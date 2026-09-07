const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { requireSuperAdmin } = require('../middleware/requireSuperAdmin');
const { createInstitution, listInstitutions } = require('../controllers/institutions.controller');

const router = express.Router();
router.use(requireAuth);
router.use(requireSuperAdmin);

router.get('/', asyncHandler(listInstitutions));
router.post('/', asyncHandler(createInstitution));

module.exports = router;
