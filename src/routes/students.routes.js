const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/requirePermission');
const { search, create, update, promote } = require('../controllers/students.controller');

const router = express.Router();

router.use(requireAuth);

router.get('/', requirePermission('students.search'), asyncHandler(search));
router.post('/', requirePermission('students.create'), asyncHandler(create));
router.patch('/:studentId', requirePermission('students.update'), asyncHandler(update));
router.post('/promote', requirePermission('students.update'), asyncHandler(promote));

module.exports = router;
