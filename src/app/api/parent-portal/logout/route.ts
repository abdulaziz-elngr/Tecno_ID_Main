import { NextResponse } from "next/server";
import { PARENT_COOKIE_NAME } from "@/lib/parent-portal-auth";

export async function POST() {
  const res = NextResponse.json({ success: true });
  res.cookies.set(PARENT_COOKIE_NAME, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
