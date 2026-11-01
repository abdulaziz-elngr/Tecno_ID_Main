import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { BusinessRuleError, created, handleApiError, ok, paginationSchema, readJson, readQuery } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { round2 } from "@/lib/billing";
import { nextDeductionNumber, pickBranchId, monthBounds, treasurySummary } from "@/lib/treasury";

const CATEGORIES = ["EQUIPMENT", "SUPPLIES", "MAINTENANCE", "CLEANING", "UTILITIES", "PRINTING", "TRANSPORT", "HOSPITALITY", "OTHER"] as const;

const listSchema = paginationSchema.extend({
  branchId: z.string().uuid().optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  category: z.enum(CATEGORIES).optional(),
  status: z.enum(["ACTIVE", "VOIDED"]).optional(),
  q: z.string().trim().max(100).optional()
});

const createSchema = z.object({
  title: z.string().trim().min(2).max(160),
  amount: z.number().positive().max(10_000_000),
  category: z.enum(CATEGORIES).default("OTHER"),
  spentAt: z.string().datetime().optional(),
  vendor: z.string().trim().max(160).optional(),
  requestedBy: z.string().trim().max(160).optional(),
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD", "OTHER"]).default("CASH"),
  notes: z.string().trim().max(1000).optional(),
  branchId: z.string().uuid().optional()
});

/** Deductions list + the treasury summary (Total + selected month) the page header shows. */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("deductions.view");
    const query = readQuery(request, listSchema);
    const branchIds = resolveBranchScope(ctx, query.branchId);

    const now = new Date();
    const year = query.year ?? now.getUTCFullYear();
    const month = query.month ?? now.getUTCMonth() + 1;
    const filterByMonth = query.year !== undefined && query.month !== undefined;
    const { start, end } = monthBounds(year, month);

    const where = {
      organizationId: ctx.organizationId,
      ...(branchIds ? { branchId: { in: branchIds } } : {}),
      ...(filterByMonth ? { spentAt: { gte: start, lt: end } } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: "insensitive" as const } },
              { vendor: { contains: query.q, mode: "insensitive" as const } },
              { requestedBy: { contains: query.q, mode: "insensitive" as const } },
              { referenceNumber: { contains: query.q, mode: "insensitive" as const } }
            ]
          }
        : {})
    };

    const [total, rows, summary] = await Promise.all([
      db.treasuryDeduction.count({ where }),
      db.treasuryDeduction.findMany({
        where,
        orderBy: [{ spentAt: "desc" }, { createdAt: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      treasurySummary({ organizationId: ctx.organizationId, branchIds }, year, month)
    ]);

    const userIds = Array.from(new Set(rows.flatMap((r) => [r.recordedById, r.voidedById]).filter((x): x is string => !!x)));
    const users = userIds.length
      ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })
      : [];
    const nameOf = new Map(users.map((u) => [u.id, u.fullName]));

    return ok({
      items: rows.map((r) => ({
        id: r.id,
        referenceNumber: r.referenceNumber,
        title: r.title,
        category: r.category,
        amount: Number(r.amount),
        spentAt: r.spentAt,
        vendor: r.vendor,
        requestedBy: r.requestedBy,
        method: r.method,
        notes: r.notes,
        status: r.status,
        recordedBy: r.recordedById ? nameOf.get(r.recordedById) ?? null : null,
        voidedBy: r.voidedById ? nameOf.get(r.voidedById) ?? null : null,
        voidedAt: r.voidedAt,
        voidReason: r.voidReason
      })),
      summary,
      canCreate: ctx.permissions.has("deductions.create"),
      canVoid: ctx.permissions.has("deductions.void"),
      pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) }
    });
  } catch (err) {
    return handleApiError("deductions.list", err);
  }
}

/**
 * Deducts an amount from the treasury. The balance is derived (income - ACTIVE deductions),
 * so saving the row IS the deduction: dashboard, payment records and reports all drop by it.
 * A deduction larger than the money the caller can see in the treasury is refused.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("deductions.create");
    const input = await readJson(request, createSchema);
    const branchId = await pickBranchId(ctx, input.branchId);
    const scope = { organizationId: ctx.organizationId, branchIds: resolveBranchScope(ctx, undefined) };

    const now = new Date();
    const summary = await treasurySummary(scope, now.getUTCFullYear(), now.getUTCMonth() + 1);
    if (input.amount > summary.total.net) {
      throw new BusinessRuleError(
        `Insufficient treasury balance: available ${round2(summary.total.net)}, requested ${input.amount}.`,
        { status: 409, code: "INSUFFICIENT_BALANCE", details: { available: round2(summary.total.net) } }
      );
    }

    const referenceNumber = await nextDeductionNumber(ctx.organizationId);
    const row = await db.treasuryDeduction.create({
      data: {
        organizationId: ctx.organizationId,
        branchId,
        referenceNumber,
        title: input.title,
        category: input.category,
        amount: input.amount,
        spentAt: input.spentAt ? new Date(input.spentAt) : now,
        vendor: input.vendor || null,
        requestedBy: input.requestedBy || null,
        method: input.method,
        notes: input.notes || null,
        recordedById: ctx.userId
      }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "CREATE_DEDUCTION",
      entityType: "TreasuryDeduction",
      entityId: row.id,
      afterValue: { referenceNumber, title: input.title, amount: input.amount, category: input.category }
    });

    return created({ id: row.id, referenceNumber, balanceAfter: round2(summary.total.net - input.amount) });
  } catch (err) {
    return handleApiError("deductions.create", err);
  }
}
