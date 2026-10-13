# TecnoID API Reference

All routes live under `src/app/api/` (Next.js Route Handlers) and are
served from `/api/*`. This document is a map of what exists and the
conventions every route follows — not a full request/response schema
dump (read the route source and its Zod schema for exact fields).

## 1. Conventions

- **Auth**: every route (except `/api/health` and `/api/auth/login`)
  requires a valid session cookie. Most call `requirePermission("key")`,
  which throws `UnauthorizedError` (401) with no session, or
  `ForbiddenError` (403) without the permission. A few read-only routes
  that are safe for any authenticated user (e.g. `/api/branches`,
  `/api/search`) call `getAuthContext()` directly instead.
- **Scoping**: `organizationId` always comes from the session, never
  from the client. Branch-scoped data is additionally filtered through
  `resolveBranchScope(ctx, branchId?)` — a non-org-wide user only ever
  sees their assigned branches.
- **Validation**: every body is parsed with `readJson(request, zodSchema)`
  and every query string with `readQuery(request, zodSchema)`. A failed
  parse returns `400` with a `ValidationError`.
- **Responses**: `ok(data)` → `{ data }`; `created(data)` → `{ data }`
  with `201`; `paginated(rows, {page, pageSize, total})` →
  `{ data: rows, pagination: {..., totalPages} }`. Some list routes
  instead return `ok({ items, pagination, ...totals })` — check the
  route when in doubt, since both shapes are in use.
- **Errors**: `handleApiError(scope, err)` maps every thrown error to a
  safe `{ error: string }` JSON body with the right status code. Stack
  traces and DB details are never leaked.
- **Soft deletes**: students, payments, invoices, exams, assignments,
  employees and similar "important" records are never hard-deleted —
  look for `deletedAt` filters. Trivial/empty records (an unused
  academic grade, a role with 0 users) may be hard-deleted.
- **Audit log**: any sensitive write (delete, void, refund, permission
  change, settings change) calls `writeAuditLog(...)`. Actions that
  require a reason enforce a `reason` field (min 3 characters) in their
  Zod schema.

## 2. Route groups

