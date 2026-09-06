const multer = require('multer');

// Memory storage — files are small (student/graduate spreadsheets), no
// need to touch disk. 10MB is generous for a CSV/XLSX of a few thousand rows.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

module.exports = upload;
