/**
 * Monthly subscription ledger (pure logic, no database access).
 *
 * A student's "ledger" is the list of calendar months from their billing
 * start up to the current month. Each month is either backed by a real
 * `Subscription` row (amount frozen at creation time) or is "virtual"
 * (no row yet) and priced from the Grade fee in force for that month.
 *
 * Statuses are always computed live from amounts and dates — never from a
 * stale stored flag — so a month that nobody paid simply stays UNPAID and
 * becomes OVERDUE once its due date passes. Nothing is deleted or reset
 * at month end.
 */

// NOTE: deliberately does not import ./billing (which imports the Prisma client)
// so this module stays pure and unit-testable without a generated client.
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
function netDue(amount: number, discount: number): number {
  return round2(Math.max(0, amount - discount));
}

export interface YearMonth {
  year: number;
  month: number; // 1-12
}

export type LedgerStatus = "PAID" | "PARTIAL" | "UNPAID" | "OVERDUE" | "WAIVED";

export interface SubscriptionRowLike {
  id: string;
  periodYear: number;
  periodMonth: number;
  amount: number;
  discount: number;
  paidAmount: number;
  status: string; // stored status; only WAIVED is trusted from storage
  /** True if a payment against this row was fully refunded or voided. */
  hadRefund?: boolean;
}

export interface GradeFeeLike {
  amount: number;
  effectiveFrom: Date;
}

export interface LedgerEntry extends YearMonth {
  key: string; // "2026-10"
  subscriptionIds: string[];
  /** Price frozen on the row, or the grade fee for that month when virtual. */
  amount: number;
  discount: number;
  paid: number;
  remaining: number;
  status: LedgerStatus;
  dueDate: Date;
  virtual: boolean;
  refunded: boolean;
  /** True when the month is WAIVED because the student is exempt from monthly fees. */
  exempt: boolean;
  /**
   * True for a month AFTER the current one (advance payment). Future months can
   * be paid early but are never a debt: they are excluded from outstanding /
   * overdue calculations until their month actually arrives.
   */
  future: boolean;
}

/**
 * Months during which a student owes nothing. `from: null` = since the very
 * first month, `until: null` = still running (open-ended).
 */
export interface ExemptionWindow {
  from: YearMonth | null;
  until: YearMonth | null;
}

export const MAX_LOOKBACK_MONTHS = 24;

/** How many months AFTER the current month a student may pay in advance. */
export const MAX_ADVANCE_MONTHS = 3;

export function ymKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function ymIndex(ym: YearMonth): number {
  return ym.year * 12 + (ym.month - 1);
}

export function fromIndex(index: number): YearMonth {
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function compareYm(a: YearMonth, b: YearMonth): number {
  return ymIndex(a) - ymIndex(b);
}

export function monthRange(start: YearMonth, end: YearMonth): YearMonth[] {
  const out: YearMonth[] = [];
  for (let i = ymIndex(start); i <= ymIndex(end); i++) out.push(fromIndex(i));
  return out;
}

/** Due date of a month: `dueDay` (clamped to 1–28) at UTC midnight. */
export function dueDateFor(ym: YearMonth, dueDay: number): Date {
  const day = Math.min(28, Math.max(1, Math.floor(dueDay)));
  return new Date(Date.UTC(ym.year, ym.month - 1, day));
}

/**
 * Fee in force for a month. Uses the latest fee whose effectiveFrom is on or
 * before the END of that month; if the grade's first fee was configured later
 * than the month, falls back to the earliest fee ever configured. Returns
 * null when the grade has no fee at all.
 */
export function feeForMonth(fees: GradeFeeLike[], ym: YearMonth): number | null {
  if (fees.length === 0) return null;
  const endOfMonth = Date.UTC(ym.year, ym.month, 1) - 1;
  const sorted = [...fees].sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
  let chosen: GradeFeeLike | undefined;
  for (const fee of sorted) {
    if (fee.effectiveFrom.getTime() <= endOfMonth) chosen = fee;
  }
  return (chosen ?? sorted[0]!).amount;
}

/** First month a student can owe: earliest existing row, else enrollment month; capped by lookback. */
export function billingStart(params: {
  enrollmentDate: Date;
  rows: Pick<SubscriptionRowLike, "periodYear" | "periodMonth">[];
  current: YearMonth;
  timeZoneMonthOf?: (d: Date) => YearMonth;
  /**
   * Center-wide "collect from" month. Months before it are never billed, so
   * they are neither a debt nor block paying later months. Existing
   * subscription rows before it are left untouched in the database.
   */
  floor?: YearMonth | null;
}): YearMonth {
  const monthOf =
    params.timeZoneMonthOf ??
    ((d: Date) => ({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }));
  let start = monthOf(params.enrollmentDate);
  for (const row of params.rows) {
    const ym = { year: row.periodYear, month: row.periodMonth };
    if (compareYm(ym, start) < 0) start = ym;
  }
  const floor = fromIndex(ymIndex(params.current) - (MAX_LOOKBACK_MONTHS - 1));
  if (compareYm(start, floor) < 0) start = floor;
  if (params.floor && compareYm(start, params.floor) < 0) start = params.floor;
  if (compareYm(start, params.current) > 0) start = params.current;
  return start;
}

/** Parses a "YYYY-MM" setting value; returns null for anything invalid/empty. */
export function parseYearMonth(value: string | null | undefined): YearMonth | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value ?? "");
  return m ? { year: Number(m[1]), month: Number(m[2]) } : null;
}

