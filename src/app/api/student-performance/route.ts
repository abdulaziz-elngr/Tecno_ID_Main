import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { handleApiError, ok, readQuery } from "@/lib/api";
import { loadAccessibleGroup, ownGroupFilter, resolveOwnTeacherId } from "@/lib/group-access";
import { loadParentContacts, whatsappUrl } from "@/lib/parent-contact";
import { performanceMessage } from "@/lib/parent-messages";
import {
  MIN_CATEGORIES_FOR_RANKING,
  MIN_SAMPLES,
  PERFORMANCE_THRESHOLDS,
  PERFORMANCE_WEIGHTS,
  computeMetrics,
  evaluateReasons,
  rankByOverall,
  sortByNeed
} from "@/lib/performance";
import { COMPLETED_SUBMISSION_STATUSES } from "@/lib/homework";

/**
 * Student consistency & performance (Stage 3). Everything is computed from real
 * rows — exam results, homework statuses, recitation grades and attendance — over
 * a chosen period; the scoring rules live in src/lib/performance.ts.
 *
 * Scope: optional stage / grade / group filters, always inside the caller's branch
 * scope, and teachers only ever see the groups they teach. Parent phone numbers are
 * never returned — only a ready WhatsApp link for the "Notify parent" button.
 */

const querySchema = z.object({
  stageId: z.string().uuid().optional(),
  gradeId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
  /** Look-back window in days; 0 = all time. */
  days: z.coerce.number().int().min(0).max(1825).default(90),
  topLimit: z.coerce.number().int().min(1).max(50).default(10),
  needLimit: z.coerce.number().int().min(1).max(100).default(50)
});

