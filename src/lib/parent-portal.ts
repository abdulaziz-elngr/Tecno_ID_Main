import { db } from "./db";
import { loadLedgerEnv, loadLedgers, serializeEntry, summarize } from "./payment-ledger";
import { getCenterProfile } from "./settings";
import { attendanceRate } from "./attendance";
import { percentage } from "./grading";
import { ensureStudentItems, serializeBookItem } from "./books";

/**
 * Read-only, parent-safe projection of one student's record.
 *
 * What is intentionally NOT returned: staff notes, emergency contact, other
 * parents' phone numbers, fee-exemption reasons, internal ids of staff,
 * unpublished exam results, and anything about other students.
 */
export async function loadParentPortalData(studentId: string) {
  const student = await db.student.findFirst({
    where: { id: studentId, deletedAt: null },
    select: {
      id: true,
      organizationId: true,
      studentCode: true,
      fullName: true,
      status: true,
      school: true,
      enrollmentDate: true,
      gradeId: true,
      groupId: true,
      feeExempt: true,
      branch: { select: { name: true } },
      stage: { select: { name: true } },
      grade: { select: { name: true } },
      group: { select: { name: true, teacher: { select: { fullName: true } } } }
    }
  });
  if (!student) return null;

  // A student who joined the group after a reservation was opened still gets his row (and is asked to pay).
  await ensureStudentItems({ id: student.id, organizationId: student.organizationId, groupId: student.groupId, status: student.status });
  const bookRows = await db.bookReservationItem.findMany({
    where: { studentId: student.id, reservation: { status: { not: "CANCELLED" } } },
    orderBy: { createdAt: "desc" },
    include: { reservation: true }
  });
  const books = bookRows.map((r) => serializeBookItem(r, r.reservation));

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const [center, attendanceRows, recitations, examResults, submissions, recognitions, payments, upcoming] =
    await Promise.all([
      getCenterProfile(student.organizationId),
      db.attendance.findMany({
        where: { studentId: student.id, deletedAt: null },
        orderBy: { session: { date: "desc" } },
        take: 120,
        select: { type: true, session: { select: { date: true, startMinutes: true, group: { select: { name: true } } } } }
      }),
      db.recitation.findMany({
        where: { studentId: student.id },
        orderBy: { date: "desc" },
        take: 60,
        select: { id: true, date: true, content: true, status: true, score: true, maxScore: true }
      }),
      db.examResult.findMany({
        // Only exams the teacher has published are visible to parents.
        where: { studentId: student.id, exam: { deletedAt: null, isPublished: true } },
        orderBy: { exam: { date: "desc" } },
        take: 60,
        select: {
          score: true,
          isAbsent: true,
          exam: { select: { id: true, name: true, date: true, maxScore: true, subject: { select: { name: true } } } }
        }
      }),
      db.assignmentSubmission.findMany({
        where: { studentId: student.id, assignment: { deletedAt: null } },
        orderBy: { assignment: { dueDate: "desc" } },
        take: 60,
        select: {
          status: true,
          grade: true,
          feedback: true,
          submittedAt: true,
          assignment: { select: { id: true, title: true, dueDate: true, maxScore: true } }
        }
      }),
      db.studentRecognition.findMany({
        where: { studentId: student.id },
        orderBy: { recognizedAt: "desc" },
        take: 20,
        select: { id: true, reason: true, recognizedAt: true }
      }),
      db.payment.findMany({
        where: { studentId: student.id },
        orderBy: { paidAt: "desc" },
        take: 60,
        select: { id: true, receiptNumber: true, amount: true, refundedAmount: true, method: true, status: true, paidAt: true }
      }),
      db.classSession.findMany({
        where: { groupId: student.groupId, date: { gte: today }, status: { in: ["SCHEDULED", "OPEN"] } },
        orderBy: [{ date: "asc" }, { startMinutes: "asc" }],
        take: 5,
        select: { id: true, date: true, startMinutes: true, endMinutes: true, status: true }
      })
    ]);

  // ---- finance: same ledger the staff screens use, so numbers always agree.
  const env = await loadLedgerEnv(student.organizationId);
  const ledger =
    (await loadLedgers(
      student.organizationId,
      [{ id: student.id, gradeId: student.gradeId, enrollmentDate: student.enrollmentDate }],
      env
    )).get(student.id) ?? [];
  const summary = summarize(ledger);

  // ---- attendance
  const present = attendanceRows.filter((a) => ["REGULAR", "LATE", "MAKE_UP"].includes(a.type)).length;
  const absent = attendanceRows.filter((a) => a.type === "ABSENT").length;
  const late = attendanceRows.filter((a) => a.type === "LATE").length;
  const excused = attendanceRows.filter((a) => a.type === "EXCUSED").length;

  // ---- exams
  const exams = examResults.map((r) => ({
    id: r.exam.id,
    name: r.exam.name,
    subject: r.exam.subject.name,
    date: r.exam.date,
    score: r.score === null ? null : Number(r.score),
    maxScore: Number(r.exam.maxScore),
    percentage: r.score === null ? null : percentage(Number(r.score), Number(r.exam.maxScore)),
    isAbsent: r.isAbsent
  }));
  const gradedExams = exams.filter((e) => e.percentage !== null && !e.isAbsent);
  const examAverage = gradedExams.length
    ? Math.round((gradedExams.reduce((s, e) => s + (e.percentage as number), 0) / gradedExams.length) * 10) / 10
    : null;

  // ---- homework
  const assignments = submissions.map((s) => ({
    id: s.assignment.id,
    title: s.assignment.title,
    dueDate: s.assignment.dueDate,
    status: s.status,
    grade: s.grade === null ? null : Number(s.grade),
    maxScore: Number(s.assignment.maxScore),
    feedback: s.feedback,
    submittedAt: s.submittedAt
  }));

  return {
    center: { name: center.name ?? "", phone: center.phone ?? null, currency: env.currency },
    student: {
      studentCode: student.studentCode,
      fullName: student.fullName,
      status: student.status,
      school: student.school,
      enrollmentDate: student.enrollmentDate,
      branch: student.branch.name,
      stage: student.stage.name,
      grade: student.grade.name,
      group: student.group.name,
      teacher: student.group.teacher?.fullName ?? null
    },
    upcomingSessions: upcoming,
    attendance: {
      summary: { present, absent, late, excused, percentage: attendanceRate(present, present + absent) },
      records: attendanceRows.map((a) => ({
        date: a.session.date,
        startMinutes: a.session.startMinutes,
        group: a.session.group.name,
        type: a.type
      }))
    },
    finance: {
      exempt: student.feeExempt,
      totalDue: summary.totalDue,
      outstandingMonths: summary.outstanding.length,
      // newest first, last 12 months
      months: ledger.slice(-12).reverse().map(serializeEntry),
      payments: payments.map((p) => ({
        id: p.id,
        receiptNumber: p.receiptNumber,
        amount: Number(p.amount),
        refundedAmount: Number(p.refundedAmount),
        method: p.method,
        status: p.status,
        paidAt: p.paidAt
      }))
    },
    books: {
      // Only OPEN reservations can be "owed"; closed ones stay visible as history.
      totalDue: Math.round(books.filter((b) => b.reservationStatus === "OPEN").reduce((n, b) => n + b.remaining, 0) * 100) / 100,
      items: books
    },
    recitations: recitations.map((r) => ({
      id: r.id,
      date: r.date,
      content: r.content,
      status: r.status,
      score: r.score === null ? null : Number(r.score),
      maxScore: Number(r.maxScore)
    })),
    exams: { average: examAverage, items: exams },
    assignments,
    recognitions
  };
}
