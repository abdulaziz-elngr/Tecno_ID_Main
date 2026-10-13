import { db } from "./db";

/**
 * Financial rules (spec §29–§32, Rule 6).
 *
 * All arithmetic here works in *minor units conceptually* by rounding
 * to 2 decimals at every step, so repeated allocation can never leak
 * fractions of a pound. Money is stored as Postgres NUMERIC(10,2) via
 * Prisma Decimal; these helpers take/return plain numbers and the
 * callers convert at the boundary.
 */

export type SubscriptionStatusValue = "PAID" | "PARTIAL" | "UNPAID" | "OVERDUE" | "WAIVED";

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function netDue(amount: number, discount: number): number {
  return round2(Math.max(0, amount - discount));
}

export function remainingAmount(amount: number, discount: number, paidAmount: number): number {
  return round2(Math.max(0, netDue(amount, discount) - paidAmount));
}

export function computeSubscriptionStatus(params: {
  amount: number;
  discount: number;
  paidAmount: number;
  dueDate: Date;
  waived?: boolean;
  now?: Date;
}): SubscriptionStatusValue {
  if (params.waived) return "WAIVED";

  const now = params.now ?? new Date();
  const due = netDue(params.amount, params.discount);
  const paid = round2(params.paidAmount);

  if (due <= 0 || paid >= due) return "PAID";
  if (params.dueDate.getTime() < now.getTime()) return "OVERDUE";
  if (paid > 0) return "PARTIAL";
  return "UNPAID";
}

export interface AllocationTarget {
  subscriptionId: string;
  /** Outstanding amount on that subscription before this payment. */
  remaining: number;
}

export interface AllocationResult {
  allocations: { subscriptionId: string; amount: number }[];
  unallocated: number;
}

/**
 * Spreads a payment across outstanding subscriptions, oldest first.
 * Whatever cannot be allocated is returned as `unallocated` (credit) —
 * we never silently over-pay a subscription.
 */
export function allocatePayment(amount: number, targets: AllocationTarget[]): AllocationResult {
  let left = round2(amount);
  const allocations: { subscriptionId: string; amount: number }[] = [];

  for (const target of targets) {
    if (left <= 0) break;
    const take = round2(Math.min(left, Math.max(0, target.remaining)));
    if (take <= 0) continue;
    allocations.push({ subscriptionId: target.subscriptionId, amount: take });
    left = round2(left - take);
  }

  return { allocations, unallocated: round2(left) };
}

/**
 * Resolves the monthly subscription fee configured for a Stage
 * (Settings → Subscription Fees, spec §17). Fees are never
 * hard-coded — this always reads the currently-active
 * SubscriptionFee row for the stage, using the most recent
 * effectiveFrom date that is not in the future relative to `asOf`.
 * Returns null if no fee has been configured yet for that stage.
 */
export async function currentStageFee(stageId: string, asOf: Date = new Date()) {
  return db.subscriptionFee.findFirst({
    where: { stageId, isActive: true, effectiveFrom: { lte: asOf } },
    orderBy: { effectiveFrom: "desc" }
  });
}

export function collectionRate(collected: number, billed: number): number {
  if (billed <= 0) return 0;
  return Math.round((collected / billed) * 1000) / 10;
}

/**
 * Human-readable, per-organization sequential document numbers.
 *
 * The count+retry approach keeps numbers readable without a dedicated
 * sequence table; the DB unique constraint on receiptNumber /
 * invoiceNumber is the real guarantee, and we retry on collision.
 */
export async function nextReceiptNumber(organizationId: string, now = new Date()): Promise<string> {
  const prefix = `RCP-${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const count = await db.payment.count({
      where: { organizationId, receiptNumber: { startsWith: prefix } }
    });
    const candidate = `${prefix}-${String(count + 1 + attempt).padStart(5, "0")}`;
    const exists = await db.payment.findUnique({ where: { receiptNumber: candidate } });
    if (!exists) return candidate;
  }
  throw new Error("Could not allocate a unique receipt number.");
}

export async function nextInvoiceNumber(organizationId: string, now = new Date()): Promise<string> {
  const prefix = `INV-${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const count = await db.invoice.count({
      where: { organizationId, invoiceNumber: { startsWith: prefix } }
    });
    const candidate = `${prefix}-${String(count + 1 + attempt).padStart(5, "0")}`;
    const exists = await db.invoice.findUnique({ where: { invoiceNumber: candidate } });
    if (!exists) return candidate;
  }
  throw new Error("Could not allocate a unique invoice number.");
}

/** Formats money for display in reports/invoices, locale-aware. */
export function formatMoney(value: number, currency = "EGP", locale = "en"): string {
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(value);
}
