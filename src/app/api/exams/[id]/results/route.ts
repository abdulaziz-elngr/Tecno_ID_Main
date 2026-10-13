import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { handleApiError, ok, readJson, NotFoundError, BusinessRuleError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { validateScore, InvalidScoreError } from "@/lib/grading";
import { loadAccessibleGroup } from "@/lib/group-access";

/**
 * Bulk grade entry (spec §26). Teachers enter a whole group at once;
 * every score is validated against the exam maximum (Rule 8) BEFORE
 * anything is written, so a single bad row rejects the whole batch
 * instead of half-saving a grade sheet.
 */

const bodySchema = z.object({
  results: z
    .array(
      z.object({
        studentId: z.string().uuid(),
        score: z.number().nullable().optional(),
        isAbsent: z.boolean().default(false),
        notes: z.string().trim().max(300).optional()
      })
    )
    .min(1)
    .max(300),
  reason: z.string().trim().max(500).optional()
});

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("grades.enter");
    const exam = await db.exam.findFirst({
      where: {
        id: params.id,
        organizationId: ctx.organizationId,
        deletedAt: null,
        ...(ctx.isOrgWide ? {} : { branchId: { in: ctx.branchIds } })
      },
      select: { id: true, maxScore: true, groupId: true, isPublished: true }
    });
    if (!exam) throw new NotFoundError("Exam not found.");
    await loadAccessibleGroup(ctx, exam.groupId);

    const input = await readJson(request, bodySchema);
    const maxScore = Number(exam.maxScore);

    // Editing an already-entered grade requires the stronger permission.
    const existingResults = await db.examResult.findMany({
      where: { examId: exam.id },
      select: { studentId: true, score: true, isAbsent: true }
    });
    const existingByStudent = new Map(existingResults.map((r) => [r.studentId, r]));
    const editsExisting = input.results.some((r) => {
      const prev = existingByStudent.get(r.studentId);
      return prev && prev.score !== null;
    });
    if (editsExisting && !ctx.permissions.has("grades.update")) {
      throw new BusinessRuleError("You are not allowed to change an already-recorded grade.", {
        status: 403
      });
    }
    if (editsExisting && !input.reason) {
      throw new BusinessRuleError("A reason is required when changing an existing grade.");
    }

    // Students must belong to the exam's group. Student.groupId is the
    // direct source of truth (there is no groupStudent join table).
    const enrolled = await db.student.findMany({
      where: { groupId: exam.groupId },
      select: { id: true }
    });
    const enrolledIds = new Set(enrolled.map((e) => e.id));

    try {
      for (const row of input.results) {
        if (!enrolledIds.has(row.studentId)) {
          throw new BusinessRuleError("One of the students is not enrolled in this exam's group.");
        }
        if (!row.isAbsent && row.score !== null && row.score !== undefined) {
          validateScore(row.score, maxScore);
        }
      }
    } catch (err) {
      if (err instanceof InvalidScoreError) {
        throw new BusinessRuleError(err.message, { code: "INVALID_SCORE" });
      }
      throw err;
    }

    await db.$transaction(
      input.results.map((row) =>
        db.examResult.upsert({
          where: { examId_studentId: { examId: exam.id, studentId: row.studentId } },
          create: {
            examId: exam.id,
            studentId: row.studentId,
            score: row.isAbsent ? null : row.score ?? null,
            isAbsent: row.isAbsent,
            notes: row.notes,
            enteredById: ctx.userId
          },
          update: {
            score: row.isAbsent ? null : row.score ?? null,
            isAbsent: row.isAbsent,
            notes: row.notes,
            enteredById: ctx.userId
          }
        })
      )
    );

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: editsExisting ? "UPDATE_GRADES" : "ENTER_GRADES",
      entityType: "Exam",
      entityId: exam.id,
      beforeValue: existingResults,
      afterValue: input.results,
      reason: input.reason
    });

    return ok({ saved: input.results.length });
  } catch (err) {
    return handleApiError("exams.results", err);
  }
}
