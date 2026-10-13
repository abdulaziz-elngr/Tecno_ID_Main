import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { handleApiError, ok, created, readJson, readQuery, BusinessRuleError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { loadAccessibleGroup } from "@/lib/group-access";
import { toDateOnly } from "@/lib/sessions";

/**
 * Recitation (التسميع) sessions — one recitation per lesson of a group.
 * The student results live in Recitation rows (see ./[id]).
 */

const listSchema = z.object({ groupId: z.string().uuid() });

const createSchema = z.object({
  groupId: z.string().uuid(),
  sessionId: z.string().uuid(), // the lesson (ClassSession) the recitation belongs to
  date: z.string().date().optional(), // defaults to the lesson's date
  maxScore: z.number().positive().max(999),
  title: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(1000).optional()
});

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("recitation.view");
    const query = readQuery(request, listSchema);
    const group = await loadAccessibleGroup(ctx, query.groupId);

    const [rows, studentCount] = await Promise.all([
      db.recitationSession.findMany({
        where: { organizationId: ctx.organizationId, groupId: group.id },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: 200,
        select: {
          id: true,
          title: true,
          date: true,
          maxScore: true,
          session: { select: { id: true, lessonNumber: true } }
        }
      }),
      db.student.count({ where: { groupId: group.id, deletedAt: null, status: "ACTIVE" } })
    ]);

    const graded = rows.length
      ? await db.recitation.groupBy({
          by: ["recitationSessionId"],
          where: { recitationSessionId: { in: rows.map((r) => r.id) }, score: { not: null } },
          _count: { _all: true }
        })
      : [];
    const gradedBy = new Map(graded.map((g) => [g.recitationSessionId, g._count._all]));

    return ok({
      recitations: rows.map((r) => {
        const gradedCount = gradedBy.get(r.id) ?? 0;
        return {
          id: r.id,
          title: r.title,
          date: r.date,
          maxScore: Number(r.maxScore),
          sessionId: r.session.id,
          lessonNumber: r.session.lessonNumber,
          studentCount,
          gradedCount,
          pendingCount: Math.max(0, studentCount - gradedCount)
        };
      })
    });
  } catch (err) {
    return handleApiError("recitation-sessions.list", err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("recitation.manage");
    const input = await readJson(request, createSchema);
    const group = await loadAccessibleGroup(ctx, input.groupId);

    // The lesson must be a real, non-cancelled lesson OF THIS GROUP.
    const lesson = await db.classSession.findFirst({
      where: { id: input.sessionId, groupId: group.id, organizationId: ctx.organizationId },
      select: { id: true, date: true, status: true, lessonNumber: true }
    });
    if (!lesson) throw new BusinessRuleError("This lesson does not belong to the selected group.", { status: 400 });
    if (lesson.status === "CANCELLED") throw new BusinessRuleError("This lesson was cancelled.", { status: 400 });

    const existing = await db.recitationSession.findUnique({ where: { sessionId: lesson.id }, select: { id: true } });
    if (existing) {
      throw new BusinessRuleError("A recitation has already been created for this lesson.", {
        status: 409,
        code: "RECITATION_EXISTS",
        details: { id: existing.id }
      });
    }

    const row = await db.recitationSession.create({
      data: {
        organizationId: ctx.organizationId,
        branchId: group.branchId,
        groupId: group.id,
        sessionId: lesson.id,
        title: input.title || null,
        date: input.date ? toDateOnly(input.date) : lesson.date,
        maxScore: input.maxScore,
        notes: input.notes || null,
        createdById: ctx.userId
      }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "CREATE_RECITATION_SESSION",
      entityType: "RecitationSession",
      entityId: row.id,
      afterValue: row
    });

    return created({ id: row.id });
  } catch (err) {
    return handleApiError("recitation-sessions.create", err);
  }
}
