/**
 * Usage: router.post('/institutions', requireAuth, requireSuperAdmin, handler)
 * Must run after requireAuth, since it reads req.user.roleName.
 * Deliberately checks the role directly rather than a granular permission
 * — institution creation is inherently a super_admin-only, cross-tenant
 * action, not something any other role should ever be grantable.
 */
function requireSuperAdmin(req, res, next) {
  if (req.user?.roleName !== 'super_admin') {
    return res.status(403).json({ error: 'This action requires the super_admin role' });
  }
  next();
}

module.exports = { requireSuperAdmin };
