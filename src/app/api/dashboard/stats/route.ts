import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthContext, resolveBranchScope, UnauthorizedError } from "@/lib/rbac";
import { handleApiError, ok, readQuery } from "@/lib/api";
import { toDateOnly } from "@/lib/sessions";
import { round2 } from "@/lib/billing";
import { loadLedgerEnv, loadLedgers } from "@/lib/payment-ledger";
import { outstandingMonths } from "@/lib/subscription-months";

/**
 * Dashboard statistics (spec §8).
 *
 * EVERY number here is a real aggregate query — nothing is hard-coded.
 * Widgets the caller has no permission to see are simply absent from
 * the response (financial figures require `payments.view`), so a
 * teacher's dashboard cannot leak revenue via the network tab.
 */

const querySchema = z.object({
  branchId: z.string().uuid().optional(),
  trendMonths: z.coerce.number().int().min(1).max(24).default(6)
});

export async function GET(request: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) throw new UnauthorizedError();

    const query = readQuery(request, querySchema);
    const branchIds = resolveBranchScope(ctx, query.branchId);
    const canSeeFinance = ctx.permissions.has("payments.view");
    const canSeeAttendance = ctx.permissions.has("attendance.view");

    const today = toDateOnly(new Date());
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const branchFilter = branchIds ? { in: branchIds } : undefined;

    const [totalStudents, activeStudents, totalTeachers, totalGroups, totalBranches] =
      await Promise.all([
        db.student.count({
          where: {
            organizationId: ctx.organizationId,
            deletedAt: null,
            ...(branchFilter ? { branchId: branchFilter } : {})
          }
        }),
        db.student.count({
          where: {
            organizationId: ctx.organizationId,
            deletedAt: null,
            status: "ACTIVE",
            ...(branchFilter ? { branchId: branchFilter } : {})
          }
        }),
        db.teacher.count({
          where: {
            organizationId: ctx.organizationId,
            deletedAt: null,
            isActive: true,
            ...(branchFilter ? { branchId: branchFilter } : {})
          }
        }),
        db.group.count({
          where: {
            deletedAt: null,
            isActive: true,
            branch: { center: { organizationId: ctx.organizationId } },
            ...(branchFilter ? { branchId: branchFilter } : {})
          }
        }),
        db.branch.count({
          where: { deletedAt: null, center: { organizationId: ctx.organizationId } }
        })
      ]);

    const response: Record<string, unknown> = {
      students: { total: totalStudents, active: activeStudents },
      teachers: totalTeachers,
      groups: totalGroups,
      branches: totalBranches
    };

    if (canSeeAttendance) {
      const attendanceWhere = {
        organizationId: ctx.organizationId,
        deletedAt: null,
        ...(branchFilter ? { branchId: branchFilter } : {}),
        session: { date: today }
      };

      const [byType, todaySessions] = await Promise.all([
        db.attendance.groupBy({ by: ["type"], where: attendanceWhere, _count: { _all: true } }),
        db.classSession.count({
          where: {
            organizationId: ctx.organizationId,
            date: today,
            status: { not: "CANCELLED" },
            ...(branchFilter ? { branchId: branchFilter } : {})
          }
        })
      ]);

      const pick = (t: string) => byType.find((b) => b.type === t)?._count._all ?? 0;
      response.attendanceToday = {
        present: pick("REGULAR"),
        late: pick("LATE"),
        makeUp: pick("MAKE_UP"),
        excused: pick("EXCUSED"),
        absent: pick("ABSENT"),
        sessions: todaySessions
      };
    }

    if (canSeeFinance) {
      const [monthPayments, todayPayments, activeStudents] = await Promise.all([
        db.payment.aggregate({
          where: {
            organizationId: ctx.organizationId,
            status: { in: ["COMPLETED", "PARTIALLY_REFUNDED"] },
            paidAt: { gte: monthStart },
            ...(branchFilter ? { branchId: branchFilter } : {})
          },
          _sum: { amount: true, refundedAmount: true }
        }),
        // Spec §27 — "Today's Payments" as its own figure.
        db.payment.aggregate({
          where: {
            organizationId: ctx.organizationId,
            status: { in: ["COMPLETED", "PARTIALLY_REFUNDED"] },
            paidAt: { gte: today },
            ...(branchFilter ? { branchId: branchFilter } : {})
          },
          _sum: { amount: true },
          _count: { _all: true }
        }),
        db.student.findMany({
          where: {
            organizationId: ctx.organizationId,
            deletedAt: null,
            status: "ACTIVE",
            ...(branchFilter ? { branchId: branchFilter } : {})
          },
          select: { id: true, gradeId: true, enrollmentDate: true },
          take: 5000
        })
      ]);

      // Paid / unpaid / outstanding come from the same monthly ledger the
      // payment screens use, so the dashboard can never disagree with them.
      const env = await loadLedgerEnv(ctx.organizationId);
      const ledgers = await loadLedgers(ctx.organizationId, activeStudents, env);
      let paidStudents = 0;
      let unpaidStudents = 0;
      let outstandingAmount = 0;
      let overdueMonthsCount = 0;
      for (const st of activeStudents) {
        const ledger = ledgers.get(st.id) ?? [];
        const cur = ledger.find((e) => e.year === env.current.year && e.month === env.current.month);
        if (cur) {
          if (cur.status === "PAID" || cur.status === "WAIVED") paidStudents++;
          else unpaidStudents++;
        }
        for (const e of outstandingMonths(ledger)) {
          outstandingAmount += e.remaining;
          if (e.status === "OVERDUE") overdueMonthsCount++;
        }
      }

      response.finance = {
        monthlyRevenue: round2(
          Number(monthPayments._sum.amount ?? 0) - Number(monthPayments._sum.refundedAmount ?? 0)
        ),
        paidStudents,
        unpaidStudents,
        outstanding: round2(outstandingAmount),
        overdueMonths: overdueMonthsCount,
        todayPaymentsCount: todayPayments._count._all,
        todayPaymentsAmount: round2(Number(todayPayments._sum.amount ?? 0))
      };

      const trendStart = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (query.trendMonths - 1), 1)
      );
      const payments = await db.payment.findMany({
        where: {
          organizationId: ctx.organizationId,
          status: { in: ["COMPLETED", "PARTIALLY_REFUNDED"] },
          paidAt: { gte: trendStart },
          ...(branchFilter ? { branchId: branchFilter } : {})
        },
        select: { paidAt: true, amount: true, refundedAmount: true },
        take: 20000
      });

      const buckets = new Map<string, { revenue: number }>();
      for (let i = 0; i < query.trendMonths; i++) {
        const d = new Date(Date.UTC(trendStart.getUTCFullYear(), trendStart.getUTCMonth() + i, 1));
        buckets.set(d.toISOString().slice(0, 7), { revenue: 0 });
      }
      for (const p of payments) {
        const bucket = buckets.get(p.paidAt.toISOString().slice(0, 7));
        if (bucket) {
          bucket.revenue = round2(bucket.revenue + Number(p.amount) - Number(p.refundedAmount));
        }
      }
      response.financeTrend = [...buckets.entries()].map(([month, v]) => ({ month, ...v }));
    }

    if (ctx.permissions.has("exams.view")) {
      response.upcomingExams = await db.exam.findMany({
        where: {
          organizationId: ctx.organizationId,
          deletedAt: null,
          date: { gte: new Date() },
          ...(branchFilter ? { branchId: branchFilter } : {})
        },
        orderBy: { date: "asc" },
        take: 5,
        select: {
          id: true,
          name: true,
          date: true,
          subject: { select: { name: true } },
          group: { select: { name: true } }
        }
      });
    }

    // Spec §28 — group capacity dashboard: current/max per active group.
    if (ctx.permissions.has("academic.groups.manage")) {
      const groups = await db.group.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          branch: { center: { organizationId: ctx.organizationId } },
          ...(branchFilter ? { branchId: branchFilter } : {})
        },
        orderBy: { name: "asc" },
        take: 12,
        select: {
          id: true,
          name: true,
          capacity: true,
          grade: { select: { name: true, stage: { select: { name: true } } } },
          _count: { select: { students: { where: { deletedAt: null, status: "ACTIVE" } } } }
        }
      });
      response.groupCapacity = groups.map((g) => ({
        id: g.id,
        name: g.name,
        gradeName: g.grade.name,
        stageName: g.grade.stage.name,
        current: g._count.students,
        capacity: g.capacity,
        isFull: g._count.students >= g.capacity
      }));
    }

    response.recentActivity = ctx.permissions.has("audit_logs.view")
      ? await db.auditLog.findMany({
          where: { organizationId: ctx.organizationId },
          orderBy: { createdAt: "desc" },
          take: 8,
          select: {
            id: true,
            action: true,
            entityType: true,
            createdAt: true,
            actor: { select: { fullName: true } }
          }
        })
      : [];

    return ok(response);
  } catch (err) {
    return handleApiError("dashboard.stats", err);
  }
}
