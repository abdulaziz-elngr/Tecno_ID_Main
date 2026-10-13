import { describe, it, expect } from "vitest";
import {
  round2,
  netDue,
  remainingAmount,
  computeSubscriptionStatus,
  allocatePayment,
  collectionRate
} from "./billing";

describe("round2", () => {
  it("rounds to two decimal places", () => {
    expect(round2(10.005)).toBeCloseTo(10.01, 2);
    expect(round2(10.004)).toBe(10);
  });
});

describe("netDue", () => {
  it("subtracts the discount from the amount", () => {
    expect(netDue(300, 50)).toBe(250);
  });

  it("never goes negative when the discount exceeds the amount", () => {
    expect(netDue(100, 500)).toBe(0);
  });
});

describe("remainingAmount", () => {
  it("computes what is left after partial payment", () => {
    expect(remainingAmount(300, 0, 100)).toBe(200);
  });

  it("returns 0 once fully paid, never negative on overpayment", () => {
    expect(remainingAmount(300, 0, 300)).toBe(0);
    expect(remainingAmount(300, 0, 350)).toBe(0);
  });

  it("applies the discount before comparing against paid amount", () => {
    expect(remainingAmount(300, 50, 250)).toBe(0);
  });
});

describe("computeSubscriptionStatus", () => {
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  it("returns WAIVED when explicitly waived, regardless of amounts", () => {
    expect(
      computeSubscriptionStatus({ amount: 300, discount: 0, paidAmount: 0, dueDate: future, waived: true })
    ).toBe("WAIVED");
  });

  it("returns PAID once the paid amount covers the net due", () => {
    expect(computeSubscriptionStatus({ amount: 300, discount: 0, paidAmount: 300, dueDate: future })).toBe("PAID");
  });

  it("returns PAID when the net due is zero (fully discounted)", () => {
    expect(computeSubscriptionStatus({ amount: 300, discount: 300, paidAmount: 0, dueDate: future })).toBe("PAID");
  });

  it("returns OVERDUE when unpaid and past the due date", () => {
    expect(computeSubscriptionStatus({ amount: 300, discount: 0, paidAmount: 0, dueDate: past })).toBe("OVERDUE");
  });

  it("returns PARTIAL when some has been paid but not enough, and not yet due", () => {
    expect(computeSubscriptionStatus({ amount: 300, discount: 0, paidAmount: 100, dueDate: future })).toBe("PARTIAL");
  });

  it("returns UNPAID when nothing has been paid and not yet due", () => {
    expect(computeSubscriptionStatus({ amount: 300, discount: 0, paidAmount: 0, dueDate: future })).toBe("UNPAID");
  });
});

describe("allocatePayment", () => {
  it("allocates fully to a single outstanding subscription", () => {
    const result = allocatePayment(300, [{ subscriptionId: "s1", remaining: 300 }]);
    expect(result.allocations).toEqual([{ subscriptionId: "s1", amount: 300 }]);
    expect(result.unallocated).toBe(0);
  });

  it("spreads a payment across multiple subscriptions, oldest first", () => {
    const result = allocatePayment(400, [
      { subscriptionId: "jan", remaining: 300 },
      { subscriptionId: "feb", remaining: 300 }
    ]);
    expect(result.allocations).toEqual([
      { subscriptionId: "jan", amount: 300 },
      { subscriptionId: "feb", amount: 100 }
    ]);
    expect(result.unallocated).toBe(0);
  });

  it("never over-allocates to a single subscription", () => {
    const result = allocatePayment(500, [{ subscriptionId: "s1", remaining: 300 }]);
    expect(result.allocations).toEqual([{ subscriptionId: "s1", amount: 300 }]);
    expect(result.unallocated).toBe(200);
  });

  it("skips subscriptions that are already fully paid", () => {
    const result = allocatePayment(100, [
      { subscriptionId: "paid", remaining: 0 },
      { subscriptionId: "unpaid", remaining: 100 }
    ]);
    expect(result.allocations).toEqual([{ subscriptionId: "unpaid", amount: 100 }]);
  });

  it("returns the full amount as unallocated when there is nothing outstanding", () => {
    const result = allocatePayment(150, []);
    expect(result.allocations).toEqual([]);
    expect(result.unallocated).toBe(150);
  });
});

describe("collectionRate", () => {
  it("returns 0 when nothing was billed", () => {
    expect(collectionRate(0, 0)).toBe(0);
  });

  it("computes a rounded percentage", () => {
    expect(collectionRate(750, 1000)).toBe(75);
  });
});
