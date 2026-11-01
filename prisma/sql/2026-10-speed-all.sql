-- =====================================================================
-- TecnoID — speed pack. Run ONCE on the production database.
-- (These files in prisma/sql are NOT run by `prisma migrate deploy`;
--  if you never ran them by hand, search has been scanning whole tables.)
--
-- Where to run: your database SQL editor (Supabase / Neon / etc.).
-- If the editor complains "CREATE INDEX CONCURRENTLY cannot run inside a
-- transaction block", simply delete the word CONCURRENTLY from the lines
-- below (fine for a center-sized database; the lock lasts a second or two).
-- Safe to run more than once.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Fast "contains" search (ILIKE '%term%') — students, parents, invoices
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Student_fullName_trgm_idx"    ON "Student" USING gin ("fullName" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Student_studentCode_trgm_idx" ON "Student" USING gin ("studentCode" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Student_phone_trgm_idx"       ON "Student" USING gin ("phone" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Parent_fullName_trgm_idx"     ON "Parent"  USING gin ("fullName" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Parent_phone_trgm_idx"        ON "Parent"  USING gin ("phone" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Invoice_invoiceNumber_trgm_idx" ON "Invoice" USING gin ("invoiceNumber" gin_trgm_ops);

-- Attendance / scan hot paths
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Attendance_studentId_deletedAt_idx" ON "Attendance" ("studentId", "deletedAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Attendance_sessionId_deletedAt_idx" ON "Attendance" ("sessionId", "deletedAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Subscription_studentId_idx"         ON "Subscription" ("studentId");

-- Students list: filter by organization + newest first
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Student_organizationId_deletedAt_idx" ON "Student" ("organizationId", "deletedAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Student_organizationId_createdAt_idx" ON "Student" ("organizationId", "createdAt" DESC);

-- Payments / subscriptions lookups per student and month
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Subscription_studentId_period_idx" ON "Subscription" ("studentId", "periodYear", "periodMonth");

-- Refresh planner statistics so the new indexes are used right away
ANALYZE "Student";
ANALYZE "Parent";
ANALYZE "Attendance";
ANALYZE "Subscription";
ANALYZE "Invoice";
