# AcadCore Backend

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL` (and `DB_SSL=true` if using Supabase) and `JWT_SECRET`.
3. Make sure the database has all schema files applied, in order:
   1. `acadcore_schema.sql`
   2. `acadcore_phase2_permissions.sql`
   3. `acadcore_verification_trigger.sql`
   4. `acadcore_phase4_import.sql`
   5. `acadcore_phase5_security.sql`
   6. `acadcore_auth_lookup_function.sql`
   7. `acadcore_public_verification_function.sql`
   8. `acadcore_auth_lookup_by_id_function.sql`
4. Run the three `ALTER FUNCTION ... OWNER TO acadcore_super_admin;` statements noted in files 6, 7, and 8, after creating that role (also noted, commented out, in `acadcore_phase5_security.sql`).
5. **Bootstrap the first super_admin** (there's no other way to get a first user into an empty database):
   ```
   DATABASE_URL=<your postgres superuser connection string> node scripts/seed-super-admin.js \
     --email superadmin@acadcore.com --password "changeme123!" --name "Platform Admin"
   ```
   Run this connected as `postgres` (or another role with `BYPASSRLS`) — it must bypass RLS since no tenant context exists yet.
6. Make sure `SUPER_ADMIN_DATABASE_URL` is set (see `.env.example`) — the super_admin's `POST /api/institutions` endpoint needs it to actually work.
7. Log in as the super_admin, then call `POST /api/institutions` to onboard your first real institution (this creates the institution AND its `institution_admin` in one step). From there, that institution_admin creates every other account for their institution through `POST /api/users`.

   (`scripts/seed-first-admin.js` still exists and still works — it's a lower-level alternative that creates just an `institution_admin` directly, skipping the super_admin/API layer entirely. Useful if you only ever plan to run a single institution and don't need multi-institution onboarding.)
6. `npm run dev`
7. Check `http://localhost:4000/health`

## What's here

- `src/db.js` — connection pool + `withTenant()`, the helper that sets `app.current_institution_id` for RLS on every tenant-scoped query.
- `src/middleware/auth.js` — JWT verification.
- `src/middleware/requirePermission.js` — RBAC checks against the permissions array embedded in the JWT at login.
- `src/controllers/auth.controller.js` — login, refresh, and logout. Login issues a short-lived (15 min) access token plus a 30-day refresh token (hashed with SHA-256 and stored in `user_sessions`); brute-force lockout via `login_attempts`.
- `src/controllers/users.controller.js` — list/create/deactivate users (admin-driven, matches the spec's "no self-service signup"), plus self-service password change.
- `src/controllers/students.controller.js`, `graduates.controller.js` — tenant-scoped CRUD examples following the patterns from the Phase 2 query library.
- `src/controllers/verify.controller.js` — the public, unauthenticated verification endpoint.
- `src/controllers/import.controller.js` — bulk CSV/XLSX import: upload+stage+validate in one call, then a separate commit step, matching the "1,248 found / 1,239 valid / 9 errors, review before importing" flow from the spec.
- `src/controllers/structure.controller.js` — faculties/departments/programmes/sessions/levels: list (any authenticated tenant user) and create/update (gated by the matching `.manage` permission).
- `src/utils/tokens.js` — refresh token generation/hashing.
- `src/utils/asyncHandler.js` — wraps every async route so thrown/rejected errors reach the centralized error handler (needed on Express 4).
- `src/controllers/institutions.controller.js` — super_admin-only: create a new institution + its first institution_admin in one call, and list all institutions with student/graduate counts. Uses `withSuperAdmin()` (a second connection pool on the `acadcore_super_admin` BYPASSRLS role — see `src/db.js`) since these are inherently cross-tenant operations.
- `scripts/seed-first-admin.js` — one-time bootstrap script for a single institution's first `institution_admin`, run manually, not an API endpoint. Still works, but superseded by the super_admin flow below for multi-institution setups.
- `scripts/seed-super-admin.js` — one-time bootstrap script for the very first `super_admin` account (global, not tied to any institution). From there, everything else — including onboarding institutions — happens through the API.

## Deliberately deferred (not needed yet, not forgotten)

- **2FA verification flow** — `login` returns `requiresTwoFactor: true` if a user has it enabled, but there's no `/auth/verify-2fa` endpoint, and nothing in the current setup ever sets `two_factor_enabled = true`. Not blocking anything right now; build when you actually want to turn 2FA on for a role.
- **Refresh token rotation** — each refresh currently reuses the same stored token for its full 30-day life rather than rotating it. Meaningfully weaker than rotation, worth doing before this is exposed to real users, not needed for development.
- **Import validation scale** — resolves programme/session with one query per row; fine at spec'd row counts, revisit with a pre-loaded lookup map if imports grow into the tens of thousands of rows.
- **Password reset via email** — the `password_reset_tokens` table exists from Phase 5 but nothing issues or consumes tokens yet; today, only an admin deactivating + recreating a user, or the user's own change-password endpoint, handle password problems.

## Trying it out

```
POST /api/auth/login                          { "email": "...", "password": "..." }
POST /api/auth/refresh                        { "refreshToken": "..." }
POST /api/auth/logout                         { "refreshToken": "..." }

GET  /api/users                                (Authorization: Bearer <token>)
POST /api/users                                { "email","password","fullName","roleName", ... }
POST /api/users/:userId/deactivate
PATCH /api/users/me                            { "email", "fullName" }  (self-service profile update)
POST /api/users/me/change-password             { "currentPassword","newPassword" }

GET  /api/students?q=Mubarak                   (Authorization: Bearer <token>)
POST /api/students                             (Authorization: Bearer <token>)
POST /api/graduates/from-student/:studentId    (Authorization: Bearer <token>)

POST /api/import/students                      (multipart "file"; Authorization: Bearer <token>)
GET  /api/import/:batchId
GET  /api/import/:batchId/errors
POST /api/import/:batchId/commit

GET  /api/verify/EV-2026-8F92K1                (no auth — public)

GET  /api/institutions                         (super_admin only)
POST /api/institutions                         { "institutionName","institutionSlug","adminFullName","adminEmail","adminPassword" }  (super_admin only)

GET  /api/faculties | /departments?facultyId=... | /programmes?departmentId=... | /sessions | /levels
POST /api/faculties | /departments | /programmes | /sessions | /levels   (requires the matching *.manage permission)
```

### Import file format

Column headers must match exactly (lowercase, snake_case):

- **students import**: `matric_no, first_name, last_name, programme, session, level` (programme, session, and level must match existing `programmes.name` / `academic_sessions.name` / `levels.name` values for that institution — resolved by name, not ID, since that's what a spreadsheet will contain)
- **graduates import**: `matric_no, programme, session, cgpa, class` (`matric_no` must match an existing student — the row updates that student to graduated and creates their graduate record)
