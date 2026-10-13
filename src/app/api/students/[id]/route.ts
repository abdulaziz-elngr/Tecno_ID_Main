import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, ForbiddenError, UnauthorizedError } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import {
  GuardianInputError,
  applyGuardianUpdate,
  parentWhatsappSchema,
  toStoredWhatsappNumber
} from "@/lib/student-parent";

/**
 * Optional free-text column that can be cleared: the edit form sends ""
 * (or null) to blank a field, which is stored as NULL rather than "".
 */
const clearableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => (value === "" ? null : value));

const updateStudentSchema = z.object({
  fullName: z.string().trim().min(2).max(200).optional(),
  gender: z.enum(["MALE", "FEMALE"]).optional(),
  phone: clearableText(30),
  address: clearableText(500),
  school: clearableText(200),
  groupId: z.string().uuid().optional(),
  notes: clearableText(2000),
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED", "GRADUATED"]).optional(),
  emergencyContact: clearableText(200),
  overrideCapacity: z.boolean().optional(),
  // Guardian fields (same validation as student creation).
  parentName: z.string().trim().min(1).max(200).optional(),
  /** Only used when the student has no guardian yet. */
  parentPhone: z.string().trim().min(3).max(30).optional(),
  parentWhatsappNumber: parentWhatsappSchema.optional()
});

function handleKnownErrors(err: unknown) {
  if (err instanceof UnauthorizedError) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof GuardianInputError) {
    return NextResponse.json(
      { error: err.message, details: { fieldErrors: { [err.field]: [err.message] } } },
      { status: 400 }
    );
  }
  console.error("[students/:id] internal error", err);
  return NextResponse.json(
    { error: "Something went wrong. Please try again." },
    { status: 500 }
  );
}

function scopeWhere(organizationId: string, branchIds: string[] | undefined, id: string) {
  return {
    id,
    organizationId,
    deletedAt: null,
    ...(branchIds ? { branchId: { in: branchIds } } : {})
  };
}

