import { db } from "./db";
import { verifyPassword } from "./password";
import { createSession, destroySession } from "./session";
import { checkRateLimit, resetRateLimit } from "./rate-limit";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

/** Strict limit: same IP + same email. */
const LOGIN_RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_LOGIN_MAX || 5);
const LOGIN_RATE_LIMIT_WINDOW_MIN = Number(
  process.env.RATE_LIMIT_LOGIN_WINDOW_MINUTES || 15
);
/**
 * Wide limit: the whole IP, across all emails. Deliberately generous because
 * many people can share one IP (center Wi-Fi, mobile-carrier CGNAT, or a
 * reverse proxy that hides the real IP). It only stops large-scale abuse.
 */
const LOGIN_IP_RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_LOGIN_IP_MAX || 100);

export interface LoginResult {
  success: boolean;
  error?: string;
}

/**
 * Authenticates a user by email + password.
 *
 * Security properties:
 *  - Generic error messages (never reveal whether the email exists)
 *  - Rate limiting per IP (wide) AND per IP+email (strict), so one person
 *    mistyping a password can't lock everyone else out of the system
 *  - Per-account lockout after repeated failures, with automatic unlock
 *  - Successful login resets the strict counter
 *  - Passwords compared via constant-time Argon2id verify
 */
export async function login(params: {
  email: string;
  password: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<LoginResult> {
  const email = params.email.trim().toLowerCase();
  const ip = params.ipAddress ?? "unknown";
  const windowMs = LOGIN_RATE_LIMIT_WINDOW_MIN * 60 * 1000;

  const pairKey = `login:ip-email:${ip}:${email}`;

  // 1) Wide limit on the IP as a whole (anti mass-abuse, not anti-typo).
  const ipCheck = checkRateLimit(`login:ip:${ip}`, LOGIN_IP_RATE_LIMIT_MAX, windowMs);
  // 2) Strict limit on this IP + this email only.
  const pairCheck = checkRateLimit(pairKey, LOGIN_RATE_LIMIT_MAX, windowMs);

  if (!ipCheck.allowed || !pairCheck.allowed) {
    return { success: false, error: "Too many attempts. Please try again later." };
  }

  const user = await db.user.findUnique({ where: { email } });
  const genericError = "Invalid email or password.";

  if (!user || !user.isActive || user.deletedAt) {
    return { success: false, error: genericError };
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return {
      success: false,
      error: "This account is temporarily locked due to repeated failed attempts."
    };
  }

  const passwordValid = await verifyPassword(user.passwordHash, params.password);

  if (!passwordValid) {
    const newFailedCount = user.failedLoginCount + 1;
    const shouldLock = newFailedCount >= MAX_FAILED_ATTEMPTS;

    await db.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: shouldLock ? 0 : newFailedCount,
        lockedUntil: shouldLock
          ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
          : user.lockedUntil
      }
    });

    return { success: false, error: genericError };
  }

  // Successful login — reset failure counters (DB + in-memory limiter).
  // The two database writes are independent, so they run at the same time
  // (one round trip of waiting instead of two).
  resetRateLimit(pairKey);
  await Promise.all([
    db.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() }
    }),
    createSession({
      userId: user.id,
      organizationId: user.organizationId,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent
    })
  ]);

  return { success: true };
}

export async function logout(): Promise<void> {
  await destroySession();
}
