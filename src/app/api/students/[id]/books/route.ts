import { type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { NotFoundError, handleApiError, ok } from "@/lib/api";
import { round2 } from "@/lib/billing";
import { ensureStudentItems, serializeBookItem } from "@/lib/books";

/** A student's book / notes reservations (shown on his profile). */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("books.view");
    const student = await db.student.findFirst({
      where: { id: params.id, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, organizationId: true, groupId: true, status: true, branchId: true }
    });
    if (!student) throw new NotFoundError("Student not found.");
    resolveBranchScope(ctx, student.branchId);
    await ensureStudentItems(student);

    const rows = await db.bookReservationItem.findMany({
      where: { studentId: student.id, reservation: { status: { not: "CANCELLED" } } },
      orderBy: { createdAt: "desc" },
      include: { reservation: true }
    });
    const items = rows.map((r) => serializeBookItem(r, r.reservation));
    return ok({
      items,
      totalRemaining: round2(items.reduce((s, i) => s + (i.reservationStatus === "OPEN" ? i.remaining : 0), 0))
    });
  } catch (err) {
    return handleApiError("students.books", err);
  }
}
