-- ============================================================================
-- TecnoID — Stage 1: Groups ↔ Subjects ↔ Teachers (schema change, ADDITIVE)
--
--   * "Subject"."code"            optional short code (unique per org when set)
--   * "Group"."subjectId"         optional FK -> "Subject" (existing groups stay NULL)
--   * "TeacherSubject"            new join table: which teachers teach which subjects
--   * "Group" unique index        (gradeId, name)  ->  (gradeId, subjectId, name)
--
-- NOTHING is dropped or rewritten except the old (gradeId, name) unique index,
-- which is replaced by a strictly more permissive one — every row that satisfied
-- the old rule satisfies the new rule, so no existing data can violate it.
-- No student, attendance, exam, recitation, payment or teacher row is touched.
--
-- The repo has no prisma/migrations folder, so (as with the previous release)
-- apply this script to an EXISTING database by hand. It is IDEMPOTENT.
--   psql "$DATABASE_URL" -f prisma/sql/2026-10-stage1-groups-subjects.sql
--   npx prisma db execute --file prisma/sql/2026-10-stage1-groups-subjects.sql --schema prisma/schema.prisma
-- A brand-new development database can instead use `npx prisma db push`.
-- ============================================================================

BEGIN;

-- 1. Subject.code ------------------------------------------------------------
ALTER TABLE "Subject" ADD COLUMN IF NOT EXISTS "code" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Subject_organizationId_code_key"
  ON "Subject" ("organizationId", "code");

-- 2. Group.subjectId ---------------------------------------------------------
ALTER TABLE "Group" ADD COLUMN IF NOT EXISTS "subjectId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Group_subjectId_fkey'
  ) THEN
    ALTER TABLE "Group"
      ADD CONSTRAINT "Group_subjectId_fkey"
      FOREIGN KEY ("subjectId") REFERENCES "Subject"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Group_subjectId_idx" ON "Group" ("subjectId");

-- 3. Group unique index: (gradeId, name) -> (gradeId, subjectId, name) -------
DROP INDEX IF EXISTS "Group_gradeId_name_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Group_gradeId_subjectId_name_key"
  ON "Group" ("gradeId", "subjectId", "name");

-- 4. TeacherSubject ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS "TeacherSubject" (
  "id"        TEXT         NOT NULL,
  "teacherId" TEXT         NOT NULL,
  "subjectId" TEXT         NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeacherSubject_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TeacherSubject_teacherId_subjectId_key"
  ON "TeacherSubject" ("teacherId", "subjectId");
CREATE INDEX IF NOT EXISTS "TeacherSubject_teacherId_idx" ON "TeacherSubject" ("teacherId");
CREATE INDEX IF NOT EXISTS "TeacherSubject_subjectId_idx" ON "TeacherSubject" ("subjectId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeacherSubject_teacherId_fkey') THEN
    ALTER TABLE "TeacherSubject"
      ADD CONSTRAINT "TeacherSubject_teacherId_fkey"
      FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeacherSubject_subjectId_fkey') THEN
    ALTER TABLE "TeacherSubject"
      ADD CONSTRAINT "TeacherSubject_subjectId_fkey"
      FOREIGN KEY ("subjectId") REFERENCES "Subject"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 5. Back-fill: teachers who already own groups are NOT auto-linked to subjects
--    (existing groups have no subject yet), so there is nothing to back-fill.
--    Assign a subject to each existing group from Academic → Groups afterwards.

COMMIT;
