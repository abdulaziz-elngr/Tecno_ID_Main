import { db } from "./db";
import { round2 } from "./billing";
import { resolveBranchScope, type AuthContext } from "./rbac";
import { BusinessRuleError } from "./api";

/**
 * Treasury maths — the ONE place that answers "how much money does the center have?".
 *
 *   income     = tuition payments (net of refunds)  +  book payments
 *   deductions = ACTIVE "خصم مبلغ" rows
 *   balance    = income - deductions
 *
 * Nothing is stored: every screen (treasury page, dashboard, payment records, payments,
 * reports) calls this, so recording or voiding a deduction changes all of them at once.
 */

export interface TreasuryScope {
  organizationId: string;
  /** undefined = every branch of the organization. */
  branchIds?: string[];
}

export { makeBucket, monthBounds, type TreasuryBucket } from "./treasury-math";
import { makeBucket, monthBounds, type TreasuryBucket } from "./treasury-math";

export interface TreasurySummary {
  year: number;
  month: number;
  /** Everything since the beginning ("Total المبلغ"). */
  total: TreasuryBucket;
  /** The selected month only ("فلوس الشهر"). */
  monthly: TreasuryBucket;
}

type DateRange = { gte?: Date; lt?: Date } | undefined;

async function sums(scope: TreasuryScope, range: DateRange) {
  const branch = scope.branchIds ? { branchId: { in: scope.branchIds } } : {};
  const [tuition, books, deductions] = await Promise.all([
    db.payment.aggregate({
      where: {
        organizationId: scope.organizationId,
        status: { in: ["COMPLETED", "PARTIALLY_REFUNDED"] },
        ...(range ? { paidAt: range } : {}),
        ...branch
      },
      _sum: { amount: true, refundedAmount: true }
    }),
    db.bookPayment.aggregate({
      where: { organizationId: scope.organizationId, status: "COMPLETED", ...(range ? { paidAt: range } : {}), ...branch },
      _sum: { amount: true }
    }),
    db.treasuryDeduction.aggregate({
      where: { organizationId: scope.organizationId, status: "ACTIVE", ...(range ? { spentAt: range } : {}), ...branch },
      _sum: { amount: true }
    })
  ]);
  return makeBucket(
    Number(tuition._sum.amount ?? 0) - Number(tuition._sum.refundedAmount ?? 0),
    Number(books._sum.amount ?? 0),
    Number(deductions._sum.amount ?? 0)
  );
}

export async function treasurySummary(scope: TreasuryScope, year: number, month: number): Promise<TreasurySummary> {
  const { start, end } = monthBounds(year, month);
  const [total, monthly] = await Promise.all([sums(scope, undefined), sums(scope, { gte: start, lt: end })]);
  return { year, month, total, monthly };
}

/** Next free `DED-YYYYMM-00001` reference (the unique index is the real guarantee). */
export async function nextDeductionNumber(organizationId: string, now = new Date()): Promise<string> {
  const prefix = `DED-${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const count = await db.treasuryDeduction.count({ where: { organizationId, referenceNumber: { startsWith: prefix } } });
    const candidate = `${prefix}-${String(count + 1 + attempt).padStart(5, "0")}`;
    const exists = await db.treasuryDeduction.findUnique({ where: { referenceNumber: candidate } });
    if (!exists) return candidate;
  }
  throw new Error("Could not allocate a unique deduction number.");
}

/** The branch a new deduction belongs to: the requested one (if allowed), else the caller's first, else the org's first. */
export async function pickBranchId(ctx: AuthContext, requested?: string | null): Promise<string> {
  if (requested) {
    resolveBranchScope(ctx, requested);
    const ok = await db.branch.findFirst({
      where: { id: requested, deletedAt: null, center: { organizationId: ctx.organizationId } },
      select: { id: true }
    });
    if (!ok) throw new BusinessRuleError("Branch not found.", { status: 404 });
    return ok.id;
  }
  if (ctx.branchIds[0]) return ctx.branchIds[0];
  const first = await db.branch.findFirst({
    where: { deletedAt: null, center: { organizationId: ctx.organizationId } },
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });
  if (!first) throw new BusinessRuleError("No branch is set up yet.", { status: 409, code: "NO_BRANCH" });
  return first.id;
}
