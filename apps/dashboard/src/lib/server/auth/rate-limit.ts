// Redis-backed token bucket rate limiter.
//
// Used by:
//   - Auth middleware (PR #2): per-IP bucket, before any DB lookup
//   - API endpoints (PR #3+): per-key and per-account buckets
//
// Algorithm: classic token bucket with continuous refill. Each call to
// `take()` debits one token, refilling proportionally to elapsed time
// since the last call. The whole read-debit-write sequence runs as a
// single Redis Lua script for atomicity; without that, two concurrent
// requests can both observe a full bucket and both pass through.
//
// Why three tiers (per-IP, per-key, per-account)?
//   - Per-IP catches brute-force on auth before the key hits the DB.
//   - Per-key catches one runaway script monopolising the API.
//   - Per-account is fairness across the customer's automation as a whole.
// All three are checked on every request; the first to fail wins.
//
// Failure mode: if Redis is unreachable, take() returns { allowed: true,
// degraded: true } instead of throwing. We prefer to fail open on rate
// limits (let the request through) over 500-ing the customer's traffic
// when our infra has a problem. The structured response signals the
// caller to log the degradation.

import type Redis from "ioredis";
import { getRedis } from "../redis.js";

export interface RateLimitConfig {
  /** Bucket capacity (max tokens). Burst size. */
  capacity: number;
  /** Tokens added per second when the bucket isn't full. */
  refillPerSecond: number;
  /** Redis key namespace; combined with `identifier`. */
  namespace: string;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Tokens left in the bucket after this call. */
  remaining: number;
  /** Seconds the caller should wait before retrying. 0 if allowed. */
  retryAfterSeconds: number;
  /** True if Redis was unavailable and we let the request through. */
  degraded: boolean;
}

// ----------------------------------------------------------------------------
// Lua script: atomic token-bucket take.
// ----------------------------------------------------------------------------
// KEYS[1]   = full Redis key (namespace + identifier)
// ARGV[1]   = capacity
// ARGV[2]   = refill_per_second
// ARGV[3]   = now_ms
//
// Returns: { allowed (1|0), remaining_tokens, retry_after_ms }
//
// Bucket state is stored as a hash with two fields:
//   tokens:  current token count (float-as-string)
//   ts:      ms timestamp of last debit
const TAKE_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local state = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(state[1])
local ts = tonumber(state[2])

if tokens == nil then
  tokens = capacity
  ts = now
end

local elapsed_s = (now - ts) / 1000
if elapsed_s > 0 then
  tokens = math.min(capacity, tokens + (elapsed_s * refill))
end

local allowed
local retry_after_ms
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
  retry_after_ms = 0
else
  allowed = 0
  -- Time until at least one token will be available.
  retry_after_ms = math.ceil((1 - tokens) / refill * 1000)
end

redis.call('HMSET', key, 'tokens', tostring(tokens), 'ts', tostring(now))
-- TTL: enough to cover capacity / refill_per_second worth of idle time,
-- with a 60s minimum and a 1-day cap. Idle keys evict naturally.
local ttl_s = math.max(60, math.min(86400, math.ceil(capacity / refill * 2)))
redis.call('EXPIRE', key, ttl_s)

