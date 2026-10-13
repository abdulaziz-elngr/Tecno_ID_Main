import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAnyPermission, requirePermission, resolveBranchScope } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { BusinessRuleError, NotFoundError, handleApiError, ok, readJson } from "@/lib/api";
import { normalizeSubjectCode } from "@/lib/group-safety";
import { mergeSubjectTeachers, summarizeSubjectGroups, type SummaryGroup } from "@/lib/subject-summary";
import { assertSubjectTeachers } from "@/lib/subject-access";

const SCOPE = "subjects.detail";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  code: z.string().trim().max(20).nullish(),
  // Full replacement set of teachers who teach this subject.
  teacherIds: z.array(z.string().uuid()).max(100).optional()
});

const SUBJECT_READ_PERMISSIONS = ["academic.subjects.manage", "academic.groups.manage"] as const;

async function loadSubject(organizationId: string, id: string) {
  const subject = await db.subject.findFirst({
    where: { id, organizationId, deletedAt: null },
    include: { _count: { select: { exams: true } } }
  });
  if (!subject) throw new NotFoundError("Subject not found.");
  return subject;
}

/**
 * Subject detail: Subject -> Teachers -> Groups -> Students, plus the
 * schedules/capacity of each group and what has happened in the subject so
 * far (exams, lessons/sessions, attendance, recitations).
 */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireAnyPermission(SUBJECT_READ_PERMISSIONS);
    const branchIds = resolveBranchScope(ctx);
    const subject = await loadSubject(ctx.organizationId, params.id);

    const [groups, declared] = await Promise.all([
      db.group.findMany({
        where: {
          subjectId: subject.id,
          deletedAt: null,
          ...(branchIds ? { branchId: { in: branchIds } } : {})
        },
        orderBy: [{ grade: { stage: { order: "asc" } } }, { grade: { order: "asc" } }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          capacity: true,
          isActive: true,
          grade: {
            select: { id: true, name: true, order: true, stage: { select: { id: true, name: true, order: true } } }
          },
          teacher: { select: { id: true, fullName: true } },
          assistant: { select: { id: true, fullName: true } },
          schedules: {
            where: { isActive: true },
            orderBy: [{ dayOfWeek: "asc" }, { startMinutes: "asc" }],
            select: { id: true, dayOfWeek: true, startMinutes: true, endMinutes: true }
          },
          _count: { select: { students: { where: { deletedAt: null, status: "ACTIVE" } } } }
        }
      }),
      db.teacherSubject.findMany({
        where: {
          subjectId: subject.id,
          teacher: { deletedAt: null, ...(branchIds ? { branchId: { in: branchIds } } : {}) }
        },
        select: { teacher: { select: { id: true, fullName: true, phone: true, isActive: true } } }
      })
    ]);

    const groupIds = groups.map((g) => g.id);
    const summaryGroups: SummaryGroup[] = groups.map((g) => ({
      id: g.id,
      name: g.name,
      capacity: g.capacity,
      isActive: g.isActive,
      studentCount: g._count.students,
      grade: g.grade,
      teacher: g.teacher
    }));

    const [recentExams, examCount, sessionCount, completedSessionCount, attendanceCount, recitationCount] =
      await Promise.all([
        db.exam.findMany({
          where: { subjectId: subject.id, deletedAt: null },
          orderBy: { date: "desc" },
          take: 10,
          select: {
            id: true,
            name: true,
            date: true,
            isPublished: true,
            group: { select: { id: true, name: true } },
            _count: { select: { results: true } }
          }
        }),
        db.exam.count({ where: { subjectId: subject.id, deletedAt: null } }),
        db.classSession.count({ where: { groupId: { in: groupIds } } }),
        db.classSession.count({ where: { groupId: { in: groupIds }, status: "COMPLETED" } }),
        db.attendance.count({ where: { groupId: { in: groupIds }, deletedAt: null } }),
        db.recitation.count({ where: { organizationId: ctx.organizationId, subjectId: subject.id } })
      ]);

    const teacherDetails = new Map(declared.map((d) => [d.teacher.id, d.teacher]));

    return ok({
      id: subject.id,
      name: subject.name,
      code: subject.code,
      totals: summarizeSubjectGroups(summaryGroups),
      teachers: mergeSubjectTeachers(
        declared.map((d) => d.teacher),
        summaryGroups
      ).map((t) => ({ ...t, phone: teacherDetails.get(t.id)?.phone ?? null })),
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        capacity: g.capacity,
        isActive: g.isActive,
        grade: { id: g.grade.id, name: g.grade.name },
        stage: { id: g.grade.stage.id, name: g.grade.stage.name },
        teacher: g.teacher,
        assistant: g.assistant,
        schedules: g.schedules,
        studentCount: g._count.students,
        remaining: Math.max(0, g.capacity - g._count.students)
      })),
      activity: {
        exams: examCount,
        sessions: sessionCount,
        completedSessions: completedSessionCount,
        attendanceRecords: attendanceCount,
        recitations: recitationCount
      },
      recentExams
    });
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("academic.subjects.manage");
    const subject = await loadSubject(ctx.organizationId, params.id);
    const input = await readJson(request, updateSchema);

    if (input.name !== undefined && input.name !== subject.name) {
      const clash = await db.subject.findFirst({
        where: { organizationId: ctx.organizationId, name: input.name, id: { not: subject.id } }
      });
      if (clash) throw new BusinessRuleError("A subject with this name already exists.", { status: 409 });
    }

    const codeProvided = input.code !== undefined;
    const nextCode = codeProvided ? normalizeSubjectCode(input.code) : subject.code;
    if (codeProvided && nextCode && nextCode !== subject.code) {
      const clash = await db.subject.findFirst({
        where: { organizationId: ctx.organizationId, code: nextCode, id: { not: subject.id } }
      });
      if (clash) throw new BusinessRuleError("A subject with this code already exists.", { status: 409 });
    }

    let teacherPlan: { toAdd: string[]; toRemove: string[] } | null = null;
    if (input.teacherIds !== undefined) {
      const wanted = await assertSubjectTeachers(ctx, input.teacherIds);
      const current = await db.teacherSubject.findMany({
        where: { subjectId: subject.id },
        select: { teacherId: true }
      });
      const currentIds = new Set(current.map((c) => c.teacherId));
      const wantedSet = new Set(wanted);
      const toAdd = wanted.filter((id) => !currentIds.has(id));
      const toRemove = Array.from(currentIds).filter((id) => !wantedSet.has(id));

      // A teacher who still runs a group of this subject cannot be un-assigned
      // from it: that would contradict Group.teacherId.
      if (toRemove.length > 0) {
        const stillTeaching = await db.group.findMany({
          where: { subjectId: subject.id, deletedAt: null, teacherId: { in: toRemove } },
          select: { name: true, teacher: { select: { fullName: true } } }
        });
        if (stillTeaching.length > 0) {
          const who = Array.from(new Set(stillTeaching.map((g) => g.teacher?.fullName ?? ""))).join(", ");
          throw new BusinessRuleError(
            `Cannot remove ${who}: still responsible for groups of this subject. Reassign those groups first.`,
            { code: "TEACHER_HAS_GROUPS" }
          );
        }
      }
      teacherPlan = { toAdd, toRemove };
    }

    const updated = await db.$transaction(async (tx) => {
      const row = await tx.subject.update({
        where: { id: subject.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(codeProvided ? { code: nextCode } : {})
        }
      });
      if (teacherPlan) {
        if (teacherPlan.toRemove.length > 0) {
          await tx.teacherSubject.deleteMany({
            where: { subjectId: subject.id, teacherId: { in: teacherPlan.toRemove } }
          });
        }
        if (teacherPlan.toAdd.length > 0) {
          await tx.teacherSubject.createMany({
            data: teacherPlan.toAdd.map((teacherId) => ({ teacherId, subjectId: subject.id })),
            skipDuplicates: true
          });
        }
      }
      return row;
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "UPDATE_SUBJECT",
      entityType: "Subject",
      entityId: subject.id,
      beforeValue: { name: subject.name, code: subject.code },
      afterValue: {
        name: updated.name,
        code: updated.code,
        ...(teacherPlan ? { teachersAdded: teacherPlan.toAdd, teachersRemoved: teacherPlan.toRemove } : {})
      }
    });

    return ok(updated);
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("academic.subjects.manage");
    const subject = await loadSubject(ctx.organizationId, params.id);

    const groupCount = await db.group.count({ where: { subjectId: subject.id, deletedAt: null } });
    if (groupCount > 0) {
      throw new BusinessRuleError(
        `This subject still has ${groupCount} group(s). Move or archive them before removing it.`
      );
    }
    if (subject._count.exams > 0) {
      throw new BusinessRuleError("This subject still has exams. Archive them before removing it.");
    }

    await db.subject.update({ where: { id: subject.id }, data: { deletedAt: new Date() } });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "DELETE_SUBJECT",
      entityType: "Subject",
      entityId: subject.id,
      beforeValue: { name: subject.name, code: subject.code }
    });

    return ok({ id: subject.id, deleted: true });
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}
