import { type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { handleApiError, ok, NotFoundError } from "@/lib/api";
import { attendanceRate } from "@/lib/attendance";
import { computeExamStatistics, percentage } from "@/lib/grading";
import { analyzeStudent, countTrailingAbsences } from "@/lib/analytics";
import { getAnalyticsThresholds } from "@/lib/settings";
import { remainingAmount, round2 } from "@/lib/billing";

/**
 * The student 360 view backing the profile page (spec §10, §64).
 * One request returns overview, attendance, academics, finance,
 * rule-based flags and the activity timeline.
 *
 * Financial blocks are omitted entirely unless the caller holds
 * `payments.view` — a teacher opening a profile sees academics only.
 */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("students.view");
    const canSeeFinance = ctx.permissions.has("payments.view");

    const student = await db.student.findFirst({
      where: {
        id: params.id,
        organizationId: ctx.organizationId,
        deletedAt: null,
        ...(ctx.isOrgWide ? {} : { branchId: { in: ctx.branchIds } })
      },
      include: {
        branch: { select: { id: true, name: true } },
        stage: { select: { id: true, name: true } },
        grade: { select: { id: true, name: true } },
        group: {
          select: {
            id: true,
            name: true,
            capacity: true,
            teacher: { select: { fullName: true } }
          }
        },
        parents: { include: { parent: true } }
      }
    });
    if (!student) throw new NotFoundError("Student not found.");

    const [attendanceRows, examResults, recitations, submissions] = await Promise.all([
      db.attendance.findMany({
        where: { studentId: student.id, deletedAt: null },
        orderBy: { recordedAt: "desc" },
        take: 200,
        select: {
          id: true,
          type: true,
          recordedAt: true,
          session: {
            select: {
              id: true,
              date: true,
              group: { select: { name: true } }
            }
          },
          originGroupId: true,
          makeUpReason: true
        }
      }),
      db.examResult.findMany({
        where: { studentId: student.id, exam: { deletedAt: null } },
        orderBy: { exam: { date: "asc" } },
        include: {
          exam: {
            select: {
              id: true,
              name: true,
              date: true,
              maxScore: true,
              isPublished: true,
              subject: { select: { name: true } }
            }
          }
        }
      }),
      db.recitation.findMany({
        where: { studentId: student.id },
        orderBy: { date: "desc" },
        take: 50
      }),
      db.assignmentSubmission.findMany({
        where: { studentId: student.id, assignment: { deletedAt: null } },
        include: {
          assignment: { select: { id: true, title: true, dueDate: true, maxScore: true } }
        },
        orderBy: { assignment: { dueDate: "desc" } },
        take: 50
      })
    ]);

    const present = attendanceRows.filter((a) =>
      ["REGULAR", "LATE", "MAKE_UP"].includes(a.type)
    ).length;
    const absent = attendanceRows.filter((a) => a.type === "ABSENT").length;
    const late = attendanceRows.filter((a) => a.type === "LATE").length;
    const makeUp = attendanceRows.filter((a) => a.type === "MAKE_UP").length;

    const gradedExams = examResults.filter((r) => r.score !== null && !r.isAbsent);
    const examPercentages = gradedExams.map((r) =>
      percentage(Number(r.score), Number(r.exam.maxScore))
    );
    const statistics = computeExamStatistics(
      examResults.map((r) => ({
        studentId: r.studentId,
        score: r.score === null ? null : Number(r.score),
        isAbsent: r.isAbsent
      })),
      // Normalized to 100 so exams with different maximums are comparable.
      100
    );

    // Chronological present/absent list for the "consecutive absences" rule.
    const chronological = [...attendanceRows].reverse().map((a) => a.type !== "ABSENT");

    let finance: Record<string, unknown> | undefined;
    let outstanding = 0;
    if (canSeeFinance) {
      const [subscriptions, payments] = await Promise.all([
        db.subscription.findMany({
          where: { studentId: student.id },
          orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }],
          take: 24
        }),
        db.payment.findMany({
          where: { studentId: student.id },
          orderBy: { paidAt: "desc" },
          take: 24,
          include: { invoice: { select: { id: true, invoiceNumber: true } } }
        })
      ]);

      outstanding = round2(
        subscriptions.reduce(
          (sum, s) =>
            sum + remainingAmount(Number(s.amount), Number(s.discount), Number(s.paidAmount)),
          0
        )
      );

      finance = {
        outstanding,
        subscriptions: subscriptions.map((s) => ({
          id: s.id,
          period: `${s.periodYear}-${String(s.periodMonth).padStart(2, "0")}`,
          amount: Number(s.amount),
          discount: Number(s.discount),
          paidAmount: Number(s.paidAmount),
          remaining: remainingAmount(Number(s.amount), Number(s.discount), Number(s.paidAmount)),
          status: s.status,
          dueDate: s.dueDate
        })),
        payments: payments.map((p) => ({
          id: p.id,
          receiptNumber: p.receiptNumber,
          amount: Number(p.amount),
          method: p.method,
          status: p.status,
          paidAt: p.paidAt,
          invoice: p.invoice
        }))
      };
    }

    const thresholds = await getAnalyticsThresholds(ctx.organizationId);
    const analytics = analyzeStudent(
      {
        presentCount: present,
        totalSessions: present + absent,
        consecutiveAbsences: countTrailingAbsences(chronological),
        examPercentages,
        missingAssignments: submissions.filter((s) => s.status === "MISSING").length,
        outstandingAmount: outstanding
      },
      thresholds
    );

    // Activity timeline — merged, newest first.
    const timeline = [
      ...attendanceRows.slice(0, 30).map((a) => ({
        at: a.recordedAt,
        kind: "ATTENDANCE" as const,
        label: `${a.type} — ${a.session.group.name}`
      })),
      ...gradedExams.slice(-15).map((r) => ({
        at: r.exam.date,
        kind: "EXAM" as const,
        label: `${r.exam.name}: ${Number(r.score)}/${Number(r.exam.maxScore)}`
      })),
      ...recitations.slice(0, 15).map((r) => ({
        at: r.date,
        kind: "RECITATION" as const,
        label: `${r.content} — ${r.status}`
      }))
    ].sort((a, b) => b.at.getTime() - a.at.getTime());

    return ok({
      student: {
        id: student.id,
        studentCode: student.studentCode,
        qrCode: student.qrCode,
        fullName: student.fullName,
        photoUrl: student.photoUrl,
        gender: student.gender,
        dateOfBirth: student.dateOfBirth,
        phone: student.phone,
        address: student.address,
        school: student.school,
        status: student.status,
        enrollmentDate: student.enrollmentDate,
        notes: student.notes,
        emergencyContact: student.emergencyContact,
        branch: student.branch,
        stage: student.stage,
        grade: student.grade,
        group: student.group
      },
      parents: student.parents.map((p) => ({
        relationship: p.relationship,
        isPrimary: p.isPrimary,
        ...p.parent
      })),
      attendance: {
        summary: {
          present,
          absent,
          late,
          makeUp,
          percentage: attendanceRate(present, present + absent)
        },
        recent: attendanceRows.slice(0, 30)
      },
      academics: {
        statistics,
        exams: examResults.map((r) => ({
          examId: r.exam.id,
          name: r.exam.name,
          subject: r.exam.subject.name,
          date: r.exam.date,
          score: r.score === null ? null : Number(r.score),
          maxScore: Number(r.exam.maxScore),
          percentage:
            r.score === null ? null : percentage(Number(r.score), Number(r.exam.maxScore)),
          isPublished: r.exam.isPublished,
          isAbsent: r.isAbsent
        })),
        recitations: recitations.map((r) => ({
          id: r.id,
          date: r.date,
          content: r.content,
          status: r.status,
          score: r.score === null ? null : Number(r.score),
          maxScore: Number(r.maxScore)
        })),
        assignments: submissions.map((s) => ({
          id: s.id,
          title: s.assignment.title,
          dueDate: s.assignment.dueDate,
          status: s.status,
          grade: s.grade === null ? null : Number(s.grade),
          maxScore: Number(s.assignment.maxScore)
        }))
      },
      finance,
      analytics,
      timeline: timeline.slice(0, 40)
    });
  } catch (err) {
    return handleApiError("students.profile", err);
  }
}
