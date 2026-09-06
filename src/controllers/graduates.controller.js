const { withTenant } = require('../db');

/**
 * Converts a student record into a graduate record. verification_code is
 * intentionally not accepted from the request body — it's generated
 * DB-side by the trigger from acadcore_verification_trigger.sql.
 */
async function convertToGraduate(req, res) {
  const { studentId } = req.params;
  const { programmeId, graduationSessionId, finalCgpa, classOfDegree, degreeAwarded } = req.body;

  if (!graduationSessionId) {
    return res.status(400).json({ error: 'graduationSessionId is required' });
  }

  const graduate = await withTenant(req.user.institutionId, async (client) => {
    await client.query(
      `UPDATE students SET status = 'graduated', updated_at = now() WHERE student_id = $1`,
      [studentId]
    );

    const result = await client.query(
      `INSERT INTO graduate_records (
         student_id, institution_id, programme_id, graduation_session_id,
         final_cgpa, class_of_degree, degree_awarded,
         graduation_status, verification_status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'approved','verified')
       RETURNING graduate_id, verification_code, final_cgpa, class_of_degree`,
      [studentId, req.user.institutionId, programmeId, graduationSessionId, finalCgpa, classOfDegree, degreeAwarded]
    );

    await client.query(
      `INSERT INTO audit_logs (user_id, institution_id, action, entity_type, entity_id, new_value, ip_address)
       VALUES ($1, $2, 'graduate.create', 'graduate_records', $3, $4::jsonb, $5)`,
      [req.user.userId, req.user.institutionId, result.rows[0].graduate_id, JSON.stringify(result.rows[0]), req.ip]
    );

    return result.rows[0];
  });

  res.status(201).json(graduate);
}

/**
 * Lists graduate records so verification codes can be looked up again
 * later, rather than only being visible at the moment of creation.
 * Searchable by name/matric number; optionally filtered by session.
 */
async function list(req, res) {
  const { q = '', sessionId } = req.query;

  const rows = await withTenant(req.user.institutionId, async (client) => {
    const result = await client.query(
      `SELECT g.graduate_id, g.verification_code, g.final_cgpa, g.class_of_degree,
              g.graduation_status, g.verification_status, g.created_at,
              st.matric_number, st.first_name || ' ' || st.last_name AS full_name,
              pr.name AS programme_name, s.name AS session_name
       FROM graduate_records g
       JOIN students st ON st.student_id = g.student_id
       JOIN programmes pr ON pr.programme_id = g.programme_id
       JOIN academic_sessions s ON s.session_id = g.graduation_session_id
       WHERE ($2::uuid IS NULL OR g.graduation_session_id = $2)
         AND (
           st.matric_number ILIKE '%' || $1 || '%'
           OR st.first_name ILIKE '%' || $1 || '%'
           OR st.last_name ILIKE '%' || $1 || '%'
           OR g.verification_code ILIKE '%' || $1 || '%'
         )
       ORDER BY g.created_at DESC
       LIMIT 100`,
      [q, sessionId || null]
    );
    return result.rows;
  });

  res.json(rows);
}

module.exports = { convertToGraduate, list };