async function findScopedStudent(organizationId: string, branchIds: string[] | undefined, id: string) {
  return db.student.findFirst({ where: scopeWhere(organizationId, branchIds, id) });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const ctx = await requirePermission("students.view");
    const branchIds = ctx.isOrgWide ? undefined : ctx.branchIds;

    // Includes the primary guardian so the edit form can be pre-filled.
    const student = await db.student.findFirst({
      where: scopeWhere(ctx.organizationId, branchIds, params.id),
      include: {
        parents: {
          orderBy: { isPrimary: "desc" },
          select: {
            relationship: true,
            isPrimary: true,
            parent: { select: { id: true, fullName: true, phone: true, whatsappNumber: true } }
          }
        }
      }
    });
    if (!student) {
      return NextResponse.json({ error: "Student not found." }, { status: 404 });
    }

    return NextResponse.json({ data: student });
  } catch (err) {
    return handleKnownErrors(err);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const ctx = await requirePermission("students.update");
    const branchIds = ctx.isOrgWide ? undefined : ctx.branchIds;

    const existing = await findScopedStudent(ctx.organizationId, branchIds, params.id);
    if (!existing) {
      return NextResponse.json({ error: "Student not found." }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const parsed = updateStudentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid student data.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // studentCode / qrCode are deliberately absent from the schema: the
    // barcode is issued once at enrollment and never changes on edit.
    const { overrideCapacity, groupId, parentName, parentPhone, parentWhatsappNumber, ...rest } = parsed.data;

    let groupUpdate: { groupId: string; gradeId: string; stageId: string } | null = null;
    if (groupId && groupId !== existing.groupId) {
      // Transferring a student to another group: re-validate the full
      // Stage -> Grade -> Group chain and capacity, exactly like at
      // creation time — never trust the client's grade/stage.
      // The target group must be in THIS organization and in the student's
      // own branch (same invariant as creation) — a client-supplied groupId
      // is never trusted on its own.
      const group = await db.group.findFirst({
        where: {
          id: groupId,
          deletedAt: null,
          branchId: existing.branchId,
          branch: { center: { organizationId: ctx.organizationId } }
        },
        include: {
          grade: { include: { stage: true } },
          _count: { select: { students: { where: { deletedAt: null, status: "ACTIVE" } } } }
        }
      });
      if (!group) {
        return NextResponse.json({ error: "Invalid group." }, { status: 400 });
      }
      if (!group.isActive || !group.grade.isActive || !group.grade.stage.isActive) {
        return NextResponse.json({ error: "Cannot move into an inactive group/grade/stage." }, { status: 400 });
      }
      if (group._count.students >= group.capacity && !overrideCapacity) {
        return NextResponse.json(
          {
            error: "This group has reached its maximum capacity.",
            details: { code: "CAPACITY_FULL", capacity: group.capacity, currentCount: group._count.students }
          },
          { status: 409 }
        );
      }
      groupUpdate = { groupId: group.id, gradeId: group.gradeId, stageId: group.grade.stageId };
    }

    const hasGuardianInput =
      parentName !== undefined || parentPhone !== undefined || parentWhatsappNumber !== undefined;

    // Student + guardian change together or not at all.
    const { updated, guardian } = await db.$transaction(async (tx) => {
      const updatedStudent = await tx.student.update({
        where: { id: existing.id },
        data: { ...rest, ...(groupUpdate ?? {}) }
      });
      const guardianChange = hasGuardianInput
        ? await applyGuardianUpdate(tx, ctx.organizationId, existing.id, {
            fullName: parentName,
            phone: parentPhone,
            whatsappNumber: parentWhatsappNumber ? toStoredWhatsappNumber(parentWhatsappNumber) : undefined
          })
        : null;
      return { updated: updatedStudent, guardian: guardianChange };
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "UPDATE_STUDENT",
      entityType: "Student",
      entityId: updated.id,
      beforeValue: guardian ? { ...existing, guardian: guardian.before } : existing,
      afterValue: guardian ? { ...updated, guardian: guardian.after } : updated
    });

    return NextResponse.json({ data: updated });
  } catch (err) {
    return handleKnownErrors(err);
  }
}

/**
 * DELETE is a SOFT delete, by design and by schema.
 *
 * A Student is referenced (foreign keys) by Attendance, ExamResult,
 * Recitation, AssignmentSubmission, Subscription, Payment, Invoice and
 * StudentParent. A hard delete would either fail with a foreign-key error
 * or — worse, with cascades — destroy attendance, grades and financial
 * records, which the system must keep (Rule 6 / §43). So the row stays,
 * stamped with `deletedAt`, and:
 *   - every list/search/scan query already filters `deletedAt: null`, so the
 *     student disappears from the UI, group counts and attendance scanning;
 *   - history (attendance, exams, payments, invoices) remains intact;
 *   - the barcode stays reserved, so it can never be re-issued;
 *   - a reason is mandatory and the change is written to the audit log.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const ctx = await requirePermission("students.delete");
    const branchIds = ctx.isOrgWide ? undefined : ctx.branchIds;

    const existing = await findScopedStudent(ctx.organizationId, branchIds, params.id);
    if (!existing) {
      return NextResponse.json({ error: "Student not found." }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const reason = z.object({ reason: z.string().trim().min(3).max(500) }).safeParse(body);
    if (!reason.success) {
      return NextResponse.json(
        { error: "A reason is required to delete a student record." },
        { status: 400 }
      );
    }

    // Soft delete only — student history (attendance, payments, grades
    // in later phases) must be preserved. See Rule 6 / §43.
    const deleted = await db.student.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), status: "INACTIVE" }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "DELETE_STUDENT",
      entityType: "Student",
      entityId: deleted.id,
      beforeValue: existing,
      afterValue: deleted,
      reason: reason.data.reason
    });

    return NextResponse.json({ data: deleted });
  } catch (err) {
    return handleKnownErrors(err);
  }
}
