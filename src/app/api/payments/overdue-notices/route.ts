import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { handleApiError, ok } from "@/lib/api";
import { loadLedgerEnv, loadLedgers } from "@/lib/payment-ledger";
import { monthLabel, overdueMonths } from "@/lib/subscription-months";

/**
 * "Monthly Subscription Unpaid" notices. Computed live from the ledger, so a
 * notice stays visible exactly as long as the month is unpaid and disappears
 * the moment the payment is recorded. Nothing is stored or duplicated.
 * A month is overdue once the due day (5th by default) has passed, and every
 * earlier unpaid month is overdue as well.
 */
export async function GET() {
  try {
    const ctx = await requirePermission("payments.view");
    const branchIds = resolveBranchScope(ctx, undefined);
    const env = await loadLedgerEnv(ctx.organizationId);

    const students = await db.student.findMany({
      where: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        status: "ACTIVE",
        ...(branchIds ? { branchId: { in: branchIds } } : {})
      },
      select: {
        id: true,
        fullName: true,
        studentCode: true,
        gradeId: true,
        enrollmentDate: true,
        group: { select: { name: true } },
        grade: { select: { name: true } }
      },
      take: 5000
    });
    const ledgers = await loadLedgers(ctx.organizationId, students, env);

    const notices = [];
    let totalOutstanding = 0;
    for (const s of students) {
      const overdue = overdueMonths(ledgers.get(s.id) ?? []);
      if (overdue.length === 0) continue;
      const due = overdue.reduce((sum, e) => sum + e.remaining, 0);
      totalOutstanding += due;
      notices.push({
        studentId: s.id,
        fullName: s.fullName,
        studentCode: s.studentCode,
        gradeName: s.grade.name,
        groupName: s.group.name,
        totalDue: Math.round(due * 100) / 100,
        months: overdue.map((e) => ({
          year: e.year,
          month: e.month,
          label: monthLabel(e, "en"),
          remaining: e.remaining
        }))
      });
    }
    notices.sort((a, b) => b.months.length - a.months.length || a.fullName.localeCompare(b.fullName));

    return ok({
      currency: env.currency,
      dueDay: env.dueDay,
      count: notices.length,
      totalOutstanding: Math.round(totalOutstanding * 100) / 100,
      notices: notices.slice(0, 100)
    });
  } catch (err) {
    return handleApiError("payments.overdue-notices", err);
  }
}
