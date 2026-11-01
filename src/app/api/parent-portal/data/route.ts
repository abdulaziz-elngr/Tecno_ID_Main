import { NextResponse, type NextRequest } from "next/server";
import { loadParentPortalData } from "@/lib/parent-portal";
import { PARENT_COOKIE_NAME, isParentPortalEnabled, verifyParentToken } from "@/lib/parent-portal-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isParentPortalEnabled()) {
    return NextResponse.json({ error: "الخدمة غير متاحة حاليًا." }, { status: 404 });
  }
  const studentId = await verifyParentToken(request.cookies.get(PARENT_COOKIE_NAME)?.value);
  if (!studentId) {
    return NextResponse.json({ error: "انتهت الجلسة. ادخل من جديد." }, { status: 401 });
  }
  try {
    const data = await loadParentPortalData(studentId);
    if (!data) return NextResponse.json({ error: "انتهت الجلسة. ادخل من جديد." }, { status: 401 });
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[parent-portal/data] internal error", err);
    return NextResponse.json({ error: "حصلت مشكلة. حاول مرة تانية." }, { status: 500 });
  }
}
