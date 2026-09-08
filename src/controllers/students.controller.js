const { withTenant } = require('../db');

async function search(req, res) {
  const { q = '' } = req.query;

  const rows = await withTenant(req.user.institutionId, async (client) => {
    const result = await client.query(
      `SELECT st.student_id, st.matric_number,
              st.first_name || ' ' || st.last_name AS full_name,
              pr.name AS programme_name, st.status,
              st.current_level_id, lv.name AS level_name
       FROM students st
       JOIN programmes pr ON pr.programme_id = st.programme_id
       LEFT JOIN levels lv ON lv.level_id = st.current_level_id
       WHERE st.status != 'graduated'
         AND (
           st.matric_number ILIKE '%' || $1 || '%'
           OR st.first_name ILIKE '%' || $1 || '%'
           OR st.last_name ILIKE '%' || $1 || '%'
         )
       ORDER BY st.last_name, st.first_name
       LIMIT 50`,
      [q]
    );
    return result.rows;
  });

  res.json(rows);
}

async function create(req, res) {
  const {
    programmeId, admissionSessionId, currentLevelId, matricNumber,
    firstName, middleName, lastName, gender, dateOfBirth, email, phoneNumber,
  } = req.body;

  if (!programmeId || !matricNumber || !firstName || !lastName) {
    return res.status(400).json({ error: 'programmeId, matricNumber, firstName, lastName are required' });
  }

  try {
    const student = await withTenant(req.user.institutionId, async (client) => {
      const result = await client.query(
        `INSERT INTO students (
           institution_id, programme_id, admission_session_id, current_level_id, matric_number,
           first_name, middle_name, last_name, gender, date_of_birth, email, phone_number
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING student_id, matric_number, first_name, last_name, status`,
        [
          req.user.institutionId, programmeId, admissionSessionId, currentLevelId || null, matricNumber,
          firstName, middleName || null, lastName, gender || null,
          dateOfBirth || null, email || null, phoneNumber || null,
        ]
      );

      await client.query(
        `INSERT INTO audit_logs (user_id, institution_id, action, entity_type, entity_id, new_value, ip_address)
         VALUES ($1, $2, 'student.create', 'students', $3, $4::jsonb, $5)`,
        [req.user.userId, req.user.institutionId, result.rows[0].student_id, JSON.stringify(result.rows[0]), req.ip]
      );

      return result.rows[0];
    });

    res.status(201).json(student);
  } catch (err) {
    if (err.code === '23505') { // unique_violation
      return res.status(409).json({ error: 'A student with this matric number already exists' });
    }
    throw err;
  }
}

/**
 * General student update — used today for level promotion
 * (`currentLevelId`), but accepts any of the same editable fields as
 * create so it can grow into a general edit form later without another
 * endpoint. Deliberately does NOT allow changing `status` here — that's
 * exclusively the job of the graduate-conversion flow, to keep "student
 * became a graduate" as one deliberate, audited action rather than a
 * side effect of a generic field edit.
 */
async function update(req, res) {
  const { studentId } = req.params;
  const { currentLevelId, programmeId, email, phoneNumber } = req.body;

  const student = await withTenant(req.user.institutionId, async (client) => {
    const before = await client.query(
      `SELECT current_level_id FROM students WHERE student_id = $1`,
      [studentId]
    );
    if (!before.rows[0]) return null;

    const result = await client.query(
      `UPDATE students SET
         current_level_id = COALESCE($2, current_level_id),
         programme_id = COALESCE($3, programme_id),
         email = COALESCE($4, email),
         phone_number = COALESCE($5, phone_number),
         updated_at = now()
       WHERE student_id = $1
       RETURNING student_id, matric_number, first_name, last_name, current_level_id, status`,
      [studentId, currentLevelId || null, programmeId || null, email || null, phoneNumber || null]
    );

    if (currentLevelId && currentLevelId !== before.rows[0].current_level_id) {
      await client.query(
        `INSERT INTO audit_logs (user_id, institution_id, action, entity_type, entity_id, old_value, new_value, ip_address)
         VALUES ($1,$2,'student.level_change','students',$3,$4::jsonb,$5::jsonb,$6)`,
        [
          req.user.userId, req.user.institutionId, studentId,
          JSON.stringify({ current_level_id: before.rows[0].current_level_id }),
          JSON.stringify({ current_level_id: currentLevelId }),
          req.ip,
        ]
      );
    }

    return result.rows[0];
  });

  if (!student) return res.status(404).json({ error: 'Student not found' });
  res.json(student);
}

/**
 * Bulk promotion: moves every active student currently at `fromLevelId`
 * to `toLevelId` in one transaction, optionally scoped to a single
 * programme (e.g. promote only Criminology's 100L, not every 100L
 * student institution-wide). New students admitted afterward are
 * registered directly at whatever level the admin picks on the
 * registration form (see students.controller.js `create`) — this
 * endpoint only moves EXISTING students, it never touches admission.
 *
 * Graduated/withdrawn/suspended students are deliberately excluded
 * (WHERE status = 'active') — promotion is a statement about ongoing
 * students, not a blanket level-bump for anyone who happens to be
 * sitting at that level historically.
 */
async function promote(req, res) {
  const { fromLevelId, toLevelId, programmeId } = req.body;

  if (!fromLevelId || !toLevelId) {
    return res.status(400).json({ error: 'fromLevelId and toLevelId are required' });
  }
  if (fromLevelId === toLevelId) {
    return res.status(400).json({ error: 'fromLevelId and toLevelId must be different' });
  }

  const result = await withTenant(req.user.institutionId, async (client) => {
    const updateResult = await client.query(
      `UPDATE students
       SET current_level_id = $1, updated_at = now()
       WHERE current_level_id = $2
         AND status = 'active'
         AND ($3::uuid IS NULL OR programme_id = $3)
       RETURNING student_id`,
      [toLevelId, fromLevelId, programmeId || null]
    );

    const promotedCount = updateResult.rows.length;

    if (promotedCount > 0) {
      await client.query(
        `INSERT INTO audit_logs (user_id, institution_id, action, entity_type, new_value, ip_address)
         VALUES ($1,$2,'students.bulk_promote','students',$3::jsonb,$4)`,
        [
          req.user.userId, req.user.institutionId,
          JSON.stringify({ fromLevelId, toLevelId, programmeId: programmeId || null, promotedCount }),
          req.ip,
        ]
      );
    }

    return promotedCount;
  });

  res.json({ promotedCount: result });
}

module.exports = { search, create, update, promote };
