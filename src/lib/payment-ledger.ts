import { db } from "./db";
import { getCenterProfile, getPaymentRules } from "./settings";
import {
  billingStart,
  buildLedger,
  currentYearMonth,
  dayOfMonthIn,
  outstandingMonths,
  type GradeFeeLike,
  type LedgerEntry,
  type SubscriptionRowLike,
  type YearMonth
} from "./subscription-months";

/**
 * Loads monthly ledgers for students. Single source of truth for
 * "what does this student owe?" — used by the payment APIs (to enforce the
 * oldest-month-first rule), the Payment Records roster, the attendance
 * warning and the overdue notices, so they can never disagree.
 *
 * Nothing here writes: no financial record is duplicated for display.
 */

export interface LedgerStudent {
  id: string;
  gradeId: string;
  enrollmentDate: Date;
}

export interface LedgerEnv {
  timeZone: string;
  currency: string;
  dueDay: number;
  allowPartial: boolean;
  now: Date;
  current: YearMonth;
  dayOfMonth: number;
}

export async function loadLedgerEnv(organizationId: string, now = new Date()): Promise<LedgerEnv> {
  const [rules, center] = await Promise.all([getPaymentRules(organizationId), getCenterProfile(organizationId)]);
  const timeZone = center.timezone || "Africa/Cairo";
  return {
    timeZone,
    currency: center.currency || "EGP",
    dueDay: rules.dueDayOfMonth,
    allowPartial: rules.allowPartialPayments,
    now,
    current: currentYearMonth(now, timeZone),
    dayOfMonth: dayOfMonthIn(now, timeZone)
  };
}

type PrismaLike = Pick<typeof db, "subscription" | "gradeFee">;

export async function loadLedgers(
  organizationId: string,
  students: LedgerStudent[],
  env: LedgerEnv,
  client: PrismaLike = db
): Promise<Map<string, LedgerEntry[]>> {
  const result = new Map<string, LedgerEntry[]>();
  if (students.length === 0) return result;

  const ids = students.map((s) => s.id);
  const gradeIds = Array.from(new Set(students.map((s) => s.gradeId)));

  const [rowsRaw, feesRaw] = await Promise.all([
    client.subscription.findMany({
      where: { organizationId, studentId: { in: ids } },
      select: {
        id: true,
        studentId: true,
        periodYear: true,
        periodMonth: true,
        amount: true,
        discount: true,
        paidAmount: true,
        status: true,
        allocations: { select: { payment: { select: { status: true } } } }
      }
    }),
    client.gradeFee.findMany({
      where: { organizationId, gradeId: { in: gradeIds } },
      select: { gradeId: true, amount: true, effectiveFrom: true }
    })
  ]);

  const rowsByStudent = new Map<string, (SubscriptionRowLike & { studentId: string })[]>();
  for (const r of rowsRaw) {
    const list = rowsByStudent.get(r.studentId) ?? [];
    list.push({
      id: r.id,
      studentId: r.studentId,
      periodYear: r.periodYear,
      periodMonth: r.periodMonth,
      amount: Number(r.amount),
      discount: Number(r.discount),
      paidAmount: Number(r.paidAmount),
      status: r.status,
      hadRefund: r.allocations.some((a) => ["REFUNDED", "VOIDED", "PARTIALLY_REFUNDED"].includes(a.payment.status))
    });
    rowsByStudent.set(r.studentId, list);
  }

  const feesByGrade = new Map<string, GradeFeeLike[]>();
  for (const f of feesRaw) {
    const list = feesByGrade.get(f.gradeId) ?? [];
    list.push({ amount: Number(f.amount), effectiveFrom: f.effectiveFrom });
    feesByGrade.set(f.gradeId, list);
  }

  const monthOf = (d: Date) => currentYearMonth(d, env.timeZone);

  for (const s of students) {
    const rows = rowsByStudent.get(s.id) ?? [];
    const start = billingStart({
      enrollmentDate: s.enrollmentDate,
      rows,
      current: env.current,
      timeZoneMonthOf: monthOf
    });
    result.set(
      s.id,
      buildLedger({
        start,
        current: env.current,
        rows,
        fees: feesByGrade.get(s.gradeId) ?? [],
        dueDay: env.dueDay,
        now: env.now
      })
    );
  }
  return result;
}

export function summarize(ledger: LedgerEntry[]) {
  const outstanding = outstandingMonths(ledger);
  const paid = ledger.filter((e) => e.status === "PAID" && e.paid > 0);
  const last = paid[paid.length - 1];
  return {
    outstanding,
    oldest: outstanding[0] ?? null,
    totalDue: Math.round(outstanding.reduce((s, e) => s + e.remaining, 0) * 100) / 100,
    lastPaidMonth: last ? { year: last.year, month: last.month } : null
  };
}

/** JSON-safe projection of a ledger entry for API responses. */
export function serializeEntry(e: LedgerEntry) {
  return {
    year: e.year,
    month: e.month,
    key: e.key,
    amount: e.amount,
    discount: e.discount,
    paid: e.paid,
    remaining: e.remaining,
    status: e.status,
    dueDate: e.dueDate.toISOString(),
    virtual: e.virtual,
    refunded: e.refunded
  };
}
