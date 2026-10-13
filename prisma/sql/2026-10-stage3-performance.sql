-- ============================================================================
-- TecnoID — Stage 3: Exams / Recitation / Homework / Student performance
-- (schema change, ADDITIVE) + the two NEW permission keys.
--
--   * "RecitationSession"            new table: one recitation per lesson
--   * "Recitation"."recitationSessionId"  optional FK -> "RecitationSession"
--   * "Assignment"."sessionId"       optional FK -> "ClassSession" (homework lesson)
--   * "StudentRecognition"           new table: recognition history
--   * Permission keys performance.view / performance.recognize
--
-- NOTHING is dropped, renamed or rewritten. Every existing Recitation /
-- Assignment row keeps the new columns NULL and works exactly as before; no
-- student, attendance, exam, payment or teacher row is touched.
--
-- The repo has no prisma/migrations folder, so (as with earlier releases)
-- apply this script to an EXISTING database by hand. It is IDEMPOTENT.
--   psql "$DATABASE_URL" -f prisma/sql/2026-10-stage3-performance.sql
--   npx prisma db execute --file prisma/sql/2026-10-stage3-performance.sql --schema prisma/schema.prisma
-- A brand-new development database can instead use `npx prisma db push`
-- (then run `npm run db:seed` for the permission keys).
-- Apply the Stage 1 and Stage 2 scripts first if you have not already.
-- Requires PostgreSQL 13+ (gen_random_uuid()).
-- ============================================================================

BEGIN;

-- 1. RecitationSession ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS "RecitationSession" (
  "id"             TEXT          NOT NULL,
  "organizationId" TEXT          NOT NULL,
  "branchId"       TEXT          NOT NULL,
  "groupId"        TEXT          NOT NULL,
  "sessionId"      TEXT          NOT NULL,
  "title"          TEXT,
  "date"           DATE          NOT NULL,
  "maxScore"       DECIMAL(5,2)  NOT NULL DEFAULT 10,
  "notes"          TEXT,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3)  NOT NULL,
  CONSTRAINT "RecitationSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RecitationSession_sessionId_key" ON "RecitationSession" ("sessionId");
CREATE INDEX IF NOT EXISTS "RecitationSession_organizationId_idx" ON "RecitationSession" ("organizationId");
CREATE INDEX IF NOT EXISTS "RecitationSession_groupId_idx" ON "RecitationSession" ("groupId");
CREATE INDEX IF NOT EXISTS "RecitationSession_date_idx" ON "RecitationSession" ("date");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RecitationSession_groupId_fkey') THEN
    ALTER TABLE "RecitationSession"
      ADD CONSTRAINT "RecitationSession_groupId_fkey"
      FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RecitationSession_sessionId_fkey') THEN
    ALTER TABLE "RecitationSession"
      ADD CONSTRAINT "RecitationSession_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "ClassSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 2. Recitation.recitationSessionId ---------------------------------------------
ALTER TABLE "Recitation" ADD COLUMN IF NOT EXISTS "recitationSessionId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Recitation_recitationSessionId_studentId_key"
  ON "Recitation" ("recitationSessionId", "studentId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Recitation_recitationSessionId_fkey') THEN
    ALTER TABLE "Recitation"
      ADD CONSTRAINT "Recitation_recitationSessionId_fkey"
      FOREIGN KEY ("recitationSessionId") REFERENCES "RecitationSession"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 3. Assignment.sessionId (homework <-> lesson) -----------------------------------
ALTER TABLE "Assignment" ADD COLUMN IF NOT EXISTS "sessionId" TEXT;
CREATE INDEX IF NOT EXISTS "Assignment_sessionId_idx" ON "Assignment" ("sessionId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Assignment_sessionId_fkey') THEN
    ALTER TABLE "Assignment"
      ADD CONSTRAINT "Assignment_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "ClassSession"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 4. StudentRecognition ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS "StudentRecognition" (
  "id"             TEXT         NOT NULL,
  "organizationId" TEXT         NOT NULL,
  "branchId"       TEXT         NOT NULL,
  "studentId"      TEXT         NOT NULL,
  "reason"         TEXT         NOT NULL,
  "recognizedAt"   DATE         NOT NULL,
  "notes"          TEXT,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentRecognition_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "StudentRecognition_organizationId_idx" ON "StudentRecognition" ("organizationId");
CREATE INDEX IF NOT EXISTS "StudentRecognition_studentId_idx" ON "StudentRecognition" ("studentId");
CREATE INDEX IF NOT EXISTS "StudentRecognition_recognizedAt_idx" ON "StudentRecognition" ("recognizedAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentRecognition_studentId_fkey') THEN
    ALTER TABLE "StudentRecognition"
      ADD CONSTRAINT "StudentRecognition_studentId_fkey"
      FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 5. Permission keys --------------------------------------------------------------
-- prisma/seed.ts only runs on fresh development databases, so roles that already
-- exist never receive keys added later to src/lib/permissions.ts.
--   performance.view       open the Student performance page
--   performance.recognize  record a recognition
-- Granted by default to SUPER_ADMIN, CENTER_OWNER, MANAGER and TEACHER
-- (adjust other roles from Users & Permissions).
INSERT INTO "Permission" ("id", "key", "module", "description")
VALUES
  (gen_random_uuid()::text, 'performance.view',      'performance', NULL),
  (gen_random_uuid()::text, 'performance.recognize', 'performance', NULL)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("id", "roleId", "permissionId")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."key" IN ('performance.view', 'performance.recognize')
WHERE r."name" IN ('SUPER_ADMIN', 'CENTER_OWNER', 'MANAGER', 'TEACHER')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

COMMIT;
