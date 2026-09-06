const crypto = require('crypto');

/**
 * Refresh tokens are high-entropy random strings, not user-chosen secrets,
 * so a fast deterministic hash (SHA-256) is appropriate for storage/lookup
 * here — unlike passwords, which use bcrypt because they're low-entropy
 * and need to resist offline guessing.
 */
function generateRefreshToken() {
  return crypto.randomBytes(48).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = { generateRefreshToken, hashToken };
