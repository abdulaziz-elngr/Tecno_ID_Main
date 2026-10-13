import { type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { handleApiError, ok, NotFoundError } from "@/lib/api";
import { loadAccessibleGroup } from "@/lib/group-access";
import { loadParentContacts, whatsappUrl } from "@/lib/parent-contact";
import { formatMessageDate, recitationMessage } from "@/lib/parent-messages";
import { percentage } from "@/lib/grading";

/** One recitation with every student's grade + WhatsApp link (parent numbers stay server-side). */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("recitation.view");
    const rec = await db.recitationSession.findFirst({
      where: {
        id: params.id,
        organizationId: ctx.organizationId,
        ...(ctx.isOrgWide ? {} : { branchId: { in: ctx.branchIds } })
      },
      include: { session: { select: { id: true, lessonNumber: true } } }
    });
    if (!rec) throw new NotFoundError("Recitation not found.");
    const group = await loadAccessibleGroup(ctx, rec.groupId);

    const [students, records] = await Promise.all([
      db.student.findMany({
        where: { groupId: rec.groupId, deletedAt: null, status: "ACTIVE" },
        orderBy: { fullName: "asc" },
        select: { id: true, fullName: true, studentCode: true, gender: true }
      }),
      db.recitation.findMany({
        where: { recitationSessionId: rec.id },
        select: { studentId: true, score: true, notes: true }
      })
    ]);
    const contacts = await loadParentContacts(students.map((s) => s.id));
    const byStudent = new Map(records.map((r) => [r.studentId, r]));
    const maxScore = Number(rec.maxScore);

    const rows = students.map((student) => {
      const record = byStudent.get(student.id);
      const score = record?.score === null || record?.score === undefined ? null : Number(record.score);
      const contact = contacts.get(student.id);
      const locale = contact?.locale ?? "ar";
      const link =
        score === null
          ? null
          : whatsappUrl(
              contact,
              recitationMessage({
                locale,
                studentName: student.fullName,
                gender: student.gender,
                lessonNumber: rec.session.lessonNumber,
                date: formatMessageDate(rec.date, locale),
                score,
                maxScore
              })
            );
      return {
        id: student.id,
        fullName: student.fullName,
        studentCode: student.studentCode,
        status: score === null ? ("PENDING" as const) : ("GRADED" as const),
        score,
        percentage: score === null ? null : percentage(score, maxScore),
        notes: record?.notes ?? null,
        whatsappUrl: link,
        parentIssue: score === null ? null : (contact?.issue ?? null)
      };
    });

    const graded = rows.filter((r) => r.status === "GRADED");
    return ok({
      recitation: {
        id: rec.id,
        title: rec.title,
        date: rec.date,
        maxScore,
        notes: rec.notes,
        sessionId: rec.session.id,
        lessonNumber: rec.session.lessonNumber,
        group: { id: group.id, name: group.name, gradeName: group.grade.name, stageName: group.grade.stage.name }
      },
      counts: { total: rows.length, graded: graded.length, pending: rows.length - graded.length },
      students: rows
    });
  } catch (err) {
    return handleApiError("recitation-sessions.get", err);
  }
}
