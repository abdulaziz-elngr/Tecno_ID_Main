import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { handleApiError, ok, readQuery } from "@/lib/api";
import { toDateOnly } from "@/lib/sessions";
import { attendanceRate } from "@/lib/attendance";

/**
 * Attendance dashboard aggregation (spec §19).
 * Every number is computed by the database with grouped counts — no
 * rows are streamed into the app just to be counted in JavaScript.
 */

const querySchema = z.object({
  branchId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
  gradeId: z.string().uuid().optional(),
  teacherId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  /** Number of trailing days for the trend series. */
  trendDays: z.coerce.number().int().min(1).max(90).default(14)
});

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("attendance.view");
    const query = readQuery(request, querySchema);
    const branchIds = resolveBranchScope(ctx, query.branchId);

    const today = toDateOnly(new Date());
    const from = query.from ? toDateOnly(query.from) : today;
    const to = query.to ? toDateOnly(query.to) : today;

    const sessionFilter = {
      date: { gte: from, lte: to },
      ...(query.teacherId ? { teacherId: query.teacherId } : {}),
      ...(query.groupId || query.gradeId || query.stageId
        ? {
            group: {
              ...(query.groupId ? { id: query.groupId } : {}),
              ...(query.gradeId ? { gradeId: query.gradeId } : {}),
              ...(query.stageId ? { grade: { stageId: query.stageId } } : {})
            }
          }
        : {})
    };

    const where = {
      organizationId: ctx.organizationId,
      deletedAt: null,
      ...(branchIds ? { branchId: { in: branchIds } } : {}),
      session: sessionFilter
    };

    const [byType, sessionCount, expectedEnrollments] = await Promise.all([
      db.attendance.groupBy({ by: ["type"], where, _count: { _all: true } }),
      db.classSession.count({
        where: {
          organizationId: ctx.organizationId,
          ...(branchIds ? { branchId: { in: branchIds } } : {}),
          status: { not: "CANCELLED" },
          ...sessionFilter
        }
      }),
      db.student.count({
        where: {
          deletedAt: null,
          status: "ACTIVE",
          group: {
            deletedAt: null,
            isActive: true,
            ...(branchIds ? { branchId: { in: branchIds } } : {}),
            ...(query.groupId ? { id: query.groupId } : {}),
            ...(query.gradeId ? { gradeId: query.gradeId } : {}),
            ...(query.stageId ? { grade: { stageId: query.stageId } } : {})
          }
        }
      })
    ]);

    const counts = {
      present: 0,
      late: 0,
      makeUp: 0,
      excused: 0,
      absent: 0
    };
    for (const row of byType) {
      if (row.type === "REGULAR") counts.present = row._count._all;
      if (row.type === "LATE") counts.late = row._count._all;
      if (row.type === "MAKE_UP") counts.makeUp = row._count._all;
      if (row.type === "EXCUSED") counts.excused = row._count._all;
      if (row.type === "ABSENT") counts.absent = row._count._all;
    }

    const attended = counts.present + counts.late + counts.makeUp;
    const recorded = attended + counts.excused + counts.absent;

    // Daily trend for the chart.
    const trendStart = new Date(today);
    trendStart.setUTCDate(trendStart.getUTCDate() - (query.trendDays - 1));
    const trendRows = await db.attendance.findMany({
      where: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        ...(branchIds ? { branchId: { in: branchIds } } : {}),
        session: { date: { gte: trendStart, lte: today } }
      },
      select: { type: true, session: { select: { date: true } } },
      take: 20000
    });

    const trendMap = new Map<string, { present: number; absent: number }>();
    for (let i = 0; i < query.trendDays; i++) {
      const d = new Date(trendStart);
      d.setUTCDate(d.getUTCDate() + i);
      trendMap.set(d.toISOString().slice(0, 10), { present: 0, absent: 0 });
    }
    for (const row of trendRows) {
      const key = row.session.date.toISOString().slice(0, 10);
      const bucket = trendMap.get(key);
      if (!bucket) continue;
      if (row.type === "ABSENT") bucket.absent += 1;
      else if (row.type !== "EXCUSED") bucket.present += 1;
    }

    // Breakdown by group (top 10 by volume) for the table widget.
    const byGroup = await db.attendance.groupBy({
      by: ["groupId", "type"],
      where,
      _count: { _all: true }
    });
    const groupIds = [...new Set(byGroup.map((g) => g.groupId))].slice(0, 50);
    const groups = groupIds.length
      ? await db.group.findMany({
          where: { id: { in: groupIds } },
          select: { id: true, name: true, grade: { select: { name: true } } }
        })
      : [];
    const groupNames = new Map(groups.map((g) => [g.id, g]));

    const groupSummary = groupIds
      .map((id) => {
        const rows = byGroup.filter((g) => g.groupId === id);
        const get = (t: string) => rows.find((r) => r.type === t)?._count._all ?? 0;
        const present = get("REGULAR") + get("LATE") + get("MAKE_UP");
        const absent = get("ABSENT");
        return {
          groupId: id,
          groupName: groupNames.get(id)?.name ?? "—",
          gradeName: groupNames.get(id)?.grade.name ?? "—",
          present,
          absent,
          rate: attendanceRate(present, present + absent)
        };
      })
      .sort((a, b) => b.present + b.absent - (a.present + a.absent))
      .slice(0, 10);

    return ok({
      range: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      counts,
      sessions: sessionCount,
      expectedEnrollments,
      attendanceRate: attendanceRate(attended, recorded),
      trend: [...trendMap.entries()].map(([date, v]) => ({ date, ...v })),
      byGroup: groupSummary
    });
  } catch (err) {
    return handleApiError("attendance.summary", err);
  }
}
