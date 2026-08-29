// Route-level security tests for POST /api/v1/servers.
//
// Verifies the wired-up integration of:
//   - requireAuth (key separation: cru_key refused with hint)
//   - pickAllowedFields (mass assignment defence)
//   - audit log writes
//   - the per-endpoint server-creation sub-limit
//
// Mocks the DB, bcrypt, billing sync, Redis. We're testing route
// behaviour, not helper internals (those have their own unit tests).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@glassmkr/db/pg", () => {
  const queryFn = vi.fn();
  return {
    query: queryFn,
    // Fake transaction: route inner statements through the same mock and
    // emit BEGIN/COMMIT markers so existing tests can still assert on
    // bracketing. ROLLBACK is emitted on throw.
    withTransaction: async (fn: any) => {
      queryFn("BEGIN");
      try {
        const result = await fn({
          query: (text: string, params?: any[]) => queryFn(text, params),
        });
        queryFn("COMMIT");
        return result;
      } catch (err) {
        queryFn("ROLLBACK");
        throw err;
      }
    },
  };
});
vi.mock("bcrypt", () => ({
  default: { hash: vi.fn(async () => "bcrypt$$$mocked") },
}));
vi.mock("$lib/server/billing/sync", () => ({
  syncSubscriptionQuantitySafe: vi.fn(async () => undefined),
}));
// Force-disable Redis at the module boundary so rate-limit + idempotency
// both take the fail-open path. config.redis.disabled is computed at
// module load and can't be flipped at runtime.
vi.mock("$lib/server/redis", () => ({
  getRedis: () => null,
  setRedisForTests: () => {},
  quitRedis: async () => {},
}));

import { query } from "@glassmkr/db/pg";
import { POST } from "../+server.js";
import { setRedisForTests } from "$lib/server/redis";
import { setPepperForTests, generateAccountKey, generateCollectorKey } from "$lib/server/auth/keys";

const TEST_PEPPER = "0123456789abcdef0123456789abcdef-test-pepper-32+chars";

beforeEach(() => {
  setPepperForTests(TEST_PEPPER);
  (query as any).mockReset();
  // Default mock: any plan-limit / count / insert lookup returns empty
  // unless the test overrides it.
  (query as any).mockResolvedValue({ rows: [] });
  // Disable Redis so rate-limit + idempotency degrade open without
  // needing a fake. Spec Part 5 says rate limit failures degrade open.
  setRedisForTests(null);
  process.env.REDIS_DISABLED = "1";
});

afterEach(() => {
  setPepperForTests(null);
  setRedisForTests(null);
  delete process.env.REDIS_DISABLED;
  vi.clearAllMocks();
});

function makeEvent(opts: {
  body: unknown;
  customer?: { id: string; email: string; plan: string } | null;
  authHeader?: string;
}): any {
  return {
    request: {
      method: "POST",
      url: "https://dashboard.test/api/v1/servers",
      headers: {
        get(name: string) {
          if (name.toLowerCase() === "authorization") return opts.authHeader ?? null;
          if (name.toLowerCase() === "user-agent") return "test/1";
          return null;
        },
      },
      json: async () => opts.body,
    },
    locals: {
      customer: opts.customer ?? null,
      // Tests that set `customer` exercise the JWT session path
      // (the only remaining session kind after slice A4).
      authKind: opts.customer ? "session" : null,
    },
    getClientAddress: () => "10.0.0.1",
    route: { id: "/api/v1/servers" },
  };
}

function setUpQueryMockSequence(rows: Array<{ rows: unknown[] }>) {
  const m = (query as any).mockReset();
  for (const r of rows) m.mockResolvedValueOnce(r);
  // Any further calls return empty (audit log inserts, last_used updates, etc).
  m.mockResolvedValue({ rows: [] });
}

// ---------------------------------------------------------------------------

