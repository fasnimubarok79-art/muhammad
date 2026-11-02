/**
 * Fixed-window in-memory limiter. Good for a single Node instance.
 * For several instances put a shared store (Redis) behind the same interface.
 */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export type RateRule = { limit: number; windowMs: number };

export const RATE = {
  auth: { limit: 10, windowMs: 15 * 60_000 },
  forgot: { limit: 5, windowMs: 60 * 60_000 },
  write: { limit: 120, windowMs: 60_000 },
  import: { limit: 20, windowMs: 60_000 },
  upload: { limit: 10, windowMs: 60_000 },
  read: { limit: 600, windowMs: 60_000 },
} satisfies Record<string, RateRule>;

export function hitRateLimit(key: string, rule: RateRule, now = Date.now()): { ok: boolean; retryAfterSec: number } {
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    if (buckets.size > 50_000) sweep(now);
    return { ok: true, retryAfterSec: 0 };
  }
  b.count += 1;
  if (b.count > rule.limit) return { ok: false, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
  return { ok: true, retryAfterSec: 0 };
}

function sweep(now: number) {
  buckets.forEach((b, k) => {
    if (b.resetAt <= now) buckets.delete(k);
  });
}

export function resetRateLimits() {
  buckets.clear();
}
