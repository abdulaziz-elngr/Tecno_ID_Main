-- ============================================================================
-- TecnoID — several assistants (معلم مساعد) in the SAME group.
--
-- Adds the "GroupAssistant" join table (group <-> assistant, many-to-many) and copies
-- the existing single assistant of every group into it. "Group"."assistantId" is NOT
-- removed: it stays as a mirror of the first assistant (sessions / schedules use it).
--
-- No data is deleted or changed. IDEMPOTENT: safe to run more than once.
-- Run it BEFORE deploying the new code.
-- ============================================================================

SET lock_timeout = '15s';

CREATE TABLE IF NOT EXISTS "GroupAssistant" (
  "id"        TEXT         NOT NULL,
  "groupId"   TEXT         NOT NULL,
  "teacherId" TEXT         NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GroupAssistant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GroupAssistant_groupId_teacherId_key" ON "GroupAssistant"("groupId", "teacherId");
CREATE INDEX IF NOT EXISTS "GroupAssistant_teacherId_idx" ON "GroupAssistant"("teacherId");

DO $$
BEGIN
  ALTER TABLE "GroupAssistant"
    ADD CONSTRAINT "GroupAssistant_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "GroupAssistant"
    ADD CONSTRAINT "GroupAssistant_teacherId_fkey"
    FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Copy today's single assistant of each live group into the new table.
INSERT INTO "GroupAssistant" ("id", "groupId", "teacherId")
SELECT gen_random_uuid()::text, g."id", g."assistantId"
FROM "Group" g
WHERE g."assistantId" IS NOT NULL AND g."deletedAt" IS NULL
ON CONFLICT ("groupId", "teacherId") DO NOTHING;
