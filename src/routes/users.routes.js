const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/requirePermission');
const { listUsers, createUser, deactivateUser, changeOwnPassword, updateOwnProfile } = require('../controllers/users.controller');

const router = express.Router();
router.use(requireAuth);

router.get('/', requirePermission('users.update'), asyncHandler(listUsers));
router.post('/', requirePermission('users.create'), asyncHandler(createUser));
router.post('/:userId/deactivate', requirePermission('users.deactivate'), asyncHandler(deactivateUser));

// Any authenticated user can manage their own account — no special permission needed.
router.patch('/me', asyncHandler(updateOwnProfile));
router.post('/me/change-password', asyncHandler(changeOwnPassword));

module.exports = router;
