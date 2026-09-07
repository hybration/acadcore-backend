/**
 * One-time bootstrap script: creates the first super_admin account —
 * a global account, not tied to any institution (institution_id is
 * NULL by design; see the `users` table comment in acadcore_schema.sql).
 *
 * Run this once, ever, per deployment. After this exists, use it to log
 * in and call POST /api/institutions to onboard every institution after
 * that — you should never need scripts/seed-first-admin.js again once
 * this exists, since that script only bootstraps an institution_admin
 * for ONE institution, while this creates the account that can onboard
 * any number of institutions through the API.
 *
 * IMPORTANT: run this connected as the postgres superuser (or another
 * BYPASSRLS role) — same reasoning as seed-first-admin.js: no
 * app.current_institution_id can exist yet for a role with no
 * institution, so a normal acadcore_app connection would be blocked by
 * RLS. Postgres superuser bypasses RLS unconditionally.
 *
 * Usage:
 *   DATABASE_URL=<postgres superuser connection string> node scripts/seed-super-admin.js \
 *     --email superadmin@acadcore.com --password "changeme123!" --name "Platform Admin"
 */
require('dotenv').config();
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    args[argv[i].replace(/^--/, '')] = argv[i + 1];
  }
  return args;
}

async function main() {
  const { email, password, name } = parseArgs();

  if (!email || !password || !name) {
    console.error(
      'Usage: node scripts/seed-super-admin.js --email a@b.com --password "..." --name "Admin Name"'
    );
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query('SELECT user_id FROM users WHERE email = $1', [email]);
    if (existing.rows[0]) {
      throw new Error(`A user with email "${email}" already exists.`);
    }

    const roleResult = await client.query(`SELECT role_id FROM roles WHERE name = 'super_admin'`);
    if (!roleResult.rows[0]) {
      throw new Error('super_admin role not found — did you run acadcore_phase2_permissions.sql?');
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await client.query(
      `INSERT INTO users (institution_id, email, password_hash, full_name, role_id)
       VALUES (NULL, $1, $2, $3, $4)`,
      [email, passwordHash, name, roleResult.rows[0].role_id]
    );

    await client.query('COMMIT');
    console.log(`Created super_admin ${email}.`);
    console.log('Log in via POST /api/auth/login, then use POST /api/institutions to onboard institutions.');
    console.log('IMPORTANT: make sure SUPER_ADMIN_DATABASE_URL is set in your deployment env (see README) —');
    console.log('institutions endpoints will fail with a permissions error otherwise.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
