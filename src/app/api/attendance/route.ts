import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { handleApiError, ok, created, readJson, readQuery, paginationSchema, BusinessRuleError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { toDateOnly } from "@/lib/sessions";
import { toCsv, csvResponse } from "@/lib/csv";
import { dispatchEvent } from "@/lib/notifications";

const listSchema = paginationSchema.extend({
  branchId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  gradeId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  teacherId: z.string().uuid().optional(),
  type: z.enum(["REGULAR", "MAKE_UP", "LATE", "EXCUSED", "ABSENT"]).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  format: z.enum(["json", "csv"]).default("json")
});

/** Manual marking (absent/excused, or attendance without a scanner). */
const createSchema = z.object({
  sessionId: z.string().uuid(),
  studentId: z.string().uuid(),
  type: z.enum(["REGULAR", "MAKE_UP", "LATE", "EXCUSED", "ABSENT"]),
  notes: z.string().trim().max(500).optional(),
  makeUpReason: z.string().trim().max(300).optional()
});

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("attendance.view");
    const query = readQuery(request, listSchema);
    const branchIds = resolveBranchScope(ctx, query.branchId);

    const where = {
      organizationId: ctx.organizationId,
      deletedAt: null,
      ...(branchIds ? { branchId: { in: branchIds } } : {}),
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.groupId ? { groupId: query.groupId } : {}),
      ...(query.sessionId ? { sessionId: query.sessionId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.gradeId ? { group: { gradeId: query.gradeId } } : {}),
      ...(query.stageId ? { group: { grade: { stageId: query.stageId } } } : {}),
      ...(query.teacherId || query.from || query.to
        ? {
            session: {
              ...(query.teacherId ? { teacherId: query.teacherId } : {}),
              ...(query.from || query.to
                ? {
                    date: {
                      ...(query.from ? { gte: toDateOnly(query.from) } : {}),
                      ...(query.to ? { lte: toDateOnly(query.to) } : {})
                    }
                  }
                : {})
            }
          }
        : {})
    };

    const select = {
      id: true,
      type: true,
      recordedAt: true,
      notes: true,
      makeUpReason: true,
      student: { select: { id: true, fullName: true, studentCode: true } },
      session: {
        select: {
          id: true,
          date: true,
          startMinutes: true,
          group: { select: { id: true, name: true, grade: { select: { name: true, stage: { select: { name: true } } } } } }
        }
      }
    };

    if (query.format === "csv") {
      if (!ctx.permissions.has("reports.export")) {
        throw new BusinessRuleError("You do not have permission to export data.", { status: 403 });
      }
      // Bounded export — large exports belong to the reports module.
      const rows = await db.attendance.findMany({
        where,
        orderBy: { recordedAt: "desc" },
        take: 5000,
        select
      });
      const csv = toCsv(
        rows.map((r) => ({
          date: r.session.date.toISOString().slice(0, 10),
          student_code: r.student.studentCode,
          student_name: r.student.fullName,
          stage: r.session.group.grade.stage.name,
          grade: r.session.group.grade.name,
          group: r.session.group.name,
          type: r.type,
          recorded_at: r.recordedAt.toISOString(),
          notes: r.notes ?? ""
        }))
      );
      await writeAuditLog({
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: "EXPORT_ATTENDANCE",
        entityType: "Attendance",
        afterValue: { rows: rows.length }
      });
      return csvResponse(`attendance-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    }

    const [total, rows] = await Promise.all([
      db.attendance.count({ where }),
      db.attendance.findMany({
        where,
        orderBy: { recordedAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select
      })
    ]);

    return ok({
      attendance: rows,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize))
      }
    });
  } catch (err) {
    return handleApiError("attendance.list", err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("attendance.create");
    const input = await readJson(request, createSchema);

    const session = await db.classSession.findFirst({
      where: {
        id: input.sessionId,
        organizationId: ctx.organizationId,
        ...(ctx.isOrgWide ? {} : { branchId: { in: ctx.branchIds } })
      },
      include: { group: { select: { id: true, name: true } } }
    });
    if (!session) throw new BusinessRuleError("Session not found.", { status: 404 });
    if (session.status === "CANCELLED") {
      throw new BusinessRuleError("This session has been cancelled.");
    }
    // A closed lesson is final: its attendance is no longer taken, only
    // corrected through the audited adjustment flow (PATCH /api/attendance/:id).
    if (session.status === "COMPLETED") {
      throw new BusinessRuleError("This lesson is already closed for attendance.", { code: "SESSION_COMPLETED" });
    }
    if (session.planId !== null && session.status !== "OPEN") {
      throw new BusinessRuleError("This lesson is not open. Open the lesson before recording attendance.", {
        code: "LESSON_NOT_OPEN"
      });
    }

    const student = await db.student.findFirst({
      where: { id: input.studentId, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, fullName: true, branchId: true, groupId: true }
    });
    if (!student) throw new BusinessRuleError("Student not found.", { status: 404 });
    resolveBranchScope(ctx, student.branchId);

    const duplicate = await db.attendance.findFirst({
      where: { sessionId: session.id, studentId: student.id, deletedAt: null }
    });
    if (duplicate) {
      throw new BusinessRuleError("Attendance for this student in this session is already recorded.", {
        code: "DUPLICATE"
      });
    }

    // A manual MAKE_UP entry still needs the approval permission.
    if (input.type === "MAKE_UP" && !ctx.permissions.has("attendance.makeup.approve")) {
      throw new BusinessRuleError("You are not allowed to authorise make-up attendance.", {
        status: 403
      });
    }

    // Same group-validation rule as barcode scanning (spec §11): a
    // student outside the session's group can only be marked via
    // MAKE_UP, never REGULAR/LATE.
    if (["REGULAR", "LATE"].includes(input.type) && student.groupId !== session.group.id) {
      throw new BusinessRuleError(
        "This student belongs to another group. Use make-up attendance instead.",
        { code: "DIFFERENT_GROUP" }
      );
    }

    const attendance = await db.attendance.create({
      data: {
        organizationId: ctx.organizationId,
        branchId: session.branchId,
        sessionId: session.id,
        studentId: student.id,
        groupId: session.group.id,
        type: input.type,
        operatorUserId: ctx.userId,
        notes: input.notes,
        makeUpReason: input.type === "MAKE_UP" ? input.makeUpReason : undefined,
        makeUpApprovedBy: input.type === "MAKE_UP" ? ctx.userId : undefined,
        originGroupId: input.type === "MAKE_UP" ? student.groupId : undefined
      }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "RECORD_ATTENDANCE_MANUAL",
      entityType: "Attendance",
      entityId: attendance.id,
      afterValue: attendance,
      reason: input.notes
    });

    if (input.type === "ABSENT") {
      await dispatchEvent({
        organizationId: ctx.organizationId,
        event: "STUDENT_ABSENT",
        studentId: student.id,
        title: "Absence recorded",
        actorUserId: ctx.userId,
        variables: {
          student_name: student.fullName,
          group_name: session.group.name,
          date: session.date.toISOString().slice(0, 10)
        }
      }).catch((err) => console.error("[attendance.create] notify failed", err));
    }

    return created(attendance);
  } catch (err) {
    return handleApiError("attendance.create", err);
  }
}
