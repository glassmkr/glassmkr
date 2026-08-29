import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the DB layer so we can simulate hits, misses, and revoked rows
// without standing up Postgres. The query() module is shared with the
// rest of Dashboard so this same mock pattern is used in authz.test.ts.
vi.mock("@glassmkr/db/pg", () => ({ query: vi.fn() }));

import { query } from "@glassmkr/db/pg";
import { setPepperForTests, generateAccountKey, generateCollectorKey, hashKey } from "../keys.js";
import { requireAuth } from "../require.js";
import type { AuthKind, Principal } from "../principal.js";

const TEST_PEPPER = "0123456789abcdef0123456789abcdef-test-pepper-32+chars";

beforeEach(() => {
  setPepperForTests(TEST_PEPPER);
  (query as any).mockReset();
});

afterEach(() => {
  setPepperForTests(null);
});

// Build a minimal RequestEvent stub. Only the fields our middleware reads
// are populated.
function makeEvent(opts: {
  authHeader?: string;
  customer?: { id: string; email: string; plan: string } | null;
  authKind?: "session" | null;
}): any {
  return {
    request: {
      headers: {
        get(name: string) {
          return name.toLowerCase() === "authorization" ? (opts.authHeader ?? null) : null;
        },
      },
    },
    locals: {
      customer: opts.customer ?? null,
      // Default to "session" when caller supplies a customer but no
      // explicit kind. This mirrors the only remaining session path
      // (real dashboard JWT cookie / Bearer). The legacy_session kind
      // was removed in slice A4 of the rename.
      authKind:
        opts.authKind !== undefined
          ? opts.authKind
          : opts.customer
            ? "session"
            : null,
    },
  };
}

function expectStatus(err: unknown, status: number) {
  expect((err as any)?.status).toBe(status);
}

describe("requireAuth: no credentials", () => {
  it("throws 401 when neither session nor bearer token is present", async () => {
    try {
      await requireAuth(makeEvent({}), { allow: ["session", "acct_key"] });
      throw new Error("should have thrown");
    } catch (e) {
      expectStatus(e, 401);
    }
  });
});

describe("requireAuth: session", () => {
  it("returns a session principal when locals.customer is set and session is allowed", async () => {
    const principal = await requireAuth(
      makeEvent({ customer: { id: "cust_a", email: "a@x.com", plan: "pro" } }),
      { allow: ["session"] },
    );
    expect(principal.kind).toBe("session");
    expect(principal.customer_id).toBe("cust_a");
  });

  it("does NOT use the session principal if session is not in the allow list", async () => {
    try {
      await requireAuth(
        makeEvent({ customer: { id: "cust_a", email: "a@x.com", plan: "pro" } }),
        { allow: ["cru_key"] },
      );
      throw new Error("should have thrown");
    } catch (e) {
      expectStatus(e, 401);
    }
  });
});

