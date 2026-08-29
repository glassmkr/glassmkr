import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { checkIdempotency, recordIdempotency } from "../idempotency.js";
import { setRedisForTests } from "../../redis.js";
import type { Principal } from "../principal.js";

// Tiny in-memory Redis stub. Implements only the commands idempotency.ts uses.
class FakeRedis {
  store = new Map<string, { value: string; expiresAt: number }>();
  shouldFail: Error | null = null;

  async get(key: string): Promise<string | null> {
    if (this.shouldFail) throw this.shouldFail;
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(
    key: string,
    value: string,
    ...rest: Array<string | number>
  ): Promise<"OK" | null> {
    if (this.shouldFail) throw this.shouldFail;
    let ttlSeconds: number | null = null;
    let nx = false;
    for (let i = 0; i < rest.length; i++) {
      const flag = String(rest[i]).toUpperCase();
      if (flag === "EX") {
        ttlSeconds = Number(rest[++i]);
      } else if (flag === "NX") {
        nx = true;
      } else {
        throw new Error(`test stub: unsupported set flag ${flag}`);
      }
    }
    if (nx) {
      const existing = this.store.get(key);
      if (existing && Date.now() <= existing.expiresAt) return null;
    }
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds === null ? Number.POSITIVE_INFINITY : Date.now() + ttlSeconds * 1000,
    });
    return "OK";
  }

  on() {}
}

let fake: FakeRedis;

beforeEach(() => {
  fake = new FakeRedis();
  setRedisForTests(fake as unknown as import("ioredis").default);
});

afterEach(() => {
  setRedisForTests(null);
});

const PRINCIPAL: Principal = {
  kind: "session",
  customer_id: "cust_1",
  email: "u@x.com",
  plan: "pro",
};

function makeEvent(headerValue: string | null): any {
  return {
    request: {
      headers: {
        get(name: string) {
          if (name.toLowerCase() === "idempotency-key") return headerValue;
          return null;
        },
      },
    },
  };
}

describe("checkIdempotency: header parsing", () => {
  it("returns no_key when header is absent", async () => {
    const r = await checkIdempotency({ event: makeEvent(null), principal: PRINCIPAL, scope: "x" });
    expect(r.kind).toBe("no_key");
  });

  it("returns no_key for an empty header", async () => {
    const r = await checkIdempotency({ event: makeEvent(""), principal: PRINCIPAL, scope: "x" });
    expect(r.kind).toBe("no_key");
  });

  it("returns no_key for a key longer than 255 chars", async () => {
    const longKey = "a".repeat(256);
    const r = await checkIdempotency({ event: makeEvent(longKey), principal: PRINCIPAL, scope: "x" });
    expect(r.kind).toBe("no_key");
  });

  it("returns no_key for keys containing non-printable ASCII", async () => {
    const r = await checkIdempotency({
      event: makeEvent("contains\x00null"),
      principal: PRINCIPAL,
      scope: "x",
    });
    expect(r.kind).toBe("no_key");
  });

  it("returns fresh on first sight of a valid key", async () => {
    const r = await checkIdempotency({ event: makeEvent("key-1"), principal: PRINCIPAL, scope: "x" });
    expect(r.kind).toBe("fresh");
    if (r.kind === "fresh") expect(r.key).toBe("key-1");
  });
});

describe("checkIdempotency: replay detection", () => {
  it("returns the cached response on a subsequent matching key", async () => {
    await recordIdempotency({
      principal: PRINCIPAL,
      scope: "POST /api/v1/servers",
      key: "abc",
      response: { status: 201, body: { server: { id: "srv_x" } } },
    });
    const r = await checkIdempotency({
      event: makeEvent("abc"),
      principal: PRINCIPAL,
      scope: "POST /api/v1/servers",
    });
    expect(r.kind).toBe("replay");
    if (r.kind === "replay") {
      expect(r.cached.status).toBe(201);
      expect(r.cached.body).toEqual({ server: { id: "srv_x" } });
    }
  });

  it("scopes by customer_id (different customers, same key, no collision)", async () => {
    await recordIdempotency({
      principal: { kind: "session", customer_id: "cust_a", email: "a@x", plan: "pro" },
      scope: "POST /api/v1/servers",
      key: "shared-key",
      response: { status: 201, body: { hello: "from a" } },
    });
    const r = await checkIdempotency({
      event: makeEvent("shared-key"),
      principal: { kind: "session", customer_id: "cust_b", email: "b@x", plan: "pro" },
      scope: "POST /api/v1/servers",
    });
    expect(r.kind).toBe("fresh");
  });

  it("scopes by route (same key on different routes, no collision)", async () => {
    await recordIdempotency({
      principal: PRINCIPAL,
      scope: "POST /api/v1/servers",
      key: "k",
      response: { status: 201, body: { from: "servers" } },
    });
    const r = await checkIdempotency({
      event: makeEvent("k"),
      principal: PRINCIPAL,
      scope: "POST /api/v1/account/keys",
    });
    expect(r.kind).toBe("fresh");
  });

  it("treats Redis read failure as fresh, not replay", async () => {
    fake.shouldFail = new Error("conn refused");
    const r = await checkIdempotency({ event: makeEvent("k"), principal: PRINCIPAL, scope: "x" });
    expect(r.kind).toBe("fresh");
  });

  it("treats corrupted cached value as fresh", async () => {
    fake.store.set("idem:cust_1:x:k", { value: "{not valid json", expiresAt: Date.now() + 60000 });
    const r = await checkIdempotency({ event: makeEvent("k"), principal: PRINCIPAL, scope: "x" });
    expect(r.kind).toBe("fresh");
  });
});

