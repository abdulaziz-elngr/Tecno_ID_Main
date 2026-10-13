import { type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { handleApiError, ok, NotFoundError } from "@/lib/api";
import { computeExamStatistics, percentage, rankScores } from "@/lib/grading";
import { loadAccessibleGroup } from "@/lib/group-access";
import { loadParentContacts, whatsappUrl } from "@/lib/parent-contact";
import { examAbsentMessage, examResultMessage, formatMessageDate } from "@/lib/parent-messages";
import { DEFAULT_TIME_ZONE } from "@/lib/tz";

/**
 * Everything the exam grading page needs in ONE round trip: the exam, the live
 * counters (total / graded / not graded / absent), every student's status with a
 * ready WhatsApp click-to-chat link, and the Top 10. The page re-fetches this after
 * each save, so counters and ranking are always computed from the database.
 *
 * Parent phone numbers never leave the server — only the finished link does.
 */
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
      include: { subject: { select: { id: true, name: true } } }
    });
    if (!exam) throw new NotFoundError("Exam not found.");
    const group = await loadAccessibleGroup(ctx, exam.groupId);

    const [students, results] = await Promise.all([
      db.student.findMany({
        where: { groupId: exam.groupId, deletedAt: null, status: "ACTIVE" },
        orderBy: { fullName: "asc" },
        select: { id: true, fullName: true, studentCode: true, gender: true }
      }),
      db.examResult.findMany({
        where: { examId: exam.id },
        select: { studentId: true, score: true, isAbsent: true, notes: true }
      })
    ]);
    const contacts = await loadParentContacts(students.map((s) => s.id));
    const byStudent = new Map(results.map((r) => [r.studentId, r]));
    const maxScore = Number(exam.maxScore);

    const rows = students.map((student) => {
      const result = byStudent.get(student.id);
      const score = result?.score === null || result?.score === undefined ? null : Number(result.score);
      const status = result?.isAbsent ? ("ABSENT" as const) : score !== null ? ("GRADED" as const) : ("PENDING" as const);
      const contact = contacts.get(student.id);
      const locale = contact?.locale ?? "ar";
      const examDate = formatMessageDate(exam.date, locale, DEFAULT_TIME_ZONE);

      let link: string | null = null;
      if (status === "GRADED" && score !== null) {
        link = whatsappUrl(
          contact,
          examResultMessage({
            locale,
            studentName: student.fullName,
            gender: student.gender,
            examName: exam.name,
            examDate,
            score,
            maxScore,
            subjectName: exam.subject.name
          })
        );
      } else if (status === "ABSENT") {
        link = whatsappUrl(
          contact,
          examAbsentMessage({
            locale,
            studentName: student.fullName,
            gender: student.gender,
            examName: exam.name,
            examDate,
            subjectName: exam.subject.name
          })
        );
      }

      return {
        id: student.id,
        fullName: student.fullName,
        studentCode: student.studentCode,
        status,
        score,
        percentage: score === null ? null : percentage(score, maxScore),
        notes: result?.notes ?? null,
        whatsappUrl: link,
        // Why there is no link: no result yet, no guardian on file, or an unusable number.
        parentIssue: status === "PENDING" ? null : (contact?.issue ?? null)
      };
    });

    const graded = rows.filter((r) => r.status === "GRADED").length;
    const absent = rows.filter((r) => r.status === "ABSENT").length;

    const entries = rows.map((r) => ({ studentId: r.id, score: r.score, isAbsent: r.status === "ABSENT" }));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const top = rankScores(entries)
      .slice(0, 10)
      .map((entry) => {
        const row = byId.get(entry.studentId)!;
        return {
          rank: entry.rank,
          studentId: entry.studentId,
          fullName: row.fullName,
          studentCode: row.studentCode,
          score: entry.score,
          percentage: percentage(entry.score, maxScore)
        };
      });

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
        group: {
          id: group.id,
          name: group.name,
          gradeName: group.grade.name,
          stageName: group.grade.stage.name
        }
      },
      counts: { total: rows.length, graded, notGraded: rows.length - graded - absent, absent },
      statistics: computeExamStatistics(entries, maxScore),
      students: rows,
      top
    });
  } catch (err) {
    return handleApiError("exams.board", err);
  }
}
