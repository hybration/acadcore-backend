const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const authRoutes = require('./routes/auth.routes');
const studentsRoutes = require('./routes/students.routes');
const graduatesRoutes = require('./routes/graduates.routes');
const verifyRoutes = require('./routes/verify.routes');
const importRoutes = require('./routes/import.routes');
const structureRoutes = require('./routes/structure.routes');
const usersRoutes = require('./routes/users.routes');
const institutionsRoutes = require('./routes/institutions.routes');

const app = express();

// Render (and most hosting platforms) sit behind a reverse proxy, which
// sets X-Forwarded-For to the real client IP. Express doesn't trust that
// header by default (a request could forge it directly otherwise), so
// express-rate-limit can't safely use it for its per-IP limits until we
// explicitly say to trust it. `1` means trust exactly one hop of proxy
// (Render's own load balancer) — appropriate here since we're not behind
// multiple chained proxies.
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({
  // In production, only the deployed frontend should be allowed to call
  // this API from a browser. FRONTEND_URL is set via env var; falls back
  // to allowing all origins in local dev when it's not set, so nothing
  // breaks on your existing local setup.
  origin: process.env.FRONTEND_URL || true,
  credentials: true,
}));
app.use(express.json());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/students', studentsRoutes);
app.use('/api/graduates', graduatesRoutes);
app.use('/api/verify', verifyRoutes); // public, no auth
app.use('/api/import', importRoutes);
app.use('/api', structureRoutes); // /api/faculties, /api/departments, /api/programmes, /api/sessions, /api/levels
app.use('/api/users', usersRoutes);
app.use('/api/institutions', institutionsRoutes);

// Centralized error handler. Every async route is wrapped in
// asyncHandler (src/utils/asyncHandler.js), which forwards rejected
// promises here — required on Express 4, which doesn't do this
// automatically. Errors with a `.status` (thrown deliberately, e.g. in
// import.controller.js) surface their message; anything else is masked
// to avoid leaking internals.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal server error' });
});

module.exports = app;
