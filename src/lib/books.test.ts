import { describe, it, expect } from "vitest";
import { bookPayable, bookRemaining, computeBookStatus } from "./books-rules";

describe("book reservation money rules", () => {
  it("payable and remaining never go negative", () => {
    expect(bookPayable(100, 30)).toBe(70);
    expect(bookPayable(100, 150)).toBe(0);
    expect(bookRemaining(100, 0, 40)).toBe(60);
    expect(bookRemaining(100, 0, 140)).toBe(0);
  });

  it("status follows paid vs reservation fee vs price", () => {
    const base = { price: 100, discount: 0, reservationFee: 30 };
    expect(computeBookStatus({ ...base, paid: 0 })).toBe("UNPAID");
    expect(computeBookStatus({ ...base, paid: 10 })).toBe("PARTIAL");
    expect(computeBookStatus({ ...base, paid: 30 })).toBe("RESERVED");
    expect(computeBookStatus({ ...base, paid: 99.5 })).toBe("RESERVED");
    expect(computeBookStatus({ ...base, paid: 100 })).toBe("PAID");
  });

  it("zero reservation fee: any payment reserves; free books are paid", () => {
    expect(computeBookStatus({ price: 100, discount: 0, reservationFee: 0, paid: 1 })).toBe("RESERVED");
    expect(computeBookStatus({ price: 100, discount: 100, reservationFee: 0, paid: 0 })).toBe("PAID");
  });

  it("a discount lowers what must be paid (and the fee is capped by it)", () => {
    expect(computeBookStatus({ price: 100, discount: 80, reservationFee: 50, paid: 20 })).toBe("PAID");
    expect(computeBookStatus({ price: 100, discount: 60, reservationFee: 50, paid: 30 })).toBe("PARTIAL");
  });
});
