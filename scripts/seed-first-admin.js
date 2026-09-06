/**
 * One-time bootstrap script: creates the first institution and its
 * super_admin user. Run this once per environment (fresh DB) — after
 * this, all further users are created through the API by an admin.
 *
 * Deliberately a standalone script, not an API endpoint: creating the
 * very first super_admin isn't something the API should ever expose
 * (there's no legitimate caller — by definition no admin exists yet to
 * authorize it), so it stays a manually-run, deliberate action instead.
 *
 * IMPORTANT: run this connected as the postgres superuser (or another
 * BYPASSRLS role) — a normal acadcore_app connection would be blocked
 * by RLS on both tables, since no app.current_institution_id can exist
 * yet.
 *
 * NOTE ON ROLE: this seeds an `institution_admin`, not `super_admin`.
 * The current backend (src/db.js) uses a single connection pool/role
 * for all requests — it does not yet implement the two-DB-role switch
 * (acadcore_app vs. acadcore_super_admin with BYPASSRLS) described
 * in the Phase 5 SQL comments. A super_admin user would hit the same
 * RLS policies as everyone else and, with no institution_id of their
 * own, would see nothing. Cross-institution super_admin support needs
 * that connection-switching logic built first — out of scope for now
 * since this deployment is single-institution to start. institution_admin
 * has full control within one institution, which is what's needed.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/seed-first-admin.js \
 *     --institution "University of Ilorin" --slug uni-ilorin \
 *     --email admin@uniilorin.edu.ng --password "changeme123!" --name "Admin Name"
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
  const { institution, slug, email, password, name } = parseArgs();

  if (!institution || !slug || !email || !password || !name) {
    console.error(
      'Usage: node scripts/seed-first-admin.js --institution "Name" --slug slug --email a@b.com --password "..." --name "Admin Name"'
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

    const existing = await client.query('SELECT institution_id FROM institutions WHERE slug = $1', [slug]);
    if (existing.rows[0]) {
      throw new Error(`An institution with slug "${slug}" already exists.`);
    }

    const instResult = await client.query(
      `INSERT INTO institutions (name, slug) VALUES ($1, $2) RETURNING institution_id`,
      [institution, slug]
    );
    const institutionId = instResult.rows[0].institution_id;

    const roleResult = await client.query(`SELECT role_id FROM roles WHERE name = 'institution_admin'`);
    if (!roleResult.rows[0]) {
      throw new Error('institution_admin role not found — did you run acadcore_phase2_permissions.sql?');
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await client.query(
      `INSERT INTO users (institution_id, email, password_hash, full_name, role_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [institutionId, email, passwordHash, name, roleResult.rows[0].role_id]
    );

    await client.query('COMMIT');
    console.log(`Created institution "${institution}" (${institutionId}) and institution_admin ${email}.`);
    console.log('You can now log in via POST /api/auth/login and create further users through the API.');
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
