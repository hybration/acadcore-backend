const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/requirePermission');
const ctrl = require('../controllers/structure.controller');

const router = express.Router();
router.use(requireAuth);

// Faculties — reading the structure is open to any authenticated user in
// the tenant (e.g. a department_admin needs to see faculties/programmes
// to register a student); only writes are gated by .manage permissions.
router.get('/faculties', asyncHandler(ctrl.listFaculties));
router.post('/faculties', requirePermission('faculties.manage'), asyncHandler(ctrl.createFaculty));
router.patch('/faculties/:facultyId', requirePermission('faculties.manage'), asyncHandler(ctrl.updateFaculty));

// Departments
router.get('/departments', asyncHandler(ctrl.listDepartments));
router.post('/departments', requirePermission('departments.manage'), asyncHandler(ctrl.createDepartment));
router.patch('/departments/:departmentId', requirePermission('departments.manage'), asyncHandler(ctrl.updateDepartment));

// Programmes
router.get('/programmes', asyncHandler(ctrl.listProgrammes));
router.post('/programmes', requirePermission('programmes.manage'), asyncHandler(ctrl.createProgramme));
router.patch('/programmes/:programmeId', requirePermission('programmes.manage'), asyncHandler(ctrl.updateProgramme));

// Academic sessions
router.get('/sessions', asyncHandler(ctrl.listSessions));
router.post('/sessions', requirePermission('sessions.manage'), asyncHandler(ctrl.createSession));

// Levels
router.get('/levels', asyncHandler(ctrl.listLevels));
router.post('/levels', requirePermission('levels.manage'), asyncHandler(ctrl.createLevel));
router.patch('/levels/:levelId', requirePermission('levels.manage'), asyncHandler(ctrl.updateLevel));

module.exports = router;