export function ledgerStatus(params: {
  amount: number;
  discount: number;
  paid: number;
  dueDate: Date;
  waived: boolean;
  now: Date;
}): LedgerStatus {
  if (params.waived) return "WAIVED";
  const due = netDue(params.amount, params.discount);
  if (due <= 0 || round2(params.paid) >= due) return "PAID";
  // "After the 5th" means strictly later than the due day.
  if (params.dueDate.getTime() + 24 * 3600 * 1000 <= params.now.getTime()) return "OVERDUE";
  if (round2(params.paid) > 0) return "PARTIAL";
  return "UNPAID";
}

export function inExemption(window: ExemptionWindow | null | undefined, ym: YearMonth): boolean {
  if (!window) return false;
  if (window.from && compareYm(ym, window.from) < 0) return false;
  if (window.until && compareYm(ym, window.until) > 0) return false;
  return true;
}

/**
 * Applies a fee exemption to one ledger entry. Money that was really
 * collected is never erased: a month that is already fully PAID stays PAID.
 * Every other month inside the window becomes WAIVED with nothing remaining,
 * so it can never show up as a debt, an overdue notice or a shortfall.
 */
function applyExemption(entry: LedgerEntry, window: ExemptionWindow | null | undefined): LedgerEntry {
  if (!inExemption(window, entry) || entry.status === "PAID") return entry;
  return { ...entry, status: "WAIVED", remaining: 0, exempt: true };
}

/**
 * Builds the ledger. `fees` are all fees ever configured for the student's
 * grade (history included). Months without a row and without any fee get
 * amount 0 and `virtual: true`; callers must refuse to take payment for them
 * (see `canCharge`).
 */
export function buildLedger(params: {
  start: YearMonth;
  current: YearMonth;
  rows: SubscriptionRowLike[];
  fees: GradeFeeLike[];
  dueDay: number;
  now: Date;
  /** Student fee exemption, if any (see ExemptionWindow). */
  exemption?: ExemptionWindow | null;
  /** Extra months after `current` to include for advance payment (0 = none). */
  ahead?: number;
}): LedgerEntry[] {
  const byKey = new Map<string, SubscriptionRowLike[]>();
  for (const row of params.rows) {
    const key = ymKey(row.periodYear, row.periodMonth);
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }

  const ahead = Math.min(MAX_ADVANCE_MONTHS, Math.max(0, Math.floor(params.ahead ?? 0)));
  const last = fromIndex(ymIndex(params.current) + ahead);
  const built = monthRange(params.start, last).map((ym) => {
    const key = ymKey(ym.year, ym.month);
    const future = compareYm(ym, params.current) > 0;
    const rows = byKey.get(key) ?? [];
    const dueDate = dueDateFor(ym, params.dueDay);

    if (rows.length === 0) {
      const amount = feeForMonth(params.fees, ym) ?? 0;
      return {
        ...ym,
        key,
        subscriptionIds: [],
        amount,
        discount: 0,
        paid: 0,
        remaining: round2(amount),
        status: ledgerStatus({ amount, discount: 0, paid: 0, dueDate, waived: false, now: params.now }),
        dueDate,
        virtual: true,
        refunded: false,
        exempt: false,
        future
      };
    }

    const amount = round2(rows.reduce((s, r) => s + r.amount, 0));
    const discount = round2(rows.reduce((s, r) => s + r.discount, 0));
    const paid = round2(rows.reduce((s, r) => s + r.paidAmount, 0));
    const waived = rows.every((r) => r.status === "WAIVED");
    const net = netDue(amount, discount);
    return {
      ...ym,
      key,
      subscriptionIds: rows.map((r) => r.id),
      amount,
      discount,
      paid,
      remaining: waived ? 0 : round2(Math.max(0, net - paid)),
      status: ledgerStatus({ amount, discount, paid, dueDate, waived, now: params.now }),
      dueDate,
      virtual: false,
      refunded: rows.some((r) => r.hadRefund),
      exempt: false,
      future
    };
  });

  return params.exemption ? built.map((e) => applyExemption(e, params.exemption)) : built;
}

export function isOpen(entry: LedgerEntry): boolean {
  return entry.status === "UNPAID" || entry.status === "PARTIAL" || entry.status === "OVERDUE";
}

/**
 * Months still owing, oldest first. Zero-priced virtual months are not debts,
 * and neither are future months (they can only be paid early, never be late).
 */
