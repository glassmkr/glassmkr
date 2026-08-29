// Regression test for the P1.2 fix: failed-auth attempts must debit
// the per-IP token bucket. Pre-fix, requireAuth ran before
// checkRateLimits, so unauthenticated probing never burned tokens
// and brute-force was unbounded from one IP.
//
// `enforceIpRateLimit` now runs at the very top of every management
// handler, before requireAuth, regardless of auth outcome.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  resetRateLimitScriptCacheForTests,
} from "../rate-limit.js";
import { setRedisForTests } from "../../redis.js";
import { enforceIpRateLimit } from "../rate-limit-middleware.js";

class FakeRedis {
  hashes = new Map<string, Map<string, string>>();
  scripts = new Map<string, string>();
  scriptCounter = 0;
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
    const [capacityS, refillS, nowS] = args;
    const capacity = Number(capacityS);
    const refill = Number(refillS);
    const now = Number(nowS);
    const h = this.hashes.get(key) ?? new Map<string, string>();
    let tokens = h.has("tokens") ? Number(h.get("tokens")!) : capacity;
    const ts = h.has("ts") ? Number(h.get("ts")!) : now;
    const elapsed = (now - ts) / 1000;
    if (elapsed > 0) tokens = Math.min(capacity, tokens + elapsed * refill);
    let allowed: number;
    let retryAfterMs: number;
    if (tokens >= 1) {
      tokens -= 1;
      allowed = 1;
      retryAfterMs = 0;
    } else {
      allowed = 0;
      retryAfterMs = Math.ceil(((1 - tokens) / refill) * 1000);
    }
    h.set("tokens", String(tokens));
    h.set("ts", String(now));
    this.hashes.set(key, h);
    return [allowed, Number(tokens.toFixed(4)), retryAfterMs];
  }
  async expire() { return 1; }
  async hmget() { return [null, null]; }
  async hmset() { return "OK"; }
}

let fake: FakeRedis;

function makeFakeEvent(ip: string): any {
  return {
    request: { headers: new Headers({ "x-forwarded-for": ip }) },
    getClientAddress: () => ip,
  };
}

beforeEach(() => {
  fake = new FakeRedis();
  setRedisForTests(fake as unknown as any);
  resetRateLimitScriptCacheForTests();
  delete process.env.REDIS_DISABLED;
});

describe("enforceIpRateLimit: pre-auth IP debit (P1.2)", () => {
  it("returns null for the first request from an IP", async () => {
    const result = await enforceIpRateLimit(makeFakeEvent("1.2.3.4"));
    expect(result).toBeNull();
  });

  it("debits one token per call from the per-IP bucket", async () => {
    // Capacity is 100. Burn 100 calls, then expect a 429.
    for (let i = 0; i < 100; i++) {
      const r = await enforceIpRateLimit(makeFakeEvent("1.2.3.5"));
      expect(r).toBeNull();
    }
    const blocked = await enforceIpRateLimit(makeFakeEvent("1.2.3.5"));
    expect(blocked).not.toBeNull();
    expect(blocked!.failure.allowed).toBe(false);
    expect(blocked!.failure.tier).toBe("ip");
    expect(blocked!.failure.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("isolates buckets per IP (one attacker IP cannot starve another)", async () => {
    for (let i = 0; i < 100; i++) {
      await enforceIpRateLimit(makeFakeEvent("evil"));
    }
    const evilBlocked = await enforceIpRateLimit(makeFakeEvent("evil"));
    expect(evilBlocked).not.toBeNull();

    const goodAllowed = await enforceIpRateLimit(makeFakeEvent("good"));
    expect(goodAllowed).toBeNull();
  });

  it("keys the bucket on the trusted last hop, so a forged leading X-Forwarded-For cannot mint fresh buckets", async () => {
    // Same real connecting peer (last hop), attacker rotates the forged
    // leading entry on every request. All must land in ONE bucket.
    for (let i = 0; i < 100; i++) {
      await enforceIpRateLimit(makeFakeEvent(`198.51.100.${i % 250}, 10.9.9.9`));
    }
    const blocked = await enforceIpRateLimit(makeFakeEvent("203.0.113.77, 10.9.9.9"));
    expect(blocked).not.toBeNull();
    expect(blocked!.failure.tier).toBe("ip");
  });

  it("degrades open when Redis is unreachable (fail-open by design)", async () => {
    fake.shouldFail = new Error("connection refused");
    const result = await enforceIpRateLimit(makeFakeEvent("1.2.3.6"));
    // Bucket failure must NOT brick the API; the spec accepts a
    // degraded-open mode logged at the take() level.
    expect(result).toBeNull();
  });
});

// =====================================================================
// Codex F3 (2026-05-22): per-route bucket override.
//
// Ingest carries a fleet of collectors behind one NAT'd egress IP. The
// default 100-burst/10-rps tier fired before the per-server `lastIngest`
// limiter could mediate. The override lets ingest carve out its own
// `ip:ingest` bucket without changing the management default.
// =====================================================================

describe("enforceIpRateLimit: per-route override (Codex F3)", () => {
  it("uses a separate namespaced bucket when namespaceSuffix is set", async () => {
    // Hammer the default 'ip' bucket until exhausted.
    for (let i = 0; i < 100; i++) {
      await enforceIpRateLimit(makeFakeEvent("nat.gateway"));
    }
    const mgmtBlocked = await enforceIpRateLimit(makeFakeEvent("nat.gateway"));
    expect(mgmtBlocked).not.toBeNull();
    expect(mgmtBlocked!.failure.tier).toBe("ip");

    // Same IP, different namespace -> separate bucket, still has capacity.
    const ingestAllowed = await enforceIpRateLimit(makeFakeEvent("nat.gateway"), {
      namespaceSuffix: "ingest",
      capacity: 1000,
      refillPerSecond: 100,
    });
    expect(ingestAllowed).toBeNull();
  });

  it("honors the larger capacity for the ingest bucket", async () => {
    // Use a tiny refill (1 token / 100s) so wall-clock elapsed during
    // the test loop can't sneak a refilled token in. Capacity comparison
    // (10 vs the management default of 100) is the property under test;
    // production uses 1000/100rps, that's pinned by a separate sync test.
    const opts = {
      namespaceSuffix: "ingest" as const,
      capacity: 10,
      refillPerSecond: 0.01,
    };
    for (let i = 0; i < 10; i++) {
      const r = await enforceIpRateLimit(makeFakeEvent("big.nat"), opts);
      expect(r).toBeNull();
    }
    // 11th hits the empty bucket — should fail.
    const blocked = await enforceIpRateLimit(makeFakeEvent("big.nat"), opts);
    expect(blocked).not.toBeNull();
    expect(blocked!.failure.tier).toBe("ip:ingest");
  });

  it("reports the namespaced tier in the failure shape so the client sees ip:ingest, not ip", async () => {
    const opts = { namespaceSuffix: "ingest" as const, capacity: 2, refillPerSecond: 1 };
    await enforceIpRateLimit(makeFakeEvent("tiny.bucket"), opts);
    await enforceIpRateLimit(makeFakeEvent("tiny.bucket"), opts);
    const blocked = await enforceIpRateLimit(makeFakeEvent("tiny.bucket"), opts);
    expect(blocked).not.toBeNull();
    expect(blocked!.failure.tier).toBe("ip:ingest");
  });
});
