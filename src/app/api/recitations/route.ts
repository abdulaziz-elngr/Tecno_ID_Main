import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { handleApiError, ok, created, readJson, readQuery, paginationSchema, BusinessRuleError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

/** Recitation / التسميع module (spec §25). */

const listSchema = paginationSchema.extend({
  studentId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
  status: z.enum(["COMPLETED", "PARTIAL", "NOT_COMPLETED", "ABSENT"]).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional()
});

const createSchema = z.object({
  studentId: z.string().uuid(),
  subjectId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
  date: z.string().datetime(),
  content: z.string().trim().min(1).max(300),
  score: z.number().min(0).max(1000).optional(),
  maxScore: z.number().positive().max(1000).default(10),
  status: z.enum(["COMPLETED", "PARTIAL", "NOT_COMPLETED", "ABSENT"]),
  notes: z.string().trim().max(500).optional()
});

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("recitation.view");
    const query = readQuery(request, listSchema);

    const where = {
      organizationId: ctx.organizationId,
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.subjectId ? { subjectId: query.subjectId } : {}),
      ...(query.groupId ? { groupId: query.groupId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? {
            date: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {})
            }
          }
        : {}),
      // Branch scoping goes through the student, which owns branchId.
      ...(ctx.isOrgWide ? {} : { student: { branchId: { in: ctx.branchIds } } })
    };

    const [total, rows] = await Promise.all([
      db.recitation.count({ where }),
      db.recitation.findMany({
        where,
        orderBy: { date: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { student: { select: { id: true, fullName: true, studentCode: true } } }
      })
    ]);

    return ok({
      recitations: rows.map((r) => ({
        ...r,
        score: r.score === null ? null : Number(r.score),
        maxScore: Number(r.maxScore)
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize))
      }
    });
  } catch (err) {
    return handleApiError("recitations.list", err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("recitation.manage");
    const input = await readJson(request, createSchema);

    if (input.score !== undefined && input.score > input.maxScore) {
      throw new BusinessRuleError("The score cannot exceed the maximum score.");
    }

    const student = await db.student.findFirst({
      where: { id: input.studentId, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, branchId: true }
    });
    if (!student) throw new BusinessRuleError("Student not found.", { status: 404 });
    resolveBranchScope(ctx, student.branchId);

    // Optional group/subject references come from the client: they must
    // belong to this organization (and the group to a branch in scope).
    if (input.groupId) {
      const group = await db.group.findFirst({
        where: {
          id: input.groupId,
          deletedAt: null,
          branch: { center: { organizationId: ctx.organizationId } }
        },
        select: { branchId: true }
      });
      if (!group) throw new BusinessRuleError("Invalid group.", { status: 400 });
      resolveBranchScope(ctx, group.branchId);
    }
    if (input.subjectId) {
      const subject = await db.subject.findFirst({
        where: { id: input.subjectId, organizationId: ctx.organizationId, deletedAt: null },
        select: { id: true }
      });
      if (!subject) throw new BusinessRuleError("Invalid subject.", { status: 400 });
    }

    const teacher = await db.teacher.findFirst({
      where: { userId: ctx.userId },
      select: { id: true }
    });

    const recitation = await db.recitation.create({
      data: {
        organizationId: ctx.organizationId,
        studentId: student.id,
        subjectId: input.subjectId,
        groupId: input.groupId,
        teacherId: teacher?.id,
        date: new Date(input.date),
        content: input.content,
        score: input.score,
        maxScore: input.maxScore,
        status: input.status,
        notes: input.notes,
        createdById: ctx.userId
      }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "CREATE_RECITATION",
      entityType: "Recitation",
      entityId: recitation.id,
      afterValue: recitation
    });

    return created({
      ...recitation,
      score: recitation.score === null ? null : Number(recitation.score),
      maxScore: Number(recitation.maxScore)
    });
  } catch (err) {
    return handleApiError("recitations.create", err);
  }
}