export function outstandingMonths(ledger: LedgerEntry[]): LedgerEntry[] {
  return ledger
    .filter((e) => !e.future && isOpen(e) && e.remaining > 0)
    .sort((a, b) => ymIndex(a) - ymIndex(b));
}

export type PayCheck =
  | { ok: true; entry: LedgerEntry }
  | {
      ok: false;
      reason: "NOT_IN_LEDGER" | "ALREADY_PAID" | "NO_PRICE" | "OUT_OF_ORDER" | "EXEMPT";
      oldest?: LedgerEntry;
    };

/**
 * The central financial rule: a month may only be paid when no EARLIER month
 * is still owing. Enforced by the API inside the payment transaction.
 */
export function checkPayable(ledger: LedgerEntry[], target: YearMonth): PayCheck {
  const entry = ledger.find((e) => e.year === target.year && e.month === target.month);
  if (!entry) return { ok: false, reason: "NOT_IN_LEDGER" };
  if (entry.exempt) return { ok: false, reason: "EXEMPT" };
  if (entry.status === "PAID" || entry.status === "WAIVED" || entry.remaining <= 0) {
    return { ok: false, reason: "ALREADY_PAID" };
  }
  if (entry.virtual && entry.amount <= 0) return { ok: false, reason: "NO_PRICE" };
  // Order check also looks at future months: December cannot be paid in advance
  // while November (also in advance) is still open.
  const oldest = ledger
    .filter((e) => isOpen(e) && e.remaining > 0)
    .sort((a, b) => ymIndex(a) - ymIndex(b))[0];
  if (oldest && compareYm(oldest, entry) < 0) {
    return { ok: false, reason: "OUT_OF_ORDER", oldest };
  }
  return { ok: true, entry };
}

/** Keys ("2026-11") of every month that can be paid right now (current/overdue AND advance). */
export function payableKeys(ledger: LedgerEntry[]): string[] {
  return ledger
    .filter((e) => checkPayable(ledger, e).ok)
    .map((e) => e.key);
}

/** Whether the student has an overdue-notice-worthy month (current month past the due day, or older). */
export function overdueMonths(ledger: LedgerEntry[]): LedgerEntry[] {
  return outstandingMonths(ledger).filter((e) => e.status === "OVERDUE");
}

const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];
const MONTHS_AR = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"
];

export function monthName(month: number, locale: "ar" | "en" = "en"): string {
  return (locale === "ar" ? MONTHS_AR : MONTHS_EN)[month - 1] ?? String(month);
}

export function monthLabel(ym: YearMonth, locale: "ar" | "en" = "en"): string {
  return `${monthName(ym.month, locale)} ${ym.year}`;
}

/** Current calendar month in a given IANA time zone. */
export function currentYearMonth(now: Date, timeZone: string): YearMonth {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit" })
    .formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  return { year, month };
}

/** Day of month (1-31) in a given IANA time zone. */
export function dayOfMonthIn(now: Date, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone, day: "2-digit" })
      .formatToParts(now)
      .find((p) => p.type === "day")?.value
  );
}

/** Builds the click-to-chat WhatsApp texts (no API; used with wa-link buildWhatsAppLink). */
export function unpaidMessage(params: {
  studentName: string;
  months: { label: string; amount: number }[];
  currency?: string;
  locale?: "ar" | "en";
}): string {
  const cur = params.currency ?? "EGP";
  const list = params.months.map((m) => `${m.label} — ${m.amount} ${cur}`).join("\n");
  const total = round2(params.months.reduce((s, m) => s + m.amount, 0));
  if (params.locale === "en") {
    return `Hello,\nThis is a reminder that the subscription for student ${params.studentName} has not been paid yet:\n${list}\nTotal due: ${total} ${cur}.\nPlease arrange payment of the outstanding subscription.\nThank you.`;
  }
  return `السلام عليكم،\nنود تذكيركم بأن اشتراك الطالب/ة ${params.studentName} لم يُسدَّد بعد:\n${list}\nالإجمالي المستحق: ${total} ${cur}.\nنرجو التكرم بسداد الاشتراك المتأخر.\nشكرًا لكم.`;
}

export function paidMessage(params: {
  studentName: string;
  monthLabel: string;
  amount: number;
  currency?: string;
  locale?: "ar" | "en";
}): string {
  const cur = params.currency ?? "EGP";
  if (params.locale === "en") {
    return `Hello,\nWe would like to inform you that the subscription for student ${params.studentName} for ${params.monthLabel} has been successfully paid.\nAmount paid: ${params.amount} ${cur}.\nThank you.`;
  }
  return `السلام عليكم،\nنفيدكم بأنه تم سداد اشتراك الطالب/ة ${params.studentName} عن شهر ${params.monthLabel} بنجاح.\nالمبلغ المسدَّد: ${params.amount} ${cur}.\nشكرًا لكم.`;
}
