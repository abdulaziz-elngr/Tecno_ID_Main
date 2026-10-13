import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { handleApiError, ok, readQuery } from "@/lib/api";
import { attendanceRate } from "@/lib/attendance";
import { percentage } from "@/lib/grading";
import { analyzeStudent } from "@/lib/analytics";
import { getAnalyticsThresholds } from "@/lib/settings";
import { toCsv, csvResponse } from "@/lib/csv";
import { writeAuditLog } from "@/lib/audit";
import { toDateOnly } from "@/lib/sessions";

/**
 * Student performance report (spec §40, §65) — one row per student with
 * attendance, exam average and rule-based flags. Capped at 1000 students
 * per call; larger centres filter by branch/group.
 */

const querySchema = z.object({
  branchId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  gradeId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  flagged: z.enum(["true", "false"]).optional(),
  format: z.enum(["json", "csv"]).default("json"),
  limit: z.coerce.number().int().min(1).max(1000).default(200)
});

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("reports.view");
    const query = readQuery(request, querySchema);
    const branchIds = resolveBranchScope(ctx, query.branchId);
    const thresholds = await getAnalyticsThresholds(ctx.organizationId);

    const dateFilter =
      query.from || query.to
        ? {
            date: {
              ...(query.from ? { gte: toDateOnly(query.from) } : {}),
              ...(query.to ? { lte: toDateOnly(query.to) } : {})
            }
          }
        : {};

    const students = await db.student.findMany({
      where: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        status: "ACTIVE",
        ...(branchIds ? { branchId: { in: branchIds } } : {}),
        ...(query.groupId ? { groupId: query.groupId } : {}),
        ...(query.gradeId ? { gradeId: query.gradeId } : {}),
        ...(query.stageId ? { stageId: query.stageId } : {})
      },
      take: query.limit,
      select: {
        id: true,
        fullName: true,
        studentCode: true,
        branch: { select: { name: true } },
        attendances: {
          where: { deletedAt: null, session: dateFilter },
          select: { type: true }
        },
        examResults: {
          where: { exam: { deletedAt: null } },
          select: { score: true, isAbsent: true, exam: { select: { maxScore: true } } }
        },
        assignmentSubmissions: { select: { status: true } },
        subscriptions: {
          where: { status: { in: ["UNPAID", "PARTIAL", "OVERDUE"] } },
          select: { amount: true, discount: true, paidAmount: true }
        }
      }
    });

    const rows = students.map((s) => {
      const present = s.attendances.filter((a) =>
        ["REGULAR", "LATE", "MAKE_UP"].includes(a.type)
      ).length;
      const absent = s.attendances.filter((a) => a.type === "ABSENT").length;
      const percentages = s.examResults
        .filter((r) => !r.isAbsent && r.score !== null)
        .map((r) => percentage(Number(r.score), Number(r.exam.maxScore)));
      const outstanding = s.subscriptions.reduce(
        (sum, sub) =>
          sum +
          Math.max(0, Number(sub.amount) - Number(sub.discount) - Number(sub.paidAmount)),
        0
      );

      const analytics = analyzeStudent(
        {
          presentCount: present,
          totalSessions: present + absent,
          consecutiveAbsences: 0,
          examPercentages: percentages,
          missingAssignments: s.assignmentSubmissions.filter((a) => a.status === "MISSING").length,
          outstandingAmount: outstanding
        },
        thresholds
      );

      return {
        studentId: s.id,
        studentCode: s.studentCode,
        fullName: s.fullName,
        branch: s.branch.name,
        sessions: present + absent,
        present,
        absent,
        attendancePercentage: attendanceRate(present, present + absent),
        examAverage: analytics.averagePercentage,
        trend: analytics.trend,
        outstanding: Math.round(outstanding * 100) / 100,
        flags: analytics.flags.map((f) => f.code)
      };
    });

    const filtered = query.flagged === "true" ? rows.filter((r) => r.flags.length > 0) : rows;

    if (query.format === "csv") {
      if (!ctx.permissions.has("reports.export")) {
        return ok({ error: "Export permission required." }, { status: 403 });
      }
      await writeAuditLog({
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: "EXPORT_STUDENT_REPORT",
        entityType: "Report",
        afterValue: { rows: filtered.length }
      });
      return csvResponse(
        `students-report-${new Date().toISOString().slice(0, 10)}.csv`,
        toCsv(filtered.map((r) => ({ ...r, flags: r.flags.join("|") })))
      );
    }

    return ok({ rows: filtered, count: filtered.length });
  } catch (err) {
    return handleApiError("reports.students", err);
  }
}
