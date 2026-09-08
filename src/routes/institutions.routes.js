const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { requireSuperAdmin } = require('../middleware/requireSuperAdmin');
const { createInstitution, listInstitutions, resetAdminPassword } = require('../controllers/institutions.controller');

const router = express.Router();
router.use(requireAuth);
router.use(requireSuperAdmin);

router.get('/', asyncHandler(listInstitutions));
router.post('/', asyncHandler(createInstitution));
router.post('/admins/:userId/reset-password', asyncHandler(resetAdminPassword));

module.exports = router;
