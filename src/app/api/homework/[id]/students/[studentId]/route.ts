import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { handleApiError, ok, readJson, NotFoundError, BusinessRuleError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { loadAccessibleGroup } from "@/lib/group-access";
import { COMPLETED_SUBMISSION_STATUSES } from "@/lib/homework";

/**
 * Marks one student's homework Completed / Not completed (and lets it be changed
 * later). One row per (homework, student) — DB unique index + `upsert`.
 * Any grade/feedback already stored by the older graded flow is left untouched.
 */
const bodySchema = z.object({ status: z.enum(["COMPLETED", "NOT_COMPLETED"]) });

export async function PUT(request: NextRequest, { params }: { params: { id: string; studentId: string } }) {
  try {
    const ctx = await requirePermission("assignments.manage");
    const hw = await db.assignment.findFirst({
      where: {
        id: params.id,
        organizationId: ctx.organizationId,
        deletedAt: null,
        ...(ctx.isOrgWide ? {} : { branchId: { in: ctx.branchIds } })
      },
      select: { id: true, groupId: true }
    });
    if (!hw) throw new NotFoundError("Homework not found.");
    await loadAccessibleGroup(ctx, hw.groupId);

    const input = await readJson(request, bodySchema);

    const student = await db.student.findFirst({
      where: { id: params.studentId, groupId: hw.groupId, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true }
    });
    if (!student) throw new BusinessRuleError("This student is not enrolled in the group.", { status: 400 });

    const where = { assignmentId_studentId: { assignmentId: hw.id, studentId: student.id } };
    const existing = await db.assignmentSubmission.findUnique({ where });

    let status: "SUBMITTED" | "LATE" | "GRADED" | "MISSING" = "MISSING";
    let submittedAt: Date | null = null;
    if (input.status === "COMPLETED") {
      if (existing && COMPLETED_SUBMISSION_STATUSES.includes(existing.status)) {
        // Already handed in (maybe late / graded by the older flow): keep that state.
        status = existing.status as "SUBMITTED" | "LATE" | "GRADED";
        submittedAt = existing.submittedAt;
      } else {
        status = "SUBMITTED";
        submittedAt = new Date();
      }
    }

    await db.assignmentSubmission.upsert({
      where,
      create: { assignmentId: hw.id, studentId: student.id, status, submittedAt },
      update: { status, submittedAt }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "SET_HOMEWORK_STATUS",
      entityType: "Assignment",
      entityId: hw.id,
      beforeValue: existing ? { status: existing.status } : null,
      afterValue: { studentId: student.id, status }
    });

    return ok({ studentId: student.id, status: input.status });
  } catch (err) {
    return handleApiError("homework.student.save", err);
  }
}