describe("POST /api/v1/servers: BOPLA / mass assignment defence", () => {
  it("does NOT propagate body-supplied account_id, id, or collector_key_hash to SQL params", async () => {
    setUpQueryMockSequence([
      { rows: [] }, // BEGIN
      { rows: [] }, // pg_advisory_xact_lock (G4)
      { rows: [{ plan_server_limit: 100 }] },
      { rows: [{ count: "0" }] },
      { rows: [] }, // INSERT INTO servers
      { rows: [] }, // INSERT INTO account_api_keys
      { rows: [] }, // COMMIT
    ]);

    const event = makeEvent({
      customer: { id: "cust_legitimate", email: "u@x.com", plan: "pro" },
      body: {
        name: "real-server",
        hostname: "real.example.com",
        // The malicious extras:
        account_id: "cust_VICTIM",
        customer_id: "cust_VICTIM",
        id: "srv_HIJACK",
        api_key_hash: "deadbeef",
        collector_key_hash: "deadbeef",
        created_at: "1970-01-01",
        last_seen_at: "1970-01-01",
      },
    });

    const response = await POST(event);
    expect(response.status).toBe(201);

    // Find the INSERT INTO servers call.
    const insertServersCall = (query as any).mock.calls.find((c: any[]) =>
      String(c[0]).startsWith("INSERT INTO servers"),
    );
    expect(insertServersCall).toBeDefined();
    const insertParams = insertServersCall[1] as unknown[];
    // PR #6: api_key_hash is hardcoded NULL in the SQL (no longer a
    // bound param); the cru key lives in account_api_keys instead.
    // Bound params: [serverId, customerId, name, hostname, tags, profile].
    expect(insertParams[1]).toBe("cust_legitimate"); // customer_id from PRINCIPAL
    expect(insertParams[1]).not.toBe("cust_VICTIM");
    expect(insertParams[0]).not.toBe("srv_HIJACK");
    expect(String(insertParams[0])).toMatch(/^srv_[0-9a-f]{16}$/);
    // Body's api_key_hash never reaches any bound param.
    for (const p of insertParams) expect(p).not.toBe("deadbeef");

    // The cru key insert into account_api_keys also uses customer_id
    // from the principal, not the body.
    const insertKeyCall = (query as any).mock.calls.find((c: any[]) =>
      String(c[0]).includes("INSERT INTO account_api_keys"),
    );
    expect(insertKeyCall).toBeDefined();
    const keyParams = insertKeyCall[1] as unknown[];
    expect(keyParams[0]).toBe("cust_legitimate");
    for (const p of keyParams) expect(p).not.toBe("cust_VICTIM");
  });

  it("accepts bare { name } body (preserves existing UI behaviour)", async () => {
    setUpQueryMockSequence([
      { rows: [] }, // BEGIN
      { rows: [] }, // pg_advisory_xact_lock (G4)
      { rows: [{ plan_server_limit: 100 }] },
      { rows: [{ count: "0" }] },
      { rows: [] }, // INSERT INTO servers
      { rows: [] }, // INSERT INTO account_api_keys
      { rows: [] }, // COMMIT
    ]);

    const event = makeEvent({
      customer: { id: "cust_a", email: "u@x.com", plan: "pro" },
      body: { name: "web-01" },
    });
    const response = await POST(event);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.server.name).toBe("web-01");
    // hostname defaults to name when name is also a valid hostname
    expect(body.server.hostname).toBe("web-01");
    // PR #6 cutover: the issued key is now gmk_cru_live_*.
    expect(body.server.api_key).toMatch(/^gmk_cru_live_[0-9a-zA-Z]{43}_[0-9a-zA-Z]{4}$/);
  });

  // Name is optional (2026-05-22): missing/empty name now falls back to a
  // placeholder that gets hidden in the UI once the agent's first
  // snapshot arrives and populates `hostname`. Still rejects an
  // explicitly-invalid name (>100 chars).
  it("rejects explicit invalid name (>100 chars)", async () => {
    const event = makeEvent({
      customer: { id: "cust_a", email: "u@x.com", plan: "pro" },
      body: { name: "x".repeat(101) },
    });
    const response = await POST(event);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("validation_failed");
  });

  it("400s on malformed hostname", async () => {
    const event = makeEvent({
      customer: { id: "cust_a", email: "u@x.com", plan: "pro" },
      body: { name: "x", hostname: "not a hostname" },
    });
    const response = await POST(event);
    expect(response.status).toBe(400);
  });

  it("400s on tags > 20 items", async () => {
    const event = makeEvent({
      customer: { id: "cust_a", email: "u@x.com", plan: "pro" },
      body: { name: "x", tags: new Array(21).fill("t") },
    });
    const response = await POST(event);
    expect(response.status).toBe(400);
  });

  it("400s on an unknown host profile", async () => {
    const event = makeEvent({
      customer: { id: "cust_a", email: "u@x.com", plan: "pro" },
      body: { name: "x", profile: "not_a_real_profile" },
    });
    const response = await POST(event);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("validation_failed");
  });

  it("accepts a known host profile and binds it as the last INSERT param", async () => {
    setUpQueryMockSequence([
      { rows: [] }, // BEGIN
      { rows: [] }, // pg_advisory_xact_lock (G4)
      { rows: [{ plan_server_limit: 100 }] },
      { rows: [{ count: "0" }] },
      { rows: [] }, // INSERT INTO servers
      { rows: [] }, // INSERT INTO account_api_keys
      { rows: [] }, // COMMIT
    ]);
    const event = makeEvent({
      customer: { id: "cust_a", email: "u@x.com", plan: "pro" },
      body: { name: "gpu-01", profile: "marketplace_gpu" },
    });
    const response = await POST(event);
    expect(response.status).toBe(201);
    const insertServersCall = (query as any).mock.calls.find((c: any[]) =>
      String(c[0]).startsWith("INSERT INTO servers"),
    );
    const insertParams = insertServersCall[1] as unknown[];
    // [serverId, customerId, name, hostname, tags, profile]
    expect(insertParams[5]).toBe("marketplace_gpu");
  });
});

