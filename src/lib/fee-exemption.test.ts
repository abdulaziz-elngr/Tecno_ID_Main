import { describe, expect, it } from "vitest";
import {
  buildLedger,
  checkPayable,
  inExemption,
  outstandingMonths,
  overdueMonths,
  type ExemptionWindow,
  type SubscriptionRowLike
} from "./subscription-months";
import { monthBoundary, monthsFromFilter, previousMonth } from "./fee-exemption";
import { applyFeeExemption } from "./lesson-snapshot";

const fees = [{ amount: 300, effectiveFrom: new Date("2026-01-01T00:00:00Z") }];
const now = new Date("2026-10-20T10:00:00Z"); // after the 5th: unpaid months are overdue

function row(m: number, paid: number, extra: Partial<SubscriptionRowLike> = {}): SubscriptionRowLike {
  return { id: `s${m}`, periodYear: 2026, periodMonth: m, amount: 300, discount: 0, paidAmount: paid, status: "UNPAID", ...extra };
}

function ledgerWith(exemption: ExemptionWindow | null, rows: SubscriptionRowLike[] = []) {
  return buildLedger({
    start: { year: 2026, month: 7 },
    current: { year: 2026, month: 10 },
    rows,
    fees,
    dueDay: 5,
    now,
    exemption
  });
}

describe("inExemption", () => {
  it("is open-ended when until is null and unbounded when from is null", () => {
    expect(inExemption({ from: { year: 2026, month: 9 }, until: null }, { year: 2026, month: 8 })).toBe(false);
    expect(inExemption({ from: { year: 2026, month: 9 }, until: null }, { year: 2027, month: 3 })).toBe(true);
    expect(inExemption({ from: null, until: null }, { year: 2020, month: 1 })).toBe(true);
    expect(inExemption({ from: null, until: { year: 2026, month: 9 } }, { year: 2026, month: 10 })).toBe(false);
    expect(inExemption(null, { year: 2026, month: 10 })).toBe(false);
  });
});

describe("ledger of a fee-exempt student", () => {
  it("owes nothing: virtual months (no row yet) are WAIVED with 0 remaining", () => {
    const ledger = ledgerWith({ from: { year: 2026, month: 9 }, until: null });
    const sep = ledger.find((e) => e.month === 9)!;
    const oct = ledger.find((e) => e.month === 10)!;
    for (const e of [sep, oct]) {
      expect(e.status).toBe("WAIVED");
      expect(e.remaining).toBe(0);
      expect(e.exempt).toBe(true);
    }
  });

  it("never produces outstanding months, overdue notices or a shortfall inside the window", () => {
    const ledger = ledgerWith({ from: null, until: null }, [row(7, 0), row(8, 100)]);
    expect(outstandingMonths(ledger)).toHaveLength(0);
    expect(overdueMonths(ledger)).toHaveLength(0);
    expect(ledger.reduce((s, e) => s + e.remaining, 0)).toBe(0);
  });

  it("leaves months BEFORE the exemption as real debt", () => {
    const ledger = ledgerWith({ from: { year: 2026, month: 10 }, until: null });
    const owed = outstandingMonths(ledger).map((e) => e.month);
    expect(owed).toEqual([7, 8, 9]);
    expect(ledger.find((e) => e.month === 10)!.status).toBe("WAIVED");
  });

  it("keeps a month that was really paid as PAID (money collected is never erased)", () => {
    const ledger = ledgerWith({ from: null, until: null }, [row(8, 300, { status: "PAID" })]);
    const aug = ledger.find((e) => e.month === 8)!;
    expect(aug.status).toBe("PAID");
    expect(aug.paid).toBe(300);
    expect(aug.exempt).toBe(false);
  });

  it("a partly paid month inside the window stops being owed", () => {
    const ledger = ledgerWith({ from: null, until: null }, [row(9, 100, { status: "PARTIAL" })]);
    const sep = ledger.find((e) => e.month === 9)!;
    expect(sep.status).toBe("WAIVED");
    expect(sep.remaining).toBe(0);
    expect(sep.paid).toBe(100); // the 100 collected is still on record
  });

  it("refuses to take payment for an exempt month (EXEMPT), never lets it be paid out of order", () => {
    const ledger = ledgerWith({ from: { year: 2026, month: 9 }, until: null });
    const check = checkPayable(ledger, { year: 2026, month: 10 });
    expect(check).toEqual({ ok: false, reason: "EXEMPT" });
  });

  it("a removed exemption only covers months up to `until`; billing resumes after", () => {
    const ledger = ledgerWith({ from: { year: 2026, month: 8 }, until: { year: 2026, month: 9 } });
    expect(ledger.find((e) => e.month === 8)!.status).toBe("WAIVED");
    expect(ledger.find((e) => e.month === 9)!.status).toBe("WAIVED");
    expect(ledger.find((e) => e.month === 10)!.status).toBe("OVERDUE");
    expect(outstandingMonths(ledger).map((e) => e.month)).toEqual([7, 10]);
  });

  it("behaves exactly as before when there is no exemption", () => {
    expect(outstandingMonths(ledgerWith(null)).map((e) => e.month)).toEqual([7, 8, 9, 10]);
  });
});

describe("fee-exemption helpers", () => {
  it("stores month boundaries at noon UTC so every time zone lands on the same month", () => {
    const d = monthBoundary({ year: 2026, month: 10 });
    expect(d.toISOString()).toBe("2026-10-01T12:00:00.000Z");
    const cairo = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit" }).format(d);
    expect(cairo).toBe("10/2026");
  });

  it("previousMonth wraps over the year boundary", () => {
    expect(previousMonth({ year: 2026, month: 1 })).toEqual({ year: 2025, month: 12 });
    expect(previousMonth({ year: 2026, month: 10 })).toEqual({ year: 2026, month: 9 });
  });

  it("monthsFromFilter(null) matches every month, otherwise 'this month or later'", () => {
    expect(monthsFromFilter(null)).toEqual({});
    expect(monthsFromFilter({ year: 2026, month: 10 })).toEqual({
      OR: [{ periodYear: { gt: 2026 } }, { periodYear: 2026, periodMonth: { gte: 10 } }]
    });
  });
});

describe("applyFeeExemption (lesson snapshot / report)", () => {
  it("turns NOT_BILLED / UNPAID / OVERDUE into WAIVED for an exempt month", () => {
    for (const state of ["NOT_BILLED", "UNPAID", "OVERDUE", "PARTIAL"] as const) {
      expect(applyFeeExemption({ state, remaining: 300 }, true)).toEqual({ state: "WAIVED", remaining: 0 });
    }
  });
  it("keeps PAID and leaves non-exempt students untouched", () => {
    expect(applyFeeExemption({ state: "PAID", remaining: 0 }, true).state).toBe("PAID");
    expect(applyFeeExemption({ state: "UNPAID", remaining: 300 }, false)).toEqual({ state: "UNPAID", remaining: 300 });
  });
});
