const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface TreasuryBucket {
  tuition: number;
  books: number;
  income: number;
  deductions: number;
  net: number;
}

/** [start, end) of a calendar month in UTC — the same convention the dashboard uses. */
export function monthBounds(year: number, month: number): { start: Date; end: Date } {
  return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)) };
}

export function makeBucket(tuition: number, books: number, deductions: number): TreasuryBucket {
  const income = round2(tuition + books);
  return { tuition: round2(tuition), books: round2(books), income, deductions: round2(deductions), net: round2(income - deductions) };
}

