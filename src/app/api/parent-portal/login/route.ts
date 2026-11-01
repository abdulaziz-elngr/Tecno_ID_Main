import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  PARENT_COOKIE_NAME,
  PARENT_TOKEN_SECONDS,
  isParentPortalEnabled,
  normalizeStudentCodeInput,
  signParentToken
} from "@/lib/parent-portal-auth";

const schema = z.object({
  studentCode: z.string().min(1).max(40)
});

const WINDOW_MS = 15 * 60 * 1000;
const GENERIC_ERROR = "رقم الـ ID غير صحيح. راجع الرقم المكتوب على كارت الطالب.";

export async function POST(request: NextRequest) {
  if (!isParentPortalEnabled()) {
    return NextResponse.json({ error: "الخدمة غير متاحة حاليًا." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "طلب غير صالح." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "من فضلك اكتب رقم الـ ID." }, { status: 400 });
  }

  const code = normalizeStudentCodeInput(parsed.data.studentCode);

  // Throttle guessing of IDs: per IP.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ipLimit = checkRateLimit(`parent:ip:${ip}`, 20, WINDOW_MS);
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: "محاولات كتير. حاول مرة تانية بعد شوية." }, { status: 429 });
  }

  try {
    const student = await db.student.findFirst({
      where: { OR: [{ studentCode: code }, { qrCode: code }], deletedAt: null },
      select: { id: true }
    });

    if (!student) {
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
    }

    const token = await signParentToken(student.id);
    const res = NextResponse.json({ success: true });
    res.cookies.set(PARENT_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: PARENT_TOKEN_SECONDS
    });
    return res;
  } catch (err) {
    console.error("[parent-portal/login] internal error", err);
    return NextResponse.json({ error: "حصلت مشكلة. حاول مرة تانية." }, { status: 500 });
  }
}
