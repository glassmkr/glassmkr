// Route-level security tests for /api/v1/account/* endpoints:
//   - POST /verify-password         (re-auth gate stamping)
//   - POST /keys                    (create, requires re-auth)
//   - GET  /keys                    (list, no plaintext)
//   - DELETE /keys/{id}             (revoke)
//   - POST   /keys/{id}/rotate      (rotate, requires re-auth)
//   - GET    /audit                 (audit view)
//
// Same mock pattern as the /servers tests: stub the DB, force-disable
// Redis, mock bcrypt and the @glassmkr/auth verifyPassword helper.

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
vi.mock("@glassmkr/auth", () => ({
  verifyPassword: vi.fn(async (pw: string) => pw === "correct-password"),
}));
vi.mock("$lib/server/redis", () => ({
  getRedis: () => null,
  setRedisForTests: () => {},
  quitRedis: async () => {},
}));

import { query } from "@glassmkr/db/pg";
import { POST as VERIFY } from "../verify-password/+server.js";
import { POST as CREATE_KEY, GET as LIST_KEYS } from "../keys/+server.js";
import { DELETE as REVOKE_KEY } from "../keys/[id]/+server.js";
import { POST as ROTATE_KEY } from "../keys/[id]/rotate/+server.js";
import { GET as LIST_AUDIT } from "../audit/+server.js";
import {
  setPepperForTests,
  generateAccountKey,
  generateCollectorKey,
} from "$lib/server/auth/keys";

const TEST_PEPPER = "0123456789abcdef0123456789abcdef-test-pepper-32+chars";

beforeEach(() => {
  setPepperForTests(TEST_PEPPER);
  (query as any).mockReset();
  (query as any).mockResolvedValue({ rows: [] });
});

afterEach(() => {
  setPepperForTests(null);
  vi.clearAllMocks();
});

function makeEvent(opts: {
  customer?: { id: string; email: string; plan: string } | null;
  authHeader?: string;
  body?: unknown;
  method?: string;
  url?: string;
  routeId?: string;
  serverId?: string;
}): any {
  const url = opts.url ?? "https://dashboard.test/api/v1/account/keys";
  return {
    request: {
      method: opts.method ?? "POST",
      url,
      headers: {
        get(name: string) {
          if (name.toLowerCase() === "authorization") return opts.authHeader ?? null;
          if (name.toLowerCase() === "user-agent") return "test/1";
          return null;
        },
      },
      json: async () => opts.body ?? {},
    },
    locals: {
      customer: opts.customer ?? null,
      authKind: opts.customer ? "session" : null,
    },
    params: { id: opts.serverId ?? "key_x" },
    url: new URL(url),
    getClientAddress: () => "10.0.0.1",
    route: { id: opts.routeId ?? "/api/v1/account/keys" },
  };
}

function setQueries(rows: Array<{ rows: unknown[] }>) {
  const m = (query as any).mockReset();
  for (const r of rows) m.mockResolvedValueOnce(r);
  m.mockResolvedValue({ rows: [] });
}

const recentReAuth = new Date();
const expiredReAuth = new Date(Date.now() - 10 * 60 * 1000);

// ============================================================================
// POST /verify-password
// ============================================================================

describe("POST /api/v1/account/verify-password", () => {
  it("stamps last_password_verified_at on correct password", async () => {
    setQueries([
      { rows: [{ password_hash: "<bcrypt-of-correct-password>" }] }, // SELECT password_hash
      { rows: [] }, // UPDATE last_password_verified_at
    ]);
    const response = await VERIFY(makeEvent({
      customer: { id: "cust_a", email: "u@x.com", plan: "pro" },
      body: { password: "correct-password" },
    }));
    expect(response.status).toBe(200);
    const updateCall = (query as any).mock.calls.find((c: any[]) =>
      String(c[0]).includes("UPDATE customers SET last_password_verified_at"),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[1]).toEqual(["cust_a"]);
  });

  it("returns 401 generic on wrong password", async () => {
    setQueries([
      { rows: [{ password_hash: "<some-hash>" }] },
    ]);
    const response = await VERIFY(makeEvent({
      customer: { id: "cust_a", email: "u@x.com", plan: "pro" },
      body: { password: "wrong-password" },
    }));
    expect(response.status).toBe(401);
  });

  it("returns 403 no_password_on_file when account is SSO-only", async () => {
    setQueries([
      { rows: [{ password_hash: null }] },
    ]);
    const response = await VERIFY(makeEvent({
      customer: { id: "cust_a", email: "u@x.com", plan: "pro" },
      body: { password: "anything" },
    }));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("no_password_on_file");
  });

  it("400s on missing password", async () => {
    const response = await VERIFY(makeEvent({
      customer: { id: "cust_a", email: "u@x.com", plan: "pro" },
      body: {},
    }));
    expect(response.status).toBe(400);
  });

  it("refuses acct_key principal (only sessions can re-auth)", async () => {
    const acct = generateAccountKey("live");
    try {
      await VERIFY(makeEvent({
        customer: null,
        authHeader: `Bearer ${acct.raw}`,
        body: { password: "x" },
      }));
      throw new Error("should have thrown");
    } catch (err: any) {
      expect(err.status).toBe(401);
    }
  });
});

