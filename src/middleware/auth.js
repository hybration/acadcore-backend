const jwt = require('jsonwebtoken');

/**
 * Verifies the Bearer token and attaches the decoded payload to req.user.
 * Expects the token payload shaped like:
 *   { userId, institutionId, roleName, permissions: [...] }
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { requireAuth };
