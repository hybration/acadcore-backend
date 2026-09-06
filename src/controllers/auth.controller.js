const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const { generateRefreshToken, hashToken } = require('../utils/tokens');

const REFRESH_TOKEN_TTL_DAYS = 30;

function signAccessToken(user) {
  const tokenPayload = {
    userId: user.user_id,
    institutionId: user.institution_id,
    facultyId: user.faculty_id,
    departmentId: user.department_id,
    roleName: user.role_name,
    permissions: user.permissions || [],
  };
  return jwt.sign(tokenPayload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
  });
}

async function issueRefreshToken(userId, req) {
  const refreshToken = generateRefreshToken();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await query(
    `INSERT INTO user_sessions (user_id, refresh_token_hash, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, hashToken(refreshToken), req.ip, req.headers['user-agent'] || null, expiresAt]
  );

  return refreshToken;
}

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const ip = req.ip;

  // Brute-force check: 5 failed attempts in 15 minutes locks out further tries.
  const recentFailures = await query(
    `SELECT COUNT(*) FROM login_attempts
     WHERE email = $1 AND was_successful = FALSE
       AND attempted_at > now() - INTERVAL '15 minutes'`,
    [email]
  );
  if (Number(recentFailures.rows[0].count) >= 5) {
    return res.status(429).json({ error: 'Too many failed attempts. Try again later.' });
  }

  const result = await query('SELECT * FROM auth_lookup_user($1)', [email]);
  const user = result.rows[0];

  const passwordOk = user ? await bcrypt.compare(password, user.password_hash) : false;

  await query(
    'INSERT INTO login_attempts (email, ip_address, was_successful) VALUES ($1, $2, $3)',
    [email, ip, Boolean(user && passwordOk)]
  );

  if (!user || !passwordOk || !user.is_active) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  if (user.two_factor_enabled) {
    // Real flow: issue a short-lived "pending 2FA" token here instead,
    // and require a second /auth/verify-2fa call before issuing the real
    // access token below. Left as a stub — wire up once you pick a TOTP library.
    return res.status(200).json({ requiresTwoFactor: true, userId: user.user_id });
  }

  const token = signAccessToken(user);
  const refreshToken = await issueRefreshToken(user.user_id, req);

  return res.json({
    token,
    refreshToken,
    user: {
      id: user.user_id,
      email: user.email,
      fullName: user.full_name,
      role: user.role_name,
      institutionId: user.institution_id,
    },
  });
}

/**
 * Exchanges a valid, non-revoked refresh token for a new access token.
 * Re-resolves the user's role/permissions from the DB rather than trusting
 * anything from the old token, so a permission change takes effect
 * immediately rather than waiting for the old access token to expire.
 */
async function refresh(req, res) {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ error: 'refreshToken is required' });
  }

  const tokenHash = hashToken(refreshToken);

  const sessionResult = await query(
    `SELECT * FROM user_sessions
     WHERE refresh_token_hash = $1 AND is_revoked = FALSE AND expires_at > now()`,
    [tokenHash]
  );
  const session = sessionResult.rows[0];

  if (!session) {
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }

  const userResult = await query('SELECT * FROM auth_lookup_user_by_id($1)', [session.user_id]);
  const user = userResult.rows[0];

  if (!user || !user.is_active) {
    return res.status(401).json({ error: 'Account is no longer active' });
  }

  await query('UPDATE user_sessions SET last_used_at = now() WHERE session_id = $1', [session.session_id]);

  const token = signAccessToken(user);
  res.json({ token });
}

/**
 * Revokes one refresh token (single-device logout). To sign a user out
 * everywhere, revoke all their sessions instead:
 *   UPDATE user_sessions SET is_revoked = TRUE WHERE user_id = $1
 */
async function logout(req, res) {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ error: 'refreshToken is required' });
  }

  await query(
    'UPDATE user_sessions SET is_revoked = TRUE WHERE refresh_token_hash = $1',
    [hashToken(refreshToken)]
  );

  res.status(204).send();
}

module.exports = { login, refresh, logout };
