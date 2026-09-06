const { withTenant } = require('../db');

/**
 * All five resources here follow the same shape: list, create, update
 * (soft — is_active toggle rather than hard delete, since departments/
 * programmes are referenced by students and shouldn't disappear from
 * history). Kept as one file since each handler is a few lines.
 */

// ---------------------------------------------------------------------
// FACULTIES
// ---------------------------------------------------------------------
async function listFaculties(req, res) {
  const rows = await withTenant(req.user.institutionId, async (client) => {
    const r = await client.query(
      `SELECT faculty_id, name, code, is_active FROM faculties ORDER BY name`
    );
    return r.rows;
  });
  res.json(rows);
}

async function createFaculty(req, res) {
  const { name, code, campusId } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const faculty = await withTenant(req.user.institutionId, async (client) => {
    const r = await client.query(
      `INSERT INTO faculties (institution_id, campus_id, name, code)
       VALUES ($1,$2,$3,$4) RETURNING faculty_id, name, code, is_active`,
      [req.user.institutionId, campusId || null, name, code || null]
    );
    return r.rows[0];
  });
  res.status(201).json(faculty);
}

async function updateFaculty(req, res) {
  const { facultyId } = req.params;
  const { name, code, isActive } = req.body;

  const faculty = await withTenant(req.user.institutionId, async (client) => {
    const r = await client.query(
      `UPDATE faculties SET
         name = COALESCE($2, name),
         code = COALESCE($3, code),
         is_active = COALESCE($4, is_active)
       WHERE faculty_id = $1
       RETURNING faculty_id, name, code, is_active`,
      [facultyId, name || null, code || null, isActive ?? null]
    );
    return r.rows[0];
  });

  if (!faculty) return res.status(404).json({ error: 'Faculty not found' });
  res.json(faculty);
}

// ---------------------------------------------------------------------
// DEPARTMENTS
// ---------------------------------------------------------------------
async function listDepartments(req, res) {
  const { facultyId } = req.query;
  const rows = await withTenant(req.user.institutionId, async (client) => {
    const r = await client.query(
      `SELECT d.department_id, d.name, d.code, d.is_active, d.faculty_id, f.name AS faculty_name
       FROM departments d
       JOIN faculties f ON f.faculty_id = d.faculty_id
       WHERE ($1::uuid IS NULL OR d.faculty_id = $1)
       ORDER BY d.name`,
      [facultyId || null]
    );
    return r.rows;
  });
  res.json(rows);
}

async function createDepartment(req, res) {
  const { facultyId, name, code } = req.body;
  if (!facultyId || !name) return res.status(400).json({ error: 'facultyId and name are required' });

  const department = await withTenant(req.user.institutionId, async (client) => {
    const r = await client.query(
      `INSERT INTO departments (faculty_id, name, code)
       VALUES ($1,$2,$3) RETURNING department_id, name, code, is_active`,
      [facultyId, name, code || null]
    );
    return r.rows[0];
  });
  res.status(201).json(department);
}

async function updateDepartment(req, res) {
  const { departmentId } = req.params;
  const { name, code, isActive } = req.body;

  const department = await withTenant(req.user.institutionId, async (client) => {
    const r = await client.query(
      `UPDATE departments SET
         name = COALESCE($2, name),
         code = COALESCE($3, code),
         is_active = COALESCE($4, is_active)
       WHERE department_id = $1
       RETURNING department_id, name, code, is_active`,
      [departmentId, name || null, code || null, isActive ?? null]
    );
    return r.rows[0];
  });

  if (!department) return res.status(404).json({ error: 'Department not found' });
  res.json(department);
}

// ---------------------------------------------------------------------
// PROGRAMMES
// ---------------------------------------------------------------------
async function listProgrammes(req, res) {
  const { departmentId } = req.query;
  const rows = await withTenant(req.user.institutionId, async (client) => {
    const r = await client.query(
      `SELECT pr.programme_id, pr.name, pr.degree_type, pr.duration_years, pr.is_active,
              pr.department_id, d.name AS department_name
       FROM programmes pr
       JOIN departments d ON d.department_id = pr.department_id
       WHERE ($1::uuid IS NULL OR pr.department_id = $1)
       ORDER BY pr.name`,
      [departmentId || null]
    );
    return r.rows;
  });
  res.json(rows);
}

