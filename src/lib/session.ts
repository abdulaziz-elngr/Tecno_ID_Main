import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { createHash, randomBytes } from "crypto";
import { db } from "./db";
import { TtlCache } from "./ttl-cache";

/**
 * Session strategy: a signed, HTTP-only, SameSite=lax cookie holding a
 * long-lived JWT, backed by a server-side Session row (the "control"
 * layer). This gives us:
 *   - Real revocation ("log out everywhere" / manual logout invalidates
 *     the DB row, which is checked on every request)
 *   - A SLIDING idle window: every time the user is active the row's
 *     expiry is pushed forward, so someone who keeps using the system is
 *     never logged out. They are only signed out after SESSION_IDLE_DAYS
 *     (default 90) with no activity at all, or when they log out themselves.
 *
 * The JWT/cookie lifetime is deliberately much longer than the idle window
 * so the cookie itself never expires first — the DB row is the real gate.
 */

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "tecnoid_session";
const DAY_MS = 24 * 60 * 60 * 1000;
/** Days of total inactivity before a session is dropped (sliding window). */
const IDLE_DAYS = Number(process.env.SESSION_IDLE_DAYS || 90);
/** Lifetime of the signed cookie / JWT. Kept far above IDLE_DAYS on purpose. */
const COOKIE_DAYS = Math.max(Number(process.env.SESSION_COOKIE_DAYS || 365), IDLE_DAYS);
/** Don't hit the DB to extend the window more often than this. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * The session row is checked on every request. Cache it for a few seconds so a
 * burst of calls (scanner, search-as-you-type) costs one DB read, not one per call.
 * Logout / revoke clear the entry, so revocation is immediate on this instance and
 * at most SESSION_CACHE_MS late on any other.
 */
const SESSION_CACHE_MS = 15 * 1000;
type SessionRow = NonNullable<Awaited<ReturnType<typeof db.session.findUnique>>>;
const sessionRowCache = new TtlCache<SessionRow>(SESSION_CACHE_MS, 2000);

function getSecretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "AUTH_SECRET is missing or too short. Set a strong random value in .env"
    );
  }
  return new TextEncoder().encode(secret);
}

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export interface SessionPayload {
  sub: string; // userId
  sid: string; // session row id
  org: string; // organizationId
}

export async function createSession(params: {
  userId: string;
  organizationId: string;
  userAgent?: string;
  ipAddress?: string;
}): Promise<string> {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + IDLE_DAYS * DAY_MS);

  const session = await db.session.create({
    data: {
      userId: params.userId,
      tokenHash,
      userAgent: params.userAgent,
      ipAddress: params.ipAddress,
      expiresAt
    }
  });

  const jwt = await new SignJWT({
    sub: params.userId,
    sid: session.id,
    org: params.organizationId
  } satisfies SessionPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${COOKIE_DAYS}d`)
    .sign(getSecretKey());

  cookies().set(COOKIE_NAME, jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // "lax" (not "strict"): strict drops the cookie on any link opened from
    // another app (WhatsApp, email, a bookmark in another browser tab…),
    // which made phones look logged-out. Lax still blocks cross-site POSTs.
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_DAYS * 24 * 60 * 60
  });

  return jwt;
}

/** Step 1 — CPU only (no database): is the cookie a validly signed, unexpired JWT? */
export async function verifySessionCookie(): Promise<SessionPayload | null> {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * Step 2 — is the backing session row still valid (not revoked / expired)?
 * Also slides the idle window forward (throttled).
 */
export async function validateSessionRow(parsed: SessionPayload): Promise<boolean> {
  try {
    const session =
      sessionRowCache.get(parsed.sid) ??
      (await db.session.findUnique({ where: { id: parsed.sid } }));
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      sessionRowCache.delete(parsed.sid);
      return false;
    }
    sessionRowCache.set(parsed.sid, session);

    // Sliding window: record activity and push the expiry forward. Throttled
    // so a burst of API calls doesn't turn into a burst of DB writes.
    const now = new Date();
    if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      const touched = await db.session.update({
        where: { id: session.id },
        data: { lastSeenAt: now, expiresAt: new Date(now.getTime() + IDLE_DAYS * DAY_MS) }
      });
      sessionRowCache.set(session.id, touched);
    }
    return true;
  } catch {
    return false;
  }
}

export async function getSessionPayload(): Promise<SessionPayload | null> {
  const parsed = await verifySessionCookie();
  if (!parsed) return null;
  return (await validateSessionRow(parsed)) ? parsed : null;
}

export async function destroySession(): Promise<void> {
  const payload = await getSessionPayload();
  if (payload) {
    sessionRowCache.delete(payload.sid);
    await db.session.update({
      where: { id: payload.sid },
      data: { revokedAt: new Date() }
    });
  }
  cookies().delete(COOKIE_NAME);
}

export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  sessionRowCache.clear();
  await db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() }
  });
}
