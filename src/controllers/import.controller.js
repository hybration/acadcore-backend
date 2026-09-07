const { withTenant } = require('../db');
const { parseImportFile } = require('../utils/parseImportFile');

/**
 * NOTE ON SCALE: validation below resolves programme/session per staged
 * row with individual queries (simplest to read/verify correctness for
 * a first pass). Fine for the hundreds-of-rows imports described in the
 * spec; if imports grow into the tens of thousands of rows, switch to
 * pre-loading all of the institution's programmes/sessions into an
 * in-memory map once per batch instead of querying per row.
 */

async function uploadBatch(req, res) {
  const { importType } = req.params;
  if (!['students', 'graduates'].includes(importType)) {
    return res.status(400).json({ error: 'importType must be "students" or "graduates"' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'file is required (multipart field name "file")' });
  }

  let rows;
  try {
    rows = parseImportFile(req.file.buffer, req.file.originalname);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (rows.length === 0) {
    return res.status(400).json({ error: 'File contains no rows' });
  }

  const summary = await withTenant(req.user.institutionId, async (client) => {
    const batchResult = await client.query(
      `INSERT INTO import_batches (institution_id, uploaded_by, import_type, original_filename, total_rows, status)
       VALUES ($1,$2,$3,$4,$5,'validating')
       RETURNING batch_id`,
      [req.user.institutionId, req.user.userId, importType, req.file.originalname, rows.length]
    );
    const batchId = batchResult.rows[0].batch_id;

    for (let i = 0; i < rows.length; i++) {
      await client.query(
        `INSERT INTO import_row_staging (batch_id, row_number, raw_data) VALUES ($1,$2,$3::jsonb)`,
        [batchId, i + 1, JSON.stringify(rows[i])]
      );
    }

    const staged = await client.query(
      `SELECT staging_id, row_number, raw_data FROM import_row_staging WHERE batch_id = $1 ORDER BY row_number`,
      [batchId]
    );

    const seenMatricNumbers = new Map();

    for (const row of staged.rows) {
      const data = row.raw_data;
      const errors = [];
      const matricNo = (data.matric_no || '').toString().trim();

      if (!matricNo) errors.push(['matric_no', 'matric_no is required']);

      if (importType === 'students') {
        if (!data.first_name) errors.push(['first_name', 'first_name is required']);
        if (!data.last_name) errors.push(['last_name', 'last_name is required']);
        if (!data.level) errors.push(['level', 'level is required']);
      } else {
        if (data.cgpa === undefined || data.cgpa === '') errors.push(['cgpa', 'cgpa is required']);
        if (!data.class) errors.push(['class', 'class is required']);
      }

      if (matricNo) {
        if (seenMatricNumbers.has(matricNo)) {
          errors.push(['matric_no', `Duplicate matric_no within this file (first seen at row ${seenMatricNumbers.get(matricNo)})`]);
        } else {
          seenMatricNumbers.set(matricNo, row.row_number);
        }
      }

      let programmeId = null;
      if (data.programme) {
        const pr = await client.query(
          `SELECT pr.programme_id FROM programmes pr
           JOIN departments d ON d.department_id = pr.department_id
           JOIN faculties f ON f.faculty_id = d.faculty_id
           WHERE f.institution_id = $1 AND pr.name ILIKE $2
           LIMIT 1`,
          [req.user.institutionId, data.programme]
        );
        if (pr.rows[0]) programmeId = pr.rows[0].programme_id;
        else errors.push(['programme', `Programme "${data.programme}" not found`]);
      } else {
        errors.push(['programme', 'programme is required']);
      }

      let sessionId = null;
      if (data.session) {
        const s = await client.query(
          `SELECT session_id FROM academic_sessions WHERE institution_id = $1 AND name = $2 LIMIT 1`,
          [req.user.institutionId, data.session]
        );
        if (s.rows[0]) sessionId = s.rows[0].session_id;
        else errors.push(['session', `Session "${data.session}" not found`]);
      } else {
        errors.push(['session', 'session is required']);
      }

      let levelId = null;
      if (importType === 'students' && data.level) {
        const lv = await client.query(
          `SELECT level_id FROM levels WHERE institution_id = $1 AND name ILIKE $2 LIMIT 1`,
          [req.user.institutionId, data.level]
        );
        if (lv.rows[0]) levelId = lv.rows[0].level_id;
        else errors.push(['level', `Level "${data.level}" not found`]);
      }

      if (matricNo && importType === 'students') {
        const existing = await client.query(
          `SELECT 1 FROM students WHERE institution_id = $1 AND matric_number = $2`,
          [req.user.institutionId, matricNo]
        );
        if (existing.rows[0]) errors.push(['matric_no', 'A student with this matric number already exists']);
      }

      const isValid = errors.length === 0;

      await client.query(
        `UPDATE import_row_staging SET is_valid = $1, resolved_programme_id = $2, resolved_session_id = $3, resolved_level_id = $4
         WHERE staging_id = $5`,
        [isValid, programmeId, sessionId, levelId, row.staging_id]
      );

      for (const [field, message] of errors) {
        await client.query(
          `INSERT INTO import_row_errors (staging_id, field_name, error_message) VALUES ($1,$2,$3)`,
          [row.staging_id, field, message]
        );
      }
    }

    const counts = await client.query(
      `SELECT COUNT(*) FILTER (WHERE is_valid) AS valid_count,
              COUNT(*) FILTER (WHERE NOT is_valid) AS invalid_count
       FROM import_row_staging WHERE batch_id = $1`,
      [batchId]
    );

    await client.query(
      `UPDATE import_batches SET valid_rows = $2, invalid_rows = $3, status = 'validated', validated_at = now()
       WHERE batch_id = $1`,
      [batchId, counts.rows[0].valid_count, counts.rows[0].invalid_count]
    );

    return {
      batchId,
      totalRows: rows.length,
      validRows: Number(counts.rows[0].valid_count),
      invalidRows: Number(counts.rows[0].invalid_count),
    };
  });

  res.status(201).json(summary);
}

async function getBatchStatus(req, res) {
  const { batchId } = req.params;
  const batch = await withTenant(req.user.institutionId, async (client) => {
    const r = await client.query(`SELECT * FROM import_batches WHERE batch_id = $1`, [batchId]);
    return r.rows[0];
  });
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  res.json(batch);
}

async function getErrorReport(req, res) {
  const { batchId } = req.params;
  const rows = await withTenant(req.user.institutionId, async (client) => {
    const r = await client.query(
      `SELECT irs.row_number, irs.raw_data, ie.field_name, ie.error_message
       FROM import_row_errors ie
       JOIN import_row_staging irs ON irs.staging_id = ie.staging_id
       WHERE irs.batch_id = $1
       ORDER BY irs.row_number`,
      [batchId]
    );
    return r.rows;
  });
  res.json(rows);
}

/**
 * Imports only the valid, not-yet-imported staged rows. Idempotent-ish:
 * calling it twice on the same batch won't double-import, since committed
 * rows get imported_at set and are excluded from the next run.
 */
async function commitImport(req, res) {
  const { batchId } = req.params;

  const result = await withTenant(req.user.institutionId, async (client) => {
    const batchRes = await client.query(`SELECT * FROM import_batches WHERE batch_id = $1`, [batchId]);
    const batch = batchRes.rows[0];

    if (!batch) {
      const err = new Error('Batch not found');
      err.status = 404;
      throw err;
    }
    if (batch.status !== 'validated' && batch.status !== 'importing') {
      const err = new Error(`Batch is not ready to import (status: ${batch.status})`);
      err.status = 400;
      throw err;
    }

    await client.query(`UPDATE import_batches SET status = 'importing' WHERE batch_id = $1`, [batchId]);

    const validRows = await client.query(
      `SELECT * FROM import_row_staging WHERE batch_id = $1 AND is_valid = TRUE AND imported_at IS NULL`,
      [batchId]
    );

    let importedCount = 0;

    if (batch.import_type === 'students') {
      for (const row of validRows.rows) {
        const data = row.raw_data;
        await client.query(
          `INSERT INTO students (institution_id, programme_id, admission_session_id, current_level_id, matric_number, first_name, last_name, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'active')`,
          [req.user.institutionId, row.resolved_programme_id, row.resolved_session_id, row.resolved_level_id, data.matric_no, data.first_name, data.last_name]
        );
        await client.query(`UPDATE import_row_staging SET imported_at = now() WHERE staging_id = $1`, [row.staging_id]);
        importedCount++;
      }
    } else {
      // graduates: matric_no must match an existing student
      for (const row of validRows.rows) {
        const data = row.raw_data;
        const studentRes = await client.query(
          `SELECT student_id FROM students WHERE institution_id = $1 AND matric_number = $2`,
          [req.user.institutionId, data.matric_no]
        );
        const student = studentRes.rows[0];

        if (!student) {
          await client.query(
            `INSERT INTO import_row_errors (staging_id, field_name, error_message)
             VALUES ($1, 'matric_no', 'No matching student found at import time')`,
            [row.staging_id]
          );
          continue;
        }

        await client.query(
          `UPDATE students SET status = 'graduated', updated_at = now() WHERE student_id = $1`,
          [student.student_id]
        );
        await client.query(
          `INSERT INTO graduate_records (student_id, institution_id, programme_id, graduation_session_id, final_cgpa, class_of_degree, graduation_status, verification_status)
           VALUES ($1,$2,$3,$4,$5,$6,'approved','verified')`,
          [student.student_id, req.user.institutionId, row.resolved_programme_id, row.resolved_session_id, data.cgpa, data.class]
        );
        await client.query(`UPDATE import_row_staging SET imported_at = now() WHERE staging_id = $1`, [row.staging_id]);
        importedCount++;
      }
    }

    await client.query(
      `UPDATE import_batches SET status = 'completed', imported_rows = $2, imported_at = now() WHERE batch_id = $1`,
      [batchId, importedCount]
    );

    await client.query(
      `INSERT INTO audit_logs (user_id, institution_id, action, entity_type, entity_id, new_value, ip_address)
       VALUES ($1,$2,'import.commit','import_batches',$3,$4::jsonb,$5)`,
      [req.user.userId, req.user.institutionId, batchId, JSON.stringify({ importedCount }), req.ip]
    );

    return { batchId, importedCount };
  });

  res.json(result);
}

module.exports = { uploadBatch, getBatchStatus, getErrorReport, commitImport };
