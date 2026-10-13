import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { handleApiError, ok, readJson, NotFoundError, BusinessRuleError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { validateScore, InvalidScoreError } from "@/lib/grading";

const bodySchema = z.object({
  submissions: z
    .array(
      z.object({
        studentId: z.string().uuid(),
        status: z.enum(["PENDING", "SUBMITTED", "LATE", "GRADED", "MISSING"]),
        grade: z.number().nullable().optional(),
        feedback: z.string().trim().max(1000).optional(),
        submittedAt: z.string().datetime().optional()
      })
    )
    .min(1)
    .max(300)
});

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("assignments.view");
    const assignment = await db.assignment.findFirst({
      where: {
        id: params.id,
        organizationId: ctx.organizationId,
        deletedAt: null,
        ...(ctx.isOrgWide ? {} : { branchId: { in: ctx.branchIds } })
      },
      include: {
        group: { select: { id: true, name: true } },
        submissions: {
          include: { student: { select: { id: true, fullName: true, studentCode: true } } }
        }
      }
    });
    if (!assignment) throw new NotFoundError("Assignment not found.");

    return ok({
      assignment: {
        id: assignment.id,
        title: assignment.title,
        dueDate: assignment.dueDate,
        maxScore: Number(assignment.maxScore),
        description: assignment.description,
        group: assignment.group
      },
      submissions: assignment.submissions.map((s) => ({
        id: s.id,
        student: s.student,
        status: s.status,
        submittedAt: s.submittedAt,
        grade: s.grade === null ? null : Number(s.grade),
        feedback: s.feedback
      }))
    });
  } catch (err) {
    return handleApiError("assignments.submissions.get", err);
  }
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("assignments.manage");
    const assignment = await db.assignment.findFirst({
      where: {
        id: params.id,
        organizationId: ctx.organizationId,
        deletedAt: null,
        ...(ctx.isOrgWide ? {} : { branchId: { in: ctx.branchIds } })
      },
      select: { id: true, maxScore: true, dueDate: true, groupId: true }
    });
    if (!assignment) throw new NotFoundError("Assignment not found.");

    const input = await readJson(request, bodySchema);
    const maxScore = Number(assignment.maxScore);

    // studentId comes from the client: only students of THIS organization
    // who are in the assignment's group (or who already have a submission
    // for it, e.g. after moving groups) may be written to.
    const [groupStudents, existingSubs] = await Promise.all([
      db.student.findMany({
        where: { organizationId: ctx.organizationId, groupId: assignment.groupId, deletedAt: null },
        select: { id: true }
      }),
      db.assignmentSubmission.findMany({
        where: { assignmentId: assignment.id, student: { organizationId: ctx.organizationId } },
        select: { studentId: true }
      })
    ]);
    const allowedStudentIds = new Set([
      ...groupStudents.map((st) => st.id),
      ...existingSubs.map((sub) => sub.studentId)
    ]);
    if (input.submissions.some((row) => !allowedStudentIds.has(row.studentId))) {
      throw new BusinessRuleError("One or more students do not belong to this assignment's group.", {
        status: 400
      });
    }

    try {
      for (const row of input.submissions) {
        if (row.grade !== null && row.grade !== undefined) validateScore(row.grade, maxScore);
      }
    } catch (err) {
      if (err instanceof InvalidScoreError) {
        throw new BusinessRuleError(err.message, { code: "INVALID_SCORE" });
      }
      throw err;
    }

    await db.$transaction(
      input.submissions.map((row) => {
        const submittedAt = row.submittedAt ? new Date(row.submittedAt) : undefined;
        // A submission after the deadline is recorded as LATE, not SUBMITTED.
        const status =
          row.status === "SUBMITTED" && submittedAt && submittedAt > assignment.dueDate
            ? ("LATE" as const)
            : row.status;

        return db.assignmentSubmission.upsert({
          where: {
            assignmentId_studentId: { assignmentId: assignment.id, studentId: row.studentId }
          },
          create: {
            assignmentId: assignment.id,
            studentId: row.studentId,
            status,
            grade: row.grade ?? null,
            feedback: row.feedback,
            submittedAt,
            gradedById: row.grade !== null && row.grade !== undefined ? ctx.userId : undefined
          },
          update: {
            status,
            grade: row.grade ?? null,
            feedback: row.feedback,
            submittedAt,
            gradedById: row.grade !== null && row.grade !== undefined ? ctx.userId : undefined
          }
        });
      })
    );

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "UPDATE_ASSIGNMENT_SUBMISSIONS",
      entityType: "Assignment",
      entityId: assignment.id,
      afterValue: input.submissions
    });

    return ok({ saved: input.submissions.length });
  } catch (err) {
    return handleApiError("assignments.submissions.update", err);
  }
}
