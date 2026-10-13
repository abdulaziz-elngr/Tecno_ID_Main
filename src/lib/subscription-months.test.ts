import { describe, expect, it } from "vitest";
import {
  billingStart,
  buildLedger,
  checkPayable,
  feeForMonth,
  outstandingMonths,
  paidMessage,
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
