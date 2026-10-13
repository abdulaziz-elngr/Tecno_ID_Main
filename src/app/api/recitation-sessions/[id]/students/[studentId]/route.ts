import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { handleApiError, ok, readJson, NotFoundError, BusinessRuleError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { validateScore, InvalidScoreError } from "@/lib/grading";
import { loadAccessibleGroup } from "@/lib/group-access";

/**
 * Saves (creates or edits) one student's recitation grade. One row per
 * (recitation session, student) — enforced by a DB unique index and `upsert`.
 */
const bodySchema = z.object({
  score: z.number().finite(),
  notes: z.string().trim().max(500).optional()
});

export async function PUT(request: NextRequest, { params }: { params: { id: string; studentId: string } }) {
  try {
    const ctx = await requirePermission("recitation.manage");
    const rec = await db.recitationSession.findFirst({
      where: {
        id: params.id,
        organizationId: ctx.organizationId,
        ...(ctx.isOrgWide ? {} : { branchId: { in: ctx.branchIds } })
      },
      include: { session: { select: { lessonNumber: true } } }
    });
    if (!rec) throw new NotFoundError("Recitation not found.");
    const group = await loadAccessibleGroup(ctx, rec.groupId);

    const input = await readJson(request, bodySchema);
    try {
      validateScore(input.score, Number(rec.maxScore));
    } catch (err) {
      if (err instanceof InvalidScoreError) throw new BusinessRuleError(err.message, { code: "INVALID_SCORE" });
      throw err;
    }
    const score = Math.round(input.score * 100) / 100;

    const student = await db.student.findFirst({
      where: { id: params.studentId, groupId: rec.groupId, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true }
    });
    if (!student) throw new BusinessRuleError("This student is not enrolled in the group.", { status: 400 });

    const where = { recitationSessionId_studentId: { recitationSessionId: rec.id, studentId: student.id } };
    const existing = await db.recitation.findUnique({ where });
    const teacher = await db.teacher.findFirst({ where: { userId: ctx.userId }, select: { id: true } });

    const saved = await db.recitation.upsert({
      where,
      create: {
        organizationId: ctx.organizationId,
        studentId: student.id,
        recitationSessionId: rec.id,
        subjectId: group.subjectId,
        groupId: group.id,
        teacherId: teacher?.id,
        date: rec.date,
        content: rec.title || (rec.session.lessonNumber !== null ? `Lesson ${rec.session.lessonNumber}` : "Recitation"),
        score,
        maxScore: rec.maxScore,
        status: "COMPLETED",
        notes: input.notes,
        createdById: ctx.userId
      },
      update: { score, status: "COMPLETED", notes: input.notes }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: existing ? "UPDATE_RECITATION_GRADE" : "ENTER_RECITATION_GRADE",
      entityType: "Recitation",
      entityId: saved.id,
      beforeValue: existing ? { score: existing.score === null ? null : Number(existing.score) } : null,
      afterValue: { recitationSessionId: rec.id, studentId: student.id, score }
    });

    return ok({ studentId: student.id, score });
  } catch (err) {
    return handleApiError("recitation-sessions.student.save", err);
  }
}
