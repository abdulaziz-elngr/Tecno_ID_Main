import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope, ForbiddenError, UnauthorizedError } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { upsertParentForOrg } from "@/lib/scope";
import { toAsciiDigits } from "@/lib/wa-link";

/**
 * Parent is intentionally NOT organizationId-scoped in the schema:
 * the same phone number (unique) may be a guardian for children at
 * different centers (e.g. siblings enrolled at two different
 * TecnoID-run centers under different organizations). Visibility and
 * write access are therefore enforced through the parent's *linked
 * students*, which ARE organization/branch scoped — never by trusting
 * a parentId's ownership directly.
 */

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  branchId: z.string().uuid().optional(),
  /** Only parents with at least one (non-deleted) student in this group. */
  groupId: z.string().uuid().optional()
});

const createParentSchema = z.object({
  studentId: z.string().uuid(),
  fullName: z.string().trim().min(2).max(200),
  phone: z.string().trim().min(6).max(30),
  whatsappNumber: z.string().trim().max(30).optional(),
  relationship: z.string().trim().min(2).max(50),
  preferredLanguage: z.enum(["ar", "en"]).default("ar"),
  isPrimary: z.boolean().default(true)
});

function handleKnownErrors(err: unknown) {
  if (err instanceof UnauthorizedError) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  console.error("[parents] internal error", err);
  return NextResponse.json(
    { error: "Something went wrong. Please try again." },
    { status: 500 }
  );
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("parents.view");
    const url = new URL(request.url);
    const parsed = listQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query parameters." }, { status: 400 });
    }
    const { page, pageSize, search, branchId, groupId } = parsed.data;
    const branchIds = resolveBranchScope(ctx, branchId);

    const studentScope = {
      organizationId: ctx.organizationId,
      deletedAt: null,
      ...(branchIds ? { branchId: { in: branchIds } } : {})
    };

    // The group filter narrows the parent's *linked students*, which are already
    // restricted to this organization/branch scope + not deleted, so a groupId of
    // another organization simply matches nothing. It ANDs with the search below.
    const filterScope = { ...studentScope, ...(groupId ? { groupId } : {}) };

    // Phones may be typed with Arabic-Indic digits; stored numbers are ASCII.
    const searchDigits = search ? toAsciiDigits(search) : undefined;

    const where = {
      students: { some: { student: filterScope } },
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: "insensitive" as const } },
              { phone: { contains: searchDigits ?? search } }
            ]
          }
        : {})
    };

    const [total, parents] = await Promise.all([
      db.parent.count({ where }),
      db.parent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          fullName: true,
          phone: true,
          whatsappNumber: true,
          preferredLanguage: true,
          students: {
            where: { student: studentScope },
            select: { relationship: true, student: { select: { id: true, fullName: true, studentCode: true } } }
          }
        }
      })
    ]);

    return NextResponse.json({
      data: parents,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
    });
  } catch (err) {
    return handleKnownErrors(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("parents.create");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const parsed = createParentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid parent data.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const input = parsed.data;

    // Verify the target student is within this user's org/branch scope
    // before linking anything — prevents linking a parent to a student
    // the caller shouldn't even be able to see.
    const branchIds = ctx.isOrgWide ? undefined : ctx.branchIds;
    const student = await db.student.findFirst({
      where: {
        id: input.studentId,
        organizationId: ctx.organizationId,
        deletedAt: null,
        ...(branchIds ? { branchId: { in: branchIds } } : {})
      }
    });
    if (!student) {
      return NextResponse.json({ error: "Invalid student." }, { status: 400 });
    }

    // Reuse an existing Parent by phone (siblings often share a guardian).
    // A parent that already belongs to another organization is linked but
    // never modified (see src/lib/scope.ts).
    const parent = await upsertParentForOrg(db, ctx.organizationId, {
      phone: input.phone,
      fullName: input.fullName,
      whatsappNumber: input.whatsappNumber,
      preferredLanguage: input.preferredLanguage
    });

    const link = await db.studentParent.upsert({
      where: { studentId_parentId: { studentId: student.id, parentId: parent.id } },
      update: { relationship: input.relationship, isPrimary: input.isPrimary },
      create: {
        studentId: student.id,
        parentId: parent.id,
        relationship: input.relationship,
        isPrimary: input.isPrimary
      }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "LINK_PARENT_TO_STUDENT",
      entityType: "StudentParent",
      entityId: link.id,
      afterValue: { parent, link }
    });

    return NextResponse.json({ data: { parent, link } }, { status: 201 });
  } catch (err) {
    return handleKnownErrors(err);
  }
}
