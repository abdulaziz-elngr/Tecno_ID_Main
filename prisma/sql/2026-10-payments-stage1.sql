-- ============================================================================
-- TecnoID — Payments Stage 1 (additive, idempotent, no data is deleted).
--
--  1. GradeFee table              (Stage -> Grade -> monthly price, with history)
--  2. Payment refund audit columns (refundedById / refundedAt / refundReason)
--  3. New permission              payments.reprint
--  4. Seed GradeFee from the old per-Stage SubscriptionFee (only where a grade
--     has no fee yet), so existing installations keep their prices.
--
-- The repo has no prisma/migrations folder (see the other scripts in this
-- folder), so apply this on an existing database BEFORE deploying:
--   psql "$DATABASE_URL" -f prisma/sql/2026-10-payments-stage1.sql
-- On a fresh development database `prisma db push` creates everything and
-- you can skip this file.
--
-- The Expense and UtilityBill tables are intentionally NOT dropped.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS "GradeFee" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "gradeId"        TEXT NOT NULL REFERENCES "Grade"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "amount"         DECIMAL(10,2) NOT NULL,
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "effectiveFrom"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes"          TEXT,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "GradeFee_organizationId_idx" ON "GradeFee"("organizationId");
CREATE INDEX IF NOT EXISTS "GradeFee_gradeId_effectiveFrom_idx" ON "GradeFee"("gradeId", "effectiveFrom");
CREATE INDEX IF NOT EXISTS "GradeFee_isActive_idx" ON "GradeFee"("isActive");

ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "refundedById" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "refundedAt"   TIMESTAMP(3);
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "refundReason" TEXT;

INSERT INTO "Permission" ("id", "key", "module", "description")
VALUES (gen_random_uuid()::text, 'payments.reprint', 'payments', NULL)
ON CONFLICT ("key") DO NOTHING;

-- Roles that can already record payments may reprint receipts.
INSERT INTO "RolePermission" ("id", "roleId", "permissionId")
SELECT gen_random_uuid()::text, rp."roleId", p."id"
FROM "RolePermission" rp
JOIN "Permission" cur ON cur."id" = rp."permissionId" AND cur."key" = 'payments.create'
JOIN "Permission" p   ON p."key" = 'payments.reprint'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- Carry the old per-stage price over to every grade of that stage that has none.
INSERT INTO "GradeFee" ("id", "organizationId", "gradeId", "amount", "isActive", "effectiveFrom", "notes")
SELECT gen_random_uuid()::text, sf."organizationId", g."id", sf."amount", true, sf."effectiveFrom",
       'Migrated from the per-stage subscription fee'
FROM "SubscriptionFee" sf
JOIN "Grade" g ON g."stageId" = sf."stageId"
WHERE sf."isActive" = true
  AND NOT EXISTS (SELECT 1 FROM "GradeFee" gf WHERE gf."gradeId" = g."id");

COMMIT;
