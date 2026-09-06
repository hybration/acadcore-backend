const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/requirePermission');
const { convertToGraduate, list } = require('../controllers/graduates.controller');

const router = express.Router();

router.use(requireAuth);

router.get('/', requirePermission('graduates.view'), asyncHandler(list));
router.post('/from-student/:studentId', requirePermission('graduates.create'), asyncHandler(convertToGraduate));

module.exports = router;
