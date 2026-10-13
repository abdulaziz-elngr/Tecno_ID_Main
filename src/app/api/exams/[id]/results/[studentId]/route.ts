import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { handleApiError, ok, readJson, NotFoundError, BusinessRuleError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { validateScore, InvalidScoreError } from "@/lib/grading";
import { loadAccessibleGroup } from "@/lib/group-access";

/**
 * Saves ONE student's result for an exam (the Save / Absent buttons on the
 * grading page). Same rules as the bulk sheet in ../route.ts:
 *   - the score must be 0 ≤ score ≤ exam maximum (Rule 8);
 *   - one row per (exam, student) — enforced by the DB unique index and `upsert`,
 *     so saving twice edits the grade, it never duplicates it;
 *   - changing an already-recorded grade needs `grades.update`;
 *   - the student must belong to the exam's group.
 *
 * body: { score: number | null, isAbsent: boolean }
 *   isAbsent=true            → marks the student absent (score cleared)
 *   isAbsent=false, score=n  → records / edits the grade (also un-marks absence)
 *   isAbsent=false, score=null → clears the result (back to "no grade yet")
 */
const bodySchema = z.object({
  score: z.number().finite().nullable(),
  isAbsent: z.boolean().default(false),
  reason: z.string().trim().max(500).optional()
});

export async function PUT(request: NextRequest, { params }: { params: { id: string; studentId: string } }) {
  try {
    const ctx = await requirePermission("grades.enter");
    const exam = await db.exam.findFirst({
      where: {
        id: params.id,
        organizationId: ctx.organizationId,
        deletedAt: null,
        ...(ctx.isOrgWide ? {} : { branchId: { in: ctx.branchIds } })
      },
      select: { id: true, maxScore: true, groupId: true }
    });
    if (!exam) throw new NotFoundError("Exam not found.");
    await loadAccessibleGroup(ctx, exam.groupId);

    const input = await readJson(request, bodySchema);

    const student = await db.student.findFirst({
      where: { id: params.studentId, groupId: exam.groupId, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true }
    });
    if (!student) {
      throw new BusinessRuleError("This student is not enrolled in the exam's group.", { status: 400 });
    }

    let score: number | null = null;
    if (!input.isAbsent && input.score !== null) {
      try {
        validateScore(input.score, Number(exam.maxScore));
      } catch (err) {
        if (err instanceof InvalidScoreError) throw new BusinessRuleError(err.message, { code: "INVALID_SCORE" });
        throw err;
      }
      score = Math.round(input.score * 100) / 100;
    }

    const existing = await db.examResult.findUnique({
      where: { examId_studentId: { examId: exam.id, studentId: student.id } }
    });
    const hadScore = existing?.score !== null && existing?.score !== undefined;
    const changesRecordedGrade = hadScore && (input.isAbsent || score === null || score !== Number(existing!.score));
    if (changesRecordedGrade && !ctx.permissions.has("grades.update")) {
      throw new BusinessRuleError("You are not allowed to change an already-recorded grade.", { status: 403 });
    }

    const saved = await db.examResult.upsert({
      where: { examId_studentId: { examId: exam.id, studentId: student.id } },
      create: { examId: exam.id, studentId: student.id, score, isAbsent: input.isAbsent, enteredById: ctx.userId },
      update: { score, isAbsent: input.isAbsent, enteredById: ctx.userId }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: input.isAbsent ? "MARK_EXAM_ABSENT" : changesRecordedGrade ? "UPDATE_GRADE" : "ENTER_GRADE",
      entityType: "ExamResult",
      entityId: saved.id,
      beforeValue: existing ? { score: existing.score === null ? null : Number(existing.score), isAbsent: existing.isAbsent } : null,
      afterValue: { examId: exam.id, studentId: student.id, score, isAbsent: input.isAbsent },
      reason: input.reason
    });

    return ok({ studentId: student.id, score, isAbsent: saved.isAbsent });
  } catch (err) {
    return handleApiError("exams.result.save", err);
  }
}
