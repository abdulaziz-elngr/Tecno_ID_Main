# TecnoID

TecnoID is a SaaS-style management platform for educational centers,
tutoring centers, and private-lesson providers: students, academics,
attendance, exams, finance, and communication in one system.

> **Status: Feature-complete.** Every planned phase — authentication,
> RBAC, the academic data model, attendance/QR scanning, exams and
> grading, subscriptions/payments/invoices, expenses and utilities,
> WhatsApp integration, notifications, reporting, and the full admin
> UI — has a working backend API and a matching frontend page. See
> `docs/ARCHITECTURE.md` for how each phase plugs into the whole.

## Stack

- **Frontend:** Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **Backend:** Next.js Route Handlers (API layer) + Prisma ORM
- **Database:** PostgreSQL
- **Auth:** Argon2id password hashing, signed JWT session cookie backed
  by a server-side `Session` table (real revocation, not just a
  client-side cookie)
- **Validation:** Zod on every API input
- **Testing:** Vitest (unit tests for security-critical logic)

## Getting started

### 1. Prerequisites

- Node.js 20+
- A running PostgreSQL instance (local, Docker, or hosted)
- (Later phases) Redis, an S3-compatible bucket, WhatsApp Business
  Platform credentials

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

- `DATABASE_URL` — your PostgreSQL connection string
- `AUTH_SECRET` — a long random secret: `openssl rand -base64 48`

### 4. Run database migrations

```bash
npm run prisma:migrate
```

> **Upgrading an existing database?** Apply the additive, idempotent script
> `prisma/sql/2026-10-stage1-groups-subjects.sql` (adds `Group.subjectId`,
> `Subject.code` and the `TeacherSubject` table). See `docs/DATABASE.md`.

### 5. Seed demo data (development only)

```bash
npm run db:seed
```

This creates a demo organization, branch, all default roles, a
handful of demo users, and a few demo students. Login credentials are
printed at the end of the seed run. **Never run this against a
production database** — every record is clearly labeled as demo data.

### 6. Run the app

```bash
npm run dev
```

Visit `http://localhost:3000`. You'll be redirected to `/login`.

### 7. Run tests

```bash
npm test
```

## Project layout

```
prisma/schema.prisma      Database schema (all phases — see docs/DATABASE.md)
prisma/seed.ts             Demo data seed script (all phases)
src/lib/                   Core services: db, auth, session, rbac,
                            permissions, password hashing, audit log,
                            i18n, theming, attendance/billing/grading/
                            analytics rules, WhatsApp, templates
src/app/api/                API route handlers (see docs/API.md)
src/app/(auth)/login/       Login page
src/app/dashboard/          Authenticated app shell + all pages
src/components/             Shared UI (Sidebar, Topbar, DataTable, etc.)
docs/                       Architecture, security, RBAC, API, database,
                            deployment, backup, WhatsApp and testing docs
```

## Security notes (read before deploying)

See `docs/SECURITY.md` for the full list. Key points:

- Every protected API route re-derives the user's organization,
  branch scope, and permissions from the **server-side session** —
  never from client-supplied IDs.
- Students (and, in later phases, payments/attendance) are
  **soft-deleted only**; history is never destroyed.
- Every sensitive write is recorded in `AuditLog`.
- Passwords are hashed with Argon2id; login is rate-limited per IP and
  accounts lock out after repeated failures.

## Roadmap

See `docs/ARCHITECTURE.md` for the phase-by-phase design covering
attendance/QR scanning, make-up group rules, exams and grading,
subscriptions/payments/invoices, expenses and utilities, WhatsApp
integration, notification rules, reporting, and deployment. Further
reading:

- `docs/API.md` — route groups and conventions
- `docs/DATABASE.md` — schema orientation and invariants
- `docs/DEPLOYMENT.md` — build/deploy steps, including the
  `prisma generate` network-dependency caveat
- `docs/BACKUP.md` — backup/restore procedure
- `docs/WHATSAPP.md` — wa.me click-to-chat links (no API, no configuration)
- `docs/TESTING.md` — what's covered by the test suite

## Payments (Stage 1)

- **Prices:** Subscriptions → Academic Stage → Grade → monthly price. Changing a price appends a new `GradeFee` row; existing `Subscription`/`Payment` rows are never touched.
- **Collect:** Payments → Collect (Month → Stage → Grade → Group → search / scan). The API (`POST /api/payments/month`) refuses a month while an earlier one is unpaid (`409 OUT_OF_ORDER`) and a month already paid (`409 ALREADY_PAID`).
- **Records:** Finance → Payment Records (paid / not paid, Excel export, WhatsApp click-to-chat links — no WhatsApp API).
- **Existing database:** run `prisma/sql/2026-10-payments-stage1.sql` once before deploying (additive, idempotent). Expense/UtilityBill tables are kept untouched; only their UI/API were removed.
