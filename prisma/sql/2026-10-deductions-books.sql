-- ============================================================================
-- TecnoID — (1) "خصم مبلغ" treasury deductions, (2) book / notes reservations.
--
--  Schema:  TreasuryDeduction, BookReservation, BookReservationItem, BookPayment (+ enums)
--  Data:    new permissions deductions.* and books.* and their role grants
--
-- ADDITIVE and IDEMPOTENT: nothing existing is changed or removed; safe to run twice.
-- Apply on an existing database BEFORE deploying:
--   psql "$DATABASE_URL" -f prisma/sql/2026-10-deductions-books.sql
-- On a fresh development database `prisma db push` creates everything.
-- Requires PostgreSQL 13+ (gen_random_uuid()).
-- ============================================================================

BEGIN;

DO $$ BEGIN CREATE TYPE "DeductionCategory" AS ENUM ('EQUIPMENT','SUPPLIES','MAINTENANCE','CLEANING','UTILITIES','PRINTING','TRANSPORT','HOSPITALITY','OTHER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "DeductionStatus" AS ENUM ('ACTIVE','VOIDED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "BookKind" AS ENUM ('BOOK','NOTES'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "BookReservationStatus" AS ENUM ('OPEN','CLOSED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "BookItemStatus" AS ENUM ('UNPAID','PARTIAL','RESERVED','PAID'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "TreasuryDeduction" (
  "id"              TEXT PRIMARY KEY,
  "organizationId"  TEXT NOT NULL,
  "branchId"        TEXT NOT NULL,
  "referenceNumber" TEXT NOT NULL,
  "title"           TEXT NOT NULL,
  "category"        "DeductionCategory" NOT NULL DEFAULT 'OTHER',
  "amount"          DECIMAL(10,2) NOT NULL,
  "spentAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "vendor"          TEXT,
  "requestedBy"     TEXT,
  "method"          "PaymentMethod" NOT NULL DEFAULT 'CASH',
  "notes"           TEXT,
  "status"          "DeductionStatus" NOT NULL DEFAULT 'ACTIVE',
  "recordedById"    TEXT,
  "voidedById"      TEXT,
  "voidedAt"        TIMESTAMP(3),
  "voidReason"      TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "TreasuryDeduction_referenceNumber_key" ON "TreasuryDeduction"("referenceNumber");
CREATE INDEX IF NOT EXISTS "TreasuryDeduction_organizationId_idx" ON "TreasuryDeduction"("organizationId");
CREATE INDEX IF NOT EXISTS "TreasuryDeduction_branchId_idx" ON "TreasuryDeduction"("branchId");
CREATE INDEX IF NOT EXISTS "TreasuryDeduction_spentAt_idx" ON "TreasuryDeduction"("spentAt");
CREATE INDEX IF NOT EXISTS "TreasuryDeduction_status_idx" ON "TreasuryDeduction"("status");

CREATE TABLE IF NOT EXISTS "BookReservation" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "branchId"       TEXT NOT NULL,
  "title"          TEXT NOT NULL,
  "kind"           "BookKind" NOT NULL DEFAULT 'BOOK',
  "stageId"        TEXT NOT NULL,
  "gradeId"        TEXT NOT NULL,
  "groupId"        TEXT NOT NULL,
  "bookPrice"      DECIMAL(10,2) NOT NULL,
  "reservationFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "dueDate"        TIMESTAMP(3),
  "notes"          TEXT,
  "status"         "BookReservationStatus" NOT NULL DEFAULT 'OPEN',
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "BookReservation_organizationId_idx" ON "BookReservation"("organizationId");
CREATE INDEX IF NOT EXISTS "BookReservation_branchId_idx" ON "BookReservation"("branchId");
CREATE INDEX IF NOT EXISTS "BookReservation_groupId_idx" ON "BookReservation"("groupId");
CREATE INDEX IF NOT EXISTS "BookReservation_gradeId_idx" ON "BookReservation"("gradeId");
CREATE INDEX IF NOT EXISTS "BookReservation_status_idx" ON "BookReservation"("status");

CREATE TABLE IF NOT EXISTS "BookReservationItem" (
  "id"            TEXT PRIMARY KEY,
  "reservationId" TEXT NOT NULL REFERENCES "BookReservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "studentId"     TEXT NOT NULL REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "price"         DECIMAL(10,2) NOT NULL,
  "discount"      DECIMAL(10,2) NOT NULL DEFAULT 0,
  "paidAmount"    DECIMAL(10,2) NOT NULL DEFAULT 0,
  "status"        "BookItemStatus" NOT NULL DEFAULT 'UNPAID',
  "deliveredAt"   TIMESTAMP(3),
  "notes"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "BookReservationItem_reservationId_studentId_key" ON "BookReservationItem"("reservationId","studentId");
CREATE INDEX IF NOT EXISTS "BookReservationItem_studentId_idx" ON "BookReservationItem"("studentId");
CREATE INDEX IF NOT EXISTS "BookReservationItem_status_idx" ON "BookReservationItem"("status");

CREATE TABLE IF NOT EXISTS "BookPayment" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "branchId"       TEXT NOT NULL,
  "itemId"         TEXT NOT NULL REFERENCES "BookReservationItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "studentId"      TEXT NOT NULL,
  "amount"         DECIMAL(10,2) NOT NULL,
  "method"         "PaymentMethod" NOT NULL DEFAULT 'CASH',
  "receiptNumber"  TEXT NOT NULL,
  "paidAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes"          TEXT,
  "status"         "PaymentStatus" NOT NULL DEFAULT 'COMPLETED',
  "recordedById"   TEXT,
  "voidedById"     TEXT,
  "voidedAt"       TIMESTAMP(3),
  "voidReason"     TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "BookPayment_receiptNumber_key" ON "BookPayment"("receiptNumber");
CREATE INDEX IF NOT EXISTS "BookPayment_organizationId_idx" ON "BookPayment"("organizationId");
CREATE INDEX IF NOT EXISTS "BookPayment_branchId_idx" ON "BookPayment"("branchId");
CREATE INDEX IF NOT EXISTS "BookPayment_itemId_idx" ON "BookPayment"("itemId");
CREATE INDEX IF NOT EXISTS "BookPayment_studentId_idx" ON "BookPayment"("studentId");
CREATE INDEX IF NOT EXISTS "BookPayment_paidAt_idx" ON "BookPayment"("paidAt");

-- ---------------------------------------------------------------------------
-- Permissions + grants (only ADDS; manual edits in "Users & Permissions" are kept)
-- ---------------------------------------------------------------------------
INSERT INTO "Permission" ("id", "key", "module", "description") VALUES
  (gen_random_uuid()::text, 'deductions.view',   'deductions', 'View treasury deductions'),
  (gen_random_uuid()::text, 'deductions.create', 'deductions', 'Deduct an amount from the treasury'),
  (gen_random_uuid()::text, 'deductions.void',   'deductions', 'Void a treasury deduction'),
  (gen_random_uuid()::text, 'books.view',        'books',      'View book / notes reservations'),
  (gen_random_uuid()::text, 'books.create',      'books',      'Create book / notes reservations'),
  (gen_random_uuid()::text, 'books.update',      'books',      'Edit / close book reservations'),
  (gen_random_uuid()::text, 'books.collect',     'books',      'Collect book payments'),
  (gen_random_uuid()::text, 'books.void',        'books',      'Void book payments')
ON CONFLICT ("key") DO NOTHING;

CREATE TEMP TABLE _grants (role_name text, perm_key text) ON COMMIT DROP;
INSERT INTO _grants (role_name, perm_key)
SELECT r, k FROM
  (VALUES ('SUPER_ADMIN'), ('CENTER_OWNER'), ('MANAGER'), ('ACCOUNTANT')) AS roles(r)
  CROSS JOIN
  (VALUES ('deductions.view'), ('deductions.create'), ('deductions.void'),
          ('books.view'), ('books.create'), ('books.update'), ('books.collect'), ('books.void')) AS perms(k);
INSERT INTO _grants (role_name, perm_key) VALUES
  ('RECEPTIONIST', 'books.view'),
  ('RECEPTIONIST', 'books.collect');

INSERT INTO "RolePermission" ("id", "roleId", "permissionId")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "Role" r
JOIN _grants g ON g.role_name = r."name"
JOIN "Permission" p ON p."key" = g.perm_key
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

COMMIT;
