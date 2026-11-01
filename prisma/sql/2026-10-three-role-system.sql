-- ============================================================================
-- TecnoID — three-role system on an EXISTING database.
--
--   CENTER_OWNER       center owner: everything (unchanged).
--   ACCOUNTANT         subscriptions & payments ONLY, for all students/stages/groups.
--   TEACHER_ASSISTANT  attendance, recitation, homework, exams/grades and student
--                      performance of the group(s) he is responsible for only.
--
-- DATA-ONLY script: NO schema change, no `prisma migrate` needed.
-- The group restriction itself is enforced by the application code
-- (src/lib/group-access.ts) — this script only aligns the permission keys that
-- the ACCOUNTANT and TEACHER_ASSISTANT roles hold in a database that was seeded
-- earlier (prisma/seed.ts only runs on fresh development databases).
--
-- WARNING: it RESETS those two roles to the defaults below in EVERY organization,
-- so any manual permission edits made to them in "Users & Permissions" are replaced.
-- IDEMPOTENT: safe to run more than once.
--
-- Run (either):
--   psql "$DATABASE_URL" -f prisma/sql/2026-10-three-role-system.sql
--   npx prisma db execute --file prisma/sql/2026-10-three-role-system.sql --schema prisma/schema.prisma
-- Requires PostgreSQL 13+ (gen_random_uuid()).
-- ============================================================================

BEGIN;

CREATE TEMP TABLE _role_defaults (role_name text, perm_key text) ON COMMIT DROP;

INSERT INTO _role_defaults (role_name, perm_key) VALUES
  -- ACCOUNTANT
  ('ACCOUNTANT', 'payments.view'),
  ('ACCOUNTANT', 'payments.create'),
  ('ACCOUNTANT', 'payments.update'),
  ('ACCOUNTANT', 'payments.refund'),
  ('ACCOUNTANT', 'payments.void'),
  ('ACCOUNTANT', 'payments.reprint'),
  ('ACCOUNTANT', 'subscriptions.view'),
  ('ACCOUNTANT', 'subscriptions.manage'),
  ('ACCOUNTANT', 'invoices.view'),
  ('ACCOUNTANT', 'invoices.void'),
  ('ACCOUNTANT', 'reports.financial.view'),
  ('ACCOUNTANT', 'reports.export'),
  -- TEACHER_ASSISTANT
  ('TEACHER_ASSISTANT', 'students.view'),
  ('TEACHER_ASSISTANT', 'sessions.view'),
  ('TEACHER_ASSISTANT', 'attendance.view'),
  ('TEACHER_ASSISTANT', 'attendance.create'),
  ('TEACHER_ASSISTANT', 'exams.view'),
  ('TEACHER_ASSISTANT', 'exams.create'),
  ('TEACHER_ASSISTANT', 'exams.update'),
  ('TEACHER_ASSISTANT', 'grades.enter'),
  ('TEACHER_ASSISTANT', 'grades.update'),
  ('TEACHER_ASSISTANT', 'recitation.view'),
  ('TEACHER_ASSISTANT', 'recitation.manage'),
  ('TEACHER_ASSISTANT', 'assignments.view'),
  ('TEACHER_ASSISTANT', 'assignments.manage'),
  ('TEACHER_ASSISTANT', 'performance.view'),
  ('TEACHER_ASSISTANT', 'performance.recognize');

-- 1) Remove grants that are no longer part of the two roles.
DELETE FROM "RolePermission" rp
USING "Role" r, "Permission" p
WHERE rp."roleId" = r."id"
  AND rp."permissionId" = p."id"
  AND r."name" IN ('ACCOUNTANT', 'TEACHER_ASSISTANT')
  AND NOT EXISTS (
    SELECT 1 FROM _role_defaults d WHERE d.role_name = r."name" AND d.perm_key = p."key"
  );

-- 2) Add the missing grants.
INSERT INTO "RolePermission" ("id", "roleId", "permissionId")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "Role" r
JOIN _role_defaults d ON d.role_name = r."name"
JOIN "Permission" p ON p."key" = d.perm_key
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

COMMIT;
