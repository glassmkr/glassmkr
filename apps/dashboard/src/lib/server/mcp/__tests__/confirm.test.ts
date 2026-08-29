import { beforeEach, describe, expect, it, vi } from "vitest";

// consumeConfirmToken spends the token in Postgres, so the table is stood in
// for here by a set. The property under test is not "Postgres works", it is
// "the second use of a token is refused", and the ON CONFLICT DO NOTHING
// contract is what the fake reproduces: an insert returns a row the first time
// and nothing thereafter.
const spent = new Set<string>();
vi.mock("@glassmkr/db/pg", () => ({
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("INSERT INTO mcp_confirm_tokens")) {
      const jti = String(params[0]);
      if (spent.has(jti)) return { rows: [], rowCount: 0 };
      spent.add(jti);
      return { rows: [{ jti }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }),
}));

import {
  confirmTokenId,
  consumeConfirmToken,
  issueConfirmToken,
  resourceVersion,
  verifyConfirmToken,
} from "../confirm.js";

const T0 = 1_000_000_000_000; // fixed base time; tokens are TTL-bounded from here
const V = resourceVersion({ status: "active", name: "web-1", active_key_id: "key_1" });

beforeEach(() => {
  process.env.MCP_OAUTH_TOKEN_PEPPER = "test-pepper-with-at-least-thirty-two-bytes";
  spent.clear();
});

describe("MCP destructive confirm tokens", () => {
  it("verifies a token against the exact binding it was issued for", () => {
    const token = issueConfirmToken("cust-a", "delete_server", "srv-1", V, T0);
    expect(verifyConfirmToken(token, "cust-a", "delete_server", "srv-1", V, T0 + 1000)).toBe(true);
  });

  it("rejects a token used for a different customer, action, or target", () => {
    const token = issueConfirmToken("cust-a", "delete_server", "srv-1", V, T0);
    expect(verifyConfirmToken(token, "cust-b", "delete_server", "srv-1", V, T0 + 1000)).toBe(false);
    expect(verifyConfirmToken(token, "cust-a", "rotate_key", "srv-1", V, T0 + 1000)).toBe(false);
    expect(verifyConfirmToken(token, "cust-a", "delete_server", "srv-2", V, T0 + 1000)).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const token = issueConfirmToken("cust-a", "delete_server", "srv-1", V, T0);
    const tampered = `${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`;
    expect(verifyConfirmToken(tampered, "cust-a", "delete_server", "srv-1", V, T0 + 1000)).toBe(false);
  });

  it("rejects an expired token", () => {
    const token = issueConfirmToken("cust-a", "delete_server", "srv-1", V, T0);
    // 5-minute TTL: well past it.
    expect(verifyConfirmToken(token, "cust-a", "delete_server", "srv-1", V, T0 + 10 * 60 * 1000)).toBe(false);
  });

  it("rejects malformed tokens", () => {
    for (const bad of ["", "no-dot", ".sig-only", "notanumber.nonce.deadbeef", "1.2", "a.b.c.d"]) {
      expect(verifyConfirmToken(bad, "c", "a", "t", V, T0)).toBe(false);
    }
  });

  it("issues a distinct token each time, so one prepare cannot spend another", () => {
    // Without a nonce the signature is a pure function of the binding, and two
    // prepares in the same millisecond produce the same token. Single-use would
    // then make the second prepare unusable.
    const a = issueConfirmToken("cust-a", "delete_server", "srv-1", V, T0);
    const b = issueConfirmToken("cust-a", "delete_server", "srv-1", V, T0);
    expect(a).not.toBe(b);
    expect(confirmTokenId(a)).not.toBe(confirmTokenId(b));
  });
});