describe("checkIdempotency: P1.6 reservation + in-flight semantics", () => {
  it("two concurrent fresh checks for the same key: first wins, second sees in_flight", async () => {
    const first = await checkIdempotency({
      event: makeEvent("race-k"),
      principal: PRINCIPAL,
      scope: "POST /api/v1/servers",
    });
    expect(first.kind).toBe("fresh");

    // The second concurrent caller observes the sentinel still in
    // place (the first hasn't called recordIdempotency yet).
    const second = await checkIdempotency({
      event: makeEvent("race-k"),
      principal: PRINCIPAL,
      scope: "POST /api/v1/servers",
    });
    expect(second.kind).toBe("in_flight");
  });

  it("the second caller sees replay once the first records its response", async () => {
    const first = await checkIdempotency({
      event: makeEvent("seq-k"),
      principal: PRINCIPAL,
      scope: "POST /api/v1/servers",
    });
    expect(first.kind).toBe("fresh");

    if (first.kind === "fresh") {
      await recordIdempotency({
        principal: PRINCIPAL,
        scope: "POST /api/v1/servers",
        key: first.key,
        response: { status: 201, body: { server: { id: "srv_first" } } },
      });
    }

    const second = await checkIdempotency({
      event: makeEvent("seq-k"),
      principal: PRINCIPAL,
      scope: "POST /api/v1/servers",
    });
    expect(second.kind).toBe("replay");
    if (second.kind === "replay") {
      expect(second.cached.status).toBe(201);
    }
  });

  it("error responses are also returned on retry (status + body cached)", async () => {
    // Simulate a fresh check that ended in a 400 validation error.
    const first = await checkIdempotency({
      event: makeEvent("err-k"),
      principal: PRINCIPAL,
      scope: "POST /api/v1/servers",
    });
    if (first.kind !== "fresh") throw new Error("expected fresh");
    await recordIdempotency({
      principal: PRINCIPAL,
      scope: "POST /api/v1/servers",
      key: first.key,
      response: { status: 400, body: { error: "validation_failed" } },
    });

    const retry = await checkIdempotency({
      event: makeEvent("err-k"),
      principal: PRINCIPAL,
      scope: "POST /api/v1/servers",
    });
    expect(retry.kind).toBe("replay");
    if (retry.kind === "replay") {
      expect(retry.cached.status).toBe(400);
      expect((retry.cached.body as any).error).toBe("validation_failed");
    }
  });
});

describe("recordIdempotency: TTL", () => {
  it("sets a 24h TTL via SET EX", async () => {
    await recordIdempotency({
      principal: PRINCIPAL,
      scope: "x",
      key: "k",
      response: { status: 200, body: {} },
    });
    const entry = fake.store.get("idem:cust_1:x:k")!;
    expect(entry).toBeDefined();
    const remaining = entry.expiresAt - Date.now();
    // ~24h, allow some slack
    expect(remaining).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(remaining).toBeLessThanOrEqual(25 * 60 * 60 * 1000);
  });

  it("never throws even if Redis write fails", async () => {
    fake.shouldFail = new Error("boom");
    await expect(
      recordIdempotency({
        principal: PRINCIPAL,
        scope: "x",
        key: "k",
        response: { status: 200, body: {} },
      }),
    ).resolves.toBeUndefined();
  });
});

describe("idempotency + cru_key principal", () => {
  it("scopes by server_id for cru_key principals", async () => {
    const cru: Principal = {
      kind: "cru_key",
      customer_id: "cust_1",
      server_id: "srv_a",
      key_id: "k",
      is_legacy_format: false,
    };
    await recordIdempotency({
      principal: cru,
      scope: "POST /api/v1/agent/snapshots",
      key: "k1",
      response: { status: 200, body: {} },
    });
    expect(fake.store.has("idem:srv_a:POST /api/v1/agent/snapshots:k1")).toBe(true);
  });
});