const STUDENT_CAP = 2000;

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("performance.view");
    const query = readQuery(request, querySchema);
    const branchIds = resolveBranchScope(ctx, undefined);

    if (query.groupId) await loadAccessibleGroup(ctx, query.groupId);
    const teacherScope = query.groupId ? undefined : await resolveOwnTeacherId(ctx);

    const since = query.days > 0 ? new Date(Date.now() - query.days * 86_400_000) : null;
    const sinceDay = since ? new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate())) : null;

    const students = await db.student.findMany({
      where: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        status: "ACTIVE",
        ...(branchIds ? { branchId: { in: branchIds } } : {}),
        ...(query.stageId ? { stageId: query.stageId } : {}),
        ...(query.gradeId ? { gradeId: query.gradeId } : {}),
        ...(query.groupId ? { groupId: query.groupId } : {}),
        group: { deletedAt: null, ...ownGroupFilter(teacherScope) }
      },
      orderBy: { fullName: "asc" },
      take: STUDENT_CAP + 1,
      select: {
        id: true,
        fullName: true,
        studentCode: true,
        gender: true,
        groupId: true,
        enrollmentDate: true,
        grade: { select: { name: true } },
        group: { select: { name: true, subject: { select: { name: true } } } }
      }
    });
    const truncated = students.length > STUDENT_CAP;
    if (truncated) students.pop();

    const ids = students.map((s) => s.id);
    const groupIds = Array.from(new Set(students.map((s) => s.groupId)));

    const [examRows, submissionRows, recitationRows, sessionRows, attendanceRows, recognitionRows] =
      ids.length === 0
        ? [[], [], [], [], [], []]
        : await Promise.all([
            db.examResult.findMany({
              where: {
                studentId: { in: ids },
                exam: { deletedAt: null, ...(since ? { date: { gte: since } } : {}) }
              },
              select: { studentId: true, score: true, isAbsent: true, exam: { select: { maxScore: true } } }
            }),
            db.assignmentSubmission.findMany({
              where: {
                studentId: { in: ids },
                status: { not: "PENDING" },
                assignment: { deletedAt: null, ...(sinceDay ? { dueDate: { gte: sinceDay } } : {}) }
              },
              select: { studentId: true, status: true }
            }),
            db.recitation.findMany({
              where: { studentId: { in: ids }, score: { not: null }, ...(since ? { date: { gte: since } } : {}) },
              select: { studentId: true, score: true, maxScore: true }
            }),
            db.classSession.findMany({
              where: { groupId: { in: groupIds }, status: "COMPLETED", ...(sinceDay ? { date: { gte: sinceDay } } : {}) },
              select: { id: true, groupId: true, date: true }
            }),
            db.attendance.findMany({
              where: {
                studentId: { in: ids },
                deletedAt: null,
                session: { status: "COMPLETED", ...(sinceDay ? { date: { gte: sinceDay } } : {}) }
              },
              select: { studentId: true, type: true, session: { select: { groupId: true, date: true } } }
            }),
            db.studentRecognition.groupBy({
              by: ["studentId"],
              where: { studentId: { in: ids } },
              _count: { _all: true },
              _max: { recognizedAt: true }
            })
          ]);

    const bucket = <T extends { studentId: string }>(rows: T[]) => {
      const map = new Map<string, T[]>();
      for (const row of rows) {
        const list = map.get(row.studentId);
        if (list) list.push(row);
        else map.set(row.studentId, [row]);
      }
      return map;
    };
    const examsBy = bucket(examRows);
    const submissionsBy = bucket(submissionRows);
    const recitationsBy = bucket(recitationRows);
    const attendanceBy = bucket(attendanceRows);
    const recognitionBy = new Map(recognitionRows.map((r) => [r.studentId, r]));
    const sessionsByGroup = new Map<string, Date[]>();
    for (const s of sessionRows) {
      const list = sessionsByGroup.get(s.groupId);
      if (list) list.push(s.date);
      else sessionsByGroup.set(s.groupId, [s.date]);
    }

    const evaluated = students.map((student) => {
      // Lessons only count from the day the student enrolled.
      const enrolledDay = Date.UTC(
        student.enrollmentDate.getUTCFullYear(),
        student.enrollmentDate.getUTCMonth(),
        student.enrollmentDate.getUTCDate()
      );
      const held = (sessionsByGroup.get(student.groupId) ?? []).filter((d) => d.getTime() >= enrolledDay).length;
      const ownLessonRows = (attendanceBy.get(student.id) ?? []).filter(
        (a) => a.session.groupId === student.groupId && a.session.date.getTime() >= enrolledDay
      );
      const attended = ownLessonRows.filter((a) => a.type === "REGULAR" || a.type === "MAKE_UP" || a.type === "LATE").length;
      const excused = ownLessonRows.filter((a) => a.type === "EXCUSED").length;

      const metrics = computeMetrics({
        exams: (examsBy.get(student.id) ?? []).map((e) => ({
          score: e.score === null ? null : Number(e.score),
          maxScore: Number(e.exam.maxScore),
          isAbsent: e.isAbsent
        })),
        homework: (submissionsBy.get(student.id) ?? []).map((h) => ({
          completed: COMPLETED_SUBMISSION_STATUSES.includes(h.status)
        })),
        recitations: (recitationsBy.get(student.id) ?? []).map((r) => ({
          score: r.score === null ? null : Number(r.score),
          maxScore: Number(r.maxScore)
        })),
        attendance: { held, attended, excused }
      });
      const recognition = recognitionBy.get(student.id);
      return {
        id: student.id,
        fullName: student.fullName,
        studentCode: student.studentCode,
        gender: student.gender,
        gradeName: student.grade.name,
        groupName: student.group.name,
        subjectName: student.group.subject?.name ?? null,
        ...metrics,
        reasons: evaluateReasons(metrics),
        recognitionCount: recognition?._count._all ?? 0,
        lastRecognizedAt: recognition?._max.recognizedAt ?? null
      };
    });

    const top = rankByOverall(evaluated).slice(0, query.topLimit);
    const needing = sortByNeed(evaluated.filter((s) => s.categoriesWithData > 0 && s.reasons.length > 0)).slice(
      0,
      query.needLimit
    );

    // Parent links only for the students that show a "Notify parent" button.
    const contacts = await loadParentContacts(needing.map((s) => s.id));
    const strip = <T extends { gender: unknown }>(s: T) => {
      const { gender: _gender, ...rest } = s;
      void _gender;
      return rest;
    };

    return ok({
      period: { days: query.days },
      weights: PERFORMANCE_WEIGHTS,
      thresholds: PERFORMANCE_THRESHOLDS,
      minimums: { ...MIN_SAMPLES, categoriesForRanking: MIN_CATEGORIES_FOR_RANKING },
      summary: {
        students: evaluated.length,
        ranked: evaluated.filter((s) => s.ranked).length,
        withoutData: evaluated.filter((s) => s.categoriesWithData === 0).length,
        needAttention: evaluated.filter((s) => s.categoriesWithData > 0 && s.reasons.length > 0).length,
        truncated
      },
      top: top.map(strip),
      needsImprovement: needing.map((s) => {
        const contact = contacts.get(s.id);
        const link = whatsappUrl(
          contact,
          performanceMessage({
            locale: contact?.locale ?? "ar",
            studentName: s.fullName,
            gender: s.gender,
            reasons: s.reasons
          })
        );
        return { ...strip(s), whatsappUrl: link, parentIssue: contact?.issue ?? null };
      })
    });
  } catch (err) {
    return handleApiError("student-performance", err);
  }
}
