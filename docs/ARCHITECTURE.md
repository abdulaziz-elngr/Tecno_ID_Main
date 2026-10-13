# TecnoID Architecture

## 1. High-level design

TecnoID is built as a single Next.js application using the App Router
for both the frontend and the backend API (Route Handlers), backed by
PostgreSQL via Prisma. This keeps Phase 1–2 simple to run and deploy
while staying compatible with a future split into a dedicated NestJS
service if/when the team needs independent scaling of the API layer —
the `src/lib/*` service modules (auth, rbac, audit, permissions) are
already framework-agnostic and would port directly.

```
┌─────────────────────────────┐
│         Next.js App          │
│  ┌────────────┐ ┌──────────┐ │
│  │  App Router │ │   API    │ │
│  │  (React UI) │ │ (Routes) │ │
│  └────────────┘ └────┬─────┘ │
└──────────────────────┼───────┘
                        │
                 ┌──────▼──────┐
                 │   Prisma    │
                 └──────┬──────┘
                        │
                 ┌──────▼──────┐
                 │ PostgreSQL  │
                 └─────────────┘
```

## 2. Multi-tenancy model

```
Organization
  └─ Center
      └─ Branch
          ├─ Room
          └─ Group ── Subject (optional), Grade ── Stage
                └─ GroupStudent ── Student
```

Every tenant-owned row carries (directly or via its parent) an
`organizationId`. Every protected API route resolves `organizationId`
and the caller's `branchIds` from the **authenticated session**
(`src/lib/rbac.ts::getAuthContext`), never from the request. This is
what prevents cross-organization data leakage (spec Rule 11) and
cross-branch leakage for branch-scoped roles.

## 3. RBAC model

`User → UserRole → Role → RolePermission → Permission`, plus
`UserBranch` for branch-level scoping. `src/lib/permissions.ts` is the
single source of truth for permission keys and default role mappings,
imported by both the seed script and (indirectly, since routes check
against the DB-stored grants) the API layer — so the catalog can never
drift between what's seeded and what's enforced.

`SUPER_ADMIN` and `CENTER_OWNER` are org-wide (no `UserBranch` rows
needed); all other roles are scoped to their assigned branches.

## 4. Authentication & sessions

- Passwords: Argon2id (`src/lib/password.ts`)
- Session: signed JWT in an HTTP-only, `SameSite=strict` cookie
  (fast verification) backed by a `Session` DB row (real revocation —
  see `src/lib/session.ts`)
- Login: rate-limited per IP, with per-account lockout after 5 failed
  attempts (`src/lib/auth.ts`, `src/lib/rate-limit.ts`)

The in-memory rate limiter is fine for a single instance. For a
multi-instance production deployment, swap its store for Redis
(`REDIS_URL` is already provisioned) so limits are shared across
instances.

## 5. Audit logging

`src/lib/audit.ts::writeAuditLog` is called from every sensitive write
(student create/update/delete now; payments, attendance corrections,
grade changes, permission changes in later phases). `AuditLog` rows
are insert-only from the application layer — no update/delete API
exists for them, and reading them requires `audit_logs.view`.

## 6. Roadmap — phases beyond this foundation

Each phase extends `prisma/schema.prisma` with its own models and adds
its permission keys to `src/lib/permissions.ts`, following the same
patterns established here (server-derived scope, Zod validation, audit
logging, soft deletes for financial/history data).

| Phase | Scope |
|---|---|
| 3 ✅ | Parents, Teachers, Teacher Assistants — profiles, linking to students/groups (see below) |
| 4 ✅ | Schedule management, conflict prevention (teacher/room/group double-booking) (see below) |
| 5 | ClassSession generation, QR/barcode attendance scanning, make-up group rules |
| 6 | Exams, grades (bounded by max score), recitation, assignments |
| 7 | Subscriptions, payments, invoices (PDF), void/refund workflows |
| 8 | Expenses, electricity/water utility tracking |
| 9 | WhatsApp Business Platform integration (background jobs via Redis/BullMQ), notification rules |
| 10 | Reports (PDF/CSV export), performance analytics |
| 11 | Full Roles & Permissions UI, security hardening pass |
| 12 | Expanded unit/integration/E2E/security test suite |
| 13 | Caching, indexing review, load testing |
| 14 | Production deployment docs (Docker/Kubernetes or platform-specific), backup/restore runbooks |

## 6b. Phase 3 notes — Parents & Teachers

- `Teacher` is a real model now (not a loose string on `Group`), with
  `Group.teacherId`/`assistantId` as proper foreign keys. `isAssistant`
  distinguishes teachers from assistants for display; it is **not** a
  security boundary — access differences between `TEACHER` and
  `TEACHER_ASSISTANT` come from their RBAC role, same as every other
  role. `Teacher.userId` is an optional link so a teacher can later get
  a dashboard login without duplicating their profile data.
- `Parent` is intentionally **not** `organizationId`-scoped: the same
  phone number can be a guardian for children at different centers.
  Every parent-facing route therefore derives visibility through the
  parent's *linked students* (which are org/branch scoped), never by
  trusting a `parentId` directly — see `src/app/api/parents/route.ts`.
  Creating a parent always happens in the context of linking them to a
  specific, scope-verified student; the API upserts by phone so
  siblings share one `Parent` record instead of creating duplicates.
- Unlinking a parent from a student (`DELETE
  /api/students/:id/parents/:parentId`) removes the `StudentParent`
  join row only — the `Parent` record itself is preserved in case they
  have other children.

## 6c. Phase 4 notes — Schedule & conflict prevention

- `Schedule` stores recurring weekly slots as `dayOfWeek` +
  `startMinutes`/`endMinutes` (minutes-from-midnight), not `DateTime`
  values — this makes overlap checking simple integer comparison,
  independent of timezone or calendar date. The API accepts/returns
  `"HH:MM"` strings (`src/lib/time.ts`) and converts at the boundary.
- Conflict detection (`src/lib/scheduling.ts::findScheduleConflicts`)
  enforces spec Rule 10 for all three cases in one pass: the same
  room, the same teacher *or* assistant (checked against both sides —
  a teacher can't double-book as either role), and the same group
  overlapping itself. The overlap test itself
  (`rangesOverlap`) is a pure function with no DB dependency and has
  exhaustive unit tests covering the back-to-back boundary case
  (`end === start` must NOT count as a conflict, so classes can be
  scheduled consecutively).
- `POST /api/schedules` returns `409 Conflict` with a structured
  `conflicts[]` array (type + which group it collides with) rather
  than a generic error, so the UI can show *why* a slot was rejected.
- `POST /api/groups` enforces Rule 9 (room capacity) at creation time:
  a group's `capacity` cannot exceed its assigned room's `capacity`.

- **Stage 1 change:** the standalone *Weekly Schedule* page was removed (it was a
  redundant global list). A group's days/times are added and removed on the Group
  detail page, using the same `/api/schedules` endpoints and `Schedule` table, which
  session generation still depends on. Lesson formation will replace the page in a
  later stage.

## 7. Why some things aren't "live" yet

This codebase was generated in a sandboxed environment without
outbound network access, so it has not been run against a live
PostgreSQL instance or had `npm install` executed here. Before first
run, follow the README setup steps in your own environment (with
network access) so dependencies install and migrations can execute
against a real database.
