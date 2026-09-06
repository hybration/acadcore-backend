const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const rateLimit = require('express-rate-limit');
const { verifyByCode } = require('../controllers/verify.controller');

const router = express.Router();

// Public endpoint — no requireAuth. Rate-limited to deter scraping/enumeration
// of verification codes.
const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Too many verification requests, try again later.' },
});

router.get('/:code', verifyLimiter, asyncHandler(verifyByCode));

module.exports = router;
