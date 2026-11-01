import { db } from "./db";
import { getCenterProfile, getPaymentRules } from "./settings";
import {
  billingStart,
  buildLedger,
  currentYearMonth,
  dayOfMonthIn,
  MAX_ADVANCE_MONTHS,
  outstandingMonths,
  parseYearMonth,
  type ExemptionWindow,
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
  /** Center-wide first billable month (Settings → Payment rules); null = no limit. */
  billingFloor: YearMonth | null;
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
    dayOfMonth: dayOfMonthIn(now, timeZone),
    billingFloor: parseYearMonth(rules.billingStartMonth)
  };
}

type PrismaLike = Pick<typeof db, "subscription" | "gradeFee" | "student">;

/** First day (UTC) of a stored exemption boundary → year/month in the center's time zone. */
function boundaryYm(date: Date | null, timeZone: string): YearMonth | null {
  return date ? currentYearMonth(date, timeZone) : null;
}

/**
 * The months a student owes nothing, from the Student exemption fields.
 * Active exemption: open-ended. Removed exemption: only up to `feeExemptUntil`.
 * Returns null when the student was never exempt (or the window is empty).
 */
export function exemptionWindowOf(
  s: { feeExempt: boolean; feeExemptFrom: Date | null; feeExemptUntil: Date | null },
  timeZone: string
): ExemptionWindow | null {
  const from = boundaryYm(s.feeExemptFrom, timeZone);
  if (s.feeExempt) return { from, until: null };
  const until = boundaryYm(s.feeExemptUntil, timeZone);
  if (!until) return null;
  if (from && from.year * 12 + from.month > until.year * 12 + until.month) return null;
  return { from, until };
}

export async function loadLedgers(
  organizationId: string,
  students: LedgerStudent[],
  env: LedgerEnv,
  client: PrismaLike = db,
  /** includeFuture: also build the months after the current one (advance payment screens only). */
  opts: { includeFuture?: boolean } = {}
): Promise<Map<string, LedgerEntry[]>> {
  const result = new Map<string, LedgerEntry[]>();
  if (students.length === 0) return result;

  const ids = students.map((s) => s.id);
  const gradeIds = Array.from(new Set(students.map((s) => s.gradeId)));

  const [rowsRaw, feesRaw, exemptRaw] = await Promise.all([
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
    }),
    // Always read the exemption here (not from the caller) so EVERY screen that
    // builds a ledger — payments, roster, dashboard, notices, attendance
    // warning — applies it identically and can never disagree.
    client.student.findMany({
      where: { id: { in: ids } },
      select: { id: true, feeExempt: true, feeExemptFrom: true, feeExemptUntil: true }
    })
  ]);
  const exemptionByStudent = new Map<string, ExemptionWindow | null>(
    exemptRaw.map((e): [string, ExemptionWindow | null] => [e.id, exemptionWindowOf(e, env.timeZone)])
  );

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
      timeZoneMonthOf: monthOf,
      floor: env.billingFloor
    });
    result.set(
      s.id,
      buildLedger({
        start,
        current: env.current,
        rows,
        fees: feesByGrade.get(s.gradeId) ?? [],
        dueDay: env.dueDay,
        now: env.now,
        exemption: exemptionByStudent.get(s.id) ?? null,
        ahead: opts.includeFuture ? MAX_ADVANCE_MONTHS : 0
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
    refunded: e.refunded,
    exempt: e.exempt,
    future: e.future
  };
}
