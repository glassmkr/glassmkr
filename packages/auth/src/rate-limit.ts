export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

const buckets = new Map<string, number[]>();

export function takeRateLimitHit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const windowStart = now - windowMs;
  const activeHits = (buckets.get(key) || []).filter((ts) => ts > windowStart);

  if (activeHits.length >= limit) {
    const oldestHit = activeHits[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((oldestHit + windowMs - now) / 1000));
    buckets.set(key, activeHits);
    return { allowed: false, limit, remaining: 0, retryAfterSeconds };
  }

  activeHits.push(now);
  buckets.set(key, activeHits);
  return { allowed: true, limit, remaining: Math.max(0, limit - activeHits.length), retryAfterSeconds: 0 };
}
