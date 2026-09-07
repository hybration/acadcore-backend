const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  // Idle client errors shouldn't crash the process
  console.error('Unexpected error on idle Postgres client', err);
});

/**
 * A second pool, connected as the acadcore_super_admin DB role (created
 * with BYPASSRLS back in Phase 5's SQL, but never actually used by the
 * app until now). This is the ONLY thing that lets genuinely cross-tenant
 * operations work — creating a brand-new institution, or listing every
 * institution — since those inherently have no single app.current_institution_id
 * to scope to. Everything else in the app should keep using the regular
 * `pool`/`withTenant` above; this one is deliberately narrow, used only
 * by the institutions controller for super_admin-only endpoints.
 *
 * SUPER_ADMIN_DATABASE_URL uses the same host/database as DATABASE_URL,
 * just with the acadcore_super_admin role's credentials instead of
 * acadcore_app's. Falls back to DATABASE_URL if unset so local dev
 * setups that haven't configured this yet don't crash outright — but
 * institutions endpoints will fail with a permissions error until it's
 * set to the real super-admin credentials.
 */
const superAdminPool = new Pool({
  connectionString: process.env.SUPER_ADMIN_DATABASE_URL || process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

superAdminPool.on('error', (err) => {
  console.error('Unexpected error on idle super-admin Postgres client', err);
});

/**
 * Runs `fn` inside a transaction with `app.current_institution_id` set for
 * the duration of that transaction — this is what makes the Row-Level
 * Security policies from acadcore_phase5_security.sql actually scope
 * queries to the caller's institution. SET LOCAL only applies within the
 * current transaction, so every tenant-scoped query MUST go through this
 * helper rather than pool.query() directly.
 */
async function withTenant(institutionId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (institutionId) {
      // NOTE: plain `SET LOCAL x = $1` is invalid — PostgreSQL's SET
      // command doesn't accept bind parameters at all (a Postgres
      // grammar limitation, not a driver issue), and fails with
      // "syntax error at or near $1" the moment a parameter is passed.
      // set_config() is the standard workaround: it's a real SQL
      // function, so it accepts parameters normally, and the third
      // argument (true) makes it transaction-local, same as SET LOCAL.
      await client.query("SELECT set_config('app.current_institution_id', $1, true)", [institutionId]);
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Runs `fn` inside a transaction on the super-admin (BYPASSRLS) pool —
 * for genuinely cross-tenant operations only (creating/listing
 * institutions). No app.current_institution_id needed or possible here,
 * since RLS doesn't apply to this role at all.
 */
async function withSuperAdmin(fn) {
  const client = await superAdminPool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Plain query for genuinely global, non-tenant-scoped lookups only
 * (e.g. roles/permissions, or the public verification lookup, which is
 * intentionally allowed to read across tenants by verification_code).
 * Everything else should use withTenant().
 */
function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, withTenant, query, withSuperAdmin };
