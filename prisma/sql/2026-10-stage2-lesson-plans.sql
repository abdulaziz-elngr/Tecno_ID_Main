-- ============================================================================
-- TecnoID — Stage 2: Lesson formation / lesson scheduling (schema change, ADDITIVE)
--
--   * "LessonPlan"                 new table: one monthly plan per group
--   * "ClassSession"."planId"      optional FK -> "LessonPlan"
--   * "ClassSession"."lessonNumber" optional 1-based number inside the plan
--   * "ClassSession"."openedById" / "closedById"  who opened / closed the lesson
--
-- NOTHING is dropped, renamed or rewritten. Every existing ClassSession keeps
-- planId / lessonNumber = NULL and continues to work exactly as before; no
-- student, attendance, exam, recitation, payment or teacher row is touched.
--
-- The repo has no prisma/migrations folder, so (as with the previous releases)
-- apply this script to an EXISTING database by hand. It is IDEMPOTENT.
--   psql "$DATABASE_URL" -f prisma/sql/2026-10-stage2-lesson-plans.sql
--   npx prisma db execute --file prisma/sql/2026-10-stage2-lesson-plans.sql --schema prisma/schema.prisma
-- A brand-new development database can instead use `npx prisma db push`.
-- Apply Stage 1's script first if you have not already.
-- ============================================================================

BEGIN;

-- 1. LessonPlan ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "LessonPlan" (
  "id"             TEXT         NOT NULL,
  "organizationId" TEXT         NOT NULL,
  "branchId"       TEXT         NOT NULL,
  "groupId"        TEXT         NOT NULL,
  "year"           INTEGER      NOT NULL,
  "month"          INTEGER      NOT NULL,
  "lessonsPerWeek" INTEGER      NOT NULL,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LessonPlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LessonPlan_groupId_year_month_key"
  ON "LessonPlan" ("groupId", "year", "month");
CREATE INDEX IF NOT EXISTS "LessonPlan_organizationId_idx" ON "LessonPlan" ("organizationId");
CREATE INDEX IF NOT EXISTS "LessonPlan_branchId_idx" ON "LessonPlan" ("branchId");
CREATE INDEX IF NOT EXISTS "LessonPlan_year_month_idx" ON "LessonPlan" ("year", "month");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LessonPlan_groupId_fkey') THEN
    ALTER TABLE "LessonPlan"
      ADD CONSTRAINT "LessonPlan_groupId_fkey"
      FOREIGN KEY ("groupId") REFERENCES "Group"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 2. ClassSession columns ----------------------------------------------------
ALTER TABLE "ClassSession" ADD COLUMN IF NOT EXISTS "planId"       TEXT;
ALTER TABLE "ClassSession" ADD COLUMN IF NOT EXISTS "lessonNumber" INTEGER;
ALTER TABLE "ClassSession" ADD COLUMN IF NOT EXISTS "openedById"   TEXT;
ALTER TABLE "ClassSession" ADD COLUMN IF NOT EXISTS "closedById"   TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClassSession_planId_fkey') THEN
    ALTER TABLE "ClassSession"
      ADD CONSTRAINT "ClassSession_planId_fkey"
      FOREIGN KEY ("planId") REFERENCES "LessonPlan"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- A lesson number is unique inside its plan. Postgres treats NULLs as
-- distinct, so legacy sessions (planId NULL) can never clash.
CREATE UNIQUE INDEX IF NOT EXISTS "ClassSession_planId_lessonNumber_key"
  ON "ClassSession" ("planId", "lessonNumber");
CREATE INDEX IF NOT EXISTS "ClassSession_planId_idx" ON "ClassSession" ("planId");

COMMIT;