| Group | Base path | Notes |
|---|---|---|
| Auth | `/api/auth/*` | login, logout, me, sessions (list/revoke), password |
| Academic structure | `/api/stages`, `/api/grades`, `/api/subjects`, `/api/subjects/[id]`, `/api/groups`, `/api/groups/[id]` | `/api/groups` list is open to anyone who can view students/parents/teachers (write needs `academic.groups.manage`); filters: `stageId`, `gradeId`, `subjectId`, `teacherId`. Creating a group requires `subjectId`. `DELETE /api/groups/[id]` only succeeds for a group with no students and no sessions/attendance/exams/assignments/subscriptions (422 `GROUP_HAS_DEPENDENCIES` lists the blockers) — otherwise archive it with `PATCH { isActive: false }`. `/api/groups/[id]` (roster) is gated more loosely so teachers can load a group's students. `/api/subjects` list returns code, teachers, stages/grades and group/student totals; `/api/subjects/[id]` returns teachers, groups (with schedules/capacity), activity and recent exams; `PATCH` accepts `name`, `code`, `teacherIds` (replacement set) |
| Schedule & sessions | `/api/schedules`, `/api/sessions`, `/api/sessions/generate`, `/api/sessions/[id]` | a group's day/time slots are added and removed on the Group detail page (the standalone Weekly Schedule page was removed in Stage 1); `generate` materializes `Schedule` weekly slots into dated `ClassSession` rows for a date range, idempotently. `GET /api/sessions` also filters by `year`+`month` (whole calendar month, ascending) and `planId`, and returns `lessonNumber`/`planId`/`subject`. `PATCH /api/sessions/[id]` only edits `notes` and cancels (`status: "CANCELLED"`; a reason is required for a numbered lesson or one with attendance; a closed lesson can't be cancelled) — opening/closing has its own endpoints |
| Lesson formation (Stage 2) | `/api/lesson-plans`, `/api/lesson-plans/preview`, `/api/lesson-plans/[id]` | `POST /preview` (`sessions.create`) is a dry run: `{ groupId, year, month, lessonsPerWeek }` → the real calendar dates of the group's weekly slots (week = Saturday→Friday; `lessonsPerWeek` is capped at the group's weekly slot count, reported in `warnings`). `POST /` confirms a reviewed selection (`lessons: [{date, startMinutes}]`); the server re-derives dates/times/numbers from the group's schedule and rejects anything that is not a real slot date. One plan per group per month (409 `PLAN_EXISTS`) — history is never overwritten; an existing legacy session in the same slot is adopted (numbered) together with its attendance. `GET /` lists plans with their numbered lessons (`year`, `month`, `groupId`, `stageId`, `gradeId`, `subjectId`). `DELETE /[id]` (`sessions.update`) only works while every lesson is untouched (SCHEDULED, no attendance) — 422 `PLAN_HAS_HISTORY` otherwise |
| Lesson lifecycle (Stage 2) | `POST /api/sessions/[id]/open`, `POST /api/sessions/[id]/close`, `GET /api/sessions/[id]/report`, `GET /api/sessions/[id]/student-snapshot` | `open`/`close` need `sessions.update` **or** `attendance.create`. `open`: lesson must be SCHEDULED, every earlier lesson of the plan must be COMPLETED/CANCELLED (422 `PREVIOUS_LESSON_NOT_FINISHED`), and the group may have only one OPEN lesson (422 `ANOTHER_LESSON_OPEN`). `close` is the **only** way a lesson becomes COMPLETED (never by the clock): roster students with no record are saved as ABSENT, then the next lesson of the plan is returned. `report` (`sessions.view`) returns the lesson snapshot (present/late/absent/excused/pending/unpaid lists, counts, center info); the unpaid list is only included for roles that can view subscriptions/payments. `student-snapshot` (`attendance.view`) returns last attendance, latest recitation/exam and the lesson-month fee state — each section only for roles allowed to see it |
| Attendance | `/api/attendance`, `/api/attendance/[id]`, `/api/attendance/scan`, `/api/attendance/summary` | `scan` runs `evaluateAttendance()` (see `src/lib/attendance.ts`) and only writes a row when allowed. Every scan response now carries a `snapshot` (student info card). Lessons of a monthly plan must be OPENed explicitly (`LESSON_NOT_OPEN`); a COMPLETED lesson refuses new attendance (corrections go through `PATCH /api/attendance/[id]` with a reason, which writes an `AttendanceAdjustment`). The standalone Student Attendance page was removed in Stage 2; `GET /api/attendance` (incl. CSV export) and `/summary` are kept for reports/integrations |
| People | `/api/students/*`, `/api/parents`, `/api/teachers`, `/api/employees` | `/api/students/[id]/profile` is the "student 360" endpoint; `/api/students/[id]/qr` streams an SVG QR code |
| Employee attendance | `/api/employee-attendance` | check-in/check-out, late/overtime derived server-side |
| Exams & grading | `/api/exams`, `/api/exams/[id]`, `/api/exams/[id]/results`, `/api/exams/[id]/publish` | results are entered via `PUT .../results` (bulk upsert); publishing is a separate, permission-gated step |
| Recitation | `/api/recitations` | per-student, per-subject entries |
| Assignments | `/api/assignments`, `/api/assignments/[id]/submissions` | creating an assignment auto-creates a `PENDING` submission for every enrolled student |
| Finance | `/api/grade-fees` (Stage→Grade→monthly price, append-only history), `/api/subscriptions*`, `/api/payments*` (`/month` pays one month, enforces oldest-unpaid-first with a row lock; `/ledger`; `/overdue-notices`; `/{id}/reprint`), `/api/payment-records` (+ `/export` .xlsx), `/api/payment-filters`, `/api/invoices*` | payments are allocated to the student's oldest unpaid subscriptions first (`allocatePayment` in `src/lib/billing.ts`); void/refund require a reason and are audit-logged; nothing is ever hard-deleted |
| Reports | `/api/reports/financial`, `/api/reports/students` | accept `?format=csv` to stream a CSV instead of JSON |
| Communication | `/api/whatsapp/templates`, `/api/notifications*`, `/api/notification-rules` | WhatsApp is wa.me links only (no API, worker or queue); `/api/whatsapp/templates` stores the editable message templates |
| Admin | `/api/users*`, `/api/roles*`, `/api/permissions`, `/api/audit-logs`, `/api/settings` | `roles.manage` / `users.manage` gated; audit logs are read-only, no mutation endpoint exists for them by design |
| Misc | `/api/branches`, `/api/search`, `/api/dashboard/stats`, `/api/health` | `/api/search` fans out across students/teachers/groups/parents/invoices for the global search box |

## 3. Adding a new route

Follow `src/app/api/rooms/route.ts` or `src/app/api/exams/route.ts` as
a template: import `requirePermission`/`resolveBranchScope` from
`@/lib/rbac`, `handleApiError`/`ok`/`created`/`paginated` from
`@/lib/api`, validate with Zod, and call `writeAuditLog` for anything
sensitive.
