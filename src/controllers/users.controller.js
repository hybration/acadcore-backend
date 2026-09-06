const bcrypt = require('bcrypt');
const { withTenant, query } = require('../db');

async function listUsers(req, res) {
  const rows = await withTenant(req.user.institutionId, async (client) => {
    const r = await client.query(
      `SELECT u.user_id, u.email, u.full_name, u.is_active, u.last_login_at, u.created_at,
              r.name AS role_name, u.faculty_id, u.department_id
       FROM users u
       JOIN roles r ON r.role_id = u.role_id
       ORDER BY u.created_at DESC`
    );
    return r.rows;
  });
  res.json(rows);
}

/**
 * Creates a user with a temporary password the caller sets directly
 * (there's no invite-by-email flow yet — see README). Roles other than
 * super_admin/institution_admin are creatable here; scoping which role
 * an institution_admin is ALLOWED to grant (e.g. not letting them create
 * another institution_admin, or letting only faculty_admin+ create
 * department_admin) is a policy decision left to you — currently any
 * caller with `users.create` can assign any non-super_admin role.
 */
async function createUser(req, res) {
  const { email, password, fullName, roleName, facultyId, departmentId, studentId } = req.body;

  if (!email || !password || !fullName || !roleName) {
    return res.status(400).json({ error: 'email, password, fullName, and roleName are required' });
  }
  if (roleName === 'super_admin') {
    return res.status(400).json({ error: 'super_admin accounts cannot be created via this endpoint' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }

  const roleResult = await query('SELECT role_id FROM roles WHERE name = $1', [roleName]);
  if (!roleResult.rows[0]) {
    return res.status(400).json({ error: `Unknown role "${roleName}"` });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const user = await withTenant(req.user.institutionId, async (client) => {
      const r = await client.query(
        `INSERT INTO users (institution_id, faculty_id, department_id, student_id, email, password_hash, full_name, role_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING user_id, email, full_name, is_active`,
        [req.user.institutionId, facultyId || null, departmentId || null, studentId || null, email, passwordHash, fullName, roleResult.rows[0].role_id]
      );

      await client.query(
        `INSERT INTO audit_logs (user_id, institution_id, action, entity_type, entity_id, new_value, ip_address)
         VALUES ($1,$2,'user.create','users',$3,$4::jsonb,$5)`,
        [req.user.userId, req.user.institutionId, r.rows[0].user_id, JSON.stringify({ email, roleName }), req.ip]
      );

      return r.rows[0];
    });

    res.status(201).json(user);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }
    throw err;
  }
}

async function deactivateUser(req, res) {
  const { userId } = req.params;

  const user = await withTenant(req.user.institutionId, async (client) => {
    const r = await client.query(
      `UPDATE users SET is_active = FALSE, updated_at = now() WHERE user_id = $1
       RETURNING user_id, email, is_active`,
      [userId]
    );

    if (r.rows[0]) {
      // Deactivating an account should also kill any active sessions —
      // otherwise a live access token keeps working until it expires.
      await client.query('UPDATE user_sessions SET is_revoked = TRUE WHERE user_id = $1', [userId]);
      await client.query(
        `INSERT INTO audit_logs (user_id, institution_id, action, entity_type, entity_id, ip_address)
         VALUES ($1,$2,'user.deactivate','users',$3,$4)`,
        [req.user.userId, req.user.institutionId, userId, req.ip]
      );
    }

    return r.rows[0];
  });

  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
}

/**
 * Self-service: change your own password. Deliberately not on the same
 * endpoint as admin user creation — a normal user should only ever be
 * able to change their own password, never anyone else's, without a
 * separate "reset" flow (not built yet — see README).
 */
async function changeOwnPassword(req, res) {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'newPassword must be at least 8 characters' });
  }

  const changed = await withTenant(req.user.institutionId, async (client) => {
    const userRow = await client.query('SELECT password_hash FROM users WHERE user_id = $1', [req.user.userId]);
    if (!userRow.rows[0]) return null;

    const currentOk = await bcrypt.compare(currentPassword, userRow.rows[0].password_hash);
    if (!currentOk) {
      const err = new Error('Current password is incorrect');
      err.status = 401;
      throw err;
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await client.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE user_id = $2', [newHash, req.user.userId]);

    // Revoke existing sessions so a stolen refresh token stops working
    // once the legitimate owner changes their password.
    await client.query('UPDATE user_sessions SET is_revoked = TRUE WHERE user_id = $1', [req.user.userId]);

    return true;
  });

  if (!changed) return res.status(404).json({ error: 'User not found' });
  res.status(204).send();
}

/**
 * Self-service: update your own email and/or full name. Deliberately
 * separate from the admin `createUser`/`deactivateUser` actions above —
 * this only ever touches the caller's own row (req.user.userId), never
 * takes a target user id, so there's no way to point it at someone else's
 * account even by mistake.
 */
async function updateOwnProfile(req, res) {
  const { email, fullName } = req.body;

  if (!email && !fullName) {
    return res.status(400).json({ error: 'Provide at least one of email or fullName to update' });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'That doesn\u2019t look like a valid email address' });
  }

  try {
    const user = await withTenant(req.user.institutionId, async (client) => {
      const result = await client.query(
        `UPDATE users SET
           email = COALESCE($2, email),
           full_name = COALESCE($3, full_name),
           updated_at = now()
         WHERE user_id = $1
         RETURNING user_id, email, full_name`,
        [req.user.userId, email || null, fullName || null]
      );
      return result.rows[0];
    });

    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'That email is already in use by another account' });
    }
    throw err;
  }
}

module.exports = { listUsers, createUser, deactivateUser, changeOwnPassword, updateOwnProfile };
