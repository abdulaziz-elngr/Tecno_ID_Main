-- ============================================================================
-- TecnoID — Student monthly-fee exemption (additive, idempotent, no data lost).
--
--  1. Student: feeExempt / feeExemptFrom / feeExemptUntil / feeExemptReason /
--              feeExemptAt / feeExemptById
--  2. Subscription: exemptWaived (marks rows waived BY an exemption so that
--     removing the exemption restores exactly those rows)
--
-- Apply on an existing database BEFORE deploying:
--   psql "$DATABASE_URL" -f prisma/sql/2026-10-student-fee-exemption.sql
-- On a fresh development database `prisma db push` creates everything.
-- ============================================================================

BEGIN;

ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "feeExempt"       BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "feeExemptFrom"   TIMESTAMP(3);
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "feeExemptUntil"  TIMESTAMP(3);
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "feeExemptReason" TEXT;
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "feeExemptAt"     TIMESTAMP(3);
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "feeExemptById"   TEXT;

ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "exemptWaived" BOOLEAN NOT NULL DEFAULT false;

COMMIT;