return { allowed, tonumber(string.format('%.4f', tokens)), retry_after_ms }
`;

let cachedScriptSha: string | null = null;

async function loadScript(redis: Redis): Promise<string> {
  if (cachedScriptSha !== null) return cachedScriptSha;
  cachedScriptSha = (await redis.script("LOAD", TAKE_SCRIPT)) as string;
  return cachedScriptSha;
}

/**
 * Test-only: clear the cached SHA so a new mock client doesn't see a
 * stale digest.
 * @internal
 */
export function resetRateLimitScriptCacheForTests(): void {
  cachedScriptSha = null;
}

/**
 * Debit one token from the bucket identified by (namespace, identifier).
 * Refills on read based on time elapsed since the last call.
 *
 * Degrades to allowed=true on Redis errors (see module-level comment).
 */
export async function take(
  cfg: RateLimitConfig,
  identifier: string,
): Promise<RateLimitResult> {
  const redis = getRedis();
  if (redis === null) {
    return { allowed: true, remaining: cfg.capacity, retryAfterSeconds: 0, degraded: true };
  }

  const key = `rl:${cfg.namespace}:${identifier}`;
  const now = Date.now();

  try {
    const sha = await loadScript(redis);
    const result = (await redis.evalsha(
      sha,
      1,
      key,
      String(cfg.capacity),
      String(cfg.refillPerSecond),
      String(now),
    )) as [number, number, number];

    const [allowed, remaining, retryAfterMs] = result;
    return {
      allowed: allowed === 1,
      remaining: Math.max(0, Math.floor(remaining)),
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      degraded: false,
    };
  } catch (err) {
    // Most likely: NOSCRIPT after a Redis flush, or transient connection
    // hiccup. Reset the cache and degrade open. The next call will try
    // to re-load the script.
    cachedScriptSha = null;
    console.error("[rate-limit] degraded open due to Redis error:", (err as Error).message);
    return { allowed: true, remaining: cfg.capacity, retryAfterSeconds: 0, degraded: true };
  }
}

// ----------------------------------------------------------------------------
// Default tier configurations, per spec Part 5.
// ----------------------------------------------------------------------------

export const TIER_PER_IP: RateLimitConfig = {
  namespace: "ip",
  capacity: 100,
  refillPerSecond: 10,
};

export const TIER_PER_KEY: RateLimitConfig = {
  namespace: "key",
  capacity: 1000,
  refillPerSecond: 100,
};

export const TIER_PER_ACCOUNT: RateLimitConfig = {
  namespace: "acct",
  capacity: 5000,
  refillPerSecond: 500,
};

/**
 * Per-endpoint sub-limits (spec Part 5). These are enforced ON TOP of the
 * three tiers above; an endpoint hits whichever runs out first.
 */
export const TIER_SERVERS_CREATE: RateLimitConfig = {
  namespace: "ep:servers:create",
  capacity: 100,         // 100 per hour per account
  refillPerSecond: 100 / 3600,
};

export const TIER_SERVERS_DELETE: RateLimitConfig = {
  namespace: "ep:servers:delete",
  capacity: 100,
  refillPerSecond: 100 / 3600,
};

export const TIER_KEY_ROTATE: RateLimitConfig = {
  namespace: "ep:rotate-key",
  capacity: 10,          // 10 per hour per account; rotation is rare
  refillPerSecond: 10 / 3600,
};

// ---------------------------------------------------------------------------
// Launch hardening gates (round-2, 2026-08-24). Enforced in addition to the
// tiers above.
// ---------------------------------------------------------------------------

/**
 * G2: per-collector-key ingestion cap, keyed on the server id, Redis-backed
 * so it survives restarts (unlike the per-server lastIngest Map, which stays
 * as the in-process fast path). Normal cadence is one snapshot per ~300s with
 * a 55s floor; a burst of 12 with ~1/55s refill (~65/hour) is over 5x the
 * fastest legitimate agent and still nothing against ClickHouse.
 */
export const TIER_INGEST_PER_KEY: RateLimitConfig = {
  namespace: "key:ingest",
  capacity: 12,
  refillPerSecond: 1 / 55,
};

/**
 * G3: per-account budget for customer-directed outbound sends (the generic
 * webhook channel and the channel test endpoint share it). safeFetch blocks
 * private targets; this bounds VOLUME toward public targets so Glassmkr
 * cannot be driven as an attributed reflector. 120 burst, 1800/hour refill:
 * far above any legitimate fanout (sends are naturally capped by the 55s
 * ingest cadence per server), far below a useful attack rate.
 */
export const TIER_WEBHOOK_SEND: RateLimitConfig = {
  namespace: "acct:webhook",
  capacity: 120,
  refillPerSecond: 0.5,
};

/** G3: the on-demand channel test endpoint; 10 per hour per account. */
export const TIER_CHANNEL_TEST: RateLimitConfig = {
  namespace: "ep:channels:test",
  capacity: 10,
  refillPerSecond: 10 / 3600,
};

/**
 * G5: per-account budget for the ClickHouse-backed read endpoints (metrics,
 * history). These were previously behind NO limiter at all while running
 * multi-query time-range scans, so a single account could loop them and
 * starve ClickHouse for the whole fleet.
 *
 * 60 burst with 1/s refill: a human clicking through a fleet dashboard never
 * notices; a loop does within a second. Deliberately crude, per the gate.
 */
export const TIER_CH_READ: RateLimitConfig = {
  namespace: "acct:chread",
  capacity: 60,
  refillPerSecond: 1,
};

/**
 * G5: the public demo account reads the same endpoints unauthenticated-ish
 * (shared principal), so it gets a TIGHTER bucket. One shared demo cannot be
 * allowed to consume the fleet's ClickHouse headroom.
 */
export const TIER_CH_READ_DEMO: RateLimitConfig = {
  namespace: "acct:chread:demo",
  capacity: 20,
  refillPerSecond: 0.5,
};
