import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { BusinessRuleError, created, handleApiError, paginated, paginationSchema, readJson, readQuery } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { teacherCreateSchema } from "@/lib/staff";
import { applyStaffGroupPlan, planStaffGroupSync } from "@/lib/staff-groups";
import { linkTeacherToSubjectsOfGroups } from "@/lib/teacher-subjects";

const SCOPE = "teachers.list";

const listQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  branchId: z.string().uuid().optional(),
  isAssistant: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true"))
});

const GROUP_BRIEF = {
  where: { deletedAt: null },
  orderBy: { name: "asc" },
  select: { id: true, name: true, grade: { select: { name: true } }, subject: { select: { id: true, name: true } } }
} as const;

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("teachers.view");
    const { page, pageSize, search, branchId, isAssistant } = readQuery(request, listQuerySchema);
    const branchIds = resolveBranchScope(ctx, branchId);

    const where = {
      organizationId: ctx.organizationId,
      deletedAt: null,
      ...(branchIds ? { branchId: { in: branchIds } } : {}),
      ...(isAssistant !== undefined ? { isAssistant } : {}),
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: "insensitive" as const } },
              { phone: { contains: search } },
              { email: { contains: search, mode: "insensitive" as const } }
            ]
          }
        : {})
    };

    const [total, rows] = await Promise.all([
      db.teacher.count({ where }),
      db.teacher.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          fullName: true,
          photoUrl: true,
          phone: true,
          email: true,
          isAssistant: true,
          isActive: true,
          userId: true,
          branch: { select: { id: true, name: true } },
          groupsAsTeacher: GROUP_BRIEF,
          groupsAsAssistant: GROUP_BRIEF,
          teacherSubjects: { select: { subject: { select: { id: true, name: true, deletedAt: true } } } }
        }
      })
    ]);

    // A teacher is responsible for `groupsAsTeacher`, an assistant for
    // `groupsAsAssistant`; expose just the relevant one as `groups`.
    const data = rows.map(({ groupsAsTeacher, groupsAsAssistant, teacherSubjects, ...rest }) => ({
      ...rest,
      // Subjects this teacher teaches (Teacher -> Subject), alphabetical.
      subjects: teacherSubjects
        .filter((ts) => ts.subject.deletedAt === null)
        .map((ts) => ({ id: ts.subject.id, name: ts.subject.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      groups: (rest.isAssistant ? groupsAsAssistant : groupsAsTeacher).map((g) => ({
        id: g.id,
        name: g.name,
        gradeName: g.grade.name,
        subjectName: g.subject?.name ?? null
      }))
    }));

    return paginated(data, { page, pageSize, total });
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("teachers.create");
    const input = await readJson(request, teacherCreateSchema);

    resolveBranchScope(ctx, input.branchId);
    const branch = await db.branch.findFirst({
      where: { id: input.branchId, deletedAt: null, center: { organizationId: ctx.organizationId } }
    });
    if (!branch) throw new BusinessRuleError("Invalid branch.", { status: 400 });

    // The teacher row and the group assignments are written together: if any
    // selected group is invalid / already taken / overlapping, nothing is created.
    const { teacher, plan } = await db.$transaction(async (tx) => {
      const row = await tx.teacher.create({
        data: {
          organizationId: ctx.organizationId,
          branchId: input.branchId,
          fullName: input.fullName,
          phone: input.phone ?? null,
          email: input.email ?? null,
          isAssistant: input.isAssistant
        }
      });
      const groupPlan = await planStaffGroupSync(tx, {
        organizationId: ctx.organizationId,
        staff: { id: row.id, branchId: row.branchId, isAssistant: row.isAssistant },
        groupIds: input.groupIds,
        allowReassign: input.allowReassign
      });
      await applyStaffGroupPlan(tx, row.id, groupPlan);
      if (!row.isAssistant) await linkTeacherToSubjectsOfGroups(tx, row.id, groupPlan.toAdd);
      return { teacher: row, plan: groupPlan };
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: input.isAssistant ? "CREATE_TEACHER_ASSISTANT" : "CREATE_TEACHER",
      entityType: "Teacher",
      entityId: teacher.id,
      afterValue: { ...teacher, groupIds: input.groupIds, reassignedFrom: plan.takeovers }
    });

    return created({ ...teacher, groupIds: input.groupIds });
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}
