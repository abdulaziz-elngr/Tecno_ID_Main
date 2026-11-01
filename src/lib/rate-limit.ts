/**
 * Simple fixed-window rate limiter.
 *
 * NOTE: This in-memory implementation is per-process. It works for a
 * single-instance dev/staging deployment. For production with more
 * than one app instance, replace the store below with Redis (the
 * REDIS_URL is already provisioned in .env.example) so limits are
 * shared across instances — see docs/ARCHITECTURE.md.
 */

interface Bucket {
  count: number;
  windowStart: number;
  windowMs: number;
}

const buckets = new Map<string, Bucket>();

/** Remove expired buckets so the Map can't grow forever. */
function cleanup(now: number): void {
  if (buckets.size < 5000) return;
  buckets.forEach((b, key) => {
    if (now - b.windowStart > b.windowMs) buckets.delete(key);
  });
}

/** Counts one attempt against `key` and says whether it is still allowed. */
export function checkRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number
): { allowed: boolean; remaining: number } {
  const now = Date.now();
  cleanup(now);
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart > windowMs) {
    buckets.set(key, { count: 1, windowStart: now, windowMs });
    return { allowed: true, remaining: maxAttempts - 1 };
  }

  if (bucket.count >= maxAttempts) {
    return { allowed: false, remaining: 0 };
  }

  bucket.count += 1;
  return { allowed: true, remaining: maxAttempts - bucket.count };
}

/** Clears the counter for `key` (e.g. after a successful login). */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}