async function createProgramme(req, res) {
  const { departmentId, name, degreeType, durationYears } = req.body;
  if (!departmentId || !name) return res.status(400).json({ error: 'departmentId and name are required' });

  const programme = await withTenant(req.user.institutionId, async (client) => {
    const r = await client.query(
      `INSERT INTO programmes (department_id, name, degree_type, duration_years)
       VALUES ($1,$2,$3,$4) RETURNING programme_id, name, degree_type, duration_years, is_active`,
      [departmentId, name, degreeType || null, durationYears || null]
    );
    return r.rows[0];
  });
  res.status(201).json(programme);
}

async function updateProgramme(req, res) {
  const { programmeId } = req.params;
  const { name, degreeType, durationYears, isActive } = req.body;

  const programme = await withTenant(req.user.institutionId, async (client) => {
    const r = await client.query(
      `UPDATE programmes SET
         name = COALESCE($2, name),
         degree_type = COALESCE($3, degree_type),
         duration_years = COALESCE($4, duration_years),
         is_active = COALESCE($5, is_active)
       WHERE programme_id = $1
       RETURNING programme_id, name, degree_type, duration_years, is_active`,
      [programmeId, name || null, degreeType || null, durationYears || null, isActive ?? null]
    );
    return r.rows[0];
  });

  if (!programme) return res.status(404).json({ error: 'Programme not found' });
  res.json(programme);
}

// ---------------------------------------------------------------------
// ACADEMIC SESSIONS
// ---------------------------------------------------------------------
async function listSessions(req, res) {
  const rows = await withTenant(req.user.institutionId, async (client) => {
    const r = await client.query(
      `SELECT session_id, name, start_date, end_date, is_current
       FROM academic_sessions ORDER BY start_date DESC NULLS LAST, name DESC`
    );
    return r.rows;
  });
  res.json(rows);
}

async function createSession(req, res) {
  const { name, startDate, endDate, setCurrent } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required (e.g. "2026/2027")' });

  const session = await withTenant(req.user.institutionId, async (client) => {
    if (setCurrent) {
      // Only one session can be "current" at a time.
      await client.query(`UPDATE academic_sessions SET is_current = FALSE WHERE is_current = TRUE`);
    }
    const r = await client.query(
      `INSERT INTO academic_sessions (institution_id, name, start_date, end_date, is_current)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING session_id, name, start_date, end_date, is_current`,
      [req.user.institutionId, name, startDate || null, endDate || null, Boolean(setCurrent)]
    );
    return r.rows[0];
  });
  res.status(201).json(session);
}

// ---------------------------------------------------------------------
// LEVELS
// ---------------------------------------------------------------------
async function listLevels(req, res) {
  const rows = await withTenant(req.user.institutionId, async (client) => {
    const r = await client.query(
      `SELECT level_id, name, sort_order FROM levels ORDER BY sort_order`
    );
    return r.rows;
  });
  res.json(rows);
}

async function createLevel(req, res) {
  const { name, sortOrder } = req.body;
  if (!name || sortOrder === undefined) {
    return res.status(400).json({ error: 'name and sortOrder are required' });
  }

  const level = await withTenant(req.user.institutionId, async (client) => {
    const r = await client.query(
      `INSERT INTO levels (institution_id, name, sort_order) VALUES ($1,$2,$3)
       RETURNING level_id, name, sort_order`,
      [req.user.institutionId, name, sortOrder]
    );
    return r.rows[0];
  });
  res.status(201).json(level);
}

async function updateLevel(req, res) {
  const { levelId } = req.params;
  const { name, sortOrder } = req.body;

  const level = await withTenant(req.user.institutionId, async (client) => {
    const r = await client.query(
      `UPDATE levels SET
         name = COALESCE($2, name),
         sort_order = COALESCE($3, sort_order)
       WHERE level_id = $1
       RETURNING level_id, name, sort_order`,
      [levelId, name || null, sortOrder ?? null]
    );
    return r.rows[0];
  });

  if (!level) return res.status(404).json({ error: 'Level not found' });
  res.json(level);
}

module.exports = {
  listFaculties, createFaculty, updateFaculty,
  listDepartments, createDepartment, updateDepartment,
  listProgrammes, createProgramme, updateProgramme,
  listSessions, createSession,
  listLevels, createLevel, updateLevel,
};
