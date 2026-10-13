import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { handleApiError, ok, created, readJson, readQuery, paginationSchema, BusinessRuleError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { loadAccessibleGroup, ownGroupFilter, resolveOwnTeacherId } from "@/lib/group-access";

const listSchema = paginationSchema.extend({
  branchId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
  upcoming: z.enum(["true", "false"]).optional()
});

const createSchema = z.object({
  groupId: z.string().uuid(),
  // Optional: defaults to the group's own subject (only needed for legacy groups without one).
  subjectId: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(150),
  date: z.string().datetime(),
  maxScore: z.number().positive().max(10000),
  durationMinutes: z.number().int().min(1).max(600).optional(),
  description: z.string().trim().max(1000).optional()
});

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("exams.view");
    const query = readQuery(request, listSchema);
    const branchIds = resolveBranchScope(ctx, query.branchId);

    // A group filter is verified (branch scope + "own groups" rule for teachers);
    // without one, teachers only see the exams of the groups they teach.
    if (query.groupId) await loadAccessibleGroup(ctx, query.groupId);
    const teacherScope = query.groupId ? undefined : await resolveOwnTeacherId(ctx);

    const where = {
      organizationId: ctx.organizationId,
      deletedAt: null,
      ...(branchIds ? { branchId: { in: branchIds } } : {}),
      ...(query.groupId ? { groupId: query.groupId } : {}),
      ...(teacherScope !== undefined ? { group: ownGroupFilter(teacherScope) } : {}),
      ...(query.subjectId ? { subjectId: query.subjectId } : {}),
      ...(query.upcoming === "true" ? { date: { gte: new Date() } } : {})
    };

    const [total, exams] = await Promise.all([
      db.exam.count({ where }),
      db.exam.findMany({
        where,
        orderBy: { date: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          name: true,
          date: true,
          maxScore: true,
          isPublished: true,
          groupId: true,
          subject: { select: { id: true, name: true } },
          group: { select: { id: true, name: true } },
          _count: { select: { results: true } }
        }
      })
    ]);

    // Per-exam progress (students / graded / absent) for the "previous exams" list.
    const examIds = exams.map((e) => e.id);
    const groupIds = Array.from(new Set(exams.map((e) => e.groupId)));
    const [gradedRows, absentRows, studentRows] =
      exams.length === 0
        ? [[], [], []]
        : await Promise.all([
            db.examResult.groupBy({
              by: ["examId"],
              where: { examId: { in: examIds }, isAbsent: false, score: { not: null } },
              _count: { _all: true }
            }),
            db.examResult.groupBy({
              by: ["examId"],
              where: { examId: { in: examIds }, isAbsent: true },
              _count: { _all: true }
            }),
            db.student.groupBy({
              by: ["groupId"],
              where: { groupId: { in: groupIds }, deletedAt: null, status: "ACTIVE" },
              _count: { _all: true }
            })
          ]);
    const graded = new Map(gradedRows.map((r) => [r.examId, r._count._all]));
    const absent = new Map(absentRows.map((r) => [r.examId, r._count._all]));
    const students = new Map(studentRows.map((r) => [r.groupId, r._count._all]));

    return ok({
      exams: exams.map((e) => {
        const studentCount = students.get(e.groupId) ?? 0;
        const gradedCount = graded.get(e.id) ?? 0;
        const absentCount = absent.get(e.id) ?? 0;
        return {
          ...e,
          maxScore: Number(e.maxScore),
          studentCount,
          gradedCount,
          absentCount,
          pendingCount: Math.max(0, studentCount - gradedCount - absentCount)
        };
      }),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize))
      }
    });
  } catch (err) {
    return handleApiError("exams.list", err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("exams.create");
    const input = await readJson(request, createSchema);

    // Branch scope + "teachers only create exams for the groups they teach".
    const group = await loadAccessibleGroup(ctx, input.groupId);

    const subjectId = input.subjectId ?? group.subjectId;
    if (!subjectId) {
      throw new BusinessRuleError("This group has no subject. Choose a subject for the exam.", { status: 400 });
    }
    const subject = await db.subject.findFirst({
      where: { id: subjectId, organizationId: ctx.organizationId, deletedAt: null }
    });
    if (!subject) throw new BusinessRuleError("Invalid subject.", { status: 400 });

    const exam = await db.exam.create({
      data: {
        organizationId: ctx.organizationId,
        branchId: group.branchId,
        subjectId: subject.id,
        groupId: group.id,
        name: input.name,
        date: new Date(input.date),
        maxScore: input.maxScore,
        durationMinutes: input.durationMinutes,
        description: input.description,
        createdById: ctx.userId
      }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "CREATE_EXAM",
      entityType: "Exam",
      entityId: exam.id,
      afterValue: exam
    });

    return created({ ...exam, maxScore: Number(exam.maxScore) });
  } catch (err) {
    return handleApiError("exams.create", err);
  }
}