describe("the token is bound to the target's version", () => {
  // The fields are what resource-version.ts selects. The first version of this
  // list named `deleted_at`, which is not a column on servers, and
  // `api_key_hash`, which rotation sets to NULL because the live collector key
  // lives in account_api_keys. `active_key_id` is the id of the non-revoked
  // key row: it changes on every rotation and discloses nothing.
  const row = { status: "active", name: "web-1", active_key_id: "key_1" };

  it("changes when a versioned field changes", () => {
    const base = resourceVersion(row);
    expect(resourceVersion({ ...row, name: "web-2" })).not.toBe(base);
    expect(resourceVersion({ ...row, status: "suspended" })).not.toBe(base);
    expect(resourceVersion({ ...row, status: "deleted" })).not.toBe(base);
    expect(resourceVersion({ ...row, active_key_id: "key_2" })).not.toBe(base);
  });

  it("does not change when unrelated telemetry moves", () => {
    // last_seen_at changes every few minutes on a healthy host. If it were
    // versioned, every token would be dead before an operator read the preview.
    expect(resourceVersion({ ...row, last_seen_at: new Date(T0), collector_version: "0.15.1" }))
      .toBe(resourceVersion(row));
  });

  it("refuses a token whose target changed between prepare and commit", () => {
    const token = issueConfirmToken("cust-a", "rotate_key", "srv-1", resourceVersion(row), T0);
    // Someone else rotated the key in the meantime.
    const after = resourceVersion({ ...row, active_key_id: "key_2" });
    expect(verifyConfirmToken(token, "cust-a", "rotate_key", "srv-1", after, T0 + 1000)).toBe(false);
  });

  it("treats a target that does not exist as its own version", () => {
    // enroll_server signs "absent". A server appearing under that name before
    // the commit must invalidate the token.
    const token = issueConfirmToken("cust-a", "enroll_server", "web-9", resourceVersion(null), T0);
    expect(verifyConfirmToken(token, "cust-a", "enroll_server", "web-9", resourceVersion(null), T0 + 1000)).toBe(true);
    expect(verifyConfirmToken(token, "cust-a", "enroll_server", "web-9", resourceVersion(row), T0 + 1000)).toBe(false);
  });
});

describe("a confirm token is single-use", () => {
  it("authorises the first commit and refuses every one after it", async () => {
    const token = issueConfirmToken("cust-a", "delete_server", "srv-1", V, T0);
    expect(await consumeConfirmToken(token, "cust-a", "delete_server", "srv-1", V, T0 + 1000)).toBe("ok");
    expect(await consumeConfirmToken(token, "cust-a", "delete_server", "srv-1", V, T0 + 2000)).toBe("already_used");
    expect(await consumeConfirmToken(token, "cust-a", "delete_server", "srv-1", V, T0 + 3000)).toBe("already_used");
  });

  it("distinguishes a replay from an invalid token, so the operator is told which", async () => {
    const token = issueConfirmToken("cust-a", "delete_server", "srv-1", V, T0);
    expect(await consumeConfirmToken(token, "cust-b", "delete_server", "srv-1", V, T0 + 1000)).toBe("invalid");
    // A rejected verification must not spend the token: the legitimate holder
    // can still use it.
    expect(await consumeConfirmToken(token, "cust-a", "delete_server", "srv-1", V, T0 + 1000)).toBe("ok");
  });

  it("does not spend an expired token, it simply refuses it", async () => {
    const token = issueConfirmToken("cust-a", "delete_server", "srv-1", V, T0);
    expect(await consumeConfirmToken(token, "cust-a", "delete_server", "srv-1", V, T0 + 10 * 60 * 1000)).toBe("invalid");
  });

  it("gives concurrent commits on one token exactly one winner", async () => {
    const token = issueConfirmToken("cust-a", "delete_server", "srv-1", V, T0);
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () => consumeConfirmToken(token, "cust-a", "delete_server", "srv-1", V, T0 + 1000)),
    );
    expect(outcomes.filter((o) => o === "ok")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "already_used")).toHaveLength(4);
  });

  it("records a hash of the token, never the token", async () => {
    const { query } = await import("@glassmkr/db/pg");
    const token = issueConfirmToken("cust-a", "delete_server", "srv-1", V, T0);
    await consumeConfirmToken(token, "cust-a", "delete_server", "srv-1", V, T0 + 1000);
    // The LAST insert, not the first: the mock accumulates calls across every
    // test in this file, and the first one belongs to whichever test ran first.
    const inserts = vi.mocked(query).mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO mcp_confirm_tokens"));
    const insert = inserts.at(-1);
    expect(insert).toBeDefined();
    const params = (insert?.[1] ?? []) as unknown[];
    expect(params[0]).toBe(confirmTokenId(token));
    expect(JSON.stringify(params)).not.toContain(token);
  });
});
