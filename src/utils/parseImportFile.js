const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');

/**
 * Parses an uploaded CSV or XLSX file buffer into an array of plain row
 * objects keyed by the file's header row (e.g. { matric_no, name, ... }).
 * Column names are matched exactly to the header — the app expects
 * lowercase_snake_case headers like "matric_no", "first_name",
 * "programme", "session", "cgpa", "class" per the import spec.
 */
function parseImportFile(buffer, originalname) {
  const ext = (originalname.split('.').pop() || '').toLowerCase();

  if (ext === 'csv') {
    return parse(buffer, { columns: true, skip_empty_lines: true, trim: true });
  }

  if (ext === 'xlsx' || ext === 'xls') {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(sheet, { defval: '' });
  }

  throw new Error('Unsupported file type — upload a .csv or .xlsx file');
}

module.exports = { parseImportFile };
