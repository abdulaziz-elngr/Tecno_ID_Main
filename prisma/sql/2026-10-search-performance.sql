-- Speed: fast "contains" search for the attendance screen + global search.
--
-- Prisma's `contains` + `mode: "insensitive"` becomes  ILIKE '%term%'.  A normal
-- B-tree index (e.g. @@index([fullName])) can NOT serve a leading wildcard, so
-- Postgres scanned the whole Student table on every keystroke.  Trigram (GIN)
-- indexes make these lookups use an index instead.
--
-- Safe to run more than once. CONCURRENTLY avoids locking writes, so run each
-- statement on its own (not inside a transaction block).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Student_fullName_trgm_idx"    ON "Student" USING gin ("fullName" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Student_studentCode_trgm_idx" ON "Student" USING gin ("studentCode" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Student_phone_trgm_idx"       ON "Student" USING gin ("phone" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Parent_fullName_trgm_idx"     ON "Parent"  USING gin ("fullName" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Parent_phone_trgm_idx"        ON "Parent"  USING gin ("phone" gin_trgm_ops);

-- Scan / snapshot hot paths.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Attendance_studentId_deletedAt_idx" ON "Attendance" ("studentId", "deletedAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Attendance_sessionId_deletedAt_idx" ON "Attendance" ("sessionId", "deletedAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Subscription_studentId_idx"         ON "Subscription" ("studentId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Student_organizationId_deletedAt_idx" ON "Student" ("organizationId", "deletedAt");