// ============================================================================
// POST /keys (create) - re-auth gate
// ============================================================================

describe("POST /api/v1/account/keys: re-auth gate", () => {
  it("403s when last_password_verified_at is null", async () => {
    setQueries([
      { rows: [{ last_password_verified_at: null }] }, // requireRecentReAuth lookup
    ]);
    try {
      await CREATE_KEY(makeEvent({
        customer: { id: "cust_a", email: "u@x.com", plan: "pro" },
        body: { name: "ansible-prod" },
      }));
      throw new Error("should have thrown");
    } catch (err: any) {
      expect(err.status).toBe(403);
      const body = JSON.stringify(err.body ?? err);
      expect(body).toMatch(/Re-authentication|verify-password/i);
    }
  });

  it("403s when last_password_verified_at is older than 5 min", async () => {
    setQueries([
      { rows: [{ last_password_verified_at: expiredReAuth }] },
    ]);
    try {
      await CREATE_KEY(makeEvent({
        customer: { id: "cust_a", email: "u@x.com", plan: "pro" },
        body: { name: "ansible-prod" },
      }));
      throw new Error("should have thrown");
    } catch (err: any) {
      expect(err.status).toBe(403);
    }
  });

  it("succeeds when re-auth is fresh", async () => {
    setQueries([
      { rows: [{ last_password_verified_at: recentReAuth }] }, // re-auth check
      { rows: [{ id: "key_xyz", created_at: new Date() }] }, // INSERT returning
    ]);
    const response = await CREATE_KEY(makeEvent({
      customer: { id: "cust_a", email: "u@x.com", plan: "pro" },
      body: { name: "ansible-prod" },
    }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.api_key).toMatch(/^gmk_acct_live_[0-9a-zA-Z]{43}_[0-9a-zA-Z]{4}$/);
    expect(body.key.last_4).toBe(body.api_key.slice(-4));
    expect(body.key.prefix).toBe("gmk_acct_live_");
  });
});

describe("POST /api/v1/account/keys: validation + mass assignment", () => {
  it("400s on missing name", async () => {
    setQueries([{ rows: [{ last_password_verified_at: recentReAuth }] }]);
    const response = await CREATE_KEY(makeEvent({
      customer: { id: "cust_a", email: "u@x.com", plan: "pro" },
      body: {},
    }));
    expect(response.status).toBe(400);
  });

  it("400s on invalid scope", async () => {
    setQueries([{ rows: [{ last_password_verified_at: recentReAuth }] }]);
    const response = await CREATE_KEY(makeEvent({
      customer: { id: "cust_a", email: "u@x.com", plan: "pro" },
      // Spec D dropped the legacy `scopes` jsonb input; the hierarchical
      // `scope` text field is now the only scope authority. An invalid
      // value still 400s via validateScopeLevel.
      body: { name: "x", scope: "billing:write" },
    }));
    expect(response.status).toBe(400);
  });

  it("400s on past expires_at", async () => {
    setQueries([{ rows: [{ last_password_verified_at: recentReAuth }] }]);
    const response = await CREATE_KEY(makeEvent({
      customer: { id: "cust_a", email: "u@x.com", plan: "pro" },
      body: { name: "x", expires_at: "2020-01-01T00:00:00Z" },
    }));
    expect(response.status).toBe(400);
  });

  it("drops body-supplied customer_id, key_hash, etc.", async () => {
    setQueries([
      { rows: [{ last_password_verified_at: recentReAuth }] },
      { rows: [{ id: "key_xyz", created_at: new Date() }] },
    ]);
    await CREATE_KEY(makeEvent({
      customer: { id: "cust_owner", email: "u@x.com", plan: "pro" },
      body: {
        name: "x",
        // Malicious extras:
        customer_id: "cust_other",
        key_hash: "deadbeef",
        revoked_at: null,
        prefix: "gmk_acct_evil_",
      },
    }));
    const insertCall = (query as any).mock.calls.find((c: any[]) =>
      String(c[0]).includes("INSERT INTO account_api_keys"),
    );
    const params = insertCall[1] as unknown[];
    expect(params[0]).toBe("cust_owner");
    expect(params).not.toContain("cust_other");
    expect(params).not.toContain("deadbeef");
    // The prefix written is the canonical generated one, not the body's.
    expect(params[2]).toBe("gmk_acct_live_");
  });

  it("refuses acct_key principal (no API-key-creating-API-key in v1)", async () => {
    const acct = generateAccountKey("live");
    try {
      await CREATE_KEY(makeEvent({
        customer: null,
        authHeader: `Bearer ${acct.raw}`,
        body: { name: "x" },
      }));
      throw new Error("should have thrown");
    } catch (err: any) {
      expect(err.status).toBe(401);
    }
  });
});

// ============================================================================
// GET /keys (list)
// ============================================================================

describe("GET /api/v1/account/keys", () => {
  it("constrains by principal.customer_id", async () => {
    setQueries([
      { rows: [{
        id: "k1", name: "n", prefix: "gmk_acct_live_", last_4: "abcd",
        scope: "admin", created_at: new Date(),
        last_used_at: null, expires_at: null, revoked_at: null,
      }] },
    ]);
    const response = await LIST_KEYS(makeEvent({
      customer: { id: "cust_owner", email: "u@x.com", plan: "pro" },
      method: "GET",
    }));
    expect(response.status).toBe(200);
    const listCall = (query as any).mock.calls[0];
    expect(listCall[0]).toMatch(/customer_id = \$1/);
    expect(listCall[1]).toEqual(["cust_owner"]);
  });

  it("never includes plaintext or key_hash in the response", async () => {
    setQueries([
      { rows: [{
        id: "k1", name: "n", prefix: "gmk_acct_live_", last_4: "abcd",
        scope: "admin", created_at: new Date(),
        last_used_at: null, expires_at: null, revoked_at: null,
      }] },
    ]);
    const response = await LIST_KEYS(makeEvent({
      customer: { id: "cust_owner", email: "u@x.com", plan: "pro" },
      method: "GET",
    }));
    const text = await response.text();
    expect(text).not.toMatch(/gmk_acct_live_[0-9a-zA-Z]{20,}/);
    expect(text).not.toMatch(/key_hash/);
  });

  it("acct_key may list keys", async () => {
    const acct = generateAccountKey("live");
    setQueries([
      // requireAuth -> lookupAcctKey (Pro-tier gate added 2026-05-12 needs plan=pro)
      { rows: [{
        id: "key_self", customer_id: "cust_owner", prefix: acct.prefix,
        scope: "admin", expires_at: null, revoked_at: null,
        plan: "pro",
      }] },
      { rows: [] }, // last_used_at update
      { rows: [] }, // list
    ]);
    const response = await LIST_KEYS(makeEvent({
      authHeader: `Bearer ${acct.raw}`,
      method: "GET",
    }));
    expect(response.status).toBe(200);
  });

  it("filters cru collector rows out via server_id IS NULL", async () => {
    setQueries([{ rows: [] }]);
    await LIST_KEYS(makeEvent({
      customer: { id: "cust_owner", email: "u@x.com", plan: "pro" },
      method: "GET",
    }));
    const listCall = (query as any).mock.calls[0];
    expect(listCall[0]).toMatch(/server_id IS NULL/);
  });
});

// ============================================================================
// DELETE /keys/{id} - revoke
// ============================================================================

describe("DELETE /api/v1/account/keys/{id}", () => {
  it("BOLA-constrains UPDATE by customer_id (immediate path)", async () => {
    setQueries([
      { rows: [] }, // no row matched (different customer)
    ]);
    const response = await REVOKE_KEY(makeEvent({
      customer: { id: "cust_attacker", email: "x", plan: "pro" },
      serverId: "key_victim",
      method: "DELETE",
      routeId: "/api/v1/account/keys/[id]",
      // Phase 4: pin `immediate=true` so this test asserts the
      // historical 2-param UPDATE shape. The default graceful path
      // also constrains by customer_id but adds the grace-hours param.
      url: "https://dashboard.test/api/v1/account/keys/key_victim?immediate=true",
    }));
    expect(response.status).toBe(404);
    const updateCall = (query as any).mock.calls[0];
    expect(updateCall[0]).toMatch(/UPDATE account_api_keys.*WHERE id = \$1 AND customer_id = \$2/s);
    expect(updateCall[1]).toEqual(["key_victim", "cust_attacker"]);
  });

  it("succeeds when key belongs to authenticated customer", async () => {
    setQueries([
      { rows: [{ id: "key_mine", name: "ansible", last_4: "abcd" }] },
    ]);
    const response = await REVOKE_KEY(makeEvent({
      customer: { id: "cust_owner", email: "x", plan: "pro" },
      serverId: "key_mine",
      method: "DELETE",
      routeId: "/api/v1/account/keys/[id]",
      url: "https://dashboard.test/api/v1/account/keys/key_mine",
    }));
    expect(response.status).toBe(200);
  });

  it("refuses acct_key principal (revocation is session-only)", async () => {
    const acct = generateAccountKey("live");
    try {
      await REVOKE_KEY(makeEvent({
        customer: null,
        authHeader: `Bearer ${acct.raw}`,
        serverId: "key_x",
        method: "DELETE",
        routeId: "/api/v1/account/keys/[id]",
        url: "https://dashboard.test/api/v1/account/keys/key_x",
      }));
      throw new Error("should have thrown");
    } catch (err: any) {
      expect(err.status).toBe(401);
    }
  });

  it("never reaches a cru collector row (server_id IS NULL in WHERE)", async () => {
    // Even if a customer presents a srv_-bound row id to this endpoint,
    // the server_id IS NULL clause makes the UPDATE match no rows -> 404.
    setQueries([{ rows: [] }]);
    const response = await REVOKE_KEY(makeEvent({
      customer: { id: "cust_owner", email: "x", plan: "pro" },
      serverId: "key_cru",
      method: "DELETE",
      routeId: "/api/v1/account/keys/[id]",
      url: "https://dashboard.test/api/v1/account/keys/key_cru",
    }));
    expect(response.status).toBe(404);
    const updateCall = (query as any).mock.calls[0];
    expect(updateCall[0]).toMatch(/server_id IS NULL/);
  });
});

// ============================================================================
// POST /keys/{id}/rotate
// ============================================================================

describe("POST /api/v1/account/keys/{id}/rotate", () => {
  it("requires recent re-auth", async () => {
    setQueries([
      { rows: [{ last_password_verified_at: null }] }, // re-auth check fails
    ]);
    try {
      await ROTATE_KEY(makeEvent({
        customer: { id: "cust_owner", email: "x", plan: "pro" },
        serverId: "key_mine",
        method: "POST",
        routeId: "/api/v1/account/keys/[id]/rotate",
        url: "https://dashboard.test/api/v1/account/keys/key_mine/rotate",
      }));
      throw new Error("should have thrown");
    } catch (err: any) {
      expect(err.status).toBe(403);
    }
  });

  it("excludes cru collector rows via server_id IS NULL in SELECT and UPDATE", async () => {
    setQueries([
      { rows: [{ last_password_verified_at: recentReAuth }] }, // re-auth ok
      { rows: [] }, // SELECT misses because server_id IS NULL excludes cru
    ]);
    const response = await ROTATE_KEY(makeEvent({
      customer: { id: "cust_owner", email: "x", plan: "pro" },
      serverId: "key_cru_disguised",
      method: "POST",
      routeId: "/api/v1/account/keys/[id]/rotate",
      url: "https://dashboard.test/api/v1/account/keys/key_cru_disguised/rotate",
    }));
    expect(response.status).toBe(404);
    const selectCall = (query as any).mock.calls[1];
    expect(selectCall[0]).toMatch(/server_id IS NULL/);
  });

  it("BOLA-constrains the SELECT by customer_id and 404s on miss", async () => {
    setQueries([
      { rows: [{ last_password_verified_at: recentReAuth }] }, // re-auth ok
      { rows: [] }, // existing-key lookup misses
    ]);
    const response = await ROTATE_KEY(makeEvent({
      customer: { id: "cust_attacker", email: "x", plan: "pro" },
      serverId: "key_victim",
      method: "POST",
      routeId: "/api/v1/account/keys/[id]/rotate",
      url: "https://dashboard.test/api/v1/account/keys/key_victim/rotate",
    }));
    expect(response.status).toBe(404);
  });

  it("atomically inserts new + flags old with grace period (Phase 4 graceful rotation)", async () => {
    setQueries([
      { rows: [{ last_password_verified_at: recentReAuth }] }, // re-auth
      { rows: [{
        id: "key_mine", name: "ansible", scope: "admin",
        expires_at: null, last_4: "wxyz",
      }] }, // existing key
      { rows: [] }, // BEGIN
      { rows: [{ id: "key_new", created_at: new Date() }] }, // INSERT returning (new key)
      { rows: [] }, // UPDATE old set replaced_by_key_id + grace_period_ends_at
      { rows: [] }, // COMMIT
    ]);
    const response = await ROTATE_KEY(makeEvent({
      customer: { id: "cust_owner", email: "x", plan: "pro" },
      serverId: "key_mine",
      method: "POST",
      routeId: "/api/v1/account/keys/[id]/rotate",
      url: "https://dashboard.test/api/v1/account/keys/key_mine/rotate",
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.api_key).toMatch(/^gmk_acct_live_/);
    expect(body.grace?.old_key_id).toBe("key_mine");
    expect(body.grace?.hours_remaining).toBe(48);
    // Verify BEGIN/COMMIT bracketed.
    const calls = (query as any).mock.calls.map((c: any[]) => String(c[0]));
    const beginIdx = calls.findIndex((s: string) => s.trim() === "BEGIN");
    const commitIdx = calls.findIndex((s: string) => s.trim() === "COMMIT");
    expect(beginIdx).toBeGreaterThan(-1);
    expect(commitIdx).toBeGreaterThan(beginIdx);
  });
});

// ============================================================================
// GET /audit
// ============================================================================

describe("GET /api/v1/account/audit", () => {
  it("constrains by principal.customer_id with retention window", async () => {
    setQueries([
      { rows: [] },
    ]);
    const response = await LIST_AUDIT(makeEvent({
      customer: { id: "cust_owner", email: "x", plan: "pro" },
      method: "GET",
      url: "https://dashboard.test/api/v1/account/audit",
      routeId: "/api/v1/account/audit",
    }));
    expect(response.status).toBe(200);
    const call = (query as any).mock.calls[0];
    expect(call[0]).toMatch(/customer_id = \$1/);
    expect(call[1][0]).toBe("cust_owner");
    // ts >= retention_min
    expect(call[0]).toMatch(/ts >= \$2/);
  });

  it("uses the same 365-day window for every plan", async () => {
    setQueries([{ rows: [] }]);
    await LIST_AUDIT(makeEvent({
      customer: { id: "cust_pro", email: "x", plan: "pro" },
      method: "GET",
      url: "https://dashboard.test/api/v1/account/audit",
      routeId: "/api/v1/account/audit",
    }));
    const proRetentionParam = (query as any).mock.calls[0][1][1] as Date;
    const proAge = Date.now() - proRetentionParam.getTime();
    expect(proAge).toBeGreaterThan(360 * 24 * 60 * 60 * 1000);
    expect(proAge).toBeLessThan(370 * 24 * 60 * 60 * 1000);

    // Inverted at the P0-03 resolution (2026-08-29): this used to expect a
    // 402 for Free, per the PR #44 gating fix. The audit log is now free on
    // every account, and crucially the window is the SAME: when the 402 gate
    // became a pass-through, a dormant plan branch would have quietly served
    // Free accounts a 30-day view. Same window, no gate.
    (query as any).mockReset();
    setQueries([{ rows: [] }]);
    await LIST_AUDIT(makeEvent({
      customer: { id: "cust_free", email: "x", plan: "free" },
      method: "GET",
      url: "https://dashboard.test/api/v1/account/audit",
      routeId: "/api/v1/account/audit",
    }));
    const freeRetentionParam = (query as any).mock.calls[0][1][1] as Date;
    const freeAge = Date.now() - freeRetentionParam.getTime();
    expect(freeAge).toBeGreaterThan(360 * 24 * 60 * 60 * 1000);
    expect(freeAge).toBeLessThan(370 * 24 * 60 * 60 * 1000);
  });

  it("ignores filter values not on the allowlist", async () => {
    setQueries([{ rows: [] }]);
    await LIST_AUDIT(makeEvent({
      customer: { id: "cust_owner", email: "x", plan: "pro" },
      method: "GET",
      url: "https://dashboard.test/api/v1/account/audit?action=DROP+TABLE&result=success",
      routeId: "/api/v1/account/audit",
    }));
    const call = (query as any).mock.calls[0];
    // 'success' is allowed, 'DROP TABLE' is not.
    expect(call[1]).toContain("success");
    for (const p of call[1] as unknown[]) {
      expect(String(p)).not.toMatch(/DROP TABLE/i);
    }
  });
});
