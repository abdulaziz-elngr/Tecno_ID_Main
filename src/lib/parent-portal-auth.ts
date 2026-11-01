import { SignJWT, jwtVerify } from "jose";
import { toAsciiDigits } from "./wa-link";

/**
 * Parent portal authentication (public link for guardians).
 *
 * Deliberately separate from the staff session system:
 *  - its own cookie and its own JWT audience, so a parent token can NEVER be
 *    accepted by a staff API (and vice-versa);
 *  - the token only carries the student id — no staff permissions exist here;
 *  - the portal is READ-ONLY.
 *
 * Pure helpers (no database access) so they can be unit-tested.
 */

export const PARENT_COOKIE_NAME = process.env.PARENT_COOKIE_NAME || "tecnoid_parent";
export const PARENT_AUDIENCE = "tecnoid-parent-portal";
const TOKEN_HOURS = Number(process.env.PARENT_PORTAL_SESSION_HOURS || 6);
export const PARENT_TOKEN_SECONDS = Math.max(1, TOKEN_HOURS) * 60 * 60;

/** Portal on by default; set PARENT_PORTAL_ENABLED=false to switch the link off. */
export function isParentPortalEnabled(): boolean {
  return (process.env.PARENT_PORTAL_ENABLED ?? "true").toLowerCase() !== "false";
}

function secretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("AUTH_SECRET is missing or too short. Set a strong random value in .env");
  }
  return new TextEncoder().encode(secret);
}

/** "  ٢٦٠٠٠١ " -> "260001", "std-ab12" -> "STD-AB12". */
export function normalizeStudentCodeInput(raw: string): string {
  return toAsciiDigits(raw).trim().replace(/\s+/g, "").toUpperCase();
}

export async function signParentToken(studentId: string): Promise<string> {
  return new SignJWT({ sid: studentId })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(PARENT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${PARENT_TOKEN_SECONDS}s`)
    .sign(secretKey());
}

/** Returns the student id carried by a valid parent token, or null. */
export async function verifyParentToken(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { audience: PARENT_AUDIENCE });
    return typeof payload.sid === "string" ? payload.sid : null;
  } catch {
    return null;
  }
}
