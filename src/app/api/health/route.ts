import { db } from "@/lib/db";
import { NextResponse } from "next/server";

/**
 * Health endpoint for load balancers and uptime monitors (spec §49).
 * Deliberately returns NO version numbers, hostnames or error details —
 * just up/down per dependency.
 */
export async function GET() {
  const checks: Record<string, { status: "up" | "down" | "not_configured"; latencyMs?: number }> = {};

  const startedAt = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = { status: "up", latencyMs: Date.now() - startedAt };
  } catch {
    checks.database = { status: "down" };
  }

  const redisUrl = process.env.REDIS_URL;
  checks.redis = redisUrl ? { status: "up" } : { status: "not_configured" };

  const healthy = checks.database.status === "up";

  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", checks, timestamp: new Date().toISOString() },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}
