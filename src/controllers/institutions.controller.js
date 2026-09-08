const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { withSuperAdmin } = require('../db');

/**
 * Creates a brand-new institution AND its first institution_admin user
 * in one call — this is what scripts/seed-first-admin.js used to do
 * manually from a developer's own machine. That script still exists for
 * the very first bootstrap (creating the first super_admin, before any
 * super_admin account exists to call this endpoint), but every
 * institution after that should go through here instead.
 */
async function createInstitution(req, res) {
  const { institutionName, institutionSlug, adminEmail, adminPassword, adminFullName } = req.body;

  if (!institutionName || !institutionSlug || !adminEmail || !adminPassword || !adminFullName) {
    return res.status(400).json({
      error: 'institutionName, institutionSlug, adminEmail, adminPassword, and adminFullName are all required',
    });
  }
  if (adminPassword.length < 8) {
    return res.status(400).json({ error: 'adminPassword must be at least 8 characters' });
  }
  if (!/^[a-z0-9-]+$/.test(institutionSlug)) {
    return res.status(400).json({ error: 'institutionSlug must be lowercase letters, numbers, and hyphens only' });
  }

  const passwordHash = await bcrypt.hash(adminPassword, 12);

  try {
    const result = await withSuperAdmin(async (client) => {
      const instResult = await client.query(
        `INSERT INTO institutions (name, slug) VALUES ($1, $2) RETURNING institution_id, name, slug`,
        [institutionName, institutionSlug]
      );
      const institution = instResult.rows[0];

      const roleResult = await client.query(`SELECT role_id FROM roles WHERE name = 'institution_admin'`);
      if (!roleResult.rows[0]) {
        throw new Error('institution_admin role not found — has the permissions seed been run?');
      }

      const userResult = await client.query(
        `INSERT INTO users (institution_id, email, password_hash, full_name, role_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING user_id, email, full_name`,
        [institution.institution_id, adminEmail, passwordHash, adminFullName, roleResult.rows[0].role_id]
      );

      await client.query(
        `INSERT INTO audit_logs (user_id, institution_id, action, entity_type, entity_id, new_value)
         VALUES ($1, $2, 'institution.create', 'institutions', $3, $4::jsonb)`,
        [
          req.user.userId, institution.institution_id, institution.institution_id,
          JSON.stringify({ institutionName, institutionSlug, adminEmail }),
        ]
      );

      return { institution, admin: userResult.rows[0] };
    });

    res.status(201).json(result);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An institution with this slug, or a user with this email, already exists' });
    }
    throw err;
  }
}

async function listInstitutions(req, res) {
  const institutions = await withSuperAdmin(async (client) => {
    const result = await client.query(
      `SELECT i.institution_id, i.name, i.slug, i.is_active, i.created_at,
              COUNT(DISTINCT s.student_id) AS student_count,
              COUNT(DISTINCT g.graduate_id) AS graduate_count,
              -- First institution_admin found for this institution (there
              -- may be more than one; this shows the earliest-created).
              (SELECT u.full_name FROM users u
                 JOIN roles r ON r.role_id = u.role_id
                WHERE u.institution_id = i.institution_id AND r.name = 'institution_admin'
                ORDER BY u.created_at ASC LIMIT 1) AS admin_full_name,
              (SELECT u.email FROM users u
                 JOIN roles r ON r.role_id = u.role_id
                WHERE u.institution_id = i.institution_id AND r.name = 'institution_admin'
                ORDER BY u.created_at ASC LIMIT 1) AS admin_email,
              (SELECT u.user_id FROM users u
                 JOIN roles r ON r.role_id = u.role_id
                WHERE u.institution_id = i.institution_id AND r.name = 'institution_admin'
                ORDER BY u.created_at ASC LIMIT 1) AS admin_user_id
       FROM institutions i
       LEFT JOIN students s ON s.institution_id = i.institution_id
       LEFT JOIN graduate_records g ON g.institution_id = i.institution_id
       GROUP BY i.institution_id
       ORDER BY i.created_at DESC`
    );
    return result.rows;
  });
  res.json(institutions);
}

/**
 * Sets a NEW password for an institution's admin and returns it once, in
 * the response — the same "show it once, share it directly" pattern as
 * creating a user. There is no way to retrieve an EXISTING password
 * (it's bcrypt-hashed — one-way, by design, same as every account on
 * this platform); resetting to a fresh known password is the only
 * legitimate way to get someone back into their account.
 */
async function resetAdminPassword(req, res) {
  const { userId } = req.params;

  const newPassword = crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 12);
  const passwordHash = await bcrypt.hash(newPassword, 12);

  const updated = await withSuperAdmin(async (client) => {
    const result = await client.query(
      `UPDATE users SET password_hash = $1, updated_at = now() WHERE user_id = $2
       RETURNING user_id, email, full_name`,
      [passwordHash, userId]
    );
    if (result.rows[0]) {
      // Revoke their existing sessions too — same reasoning as the
      // self-service password change: a stolen/lingering token shouldn't
      // keep working after a password reset.
      await client.query('UPDATE user_sessions SET is_revoked = TRUE WHERE user_id = $1', [userId]);
    }
    return result.rows[0];
  });

  if (!updated) return res.status(404).json({ error: 'User not found' });

  res.json({ ...updated, newPassword });
}

module.exports = { createInstitution, listInstitutions, resetAdminPassword };
