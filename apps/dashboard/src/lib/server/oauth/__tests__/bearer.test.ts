import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@glassmkr/db/pg", () => ({ query: vi.fn() }));

import { query } from "@glassmkr/db/pg";
import { authenticateMcpBearer } from "../bearer.js";

beforeEach(() => {
  process.env.MCP_OAUTH_TOKEN_PEPPER = "test-pepper-with-at-least-thirty-two-bytes";
  process.env.MCP_PUBLIC_ORIGIN = "https://app.glassmkr.com";
  vi.mocked(query).mockReset();
});

function liveTokenRow(overrides: Record<string, unknown> = {}) {
  const epoch = new Date("2026-07-18T10:00:00.000Z");
  return {
    token_id: "token-id",
    token_expires_at: new Date(Date.now() + 60_000),
    token_revoked_at: null,
    grant_id: "grant-id",
    customer_id: "customer-id",
    client_id: "client-id",
    scopes: ["glassmkr:read"],
    resource: "https://app.glassmkr.com/mcp",
    grant_expires_at: new Date(Date.now() + 86_400_000),
    grant_revoked_at: null,
    session_epoch_at_issue: epoch,
    email: "owner@example.com",
    plan: "pro",
    status: "active",
    session_epoch: epoch,
    client_name: "Pilot client",
    redirect_uris: ["https://client.example/callback"],
    client_disabled_at: null,
    ...overrides,
  };
}

describe("MCP bearer authentication", () => {
  it("returns a tenant-bound principal for a live token", async () => {
    vi.mocked(query).mockImplementation(async (sql) => (
      String(sql).includes("FROM mcp_oauth_access_tokens")
        ? { rows: [liveTokenRow()], rowCount: 1 }
        : { rows: [], rowCount: 1 }
    ) as never);
    const request = new Request("https://app.glassmkr.com/mcp", {
      headers: { Authorization: "Bearer gmk_mcp_at_valid" },
    });
    const principal = await authenticateMcpBearer(request);
    expect(principal).toMatchObject({
      kind: "oauth",
      customer_id: "customer-id",
      client_id: "client-id",
      grant_id: "grant-id",
      resource: "https://app.glassmkr.com/mcp",
    });
    expect(principal?.allowed_origins.has("https://client.example")).toBe(true);
  });

  it("rejects a token issued for another resource", async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [liveTokenRow({ resource: "https://api.example.com/mcp" })],
      rowCount: 1,
    } as never);
    const request = new Request("https://app.glassmkr.com/mcp", {
      headers: { Authorization: "Bearer gmk_mcp_at_wrong_audience" },
    });
    await expect(authenticateMcpBearer(request)).resolves.toBeNull();
  });

  it("rejects a token minted before the current session epoch", async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [liveTokenRow({ session_epoch: new Date("2026-07-18T11:00:00.000Z") })],
      rowCount: 1,
    } as never);
    const request = new Request("https://app.glassmkr.com/mcp", {
      headers: { Authorization: "Bearer gmk_mcp_at_stale" },
    });
    await expect(authenticateMcpBearer(request)).resolves.toBeNull();
  });
});

// Audit finding 10 asks for authorization to be tested as INVARIANTS rather
// than documentation claims. authenticateMcpBearer has eight independent
// rejection conditions; three were covered. Every one is now exercised, because
// a condition nobody tests is a condition that can be deleted in a refactor
// without anything going red.
describe("every rejection condition actually rejects", () => {
  const CASES: Array<[string, Record<string, unknown>, string]> = [
    ["the access token was revoked", { token_revoked_at: new Date() },
      "revocation must take effect immediately, not at next expiry"],
    ["the access token expired", { token_expires_at: new Date(Date.now() - 1000) }, ""],
    ["the grant was revoked", { grant_revoked_at: new Date() },
      "revoking a grant kills every token issued under it"],
    ["the grant expired", { grant_expires_at: new Date(Date.now() - 1000) }, ""],
    ["the client was disabled", { client_disabled_at: new Date() },
      "disabling a client must not wait for its tokens to expire"],
    ["the customer is suspended", { status: "suspended" }, ""],
    ["the token is for another resource", { resource: "https://elsewhere.example/mcp" },
      "audience binding: a token minted for another resource is not ours"],
    ["the password was reset since issue", { session_epoch: new Date("2030-01-01T00:00:00.000Z") },
      "a password reset invalidates tokens minted before it"],
    ["the grant lost the base read scope", { scopes: [] }, ""],
  ];

  for (const [name, overrides, why] of CASES) {
    it(`rejects when ${name}${why ? `: ${why}` : ""}`, async () => {
      vi.mocked(query).mockImplementation(async (sql) => (
        String(sql).includes("FROM mcp_oauth_access_tokens")
          ? { rows: [liveTokenRow(overrides)], rowCount: 1 }
          : { rows: [], rowCount: 1 }
      ) as never);
      const request = new Request("https://app.glassmkr.com/mcp", {
        headers: { authorization: "Bearer gmk_mcp_at_test" },
      });
      await expect(authenticateMcpBearer(request)).resolves.toBeNull();
    });
  }

  it("rejects an unknown token without leaking whether it ever existed", async () => {
    vi.mocked(query).mockImplementation(async () => ({ rows: [], rowCount: 0 }) as never);
    const request = new Request("https://app.glassmkr.com/mcp", {
      headers: { authorization: "Bearer gmk_mcp_at_never_issued" },
    });
    await expect(authenticateMcpBearer(request)).resolves.toBeNull();
  });
});
