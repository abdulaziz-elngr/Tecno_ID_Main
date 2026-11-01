-- ============================================================================
-- TecnoID — (1) lesson formation for the teaching assistant,
--           (2) full money/fees control for the accountant.
--
--  1. New permission  lessons.plan  (form / delete monthly lesson plans, تشكيل الحصص).
--     Granted to TEACHER_ASSISTANT (his own groups only — enforced in code),
--     and to the roles that already manage lessons (SUPER_ADMIN, CENTER_OWNER, MANAGER).
--  2. ACCOUNTANT gets:  academic.fees.manage (set / change the monthly price of a grade),
--     students.view and parents.view (read-only, so students and groups show up).
--     He does NOT get students.update/create/delete or academic.groups.manage.
--
-- DATA-ONLY script: NO schema change. Only ADDS grants — nothing is removed, so manual
-- permission edits made in "Users & Permissions" are kept.
-- IDEMPOTENT: safe to run more than once.
--
-- Run (either):
--   psql "$DATABASE_URL" -f prisma/sql/2026-10-assistant-lessons-accountant-fees.sql
--   npx prisma db execute --file prisma/sql/2026-10-assistant-lessons-accountant-fees.sql --schema prisma/schema.prisma
-- Requires PostgreSQL 13+ (gen_random_uuid()).
-- ============================================================================

BEGIN;

-- 1) The new permission key.
INSERT INTO "Permission" ("id", "key", "module", "description")
VALUES (gen_random_uuid()::text, 'lessons.plan', 'lessons', 'Form and delete monthly lesson plans')
ON CONFLICT ("key") DO NOTHING;

CREATE TEMP TABLE _grants (role_name text, perm_key text) ON COMMIT DROP;

INSERT INTO _grants (role_name, perm_key) VALUES
  ('TEACHER_ASSISTANT', 'lessons.plan'),
  ('SUPER_ADMIN',       'lessons.plan'),
  ('CENTER_OWNER',      'lessons.plan'),
  ('MANAGER',           'lessons.plan'),
  ('ACCOUNTANT',        'academic.fees.manage'),
  ('ACCOUNTANT',        'students.view'),
  ('ACCOUNTANT',        'parents.view');

-- 2) Add the missing grants in every organization.
INSERT INTO "RolePermission" ("id", "roleId", "permissionId")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "Role" r
JOIN _grants g ON g.role_name = r."name"
JOIN "Permission" p ON p."key" = g.perm_key
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

COMMIT;
