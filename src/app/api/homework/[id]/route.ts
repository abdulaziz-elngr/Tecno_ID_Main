import { type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { handleApiError, ok, NotFoundError } from "@/lib/api";
import { loadAccessibleGroup } from "@/lib/group-access";
import { loadParentContacts, whatsappUrl } from "@/lib/parent-contact";
import { formatMessageDate, homeworkMessage } from "@/lib/parent-messages";
import { homeworkState } from "@/lib/homework";

/** One homework with every student's status + WhatsApp link (parent numbers stay server-side). */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("assignments.view");
    const hw = await db.assignment.findFirst({
      where: {
        id: params.id,
        organizationId: ctx.organizationId,
        deletedAt: null,
        ...(ctx.isOrgWide ? {} : { branchId: { in: ctx.branchIds } })
      },
      include: { session: { select: { id: true, lessonNumber: true } } }
    });
    if (!hw) throw new NotFoundError("Homework not found.");
    const group = await loadAccessibleGroup(ctx, hw.groupId);

    const [students, submissions] = await Promise.all([
      db.student.findMany({
        where: { groupId: hw.groupId, deletedAt: null, status: "ACTIVE" },
        orderBy: { fullName: "asc" },
        select: { id: true, fullName: true, studentCode: true, gender: true }
      }),
      db.assignmentSubmission.findMany({
        where: { assignmentId: hw.id },
        select: { studentId: true, status: true }
      })
    ]);
    const contacts = await loadParentContacts(students.map((s) => s.id));
    const byStudent = new Map(submissions.map((s) => [s.studentId, s]));
    const lessonNumber = hw.session?.lessonNumber ?? null;

    const rows = students.map((student) => {
      const state = homeworkState(byStudent.get(student.id)?.status);
      const contact = contacts.get(student.id);
      const locale = contact?.locale ?? "ar";
      const link =
        state === "PENDING"
          ? null
          : whatsappUrl(
              contact,
              homeworkMessage({
                locale,
                studentName: student.fullName,
                gender: student.gender,
                homeworkName: hw.title,
                date: formatMessageDate(hw.dueDate, locale),
                lessonNumber,
                completed: state === "COMPLETED"
              })
            );
      return {
        id: student.id,
        fullName: student.fullName,
        studentCode: student.studentCode,
        status: state,
        whatsappUrl: link,
        parentIssue: state === "PENDING" ? null : (contact?.issue ?? null)
      };
    });

    const completed = rows.filter((r) => r.status === "COMPLETED").length;
    const notCompleted = rows.filter((r) => r.status === "NOT_COMPLETED").length;

    return ok({
      homework: {
        id: hw.id,
        title: hw.title,
        date: hw.dueDate,
        description: hw.description,
        sessionId: hw.session?.id ?? null,
        lessonNumber,
        group: { id: group.id, name: group.name, gradeName: group.grade.name, stageName: group.grade.stage.name }
      },
      counts: {
        total: rows.length,
        completed,
        notCompleted,
        pending: rows.length - completed - notCompleted
      },
      students: rows
    });
  } catch (err) {
    return handleApiError("homework.get", err);
  }
}
