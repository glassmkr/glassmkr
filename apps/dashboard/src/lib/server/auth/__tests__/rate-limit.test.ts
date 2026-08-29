// Tests for the Redis-backed token bucket.
//
// Strategy: stub `getRedis()` with a tiny in-memory implementation that
// supports the EVALSHA + SCRIPT LOAD + HMGET/HMSET/EXPIRE shape. Lets us
// verify the Lua-script behaviour without spinning up a real Redis.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  take,
  resetRateLimitScriptCacheForTests,
  TIER_PER_IP,
  TIER_PER_KEY,
  TIER_KEY_ROTATE,
  type RateLimitConfig,
} from "../rate-limit.js";
import { setRedisForTests } from "../../redis.js";

// ---------------------------------------------------------------------------
// In-memory Redis stand-in implementing the subset of commands the
// rate-limit module uses.
// ---------------------------------------------------------------------------

class FakeRedis {
  hashes = new Map<string, Map<string, string>>();
  scripts = new Map<string, string>();
  scriptCounter = 0;
  /** When set, every Redis call rejects with this error. Used to test the
   *  degrade-open path. */
  shouldFail: Error | null = null;

  async script(_cmd: "LOAD", body: string): Promise<string> {
    if (this.shouldFail) throw this.shouldFail;
    const sha = `sha-${++this.scriptCounter}`;
    this.scripts.set(sha, body);
    return sha;
  }

  async evalsha(sha: string, _numkeys: number, key: string, ...args: string[]): Promise<unknown> {
    if (this.shouldFail) throw this.shouldFail;
    if (!this.scripts.has(sha)) throw new Error("NOSCRIPT");
    return this.runTakeScript(key, Number(args[0]), Number(args[1]), Number(args[2]));
  }

  /** Re-implements the take Lua script in JS so behaviour is verifiable. */
  private runTakeScript(
    key: string,
    capacity: number,
    refill: number,
    now: number,
  ): [number, number, number] {
    const state = this.hashes.get(key);
    let tokens = state ? Number(state.get("tokens")) : NaN;
    let ts = state ? Number(state.get("ts")) : NaN;
    if (Number.isNaN(tokens)) {
      tokens = capacity;
      ts = now;
    }
    const elapsedS = (now - ts) / 1000;
    if (elapsedS > 0) tokens = Math.min(capacity, tokens + elapsedS * refill);

    let allowed: 0 | 1;
    let retryAfterMs: number;
    if (tokens >= 1) {
      tokens -= 1;
      allowed = 1;
      retryAfterMs = 0;
    } else {
      allowed = 0;
      retryAfterMs = Math.ceil(((1 - tokens) / refill) * 1000);
    }

    const next = new Map<string, string>([
      ["tokens", String(tokens)],
      ["ts", String(now)],
    ]);
    this.hashes.set(key, next);
    return [allowed, Number(tokens.toFixed(4)), retryAfterMs];
  }

  on(_event: string, _handler: (err: Error) => void): void {
    // ignore
  }
}

let fake: FakeRedis;

beforeEach(() => {
  fake = new FakeRedis();
  // ioredis types are too strict for the stub; cast to the runtime shape.
  setRedisForTests(fake as unknown as import("ioredis").default);
  resetRateLimitScriptCacheForTests();
});

afterEach(() => {
  setRedisForTests(null);
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------

describe("take: basic semantics", () => {
  it("allows requests up to capacity, then blocks", async () => {
    const cfg: RateLimitConfig = { namespace: "test", capacity: 3, refillPerSecond: 0.001 };
    const id = "user-1";
    expect((await take(cfg, id)).allowed).toBe(true);
    expect((await take(cfg, id)).allowed).toBe(true);
    expect((await take(cfg, id)).allowed).toBe(true);
    const blocked = await take(cfg, id);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("isolates buckets by identifier", async () => {
    const cfg: RateLimitConfig = { namespace: "test", capacity: 1, refillPerSecond: 0.001 };
    expect((await take(cfg, "a")).allowed).toBe(true);
    expect((await take(cfg, "b")).allowed).toBe(true);
    expect((await take(cfg, "a")).allowed).toBe(false);
    expect((await take(cfg, "b")).allowed).toBe(false);
  });

  it("isolates buckets by namespace", async () => {
    const a: RateLimitConfig = { namespace: "ns-a", capacity: 1, refillPerSecond: 0.001 };
    const b: RateLimitConfig = { namespace: "ns-b", capacity: 1, refillPerSecond: 0.001 };
    expect((await take(a, "x")).allowed).toBe(true);
    expect((await take(b, "x")).allowed).toBe(true);
  });

  it("refills proportionally to elapsed time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const cfg: RateLimitConfig = { namespace: "refill", capacity: 1, refillPerSecond: 1 };
    expect((await take(cfg, "x")).allowed).toBe(true);
    expect((await take(cfg, "x")).allowed).toBe(false);
    vi.setSystemTime(1100); // 1.1s later -> 1.1 tokens accrued, capped at capacity=1
    expect((await take(cfg, "x")).allowed).toBe(true);
  });

  it("retryAfterSeconds is set when blocked", async () => {
    const cfg: RateLimitConfig = { namespace: "ra", capacity: 1, refillPerSecond: 1 };
    expect((await take(cfg, "x")).allowed).toBe(true);
    const r = await take(cfg, "x");
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});

describe("take: degraded-open on Redis failure", () => {
  it("returns allowed=true, degraded=true when Redis throws", async () => {
    fake.shouldFail = new Error("Connection refused");
    const cfg: RateLimitConfig = { namespace: "down", capacity: 1, refillPerSecond: 1 };
    const r = await take(cfg, "x");
    expect(r.allowed).toBe(true);
    expect(r.degraded).toBe(true);
  });

  it("returns degraded result when Redis is disabled at config level", async () => {
    setRedisForTests(null);
    // Force config.redis.disabled by mutating env. Cleaner alternative: a
    // mock for getRedis(). Use the singleton-cleared path which is the
    // production REDIS_DISABLED behaviour (getRedis returns null).
    const cfg: RateLimitConfig = { namespace: "noredis", capacity: 1, refillPerSecond: 1 };
    const r = await take(cfg, "x");
    expect(r.degraded).toBe(true);
    expect(r.allowed).toBe(true);
  });
});

describe("default tier configs", () => {
  it("per-IP allows 100 burst then refills at 10/s", () => {
    expect(TIER_PER_IP.capacity).toBe(100);
    expect(TIER_PER_IP.refillPerSecond).toBe(10);
  });

  it("per-key allows 1000 burst then refills at 100/s", () => {
    expect(TIER_PER_KEY.capacity).toBe(1000);
    expect(TIER_PER_KEY.refillPerSecond).toBe(100);
  });

  it("rotate-key is the strictest at 10 per hour", () => {
    expect(TIER_KEY_ROTATE.capacity).toBe(10);
    expect(TIER_KEY_ROTATE.refillPerSecond).toBeCloseTo(10 / 3600);
  });
});
