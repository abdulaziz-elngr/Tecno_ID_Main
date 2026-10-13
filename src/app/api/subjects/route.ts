import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAnyPermission, requirePermission, resolveBranchScope } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { BusinessRuleError, created, handleApiError, ok, readJson } from "@/lib/api";
import { normalizeSubjectCode } from "@/lib/group-safety";
import { mergeSubjectTeachers, summarizeSubjectGroups, type SummaryGroup } from "@/lib/subject-summary";
import { assertSubjectTeachers } from "@/lib/subject-access";

const SCOPE = "subjects";

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  code: z.string().trim().max(20).nullish(),
  teacherIds: z.array(z.string().uuid()).max(100).optional()
});

/**
 * Reading subjects is needed by the Groups, Exams and Recitation screens
 * (dropdowns / filters), so GET is open to the roles that use those screens.
 * Writing still requires `academic.subjects.manage`.
 */
const SUBJECT_READ_PERMISSIONS = [
  "academic.subjects.manage",
  "academic.groups.manage",
  "exams.view",
  "recitation.view"
] as const;

export async function GET() {
  try {
    const ctx = await requireAnyPermission(SUBJECT_READ_PERMISSIONS);
    const branchIds = resolveBranchScope(ctx);

    const subjects = await db.subject.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      orderBy: { name: "asc" },
      include: {
        _count: { select: { exams: true } },
        groups: {
          where: { deletedAt: null, ...(branchIds ? { branchId: { in: branchIds } } : {}) },
          select: {
            id: true,
            name: true,
            capacity: true,
            isActive: true,
            grade: {
              select: { id: true, name: true, order: true, stage: { select: { id: true, name: true, order: true } } }
            },
            teacher: { select: { id: true, fullName: true } },
            _count: { select: { students: { where: { deletedAt: null, status: "ACTIVE" } } } }
          }
        },
        teacherSubjects: {
          where: { teacher: { deletedAt: null, ...(branchIds ? { branchId: { in: branchIds } } : {}) } },
          select: { teacher: { select: { id: true, fullName: true } } }
        }
      }
    });

    const data = subjects.map((subject) => {
      const groups: SummaryGroup[] = subject.groups.map((g) => ({
        id: g.id,
        name: g.name,
        capacity: g.capacity,
        isActive: g.isActive,
        studentCount: g._count.students,
        grade: g.grade,
        teacher: g.teacher
      }));
      return {
        id: subject.id,
        name: subject.name,
        code: subject.code,
        _count: subject._count,
        totals: summarizeSubjectGroups(groups),
        teachers: mergeSubjectTeachers(
          subject.teacherSubjects.map((ts) => ts.teacher),
          groups
        ).map(({ id, fullName }) => ({ id, fullName }))
      };
    });

    return ok(data);
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("academic.subjects.manage");
    const input = await readJson(request, createSchema);
    const code = normalizeSubjectCode(input.code);

    const existing = await db.subject.findFirst({
      where: { organizationId: ctx.organizationId, name: input.name }
    });
    if (existing) {
      throw new BusinessRuleError("A subject with this name already exists.", { status: 409 });
    }
    if (code) {
      const codeClash = await db.subject.findFirst({ where: { organizationId: ctx.organizationId, code } });
      if (codeClash) {
        throw new BusinessRuleError("A subject with this code already exists.", { status: 409 });
      }
    }
    const teacherIds = await assertSubjectTeachers(ctx, input.teacherIds ?? []);

    const subject = await db.$transaction(async (tx) => {
      const row = await tx.subject.create({
        data: { organizationId: ctx.organizationId, name: input.name, code }
      });
      if (teacherIds.length > 0) {
        await tx.teacherSubject.createMany({
          data: teacherIds.map((teacherId) => ({ teacherId, subjectId: row.id }))
        });
      }
      return row;
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "CREATE_SUBJECT",
      entityType: "Subject",
      entityId: subject.id,
      afterValue: { ...subject, teacherIds }
    });

    return created(subject);
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}
