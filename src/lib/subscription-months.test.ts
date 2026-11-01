import { describe, expect, it } from "vitest";
import {
  billingStart,
  buildLedger,
  checkPayable,
  feeForMonth,
  outstandingMonths,
  overdueMonths,
  paidMessage,
  parseYearMonth,
  payableKeys,
  unpaidMessage,
  type SubscriptionRowLike
} from "./subscription-months";

const fees = [
  { amount: 300, effectiveFrom: new Date("2026-01-01T00:00:00Z") },
  { amount: 350, effectiveFrom: new Date("2026-02-01T00:00:00Z") }
];

function row(m: number, paid: number, amount = 300, extra: Partial<SubscriptionRowLike> = {}): SubscriptionRowLike {
  return { id: `s${m}`, periodYear: 2026, periodMonth: m, amount, discount: 0, paidAmount: paid, status: "UNPAID", ...extra };
}

const now = new Date("2026-10-20T10:00:00Z");

describe("feeForMonth", () => {
  it("keeps January at the old price and uses the new price from February", () => {
    expect(feeForMonth(fees, { year: 2026, month: 1 })).toBe(300);
    expect(feeForMonth(fees, { year: 2026, month: 2 })).toBe(350);
    expect(feeForMonth(fees, { year: 2026, month: 10 })).toBe(350);
  });
  it("falls back to the earliest fee for months before any fee existed", () => {
    expect(feeForMonth(fees, { year: 2025, month: 6 })).toBe(300);
  });
  it("returns null with no fees", () => {
    expect(feeForMonth([], { year: 2026, month: 1 })).toBeNull();
  });
});

