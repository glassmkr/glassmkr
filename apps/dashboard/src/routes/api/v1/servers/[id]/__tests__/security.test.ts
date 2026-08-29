// Route-level security tests for /api/v1/servers/{id} (GET / PATCH / DELETE)
// and /api/v1/servers/{id}/rotate-key (POST).
//
// Same shape as the POST /api/v1/servers test suite: mock the DB, mock
// Redis (force degrade-open), mock bcrypt, mock billing sync. Verify
// BOLA, mass assignment, key separation, and the per-endpoint sub-limit
// for rotate-key.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@glassmkr/db/pg", () => {
  const queryFn = vi.fn();
  return {
    query: queryFn,
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
vi.mock("$lib/server/redis", () => ({
  getRedis: () => null,
  setRedisForTests: () => {},
  quitRedis: async () => {},
}));

import { query } from "@glassmkr/db/pg";
import { GET, PATCH, DELETE } from "../+server.js";
import { POST as ROTATE } from "../rotate-key/+server.js";
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
  serverId?: string;
  customer?: { id: string; email: string; plan: string } | null;
  authHeader?: string;
  body?: unknown;
  method?: string;
  url?: string;
}): any {
  return {
    request: {
      method: opts.method ?? "GET",
      url: opts.url ?? `https://dashboard.test/api/v1/servers/${opts.serverId ?? "srv_x"}`,
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
    params: { id: opts.serverId ?? "srv_x" },
    url: new URL(opts.url ?? `https://dashboard.test/api/v1/servers/${opts.serverId ?? "srv_x"}`),
    getClientAddress: () => "10.0.0.1",
    route: { id: "/api/v1/servers/[id]" },
  };
}

function setQueries(rows: Array<{ rows: unknown[] }>) {
  const m = (query as any).mockReset();
  for (const r of rows) m.mockResolvedValueOnce(r);
  m.mockResolvedValue({ rows: [] });
}

// ============================================================================
// BOLA: each endpoint refuses cross-account access with 404
// ============================================================================

describe("GET /[id]: BOLA", () => {
  it("returns 404 (not 403) when server belongs to a different customer", async () => {
    // requireServerOwnership returns no row when customer_id doesn't match.
    setQueries([{ rows: [] }]);
    try {
      await GET(makeEvent({
        customer: { id: "cust_attacker", email: "x", plan: "pro" },
        serverId: "srv_victim",
      }));
      throw new Error("should have thrown");
    } catch (err: any) {
      expect(err.status).toBe(404);
    }
    // The query MUST have included customer_id constraint.
    const call = (query as any).mock.calls[0];
    expect(call[0]).toMatch(/WHERE id = \$1 AND customer_id = \$2/);
    expect(call[1]).toEqual(["srv_victim", "cust_attacker"]);
  });

  it("returns the row when the server belongs to the authenticated customer", async () => {
    setQueries([
      { rows: [{ id: "srv_mine" }] }, // ownership check
      { rows: [{ id: "srv_mine", name: "mine", hostname: "mine.example", active_alerts: "0" }] }, // full load
    ]);
    const response = await GET(makeEvent({
      customer: { id: "cust_owner", email: "x", plan: "pro" },
      serverId: "srv_mine",
    }));
    expect(response.status).toBe(200);
  });
});

describe("PATCH /[id]: BOLA + mass assignment", () => {
  it("returns 404 when server belongs to a different customer", async () => {
    setQueries([{ rows: [] }]); // ownership check fails
    try {
      await PATCH(makeEvent({
        customer: { id: "cust_attacker", email: "x", plan: "pro" },
        serverId: "srv_victim",
        method: "PATCH",
        body: { name: "hijacked" },
      }));
      throw new Error("should have thrown");
    } catch (err: any) {
      expect(err.status).toBe(404);
    }
  });

  it("drops body-supplied account_id, customer_id, hostname, id, etc.", async () => {
    setQueries([
      { rows: [{ id: "srv_mine" }] }, // ownership check
      { rows: [{ id: "srv_mine", name: "new-name", hostname: "old.example.com", tags: [] }] }, // UPDATE
    ]);

    await PATCH(makeEvent({
      customer: { id: "cust_owner", email: "x", plan: "pro" },
      serverId: "srv_mine",
      method: "PATCH",
      body: {
        name: "new-name",
        // Malicious extras:
        hostname: "attacker-changed-this.com",
        customer_id: "cust_other",
        account_id: "cust_other",
        id: "srv_HIJACK",
        api_key_hash: "deadbeef",
      },
    }));

    // Find the UPDATE call.
    const updateCall = (query as any).mock.calls.find((c: any[]) =>
      String(c[0]).startsWith("UPDATE servers"),
    );
    expect(updateCall).toBeDefined();
    const sql = String(updateCall[0]);
    // The SET clause should reference name (and only name; tags wasn't
    // passed). Hostname is NOT in the allowlist, so it should be absent.
    expect(sql).toMatch(/SET name =/);
    expect(sql).not.toMatch(/SET .*hostname/);
    expect(sql).not.toMatch(/SET .*customer_id/);
    expect(sql).not.toMatch(/SET .*api_key_hash/);
    // The WHERE clause uses the principal's customer_id, not the body's.
    const params = updateCall[1] as unknown[];
    expect(params).toContain("cust_owner");
    expect(params).not.toContain("cust_other");
  });

  it("400s on invalid name", async () => {
    setQueries([{ rows: [{ id: "srv_mine" }] }]); // ownership ok
    const response = await PATCH(makeEvent({
      customer: { id: "cust_owner", email: "x", plan: "pro" },
      serverId: "srv_mine",
      method: "PATCH",
      body: { name: "" },
    }));
    expect(response.status).toBe(400);
  });

  it("returns current row when no updatable fields are sent", async () => {
    setQueries([
      { rows: [{ id: "srv_mine" }] }, // ownership ok
      { rows: [{ id: "srv_mine", name: "current", hostname: "h", tags: ["a"] }] }, // SELECT
    ]);
    const response = await PATCH(makeEvent({
      customer: { id: "cust_owner", email: "x", plan: "pro" },
      serverId: "srv_mine",
      method: "PATCH",
      body: { /* nothing in allowlist */ irrelevant: "x" },
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.server.name).toBe("current");
  });
});

describe("DELETE /[id]: BOLA + confirmation gate", () => {
  it("400s without ?confirm=true", async () => {
    const response = await DELETE(makeEvent({
      customer: { id: "cust_owner", email: "x", plan: "pro" },
      serverId: "srv_mine",
      method: "DELETE",
    }));
    expect(response.status).toBe(400);
  });

  it("returns 404 when server belongs to a different customer (?confirm=true)", async () => {
    setQueries([{ rows: [] }]); // no row matched
    const response = await DELETE(makeEvent({
      customer: { id: "cust_attacker", email: "x", plan: "pro" },
      serverId: "srv_victim",
      method: "DELETE",
      url: "https://dashboard.test/api/v1/servers/srv_victim?confirm=true",
    }));
    expect(response.status).toBe(404);
    // The statement is an UPDATE since 2026-08-28 (soft delete; permanent
    // removal moved to /trashed-servers/{id}). The BOLA property this test
    // exists for is unchanged: the customer_id constraint is in the same
    // statement, so another tenant's row can never be the one it touches.
    const deleteCall = (query as any).mock.calls.find((c: any[]) =>
      String(c[0]).includes("UPDATE servers SET status = 'deleted'"),
    );
    expect(deleteCall).toBeTruthy();
    expect(deleteCall[0]).toMatch(/WHERE id = \$1 AND customer_id = \$2/);
    expect(deleteCall[1]).toEqual(["srv_victim", "cust_attacker"]);
  });

  it("succeeds when authenticated customer owns the server", async () => {
    setQueries([
      { rows: [{ id: "srv_mine", name: "old-name" }] }, // DELETE returning
    ]);
    const response = await DELETE(makeEvent({
      customer: { id: "cust_owner", email: "x", plan: "pro" },
      serverId: "srv_mine",
      method: "DELETE",
      url: "https://dashboard.test/api/v1/servers/srv_mine?confirm=true",
    }));
    expect(response.status).toBe(200);
  });
});

// ============================================================================
// Key separation invariant: cru_key on management endpoint -> 401 + hint
// ============================================================================

describe("/[id] endpoints: key separation invariant", () => {
  it("GET refuses cru_key with hint", async () => {
    const cru = generateCollectorKey("live");
    try {
      await GET(makeEvent({
        authHeader: `Bearer ${cru.raw}`,
        serverId: "srv_x",
      }));
      throw new Error("should have thrown");
    } catch (err: any) {
      expect(err.status).toBe(401);
      const body = JSON.stringify(err.body ?? err);
      expect(body).toMatch(/collector key|cru/i);
    }
  });

  it("PATCH refuses cru_key with hint", async () => {
    const cru = generateCollectorKey("live");
    try {
      await PATCH(makeEvent({
        authHeader: `Bearer ${cru.raw}`,
        serverId: "srv_x",
        method: "PATCH",
        body: { name: "x" },
      }));
      throw new Error("should have thrown");
    } catch (err: any) {
      expect(err.status).toBe(401);
    }
  });

  it("DELETE refuses cru_key with hint", async () => {
    const cru = generateCollectorKey("live");
    try {
      await DELETE(makeEvent({
        authHeader: `Bearer ${cru.raw}`,
        serverId: "srv_x",
        method: "DELETE",
        url: "https://dashboard.test/api/v1/servers/srv_x?confirm=true",
      }));
      throw new Error("should have thrown");
    } catch (err: any) {
      expect(err.status).toBe(401);
    }
  });

  it("rotate-key refuses cru_key with hint", async () => {
    const cru = generateCollectorKey("live");
    try {
      await ROTATE(makeEvent({
        authHeader: `Bearer ${cru.raw}`,
        serverId: "srv_x",
        method: "POST",
      }));
      throw new Error("should have thrown");
    } catch (err: any) {
      expect(err.status).toBe(401);
    }
  });
});

// ============================================================================
// Rotate-key behaviour
// ============================================================================

describe("POST /[id]/rotate-key", () => {
  it("returns a new gmk_cru_live_* key, atomically swaps in account_api_keys, clears legacy hash", async () => {
    setQueries([
      { rows: [{ id: "srv_mine" }] }, // ownership check
      { rows: [] }, // BEGIN
      { rows: [{ id: "old_key", last_4: "wxyz" }] }, // SELECT existing cru rows
      { rows: [] }, // UPDATE revoked_at (revoke old)
      { rows: [] }, // INSERT new
      { rows: [] }, // UPDATE servers SET api_key_hash = NULL
      { rows: [] }, // COMMIT
    ]);
    const response = await ROTATE(makeEvent({
      customer: { id: "cust_owner", email: "x", plan: "pro" },
      serverId: "srv_mine",
      method: "POST",
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    // PR #6 cutover: keys are now in the new gmk_cru_live_* format with
    // a 4-char checksum suffix.
    expect(body.collector_key).toMatch(/^gmk_cru_live_[0-9a-zA-Z]{43}_[0-9a-zA-Z]{4}$/);
    expect(typeof body.rotated_at).toBe("string");

    const calls = (query as any).mock.calls.map((c: any[]) => String(c[0]));
    // BEGIN/COMMIT bracket the swap
    expect(calls).toContain("BEGIN");
    expect(calls).toContain("COMMIT");
    // INSERT into account_api_keys with the new key
    expect(calls.some((s: string) => s.includes("INSERT INTO account_api_keys"))).toBe(true);
    // UPDATE servers SET api_key_hash = NULL completes the cutover
    expect(calls.some((s: string) => s.includes("UPDATE servers SET api_key_hash = NULL"))).toBe(true);

    // Whichever UPDATE/INSERT touched servers used principal.customer_id,
    // never anything from the body. Walk every param of every call.
    for (const [, params] of (query as any).mock.calls) {
      if (Array.isArray(params)) {
        for (const p of params) {
          expect(p).not.toBe("cust_other");
        }
      }
    }
  });

  it("returns 404 if the server doesn't belong to the customer", async () => {
    setQueries([{ rows: [] }]); // ownership fails
    try {
      await ROTATE(makeEvent({
        customer: { id: "cust_attacker", email: "x", plan: "pro" },
        serverId: "srv_victim",
        method: "POST",
      }));
      throw new Error("should have thrown");
    } catch (err: any) {
      expect(err.status).toBe(404);
    }
  });
});

// ============================================================================
// Auth happy path with acct_key
// ============================================================================

describe("acct_key auth on /[id] endpoints", () => {
  it("allows GET with a valid acct_key", async () => {
    const key = generateAccountKey("live");
    setQueries([
      // requireAuth -> lookupAcctKey (Pro-tier gate added 2026-05-12 needs plan=pro)
      { rows: [{
        id: "key_xyz",
        customer_id: "cust_via_key",
        prefix: key.prefix,
        scope: "admin",
        expires_at: null,
        revoked_at: null,
        plan: "pro",
      }] },
      { rows: [] }, // last_used_at update
      { rows: [{ id: "srv_mine" }] }, // ownership
      { rows: [{ id: "srv_mine", name: "my", hostname: "h", active_alerts: "0" }] }, // full load
    ]);

    const response = await GET(makeEvent({
      authHeader: `Bearer ${key.raw}`,
      serverId: "srv_mine",
    }));
    expect(response.status).toBe(200);
    // The ownership check used customer_id from the key lookup, not from
    // any body field.
    const ownershipCall = (query as any).mock.calls.find((c: any[]) =>
      String(c[0]).includes("FROM servers WHERE id = $1 AND customer_id = $2") &&
      !String(c[0]).startsWith("UPDATE"),
    );
    expect(ownershipCall[1]).toEqual(["srv_mine", "cust_via_key"]);
  });
});
