const { query } = require('../db');

async function verifyByCode(req, res) {
  const { code } = req.params;

  const result = await query('SELECT * FROM verify_graduate_by_code($1)', [code]);
  const record = result.rows[0];

  // Log every attempt (hit or miss) for the verification history feature.
  await query(
    `INSERT INTO verification_requests (verification_code_used, requester_ip, result)
     VALUES ($1, $2, $3)`,
    [code, req.ip, record ? 'found' : 'not_found']
  );

  if (!record) {
    return res.status(404).json({ verified: false, message: 'No matching record found' });
  }

  res.json({ verified: true, record });
}

module.exports = { verifyByCode };
