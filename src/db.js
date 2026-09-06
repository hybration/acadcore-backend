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
 * Runs `fn` inside a transaction with `app.current_institution_id` set for
 * the duration of that transaction — this is what makes the Row-Level
 * Security policies from acadcore_phase5_security.sql actually scope
 * queries to the caller's institution. SET LOCAL only applies within the
 * current transaction, so every tenant-scoped query MUST go through this
 * helper rather than pool.query() directly.
 *
 * Pass institutionId = null for super_admin requests, which should instead
 * use a pool connected as the acadcore_super_admin role (BYPASSRLS) —
 * see note below.
 */
async function withTenant(institutionId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (institutionId) {
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
 * Plain query for genuinely global, non-tenant-scoped lookups only
 * (e.g. roles/permissions, or the public verification lookup, which is
 * intentionally allowed to read across tenants by verification_code).
 * Everything else should use withTenant().
 */
function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, withTenant, query };
