const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const rateLimit = require('express-rate-limit');
const { login, refresh, logout } = require('../controllers/auth.controller');

const router = express.Router();

// Extra layer on top of the DB-level login_attempts check: caps raw
// request volume per IP regardless of which email is being tried.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login requests from this IP, try again later.' },
});

router.post('/login', loginLimiter, asyncHandler(login));
router.post('/refresh', asyncHandler(refresh));
router.post('/logout', asyncHandler(logout));

module.exports = router;
