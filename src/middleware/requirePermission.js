/**
 * Usage: router.post('/students', requireAuth, requirePermission('students.create'), handler)
 * Must run after requireAuth, since it reads req.user.permissions.
 * super_admin is not special-cased here — grant it every permission at
 * the role_permissions level (already done in the Phase 2 seed) so this
 * middleware stays simple and there's one source of truth for who can do what.
 */
function requirePermission(permissionName) {
  return (req, res, next) => {
    const perms = req.user?.permissions || [];
    if (!perms.includes(permissionName)) {
      return res.status(403).json({ error: `Missing required permission: ${permissionName}` });
    }
    next();
  };
}

module.exports = { requirePermission };
