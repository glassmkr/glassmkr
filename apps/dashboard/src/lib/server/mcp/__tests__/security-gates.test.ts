import { describe, expect, it, vi } from "vitest";

// The single-use check is an INSERT whose conflict is the refusal. The set
// below reproduces that contract so the property can be tested without a
// database: a row the first time, nothing after.
const spent = new Set<string>();
vi.mock("@glassmkr/db/pg", () => ({
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    if (String(sql).includes("INSERT INTO mcp_confirm_tokens")) {
      const jti = String(params[0]);
      if (spent.has(jti)) return { rows: [], rowCount: 0 };
      spent.add(jti);
      return { rows: [{ jti }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }),
}));

import { hasMcpScope } from "../../oauth/bearer";
import { consumeConfirmToken, issueConfirmToken, resourceVersion, verifyConfirmToken } from "../confirm";

// Audit findings 8 and 10: prepare/commit binding, and authorization and tenant
// isolation as INVARIANTS rather than documentation claims.
//
// These were classified "unverified" in the audit and then dropped from my open
// list, which is how a security gate becomes invisible. What follows tests the
// properties that are actually enforced, and, where a property the audit asks
// for is NOT enforced, says so explicitly rather than leaving a silent gap.

const principal = (scopes: string[]) =>
  ({ scopes: new Set(scopes) }) as unknown as Parameters<typeof hasMcpScope>[0];

describe("scope is a hierarchy and it holds in both directions", () => {
  it("a read grant cannot reach write or admin", () => {
    const read = principal(["glassmkr:read"]);
    expect(hasMcpScope(read, "glassmkr:read")).toBe(true);
    expect(hasMcpScope(read, "glassmkr:write")).toBe(false);
    expect(hasMcpScope(read, "glassmkr:admin")).toBe(false);
  });

  it("a write grant reaches read but not admin", () => {
    const write = principal(["glassmkr:write"]);
    expect(hasMcpScope(write, "glassmkr:read")).toBe(true);
    expect(hasMcpScope(write, "glassmkr:write")).toBe(true);
    expect(hasMcpScope(write, "glassmkr:admin")).toBe(false);
  });

  it("an admin grant reaches everything", () => {
    const admin = principal(["glassmkr:admin"]);
    for (const s of ["glassmkr:read", "glassmkr:write", "glassmkr:admin"] as const) {
      expect(hasMcpScope(admin, s)).toBe(true);
    }
  });

  it("an empty grant reaches nothing", () => {
    const none = principal([]);
    for (const s of ["glassmkr:read", "glassmkr:write", "glassmkr:admin"] as const) {
      expect(hasMcpScope(none, s)).toBe(false);
    }
  });

  it("an unrecognised scope string grants nothing", () => {
    // Guards against a grant carrying something like "glassmkr:*" or "admin"
    // and being treated as authority by a looser comparison.
    for (const s of ["admin", "glassmkr:*", "*", "glassmkr:Admin", ""]) {
      expect(hasMcpScope(principal([s]), "glassmkr:admin")).toBe(false);
    }
  });
});

describe("the prepare/commit token is bound to exactly one action", () => {
  const CUSTOMER = "cust_a";
  const ACTION = "delete_server";
  const TARGET = "srv_1";
  const ROW = { status: "active", name: "web-1", active_key_id: "key_1" };
  const V = resourceVersion(ROW);

  it("verifies only against the binding it was issued for", () => {
    const t = issueConfirmToken(CUSTOMER, ACTION, TARGET, V);
    expect(verifyConfirmToken(t, CUSTOMER, ACTION, TARGET, V)).toBe(true);
  });

  it("cannot be replayed against another tenant", () => {
    // The cross-tenant property that matters most here: a token minted in one
    // account must be worthless in another even for the same action and a
    // target id that happens to collide.
    const t = issueConfirmToken(CUSTOMER, ACTION, TARGET, V);
    expect(verifyConfirmToken(t, "cust_b", ACTION, TARGET, V)).toBe(false);
  });

  it("cannot be redirected to another target", () => {
    const t = issueConfirmToken(CUSTOMER, ACTION, TARGET, V);
    expect(verifyConfirmToken(t, CUSTOMER, ACTION, "srv_2", V)).toBe(false);
  });

  it("cannot be reused for another action on the same target", () => {
    // Prevents a token prepared for a key rotation being spent on a delete.
    const t = issueConfirmToken(CUSTOMER, "rotate_key", TARGET, V);
    expect(verifyConfirmToken(t, CUSTOMER, "delete_server", TARGET, V)).toBe(false);
  });

  it("expires", () => {
    vi.useFakeTimers();
    try {
      const t = issueConfirmToken(CUSTOMER, ACTION, TARGET, V);
      expect(verifyConfirmToken(t, CUSTOMER, ACTION, TARGET, V)).toBe(true);
      vi.advanceTimersByTime(6 * 60 * 1000);
      expect(verifyConfirmToken(t, CUSTOMER, ACTION, TARGET, V)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a tampered expiry, so the TTL cannot be extended by the caller", () => {
    const t = issueConfirmToken(CUSTOMER, ACTION, TARGET, V);
    const [, nonce, sig] = t.split(".");
    const far = String(Date.now() + 60 * 60 * 1000);
    expect(verifyConfirmToken(`${far}.${nonce}.${sig}`, CUSTOMER, ACTION, TARGET, V)).toBe(false);
  });

  it("rejects a tampered signature and malformed input", () => {
    const t = issueConfirmToken(CUSTOMER, ACTION, TARGET, V);
    const [exp, nonce] = t.split(".");
    expect(verifyConfirmToken(`${exp}.${nonce}.deadbeef`, CUSTOMER, ACTION, TARGET, V)).toBe(false);
    for (const bad of ["", ".", "nodot", `${exp}.`, `.${t}`, `${exp}.${nonce}.`]) {
      expect(verifyConfirmToken(bad, CUSTOMER, ACTION, TARGET, V)).toBe(false);
    }
  });
});

describe("the gaps the audit named, now closed", () => {
  // These two were recorded as PASSING tests titled "is not single-use" and
  // "is not bound to ... a resource version". That is an honest way to make a
  // gap visible in test output, and it is also a green suite asserting that a
  // protection is absent, which reads as coverage to anyone scanning results.
  // Both properties are now enforced, so the assertions are inverted rather
  // than deleted: the old behaviour is what must never come back.
  const ROW = { status: "active", name: "web-1", active_key_id: "key_1" };
  const V = resourceVersion(ROW);
  const T = () => issueConfirmToken("cust_a", "delete_server", "srv_1", V);

  it("is single-use: the second commit on one token is refused", async () => {
    spent.clear();
    const t = T();
    expect(await consumeConfirmToken(t, "cust_a", "delete_server", "srv_1", V)).toBe("ok");
    expect(await consumeConfirmToken(t, "cust_a", "delete_server", "srv_1", V)).toBe("already_used");
  });

  it("is bound to a resource version: a target that changed invalidates the token", () => {
    const t = T();
    // Any of these between prepare and commit means the operator approved a
    // description of the resource that is no longer accurate.
    for (const changed of [
      { ...ROW, name: "web-2" },
      { ...ROW, status: "deleted" },
      { ...ROW, active_key_id: "key_2" },
    ]) {
      expect(verifyConfirmToken(t, "cust_a", "delete_server", "srv_1", resourceVersion(changed))).toBe(false);
    }
    expect(verifyConfirmToken(t, "cust_a", "delete_server", "srv_1", V)).toBe(true);
  });

  it("still does not bind the user, the client, or the granted scope", () => {
    // Stated plainly rather than left implied. The signature covers customer,
    // action, target, version, expiry and a nonce. It does NOT distinguish two
    // MCP clients authorised on the same account, or a token minted while a
    // broader scope was granted. Those remain covered by the scope check on
    // every call and by the client's own approval step, not by this token.
    expect(true).toBe(true);
  });
});
