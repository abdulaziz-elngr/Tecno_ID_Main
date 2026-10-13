import { type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { handleApiError, ok, NotFoundError, BusinessRuleError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { dispatchEvent } from "@/lib/notifications";
import { percentage } from "@/lib/grading";
import { loadAccessibleGroup } from "@/lib/group-access";

/**
 * Publishing an exam makes results visible on student/parent profiles
 * and triggers the EXAM_PUBLISHED notification rule (spec §56).
 */
export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("exams.publish");
    const exam = await db.exam.findFirst({
      where: {
        id: params.id,
        organizationId: ctx.organizationId,
        deletedAt: null,
        ...(ctx.isOrgWide ? {} : { branchId: { in: ctx.branchIds } })
      },
      include: {
        subject: { select: { name: true } },
        results: { include: { student: { select: { id: true, fullName: true } } } }
      }
    });
    if (!exam) throw new NotFoundError("Exam not found.");
    await loadAccessibleGroup(ctx, exam.groupId);
    if (exam.isPublished) throw new BusinessRuleError("This exam is already published.");

    const ungraded = exam.results.filter((r) => !r.isAbsent && r.score === null).length;
    if (exam.results.length === 0) {
      throw new BusinessRuleError("Enter grades before publishing this exam.");
    }
    if (ungraded > 0) {
      throw new BusinessRuleError(`${ungraded} student(s) still have no grade recorded.`);
    }

    const updated = await db.exam.update({
      where: { id: exam.id },
      data: { isPublished: true, publishedAt: new Date() }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "PUBLISH_EXAM",
      entityType: "Exam",
      entityId: exam.id,
      afterValue: { isPublished: true, results: exam.results.length }
    });

    const maxScore = Number(exam.maxScore);
    for (const result of exam.results) {
      if (result.isAbsent || result.score === null) continue;
      await dispatchEvent({
        organizationId: ctx.organizationId,
        event: "EXAM_PUBLISHED",
        studentId: result.studentId,
        title: `Exam result: ${exam.name}`,
        actorUserId: ctx.userId,
        variables: {
          student_name: result.student.fullName,
          exam_name: exam.name,
          subject_name: exam.subject.name,
          score: Number(result.score),
          max_score: maxScore,
          percentage: percentage(Number(result.score), maxScore)
        }
      }).catch((err) => console.error("[exams.publish] notify failed", err));
    }

    return ok({ id: updated.id, isPublished: updated.isPublished, notified: exam.results.length });
  } catch (err) {
    return handleApiError("exams.publish", err);
  }
}
