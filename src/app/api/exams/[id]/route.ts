import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { handleApiError, ok, readJson, NotFoundError, BusinessRuleError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { computeExamStatistics, rankScores } from "@/lib/grading";
import { loadAccessibleGroup } from "@/lib/group-access";

const patchSchema = z.object({
  name: z.string().trim().min(2).max(150).optional(),
  date: z.string().datetime().optional(),
  maxScore: z.number().positive().max(10000).optional(),
  durationMinutes: z.number().int().min(1).max(600).optional(),
  description: z.string().trim().max(1000).optional(),
  reason: z.string().trim().max(500).optional()
});

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("exams.view");
    const exam = await db.exam.findFirst({
      where: {
        id: params.id,
        organizationId: ctx.organizationId,
        deletedAt: null,
        ...(ctx.isOrgWide ? {} : { branchId: { in: ctx.branchIds } })
      },
      include: {
        subject: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } },
        results: {
          include: { student: { select: { id: true, fullName: true, studentCode: true } } }
        }
      }
    });
    if (!exam) throw new NotFoundError("Exam not found.");
    await loadAccessibleGroup(ctx, exam.group.id);

    const maxScore = Number(exam.maxScore);
    const entries = exam.results.map((r) => ({
      studentId: r.studentId,
      score: r.score === null ? null : Number(r.score),
      isAbsent: r.isAbsent
    }));
    const ranks = new Map(rankScores(entries).map((r) => [r.studentId, r.rank]));

    return ok({
      exam: {
        id: exam.id,
        name: exam.name,
        date: exam.date,
        maxScore,
        durationMinutes: exam.durationMinutes,
        description: exam.description,
        isPublished: exam.isPublished,
        subject: exam.subject,
        group: exam.group
      },
      results: exam.results.map((r) => ({
        id: r.id,
        student: r.student,
        score: r.score === null ? null : Number(r.score),
        isAbsent: r.isAbsent,
        notes: r.notes,
        rank: ranks.get(r.studentId) ?? null
      })),
      statistics: computeExamStatistics(entries, maxScore)
    });
  } catch (err) {
    return handleApiError("exams.get", err);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("exams.update");
    const existing = await db.exam.findFirst({
      where: {
        id: params.id,
        organizationId: ctx.organizationId,
        deletedAt: null,
        ...(ctx.isOrgWide ? {} : { branchId: { in: ctx.branchIds } })
      }
    });
    if (!existing) throw new NotFoundError("Exam not found.");
    await loadAccessibleGroup(ctx, existing.groupId);

    const input = await readJson(request, patchSchema);

    // Lowering the maximum score below an already-entered grade would
    // create impossible data (Rule 8), so it is refused.
    if (input.maxScore !== undefined && input.maxScore < Number(existing.maxScore)) {
      const higher = await db.examResult.findFirst({
        where: { examId: existing.id, score: { gt: input.maxScore } }
      });
      if (higher) {
        throw new BusinessRuleError(
          "Some recorded grades are higher than the new maximum score. Correct those grades first."
        );
      }
    }

    const updated = await db.exam.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        date: input.date ? new Date(input.date) : undefined,
        maxScore: input.maxScore,
        durationMinutes: input.durationMinutes,
        description: input.description
      }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "UPDATE_EXAM",
      entityType: "Exam",
      entityId: updated.id,
      beforeValue: existing,
      afterValue: updated,
      reason: input.reason
    });

    return ok({ ...updated, maxScore: Number(updated.maxScore) });
  } catch (err) {
    return handleApiError("exams.update", err);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("exams.update");
    const existing = await db.exam.findFirst({
      where: {
        id: params.id,
        organizationId: ctx.organizationId,
        deletedAt: null,
        ...(ctx.isOrgWide ? {} : { branchId: { in: ctx.branchIds } })
      }
    });
    if (!existing) throw new NotFoundError("Exam not found.");
    await loadAccessibleGroup(ctx, existing.groupId);

    const input = await readJson(request, z.object({ reason: z.string().trim().min(3).max(500) }));

    const deleted = await db.exam.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "DELETE_EXAM",
      entityType: "Exam",
      entityId: deleted.id,
      beforeValue: existing,
      reason: input.reason
    });

    return ok({ id: deleted.id, deletedAt: deleted.deletedAt });
  } catch (err) {
    return handleApiError("exams.delete", err);
  }
}
