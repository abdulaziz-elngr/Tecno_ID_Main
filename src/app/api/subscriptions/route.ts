import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { handleApiError, ok, created, readJson, readQuery, paginationSchema, BusinessRuleError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { computeSubscriptionStatus, netDue, remainingAmount } from "@/lib/billing";

const listSchema = paginationSchema.extend({
  branchId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
  status: z.enum(["PAID", "PARTIAL", "UNPAID", "OVERDUE", "WAIVED"]).optional(),
  periodYear: z.coerce.number().int().min(2000).max(2100).optional(),
  periodMonth: z.coerce.number().int().min(1).max(12).optional()
});

const createSchema = z.object({
  studentId: z.string().uuid(),
  groupId: z.string().uuid().optional(),
  periodYear: z.number().int().min(2000).max(2100),
  periodMonth: z.number().int().min(1).max(12),
  amount: z.number().min(0).max(1000000),
  discount: z.number().min(0).max(1000000).default(0),
  dueDate: z.string().datetime(),
  notes: z.string().trim().max(500).optional()
});

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("subscriptions.view");
    const query = readQuery(request, listSchema);
    const branchIds = resolveBranchScope(ctx, query.branchId);

    const where = {
      organizationId: ctx.organizationId,
      ...(branchIds ? { branchId: { in: branchIds } } : {}),
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.groupId ? { groupId: query.groupId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.periodYear ? { periodYear: query.periodYear } : {}),
      ...(query.periodMonth ? { periodMonth: query.periodMonth } : {})
    };

    const [total, rows, totals] = await Promise.all([
      db.subscription.count({ where }),
      db.subscription.findMany({
        where,
        orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          student: { select: { id: true, fullName: true, studentCode: true } }
        }
      }),
      db.subscription.aggregate({ where, _sum: { amount: true, discount: true, paidAmount: true } })
    ]);

    const billed = netDue(Number(totals._sum.amount ?? 0), Number(totals._sum.discount ?? 0));
    const collected = Number(totals._sum.paidAmount ?? 0);

    return ok({
      subscriptions: rows.map((s) => ({
        id: s.id,
        student: s.student,
        groupId: s.groupId,
        periodYear: s.periodYear,
        periodMonth: s.periodMonth,
        amount: Number(s.amount),
        discount: Number(s.discount),
        paidAmount: Number(s.paidAmount),
        remaining: remainingAmount(Number(s.amount), Number(s.discount), Number(s.paidAmount)),
        dueDate: s.dueDate,
        status: s.status,
        notes: s.notes
      })),
      totals: { billed, collected, outstanding: Math.max(0, billed - collected) },
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize))
      }
    });
  } catch (err) {
    return handleApiError("subscriptions.list", err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("subscriptions.manage");
    const input = await readJson(request, createSchema);

    const student = await db.student.findFirst({
      where: { id: input.studentId, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, branchId: true }
    });
    if (!student) throw new BusinessRuleError("Student not found.", { status: 404 });
    resolveBranchScope(ctx, student.branchId);

    // groupId is client-supplied: it must be a group of this organization
    // in a branch the caller may act on.
    if (input.groupId) {
      const group = await db.group.findFirst({
        where: {
          id: input.groupId,
          deletedAt: null,
          branch: { center: { organizationId: ctx.organizationId } }
        },
        select: { branchId: true }
      });
      if (!group) throw new BusinessRuleError("Invalid group.", { status: 400 });
      resolveBranchScope(ctx, group.branchId);
    }

    // Postgres treats NULL group ids as distinct in the unique index,
    // so the general (no-group) duplicate case is checked here.
    const duplicate = await db.subscription.findFirst({
      where: {
        studentId: student.id,
        groupId: input.groupId ?? null,
        periodYear: input.periodYear,
        periodMonth: input.periodMonth
      }
    });
    if (duplicate) {
      throw new BusinessRuleError("A subscription for this student and period already exists.");
    }

    const dueDate = new Date(input.dueDate);
    const subscription = await db.subscription.create({
      data: {
        organizationId: ctx.organizationId,
        branchId: student.branchId,
        studentId: student.id,
        groupId: input.groupId,
        periodYear: input.periodYear,
        periodMonth: input.periodMonth,
        amount: input.amount,
        discount: input.discount,
        dueDate,
        notes: input.notes,
        status: computeSubscriptionStatus({
          amount: input.amount,
          discount: input.discount,
          paidAmount: 0,
          dueDate
        })
      }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "CREATE_SUBSCRIPTION",
      entityType: "Subscription",
      entityId: subscription.id,
      afterValue: subscription
    });

    return created(subscription);
  } catch (err) {
    return handleApiError("subscriptions.create", err);
  }
}
