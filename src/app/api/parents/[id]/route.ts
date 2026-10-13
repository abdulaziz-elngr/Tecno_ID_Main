import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, ForbiddenError, UnauthorizedError } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { isParentSharedWithOtherOrg } from "@/lib/scope";
import { parentWhatsappSchema, toStoredWhatsappNumber } from "@/lib/student-parent";

const updateParentSchema = z.object({
  fullName: z.string().trim().min(2).max(200).optional(),
  // Same rule as student enrollment: must be a valid number, stored as international digits.
  whatsappNumber: parentWhatsappSchema.optional(),
  preferredLanguage: z.enum(["ar", "en"]).optional(),
  notificationsEnabled: z.boolean().optional()
});

function handleKnownErrors(err: unknown) {
  if (err instanceof UnauthorizedError) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  console.error("[parents/:id] internal error", err);
  return NextResponse.json(
    { error: "Something went wrong. Please try again." },
    { status: 500 }
  );
}

async function findScopedParent(organizationId: string, branchIds: string[] | undefined, id: string) {
  const studentScope = {
    organizationId,
    deletedAt: null,
    ...(branchIds ? { branchId: { in: branchIds } } : {})
  };
  return db.parent.findFirst({
    where: { id, students: { some: { student: studentScope } } },
    include: {
      students: {
        where: { student: studentScope },
        select: { relationship: true, isPrimary: true, student: { select: { id: true, fullName: true, studentCode: true } } }
      }
    }
  });
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("parents.view");
    const branchIds = ctx.isOrgWide ? undefined : ctx.branchIds;
    const parent = await findScopedParent(ctx.organizationId, branchIds, params.id);
    if (!parent) {
      return NextResponse.json({ error: "Parent not found." }, { status: 404 });
    }
    return NextResponse.json({ data: parent });
  } catch (err) {
    return handleKnownErrors(err);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("parents.update");
    const branchIds = ctx.isOrgWide ? undefined : ctx.branchIds;
    const existing = await findScopedParent(ctx.organizationId, branchIds, params.id);
    if (!existing) {
      return NextResponse.json({ error: "Parent not found." }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    // `Parent.phone` is the unique identifier of the guardian (siblings and other
    // students are linked through it) — it is never editable here. Say so
    // explicitly instead of silently ignoring the field.
    if (typeof body === "object" && body !== null && "phone" in body) {
      return NextResponse.json(
        {
          error: "A parent's phone number identifies them and cannot be changed.",
          details: { fieldErrors: { phone: ["A parent's phone number cannot be changed."] } }
        },
        { status: 400 }
      );
    }

    const parsed = updateParentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid parent data.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Parent rows are global; refuse to rewrite contact data that another
    // organization's students also depend on.
    if (await isParentSharedWithOtherOrg(existing.id, ctx.organizationId)) {
      return NextResponse.json(
        { error: "This guardian is also linked to another center and cannot be edited here." },
        { status: 409 }
      );
    }

    const { whatsappNumber, ...rest } = parsed.data;
    const updated = await db.parent.update({
      where: { id: existing.id },
      data: {
        ...rest,
        ...(whatsappNumber !== undefined ? { whatsappNumber: toStoredWhatsappNumber(whatsappNumber) } : {})
      }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "UPDATE_PARENT",
      entityType: "Parent",
      entityId: updated.id,
      beforeValue: existing,
      afterValue: updated
    });

    return NextResponse.json({ data: updated });
  } catch (err) {
    return handleKnownErrors(err);
  }
}