describe("POST /api/v1/servers: key separation invariant", () => {
  it("refuses a cru_key with a hint mentioning 'collector key'", async () => {
    const cruKey = generateCollectorKey("live");
    const event = makeEvent({
      body: { name: "x" },
      authHeader: `Bearer ${cruKey.raw}`,
      customer: null,
    });
    try {
      await POST(event);
      throw new Error("should have thrown");
    } catch (err: any) {
      expect(err.status).toBe(401);
      const body = JSON.stringify(err.body ?? err);
      expect(body).toMatch(/collector key|cru/i);
    }
  });

  it("refuses an unauthenticated request", async () => {
    const event = makeEvent({ body: { name: "x" }, customer: null });
    try {
      await POST(event);
      throw new Error("should have thrown");
    } catch (err: any) {
      expect(err.status).toBe(401);
    }
  });
});

describe("POST /api/v1/servers: BOLA constraint flows from principal, not body", () => {
  it("the SQL INSERT uses principal.customer_id even when body tries to override", async () => {
    setUpQueryMockSequence([
      { rows: [] }, // BEGIN
      { rows: [] }, // pg_advisory_xact_lock (G4)
      { rows: [{ plan_server_limit: 100 }] },
      { rows: [{ count: "0" }] },
      { rows: [] }, // INSERT INTO servers
      { rows: [] }, // INSERT INTO account_api_keys
      { rows: [] }, // COMMIT
    ]);

    await POST(
      makeEvent({
        customer: { id: "cust_owner", email: "o@x.com", plan: "pro" },
        body: { name: "x", customer_id: "cust_other" },
      }),
    );

    // Find every query that bound a customer_id parameter and assert it
    // was 'cust_owner', never 'cust_other'.
    const calls = (query as any).mock.calls;
    for (const [, params] of calls) {
      if (Array.isArray(params)) {
        for (const p of params) {
          expect(p).not.toBe("cust_other");
        }
      }
    }
  });

  it("the GET path constrains by principal.customer_id", async () => {
    const { GET } = await import("../+server.js");
    setUpQueryMockSequence([
      { rows: [] },
    ]);
    await GET(
      makeEvent({
        customer: { id: "cust_owner", email: "o@x.com", plan: "pro" },
        body: {},
      }),
    );
    // The list query should have customer_id = 'cust_owner' as the
    // first param.
    const listCall = (query as any).mock.calls.find((c: any[]) =>
      String(c[0]).includes("FROM servers"),
    );
    expect(listCall).toBeDefined();
    expect(listCall[1][0]).toBe("cust_owner");
  });
});

describe("POST /api/v1/servers: server limit enforcement", () => {
  it("returns 403 quota_exceeded when at limit", async () => {
    setUpQueryMockSequence([
      { rows: [] }, // BEGIN
      { rows: [] }, // pg_advisory_xact_lock (G4)
      { rows: [{ plan_server_limit: 3 }] },
      { rows: [{ count: "3" }] },
    ]);
    const response = await POST(
      makeEvent({
        customer: { id: "cust_a", email: "u@x.com", plan: "free" },
        body: { name: "x" },
      }),
    );
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("quota_exceeded");
    // The refusal has to say where the road continues. A cap that only says no
    // reads as "pay us", when the honest answer for a fleet past the hosted cap
    // is that self-hosting has no node limit at all.
    expect(body.message).toContain("self-host");
    expect(body.message).toContain("glassmkr.com/docs");
    // And it must still state the cap, so the reader knows what they hit.
    expect(body.message).toContain("3-node cap");
  });
});
