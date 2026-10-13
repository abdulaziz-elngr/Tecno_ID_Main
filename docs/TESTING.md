# Testing

TecnoID uses [Vitest](https://vitest.dev) for unit tests. The focus
is security- and correctness-critical **pure logic** — the functions
in `src/lib/*.ts` that encode a business rule and can be tested
exhaustively without a database.

```bash
npm test          # run once
npm run test:watch
```

## 1. What's covered

| File | Tests | Covers |
|---|---|---|
| `src/lib/password.test.ts` | hashing/verification | Argon2id password rules |
| `src/lib/rbac.test.ts` | permission resolution | role → permission set |
| `src/lib/scheduling.test.ts` | `rangesOverlap`, `isValidTimeRange` | schedule conflict detection |
| `src/lib/student-code.test.ts` | code generation | unique student code format |
| `src/lib/time.test.ts` | time helpers | minute/time formatting |
| `src/lib/group-rules.test.ts` | `evaluateGroupDeletion`, `describeGroupBlockers`, `normalizeSubjectCode` | a group can only be deleted when nothing depends on it; otherwise it must be archived |
| `src/lib/subject-summary.test.ts` | `mergeSubjectTeachers`, `summarizeSubjectGroups` | Subject → Teacher → Groups → Students aggregation, no duplicate teachers |
| `src/lib/lesson-plan.test.ts` | `generateMonthlyLessons`, `validateConfirmedLessons`, `startOfWeek` | real calendar dates for a month from the group's weekly slots (October 2026 Sat+Tue), 1 vs 2 lessons/week, weeks that straddle two months, cap at the group's slots, server-side guard on the reviewed selection |
| `src/lib/lesson-flow.test.ts` | `canOpenLesson`, `nextLesson`, `canCloseLesson`, `isPlanDeletable`, tz helpers | lessons open in order, one open lesson per group, only an explicit close completes a lesson, history is never deletable, lateness uses the centre's local start time (Cairo DST) |
| `src/lib/lesson-snapshot.test.ts` | `resolveFeeState`, `isFeeUnpaid`, `buildSnapshotWarnings`, `countAttendance` | fee state per group/month, unpaid definition, student scan-card warnings, attendance counts |
| `src/lib/attendance.test.ts` | `evaluateAttendance`, `attendanceRate`, `normalizeScanInput` | Rule 1 (no duplicates), Rule 2 (make-up eligibility), Rule 3 (make-up limits/window/approval), Rule 9 (capacity), late detection |
| `src/lib/billing.test.ts` | `round2`, `netDue`, `remainingAmount`, `computeSubscriptionStatus`, `allocatePayment`, `collectionRate`, `netIncome` | money rounding, subscription status derivation, oldest-first payment allocation (Rule 6 — never over-allocates) |
| `src/lib/grading.test.ts` | `validateScore`, `percentage`, `computeExamStatistics`, `rankScores`, `performanceTrend` | Rule 8 (score can't exceed max), exam statistics, competition ranking with ties, trend slope |
| `src/lib/analytics.test.ts` | `analyzeStudent`, `countTrailingAbsences` | every rule-based flag (low attendance, repeated absence, low grades, declining/improving trend, missing assignments, unpaid balance) individually and combined |
| `src/lib/templates.test.ts` | `renderTemplate`, `extractPlaceholders`, `DEFAULT_TEMPLATES` | placeholder substitution/extraction, and that every seeded template's Arabic and English bodies use the same placeholder set |

## 2. What's intentionally not unit-tested here

API route handlers themselves (`src/app/api/**/route.ts`) are thin —
auth, validation, then a call into the tested `src/lib/*` functions
plus a Prisma query. They're better covered by integration/e2e tests
against a real database than by mocking Prisma, which was out of
scope for this pass. If you add integration tests, point them at a
disposable test database (`DATABASE_URL` override), never a shared
dev database — tests should be able to run in any order and leave no
state behind.

## 3. A known environment caveat: Prisma client generation

Four existing test files (`billing.test.ts` among them, plus the
pre-existing `rbac.test.ts`, `scheduling.test.ts`,
`student-code.test.ts`) import a module that in turn imports
`src/lib/db.ts`, which constructs a `PrismaClient` at module load
time. If `npx prisma generate` has not been run successfully — most
commonly because `binaries.prisma.sh` was unreachable in that
environment (see `docs/DEPLOYMENT.md` §4) — that constructor throws:

```
Error: @prisma/client did not initialize yet. Please run "prisma generate" and try to import it again.
```

This is **not a test failure in the logic being tested** — it's the
same "no query engine" condition surfaced at test-import time instead
of at first-query time. The fix is always the same: get
`prisma generate` to run successfully (reachable network, or a
pre-generated client committed/cached into `node_modules/.prisma`)
before running `npm test`. None of the pure-function tests in this
document assert anything about the database; they fail only because
importing their module transitively imports `db.ts`.

## 4. Adding new tests

Follow the existing style: `describe`/`it` blocks grouped by function,
one behavior per `it`, and a short comment above any assertion whose
expected value isn't obvious from reading the call (see
`scheduling.test.ts`'s back-to-back-ranges test for a good example).
Prefer testing the pure `src/lib` function directly over hitting the
API route, for both speed and because it does not require a database.
