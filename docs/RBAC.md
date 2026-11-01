# Roles & Permissions

## Default roles

| Role | Scope | Notes |
|---|---|---|
| `SUPER_ADMIN` | All organizations (platform operator) | Full access |
| `CENTER_OWNER` | Org-wide within their organization | Full access within org |
| `MANAGER` | Org-wide within their organization | Operational management, no `users.manage`/`roles.manage` |
| `ACCOUNTANT` | Branch-scoped (assign every branch) | Everything about money: subscriptions, payments, invoices, financial reports and the monthly price of each grade (`academic.fees.manage`). Read-only view of students, parents and groups (`students.view`, `parents.view`). No attendance / exams / teachers, and no edit rights on students or groups |
| `TEACHER` | Branch-scoped | Own groups: students, attendance, exams/grades |
| `TEACHER_ASSISTANT` | Branch-scoped + own groups only | Attendance, recitation, homework, exams/grades, student performance and lesson formation (`lessons.plan`) of the groups he is responsible for (several assistants can share one group; each group lists all of them). Never finance, users or settings |
| `RECEPTIONIST` | Branch-scoped | Student/parent intake |
| `ATTENDANCE_OPERATOR` | Branch-scoped | QR scanning station |
| `PARENT` | Own linked children only | No permission keys — access is enforced via a separate parent-portal scope, added in a later phase |
| `STUDENT` | Own data only | Same as above |

`SUPER_ADMIN` and `CENTER_OWNER` have no `UserBranch` rows and are
treated as "all branches in this organization" (`AuthContext.isOrgWide
= true`). Every other role must have explicit `UserBranch` rows —
a user with zero branch assignments and a non-org-wide role sees no
data anywhere, by design (fail closed).

## Permission key format

`<module>.<action>`, e.g. `students.create`, `payments.refund`. The
full catalog lives in `src/lib/permissions.ts` — that file is the only
place permission keys are defined; both the seed script and (via the
database) every API route consume it, so there is no way for the
"list of permissions that exist" and "list of permissions that are
enforced" to drift apart.

## Adding a new permission

1. Add the key to the relevant module array in `PERMISSIONS`
   (`src/lib/permissions.ts`).
2. Add it to whichever `DEFAULT_ROLE_PERMISSIONS` entries should have
   it by default.
3. Re-run `npm run db:seed` in a dev environment, or write a migration
   that inserts the new `Permission` row and any `RolePermission`
   grants for existing organizations.
4. Guard the corresponding API route with
   `await requirePermission("your.new.key")`.

## Extending scope beyond branch

Some later-phase roles (`PARENT`, `STUDENT`) need row-level scoping
(their own children / their own record) rather than branch-level
scoping. This is intentionally not implemented as a permission key —
it's enforced by looking up the caller's linked `Student`/`Parent`
record and filtering queries to it directly, the same server-derived
pattern used for `organizationId`/`branchId` elsewhere.

## The three-role setup

| Who | Role | What they see |
|---|---|---|
| Center owner | `CENTER_OWNER` | Everything |
| Accountant | `ACCOUNTANT` | All money screens + grade prices (all students, stages, groups); students/groups read-only |
| Teaching assistant | `TEACHER_ASSISTANT` | His own group(s): attendance, recitation, homework, exams, performance, lesson formation |

* **Own-group restriction** — `src/lib/group-access.ts` (`resolveOwnGroupIds`,
  `groupIdFilter`) is applied on the server to attendance, lessons, students,
  groups, stages, search and dashboard numbers, besides the exams / recitation /
  homework / performance routes that already used it. A login is tied to its
  groups through its Teacher/Assistant profile (`Teacher.userId`; groups are
  `Group.assistantId`).
* **Create the login** — Users → add user → role `TEACHER_ASSISTANT` → pick the
  *Teacher / Assistant profile* and a branch. A teaching login without a profile
  sees nothing (fail closed).
* **Menu / page guard** — `src/lib/nav-access.ts` hides pages a user has no
  permission for and redirects typed URLs to the dashboard. The API still
  enforces every permission.
* **Existing databases** — run `prisma/sql/2026-10-three-role-system.sql` once to
  align the permission keys of the two roles.

## Deductions and book reservations (Oct 2026)

New permissions: `deductions.view|create|void` and `books.view|create|update|collect|void`.
Granted to SUPER_ADMIN, CENTER_OWNER, MANAGER and ACCOUNTANT; RECEPTIONIST gets `books.view` + `books.collect`.
Existing databases: run `prisma/sql/2026-10-deductions-books.sql` (schema + permissions + grants, idempotent).
