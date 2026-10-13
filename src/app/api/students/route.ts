import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope, ForbiddenError, UnauthorizedError } from "@/lib/rbac";
import { generateStudentCode, isStudentCodeConflict } from "@/lib/student-code";
import { writeAuditLog } from "@/lib/audit";
import {
  GuardianInputError,
  isParentPhoneConflict,
  parentWhatsappSchema,
  toStoredWhatsappNumber,
  upsertGuardian
} from "@/lib/student-parent";

/** How many times a create is retried when another enrollment grabs the same barcode first. */
const MAX_CODE_ATTEMPTS = 5;

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  branchId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  gradeId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED", "GRADUATED"]).optional()
});

const createStudentSchema = z.object({
  branchId: z.string().uuid(),
  groupId: z.string().uuid(),
  fullName: z.string().trim().min(2).max(200),
  gender: z.enum(["MALE", "FEMALE"]),
  dateOfBirth: z.string().datetime().optional(),
  phone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(500).optional(),
  school: z.string().trim().max(200).optional(),
  parentName: z.string().trim().min(1).max(200).optional(),
  /** Guardian's contact phone. Optional: defaults to the WhatsApp number. */
  parentPhone: z.string().trim().min(3).max(30).optional(),
  /** REQUIRED — the guardian's WhatsApp number (validated here, not just in the form). */
  parentWhatsappNumber: parentWhatsappSchema,
  notes: z.string().trim().max(2000).optional(),
  emergencyContact: z.string().trim().max(200).optional(),
  /** Explicit administrator override to enroll past a full group's capacity (spec §3). */
  overrideCapacity: z.boolean().optional()
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
  console.error("[students] internal error", err);
  return NextResponse.json(
    { error: "Something went wrong. Please try again." },
    { status: 500 }
  );
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("students.view");

    const url = new URL(request.url);
    const parsed = listQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query parameters." }, { status: 400 });
    }
    const { page, pageSize, search, branchId, stageId, gradeId, groupId, status } = parsed.data;

    const branchIds = resolveBranchScope(ctx, branchId);

    const where = {
      organizationId: ctx.organizationId,
      deletedAt: null,
      ...(branchIds ? { branchId: { in: branchIds } } : {}),
      ...(status ? { status } : {}),
      ...(stageId ? { stageId } : {}),
      ...(gradeId ? { gradeId } : {}),
      ...(groupId ? { groupId } : {}),
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: "insensitive" as const } },
              { studentCode: { contains: search, mode: "insensitive" as const } },
              { phone: { contains: search } },
              { parents: { some: { parent: { phone: { contains: search } } } } }
            ]
          }
        : {})
    };

    const [total, students] = await Promise.all([
      db.student.count({ where }),
      db.student.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          studentCode: true,
          fullName: true,
          photoUrl: true,
          gender: true,
          status: true,
          phone: true,
          enrollmentDate: true,
          branch: { select: { id: true, name: true } },
          stage: { select: { id: true, name: true } },
          grade: { select: { id: true, name: true } },
          group: { select: { id: true, name: true } },
          parents: {
            where: { isPrimary: true },
            take: 1,
            select: { parent: { select: { fullName: true, phone: true } } }
          }
        }
      })
    ]);

    return NextResponse.json({
      data: students,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
    });
  } catch (err) {
    return handleKnownErrors(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("students.create");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const parsed = createStudentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid student data.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const input = parsed.data;

    // Verify the target branch belongs to this org AND this user's scope
    // — never trust branchId from the client beyond that verification.
    resolveBranchScope(ctx, input.branchId);
    const branch = await db.branch.findFirst({
      where: { id: input.branchId, deletedAt: null, center: { organizationId: ctx.organizationId } }
    });
    if (!branch) {
      return NextResponse.json({ error: "Invalid branch." }, { status: 400 });
    }

    // Enforce Stage -> Grade -> Group: the group is the single source
    // of truth for where the student is enrolled; stageId/gradeId are
    // derived from it, never accepted directly from the client.
    const group = await db.group.findFirst({
      where: { id: input.groupId, branchId: input.branchId, deletedAt: null },
      include: {
        grade: { include: { stage: true } },
        _count: { select: { students: { where: { deletedAt: null, status: "ACTIVE" } } } }
      }
    });
    if (!group) {
      return NextResponse.json({ error: "Invalid group." }, { status: 400 });
    }
    if (!group.isActive || !group.grade.isActive || !group.grade.stage.isActive) {
      return NextResponse.json({ error: "Cannot enroll into an inactive group/grade/stage." }, { status: 400 });
    }

    // Rule: cannot exceed group capacity unless explicitly overridden
    // by an administrator with students.create permission.
    if (group._count.students >= group.capacity && !input.overrideCapacity) {
      return NextResponse.json(
        {
          error: "This group has reached its maximum capacity.",
          details: { code: "CAPACITY_FULL", capacity: group.capacity, currentCount: group._count.students }
        },
        { status: 409 }
      );
    }

    const whatsappNumber = toStoredWhatsappNumber(input.parentWhatsappNumber);

    // The barcode is a short numeric code (e.g. 260001). The database
    // unique constraint is the real guarantee: if two enrollments race for
    // the same number, the loser retries with the next free one.
    const createWithUniqueBarcode = async () => {
      for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
        const studentCode = await generateStudentCode(attempt);
        try {
          return await db.$transaction(async (tx) => {
            const created = await tx.student.create({
              data: {
                organizationId: ctx.organizationId,
                branchId: input.branchId,
                studentCode,
                // The printed/scanned barcode IS the student code; keeping the
                // legacy qrCode column identical means the two can never disagree.
                qrCode: studentCode,
                fullName: input.fullName,
                gender: input.gender,
                dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : undefined,
                phone: input.phone,
                address: input.address,
                school: input.school,
                stageId: group.grade.stageId,
                gradeId: group.gradeId,
                groupId: group.id,
                notes: input.notes,
                emergencyContact: input.emergencyContact
              }
            });

            // Reuses the existing Parent (matched by phone) when the guardian
            // is already registered, e.g. a sibling — never a duplicate row.
            const parent = await upsertGuardian(tx, ctx.organizationId, {
              fullName: input.parentName,
              phone: input.parentPhone,
              whatsappNumber
            });
            await tx.studentParent.create({
              data: { studentId: created.id, parentId: parent.id, relationship: "Guardian", isPrimary: true }
            });

            return created;
          });
        } catch (err) {
          const raced = isStudentCodeConflict(err) || isParentPhoneConflict(err);
          if (raced && attempt < MAX_CODE_ATTEMPTS - 1) continue;
          throw err;
        }
      }
      throw new Error("Could not generate a unique student code, please retry.");
    };

    const student = await createWithUniqueBarcode();

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "CREATE_STUDENT",
      entityType: "Student",
      entityId: student.id,
      afterValue: student
    });

    return NextResponse.json({ data: student }, { status: 201 });
  } catch (err) {
    return handleKnownErrors(err);
  }
}
