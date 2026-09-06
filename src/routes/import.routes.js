const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/requirePermission');
const upload = require('../middleware/upload');
const { uploadBatch, getBatchStatus, getErrorReport, commitImport } = require('../controllers/import.controller');

const router = express.Router();

router.use(requireAuth);
router.use(requirePermission('graduates.bulk_import'));

router.post('/:importType', upload.single('file'), asyncHandler(uploadBatch));
router.get('/:batchId', asyncHandler(getBatchStatus));
router.get('/:batchId/errors', asyncHandler(getErrorReport));
router.post('/:batchId/commit', asyncHandler(commitImport));

module.exports = router;
