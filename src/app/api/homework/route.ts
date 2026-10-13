import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { handleApiError, ok, created, readJson, readQuery, BusinessRuleError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { loadAccessibleGroup } from "@/lib/group-access";
import { toDateOnly } from "@/lib/sessions";
import { COMPLETED_SUBMISSION_STATUSES } from "@/lib/homework";

/**
 * Homework (الواجب) — stored in the existing Assignment / AssignmentSubmission
 * tables. A homework belongs to one group and one lesson; each student is marked
 * Completed or Not completed (see ./[id]).
 */

const listSchema = z.object({ groupId: z.string().uuid() });

const createSchema = z.object({
  groupId: z.string().uuid(),
  sessionId: z.string().uuid(), // the lesson this homework is linked to
  title: z.string().trim().min(2).max(200),
  date: z.string().date(),
  description: z.string().trim().max(2000).optional()
});

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("assignments.view");
    const query = readQuery(request, listSchema);
    const group = await loadAccessibleGroup(ctx, query.groupId);

    const [rows, studentCount] = await Promise.all([
      db.assignment.findMany({
        where: { organizationId: ctx.organizationId, groupId: group.id, deletedAt: null },
        orderBy: [{ dueDate: "desc" }, { createdAt: "desc" }],
        take: 200,
        select: { id: true, title: true, dueDate: true, session: { select: { lessonNumber: true } } }
      }),
      db.student.count({ where: { groupId: group.id, deletedAt: null, status: "ACTIVE" } })
    ]);

    const grouped = rows.length
      ? await db.assignmentSubmission.groupBy({
          by: ["assignmentId", "status"],
          where: { assignmentId: { in: rows.map((r) => r.id) } },
          _count: { _all: true }
        })
      : [];
    const completed = new Map<string, number>();
    const notCompleted = new Map<string, number>();
    for (const g of grouped) {
      if (COMPLETED_SUBMISSION_STATUSES.includes(g.status)) {
        completed.set(g.assignmentId, (completed.get(g.assignmentId) ?? 0) + g._count._all);
      } else if (g.status === "MISSING") {
        notCompleted.set(g.assignmentId, (notCompleted.get(g.assignmentId) ?? 0) + g._count._all);
      }
    }

    return ok({
      homework: rows.map((r) => {
        const done = completed.get(r.id) ?? 0;
        const notDone = notCompleted.get(r.id) ?? 0;
        return {
          id: r.id,
          title: r.title,
          date: r.dueDate,
          lessonNumber: r.session?.lessonNumber ?? null,
          studentCount,
          completedCount: done,
          notCompletedCount: notDone,
          pendingCount: Math.max(0, studentCount - done - notDone)
        };
      })
    });
  } catch (err) {
    return handleApiError("homework.list", err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("assignments.manage");
    const input = await readJson(request, createSchema);
    const group = await loadAccessibleGroup(ctx, input.groupId);

    const lesson = await db.classSession.findFirst({
      where: { id: input.sessionId, groupId: group.id, organizationId: ctx.organizationId },
      select: { id: true, status: true }
    });
    if (!lesson) throw new BusinessRuleError("This lesson does not belong to the selected group.", { status: 400 });
    if (lesson.status === "CANCELLED") throw new BusinessRuleError("This lesson was cancelled.", { status: 400 });

    const row = await db.assignment.create({
      data: {
        organizationId: ctx.organizationId,
        branchId: group.branchId,
        groupId: group.id,
        sessionId: lesson.id,
        subjectId: group.subject?.name,
        title: input.title,
        description: input.description || null,
        dueDate: toDateOnly(input.date),
        // Homework here is marked Completed / Not completed, not graded.
        maxScore: 0,
        createdById: ctx.userId
      }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "CREATE_HOMEWORK",
      entityType: "Assignment",
      entityId: row.id,
      afterValue: row
    });

    return created({ id: row.id });
  } catch (err) {
    return handleApiError("homework.create", err);
  }
}