describe("ledger", () => {
  const ledger = buildLedger({
    start: { year: 2026, month: 8 },
    current: { year: 2026, month: 10 },
    rows: [row(8, 0), row(9, 0)],
    fees,
    dueDay: 5,
    now
  });

  it("lists every month, rows keep their frozen amount, missing ones use the fee", () => {
    expect(ledger.map((e) => e.key)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(ledger[0]!.amount).toBe(300);
    expect(ledger[2]!.virtual).toBe(true);
    expect(ledger[2]!.amount).toBe(350);
  });

  it("an unpaid month stays unpaid and becomes OVERDUE after the due day", () => {
    expect(ledger.every((e) => e.status === "OVERDUE")).toBe(true);
    const early = buildLedger({
      start: { year: 2026, month: 10 },
      current: { year: 2026, month: 10 },
      rows: [],
      fees,
      dueDay: 5,
      now: new Date("2026-10-04T10:00:00Z")
    });
    expect(early[0]!.status).toBe("UNPAID");
  });

  it("is not overdue on the 5th itself, overdue on the 6th", () => {
    const mk = (d: string) =>
      buildLedger({ start: { year: 2026, month: 10 }, current: { year: 2026, month: 10 }, rows: [], fees, dueDay: 5, now: new Date(d) })[0]!.status;
    expect(mk("2026-10-05T20:00:00Z")).toBe("UNPAID");
    expect(mk("2026-10-06T00:30:00Z")).toBe("OVERDUE");
  });

  it("outstanding months are ordered oldest first", () => {
    expect(outstandingMonths(ledger).map((e) => e.key)).toEqual(["2026-08", "2026-09", "2026-10"]);
  });
});

describe("checkPayable (oldest-first rule)", () => {
  const ledger = buildLedger({
    start: { year: 2026, month: 1 },
    current: { year: 2026, month: 3 },
    rows: [row(1, 300, 300, { status: "PAID" })],
    fees,
    dueDay: 5,
    now
  });

  it("refuses March while February is unpaid and points at February", () => {
    const r = checkPayable(ledger, { year: 2026, month: 3 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("OUT_OF_ORDER");
      expect(r.oldest?.key).toBe("2026-02");
    }
  });

  it("allows the oldest unpaid month", () => {
    expect(checkPayable(ledger, { year: 2026, month: 2 }).ok).toBe(true);
  });

  it("refuses a month that is already paid (duplicate payment)", () => {
    const r = checkPayable(ledger, { year: 2026, month: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("ALREADY_PAID");
  });

  it("after February is paid, March becomes eligible", () => {
    const after = buildLedger({
      start: { year: 2026, month: 1 },
      current: { year: 2026, month: 3 },
      rows: [row(1, 300), row(2, 350, 350)],
      fees,
      dueDay: 5,
      now
    });
    expect(checkPayable(after, { year: 2026, month: 3 }).ok).toBe(true);
  });

  it("a partially paid earlier month still blocks later months", () => {
    const partial = buildLedger({
      start: { year: 2026, month: 1 },
      current: { year: 2026, month: 2 },
      rows: [row(1, 100)],
      fees,
      dueDay: 5,
      now
    });
    const r = checkPayable(partial, { year: 2026, month: 2 });
    expect(r.ok).toBe(false);
  });

  it("refuses a month without any price", () => {
    const none = buildLedger({ start: { year: 2026, month: 1 }, current: { year: 2026, month: 1 }, rows: [], fees: [], dueDay: 5, now });
    const r = checkPayable(none, { year: 2026, month: 1 });
    expect(r.ok).toBe(false);
  });

  it("a refunded (reversed) month is payable again and flagged", () => {
    const l = buildLedger({
      start: { year: 2026, month: 1 },
      current: { year: 2026, month: 1 },
      rows: [row(1, 0, 300, { hadRefund: true })],
      fees,
      dueDay: 5,
      now
    });
    expect(l[0]!.refunded).toBe(true);
    expect(checkPayable(l, { year: 2026, month: 1 }).ok).toBe(true);
  });
});

describe("billingStart", () => {
  it("uses enrollment month, earlier rows, and caps the lookback", () => {
    const current = { year: 2026, month: 10 };
    expect(billingStart({ enrollmentDate: new Date("2026-09-10T00:00:00Z"), rows: [], current })).toEqual({ year: 2026, month: 9 });
    expect(billingStart({ enrollmentDate: new Date("2026-09-10T00:00:00Z"), rows: [{ periodYear: 2026, periodMonth: 7 }], current })).toEqual({ year: 2026, month: 7 });
    expect(billingStart({ enrollmentDate: new Date("2020-01-01T00:00:00Z"), rows: [], current })).toEqual({ year: 2024, month: 11 });
    expect(billingStart({ enrollmentDate: new Date("2027-01-01T00:00:00Z"), rows: [], current })).toEqual(current);
  });

  it("center-wide floor hides earlier months so November can be paid with October unpaid", () => {
    const current = { year: 2026, month: 11 };
    const floor = { year: 2026, month: 11 };
    const rows = [{ periodYear: 2026, periodMonth: 10 }];
    const start = billingStart({ enrollmentDate: new Date("2026-01-01T00:00:00Z"), rows, current, floor });
    expect(start).toEqual(floor);

    const ledger = buildLedger({
      start,
      current,
      rows: [{ id: "o", periodYear: 2026, periodMonth: 10, amount: 100, discount: 0, paidAmount: 0, status: "OVERDUE" }],
      fees: [{ amount: 100, effectiveFrom: new Date("2026-01-01T00:00:00Z") }],
      dueDay: 5,
      now: new Date("2026-11-01T08:00:00Z")
    });
    expect(outstandingMonths(ledger).some((e) => e.month === 10)).toBe(false);
    expect(checkPayable(ledger, current).ok).toBe(true);
  });

  it("parseYearMonth accepts only YYYY-MM", () => {
    expect(parseYearMonth("2026-11")).toEqual({ year: 2026, month: 11 });
    expect(parseYearMonth("2026-13")).toBeNull();
    expect(parseYearMonth("")).toBeNull();
    expect(parseYearMonth(null)).toBeNull();
  });
});

describe("whatsapp messages", () => {
  it("mentions the student, the month and the amount", () => {
    const u = unpaidMessage({ studentName: "Ahmed", months: [{ label: "October 2026", amount: 300 }], locale: "en" });
    expect(u).toContain("Ahmed");
    expect(u).toContain("October 2026");
    expect(u).toContain("300 EGP");
    const p = paidMessage({ studentName: "Ahmed", monthLabel: "October 2026", amount: 300, locale: "en" });
    expect(p).toContain("successfully paid");
  });
});

describe("advance payment (months after the current one)", () => {
  // Today is 25 Oct 2026; October is paid, November/December/January are in the future.
  const base = {
    start: { year: 2026, month: 9 },
    current: { year: 2026, month: 10 },
    fees,
    dueDay: 5,
    now: new Date("2026-10-25T10:00:00Z"),
    ahead: 3
  };
  const paidUntilOct = [row(9, 350, 350), row(10, 350, 350)];

  it("adds the next months flagged as future and never counts them as debt", () => {
    const ledger = buildLedger({ ...base, rows: paidUntilOct });
    expect(ledger.map((e) => e.key)).toEqual(["2026-09", "2026-10", "2026-11", "2026-12", "2027-01"]);
    expect(ledger.filter((e) => e.future).map((e) => e.key)).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(ledger.find((e) => e.key === "2026-11")!.status).toBe("UNPAID");
    expect(outstandingMonths(ledger)).toEqual([]);
    expect(overdueMonths(ledger)).toEqual([]);
  });

  it("without `ahead` the ledger still stops at the current month (nothing else changes)", () => {
    const ledger = buildLedger({ ...base, ahead: undefined, rows: paidUntilOct });
    expect(ledger.map((e) => e.key)).toEqual(["2026-09", "2026-10"]);
    expect(ledger.some((e) => e.future)).toBe(false);
  });

  it("November can be paid on 25 October once October is settled", () => {
    const ledger = buildLedger({ ...base, rows: paidUntilOct });
    const check = checkPayable(ledger, { year: 2026, month: 11 });
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.entry.amount).toBe(350);
    expect(payableKeys(ledger)).toEqual(["2026-11"]);
  });

  it("November cannot be paid while October is still owing", () => {
    const ledger = buildLedger({ ...base, rows: [row(9, 350, 350), row(10, 100, 350)] });
    const check = checkPayable(ledger, { year: 2026, month: 11 });
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toBe("OUT_OF_ORDER");
      expect(check.oldest?.key).toBe("2026-10");
    }
  });

  it("December cannot be paid in advance before November", () => {
    const ledger = buildLedger({ ...base, rows: paidUntilOct });
    const check = checkPayable(ledger, { year: 2026, month: 12 });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.oldest?.key).toBe("2026-11");
  });

  it("once November is paid, December becomes the next advance month", () => {
    const ledger = buildLedger({ ...base, rows: [...paidUntilOct, row(11, 350, 350)] });
    expect(ledger.find((e) => e.key === "2026-11")!.status).toBe("PAID");
    expect(payableKeys(ledger)).toEqual(["2026-12"]);
  });

  it("does not offer months beyond the allowed advance window", () => {
    const ledger = buildLedger({ ...base, rows: paidUntilOct });
    expect(checkPayable(ledger, { year: 2027, month: 3 })).toEqual({ ok: false, reason: "NOT_IN_LEDGER" });
  });

  it("a fee exemption still waives future months", () => {
    const ledger = buildLedger({ ...base, rows: paidUntilOct, exemption: { from: { year: 2026, month: 11 }, until: null } });
    const check = checkPayable(ledger, { year: 2026, month: 11 });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe("EXEMPT");
  });
});
