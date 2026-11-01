import type { Prisma } from "@prisma/client";
import { fromIndex, ymIndex, type YearMonth } from "./subscription-months";

/**
 * Student monthly-fee exemption — pure helpers (no database access).
 *
 * Boundaries are stored on Student as DateTime. They are written as 12:00 UTC
 * on the 1st of the month, so converting them back to a year/month in ANY
 * time zone (Cairo is UTC+2/+3) always lands on the same calendar month.
 */

/** DateTime stored for a month boundary (noon UTC on the 1st). */
export function monthBoundary(ym: YearMonth): Date {
  return new Date(Date.UTC(ym.year, ym.month - 1, 1, 12, 0, 0));
}

export function previousMonth(ym: YearMonth): YearMonth {
  return fromIndex(ymIndex(ym) - 1);
}

/**
 * Prisma filter for subscription rows of months `>= from`
 * (`from: null` = every month).
 */
export function monthsFromFilter(from: YearMonth | null): Prisma.SubscriptionWhereInput {
  if (!from) return {};
  return {
    OR: [{ periodYear: { gt: from.year } }, { periodYear: from.year, periodMonth: { gte: from.month } }]
  };
}
