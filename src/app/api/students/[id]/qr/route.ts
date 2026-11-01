import { type NextRequest } from "next/server";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { groupIdFilter, resolveOwnGroupIds } from "@/lib/group-access";
import { handleApiError, NotFoundError } from "@/lib/api";

/**
 * Renders the student's QR payload as an SVG (spec §9).
 *
 * The QR is generated server-side and returned only to authenticated,
 * authorised staff — student codes are never exposed through a public
 * URL (spec §62).
 */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("students.view");

    const ownGroupIds = await resolveOwnGroupIds(ctx);
    const student = await db.student.findFirst({
      where: {
        id: params.id,
        organizationId: ctx.organizationId,
        deletedAt: null,
        ...(ctx.isOrgWide ? {} : { branchId: { in: ctx.branchIds } }),
        ...groupIdFilter(ownGroupIds)
      },
      select: { qrCode: true }
    });
    if (!student) throw new NotFoundError("Student not found.");

    const svg = await QRCode.toString(student.qrCode, {
      type: "svg",
      margin: 1,
      width: 320,
      errorCorrectionLevel: "M",
      color: { dark: "#0D0D0D", light: "#FFFFFF" }
    });

    return new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "private, max-age=3600"
      }
    });
  } catch (err) {
    return handleApiError("students.qr", err);
  }
}
