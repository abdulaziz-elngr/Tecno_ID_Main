import { describe, it, expect } from "vitest";
import { makeBucket, monthBounds } from "./treasury-math";

describe("treasury maths", () => {
  it("net = tuition + books - deductions", () => {
    const b = makeBucket(1000, 250.5, 400.25);
    expect(b.income).toBe(1250.5);
    expect(b.net).toBe(850.25);
  });

  it("net can go negative only if the data does (the API refuses such a deduction)", () => {
    expect(makeBucket(100, 0, 150).net).toBe(-50);
  });

  it("month bounds are [first of month, first of next month) in UTC, December rolls the year", () => {
    const { start, end } = monthBounds(2026, 12);
    expect(start.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});
