import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { handleApiError, ok, readQuery } from "@/lib/api";
import { collectionRate, round2 } from "@/lib/billing";
import { toCsv, csvResponse } from "@/lib/csv";
import { writeAuditLog } from "@/lib/audit";

/** Financial reporting (spec §32, §40). */

const querySchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  branchId: z.string().uuid().optional(),
  groupBy: z.enum(["day", "month", "group", "grade"]).default("month"),
  format: z.enum(["json", "csv"]).default("json")
});

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("reports.financial.view");
    const query = readQuery(request, querySchema);
    const branchIds = resolveBranchScope(ctx, query.branchId);

    const from = new Date(query.from);
    const to = new Date(`${query.to}T23:59:59.999Z`);
    const branchFilter = branchIds ? { in: branchIds } : undefined;

    const [payments, billed] = await Promise.all([
      db.payment.findMany({
        where: {
          organizationId: ctx.organizationId,
          status: { in: ["COMPLETED", "PARTIALLY_REFUNDED"] },
          paidAt: { gte: from, lte: to },
          ...(branchFilter ? { branchId: branchFilter } : {})
        },
        select: {
          paidAt: true,
          amount: true,
          refundedAmount: true,
          method: true,
          allocations: {
            select: {
              amount: true,
              subscription: { select: { groupId: true } }
            }
          }
        },
        take: 50000
      }),
      db.subscription.aggregate({
        where: {
          organizationId: ctx.organizationId,
          dueDate: { gte: from, lte: to },
          ...(branchFilter ? { branchId: branchFilter } : {})
        },
        _sum: { amount: true, discount: true, paidAmount: true }
      })
    ]);

    const revenue = round2(
      payments.reduce((sum, p) => sum + Number(p.amount) - Number(p.refundedAmount), 0)
    );
    const billedTotal = round2(
      Number(billed._sum.amount ?? 0) - Number(billed._sum.discount ?? 0)
    );

    const rows: { key: string; revenue: number }[] = [];
    const bucket = new Map<string, { revenue: number }>();
    const add = (key: string, value: number) => {
      const current = bucket.get(key) ?? { revenue: 0 };
      current.revenue = round2(current.revenue + value);
      bucket.set(key, current);
    };

    if (query.groupBy === "day" || query.groupBy === "month") {
      const slice = query.groupBy === "day" ? 10 : 7;
      for (const p of payments) {
        add(p.paidAt.toISOString().slice(0, slice), Number(p.amount) - Number(p.refundedAmount));
      }
    } else {
      // Revenue by group (or by that group's grade).
      const groupIds = new Set<string>();
      for (const p of payments) {
        for (const a of p.allocations) {
          if (a.subscription.groupId) groupIds.add(a.subscription.groupId);
        }
      }
      const groups = groupIds.size
        ? await db.group.findMany({
            where: { id: { in: [...groupIds] } },
            select: { id: true, name: true, grade: { select: { name: true } } }
          })
        : [];
      const labelById = new Map(
        groups.map((g) => [g.id, query.groupBy === "grade" ? g.grade.name : g.name])
      );
      for (const p of payments) {
        for (const a of p.allocations) {
          const label = a.subscription.groupId
            ? labelById.get(a.subscription.groupId) ?? "—"
            : "Unallocated";
          add(label, Number(a.amount));
        }
      }
    }

    for (const [key, value] of [...bucket.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      rows.push({ key, ...value });
    }

    if (query.format === "csv") {
      if (!ctx.permissions.has("reports.export")) {
        return ok({ error: "Export permission required." }, { status: 403 });
      }
      await writeAuditLog({
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: "EXPORT_FINANCIAL_REPORT",
        entityType: "Report",
        afterValue: { from: query.from, to: query.to, groupBy: query.groupBy }
      });
      return csvResponse(
        `financial-${query.from}-to-${query.to}.csv`,
        toCsv(rows)
      );
    }

    const byMethod = new Map<string, number>();
    for (const p of payments) {
      byMethod.set(
        p.method,
        round2((byMethod.get(p.method) ?? 0) + Number(p.amount) - Number(p.refundedAmount))
      );
    }

    return ok({
      range: { from: query.from, to: query.to },
      summary: {
        revenue,
        billed: billedTotal,
        collected: Number(billed._sum.paidAmount ?? 0),
        outstanding: round2(billedTotal - Number(billed._sum.paidAmount ?? 0)),
        collectionRate: collectionRate(Number(billed._sum.paidAmount ?? 0), billedTotal)
      },
      byMethod: [...byMethod.entries()].map(([method, amount]) => ({ method, amount })),
      series: rows
    });
  } catch (err) {
    return handleApiError("reports.financial", err);
  }
}