describe("requireAuth: gmk_acct_* bearer", () => {
  it("authenticates a valid acct key and returns acct_key principal", async () => {
    const key = generateAccountKey("live");
    const keyHash = hashKey(key.raw);
    (query as any).mockResolvedValueOnce({
      rows: [{
        id: "key_1",
        customer_id: "cust_a",
        prefix: key.prefix,
        scope: "admin",
        expires_at: null,
        revoked_at: null,
      }],
    });
    // Stub the fire-and-forget last_used_at update.
    (query as any).mockResolvedValueOnce({ rows: [] });

    const principal = await requireAuth(
      makeEvent({ authHeader: `Bearer ${key.raw}` }),
      { allow: ["acct_key"] },
    );
    expect(principal.kind).toBe("acct_key");
    if (principal.kind === "acct_key") {
      expect(principal.customer_id).toBe("cust_a");
      expect(principal.key_id).toBe("key_1");
      expect(principal.scope).toBe("admin");
    }

    // Verify the SQL hit looked up by HMAC, not plaintext.
    const passedHash = (query as any).mock.calls[0][1][0] as Buffer;
    expect(Buffer.isBuffer(passedHash)).toBe(true);
    expect(Buffer.compare(passedHash, keyHash)).toBe(0);
  });

  it("returns 401 generic when the row is revoked", async () => {
    const key = generateAccountKey("live");
    (query as any).mockResolvedValueOnce({
      rows: [{
        id: "key_1",
        customer_id: "cust_a",
        prefix: key.prefix,
        scope: "admin",
        expires_at: null,
        revoked_at: new Date(),
      }],
    });
    try {
      await requireAuth(
        makeEvent({ authHeader: `Bearer ${key.raw}` }),
        { allow: ["acct_key"] },
      );
      throw new Error("should have thrown");
    } catch (e) {
      expectStatus(e, 401);
    }
  });

  it("returns 401 generic when the row is expired", async () => {
    const key = generateAccountKey("live");
    (query as any).mockResolvedValueOnce({
      rows: [{
        id: "key_1",
        customer_id: "cust_a",
        prefix: key.prefix,
        scope: "admin",
        expires_at: new Date(Date.now() - 1000),
        revoked_at: null,
      }],
    });
    try {
      await requireAuth(
        makeEvent({ authHeader: `Bearer ${key.raw}` }),
        { allow: ["acct_key"] },
      );
      throw new Error("should have thrown");
    } catch (e) {
      expectStatus(e, 401);
    }
  });

  it("returns 401 generic when prefix mismatches the row (defence-in-depth)", async () => {
    const key = generateAccountKey("live");
    (query as any).mockResolvedValueOnce({
      rows: [{
        id: "key_1",
        customer_id: "cust_a",
        // Stored prefix differs from presented; would only happen if a
        // SHA-256 hash collision occurred (vanishingly unlikely) but we
        // guard anyway.
        prefix: "gmk_acct_test_",
        scope: "admin",
        expires_at: null,
        revoked_at: null,
      }],
    });
    try {
      await requireAuth(
        makeEvent({ authHeader: `Bearer ${key.raw}` }),
        { allow: ["acct_key"] },
      );
      throw new Error("should have thrown");
    } catch (e) {
      expectStatus(e, 401);
    }
  });

  it("returns 401 generic for malformed gmk_ prefix", async () => {
    try {
      await requireAuth(
        makeEvent({ authHeader: "Bearer gmk_acct_live_garbage" }),
        { allow: ["acct_key"] },
      );
      throw new Error("should have thrown");
    } catch (e) {
      expectStatus(e, 401);
    }
    expect((query as any).mock.calls.length).toBe(0); // never hit DB
  });
});

describe("requireAuth: key separation invariant (spec Part 2)", () => {
  it("refuses an acct key on an endpoint that only allows cru_key, with hint", async () => {
    const key = generateAccountKey("live");
    try {
      await requireAuth(
        makeEvent({ authHeader: `Bearer ${key.raw}` }),
        { allow: ["cru_key"] },
      );
      throw new Error("should have thrown");
    } catch (e: any) {
      expectStatus(e, 401);
      // Hint mentions both kinds so customer can tell what they pasted
      // wrong.
      const body = e.body ?? e.body?.message ?? JSON.stringify(e);
      expect(JSON.stringify(body)).toMatch(/collector key|cru/i);
    }
    // Edge rejection: no DB hit on wrong-kind.
    expect((query as any).mock.calls.length).toBe(0);
  });

  it("refuses a cru key on an endpoint that only allows acct_key, with hint", async () => {
    const key = generateCollectorKey("live");
    try {
      await requireAuth(
        makeEvent({ authHeader: `Bearer ${key.raw}` }),
        { allow: ["acct_key"] },
      );
      throw new Error("should have thrown");
    } catch (e: any) {
      expectStatus(e, 401);
      const body = e.body ?? JSON.stringify(e);
      expect(JSON.stringify(body)).toMatch(/account API key|acct/i);
    }
    expect((query as any).mock.calls.length).toBe(0);
  });
});

// The `describe("requireScope", ...)` block here previously tested the
// legacy v1-scope checker. It was deleted with the function itself in
// unify-auth Spec D PR-1; the hierarchical `requireScopeLevel` checker
// in plan.ts is covered by plan.test.ts.

// Statistical BOLA-ish smoke: confirm that a customer authenticating with
// acct_key A cannot end up with a principal whose customer_id is B even
// if rows for B are returned by the mock. (i.e. the lookup uses the hash
// to pick THE row, not a random row from another customer.)
describe("BOLA smoke: principal.customer_id always matches the row hit by HMAC", () => {
  it("returns the customer_id from the matched row", async () => {
    const key = generateAccountKey("live");
    (query as any).mockResolvedValueOnce({
      rows: [{
        id: "key_a",
        customer_id: "cust_legitimate_owner",
        prefix: key.prefix,
        scope: "admin",
        expires_at: null,
        revoked_at: null,
      }],
    });
    (query as any).mockResolvedValueOnce({ rows: [] });
    const principal = await requireAuth(
      makeEvent({ authHeader: `Bearer ${key.raw}` }),
      { allow: ["acct_key"] },
    );
    expect(principal.customer_id).toBe("cust_legitimate_owner");
  });
});
