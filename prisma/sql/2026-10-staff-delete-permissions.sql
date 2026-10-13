-- ============================================================================
-- TecnoID — grant the two NEW permission keys on an EXISTING database.
--
--   teachers.delete   (delete a Teacher / Teacher Assistant)
--   employees.delete  (delete an Employee)
--
-- This is a DATA-ONLY script. There is NO schema change in this release, so no
-- `prisma migrate` migration exists or is needed. (The repo has no
-- prisma/migrations folder; creating the first migration here would make
-- `migrate deploy` fail on an existing database with P3005.)
--
-- Why it is needed: `prisma/seed.ts` only runs on fresh development databases.
-- Roles already in a deployed database never receive permission keys added to
-- src/lib/permissions.ts later, so without this script nobody except a user
-- who is granted the keys by hand in Users & Permissions could delete.
--
-- It is IDEMPOTENT (safe to run more than once) and ADDITIVE (touches nothing
-- else). Roles that get the keys are the ones that already hold the matching
-- `*.update` capability by default: SUPER_ADMIN, CENTER_OWNER and MANAGER.
-- Grant them to any other role from Users & Permissions if you want.
--
-- Run (either):
--   psql "$DATABASE_URL" -f prisma/sql/2026-10-staff-delete-permissions.sql
--   npx prisma db execute --file prisma/sql/2026-10-staff-delete-permissions.sql --schema prisma/schema.prisma
-- Requires PostgreSQL 13+ (gen_random_uuid()).
-- ============================================================================

BEGIN;

INSERT INTO "Permission" ("id", "key", "module", "description")
VALUES
  (gen_random_uuid()::text, 'teachers.delete',  'teachers',  NULL),
  (gen_random_uuid()::text, 'employees.delete', 'employees', NULL)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("id", "roleId", "permissionId")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."key" IN ('teachers.delete', 'employees.delete')
WHERE r."name" IN ('SUPER_ADMIN', 'CENTER_OWNER', 'MANAGER')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

COMMIT;
