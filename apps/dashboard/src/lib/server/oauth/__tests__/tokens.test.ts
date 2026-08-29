import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ txQuery: vi.fn(), query: vi.fn() }));

vi.mock("@glassmkr/db/pg", () => ({
  query: mocks.query,
  withTransaction: vi.fn(async (callback) => callback({ query: mocks.txQuery })),
}));

import { pkceS256 } from "../crypto.js";
import { exchangeAuthorizationCode, rotateRefreshToken } from "../tokens.js";

beforeEach(() => {
  process.env.MCP_OAUTH_TOKEN_PEPPER = "test-pepper-with-at-least-thirty-two-bytes";
  mocks.txQuery.mockReset();
  mocks.query.mockReset();
});

function liveGrantRow(overrides: Record<string, unknown> = {}) {
  const epoch = new Date("2026-07-18T10:00:00.000Z");
  return {
    id: "code-id",
    grant_id: "grant-id",
    client_id: "client-id",
    customer_id: "customer-id",
    scopes: ["glassmkr:read"],
    resource: "https://app.glassmkr.com/mcp",
    redirect_uri: "https://client.example/callback",
    code_challenge: pkceS256("v".repeat(43)),
    expires_at: new Date(Date.now() + 60_000),
    consumed_at: null,
    grant_expires_at: new Date(Date.now() + 86_400_000),
    grant_revoked_at: null,
    session_epoch_at_issue: epoch,
    session_epoch: epoch,
    customer_status: "active",
    client_disabled_at: null,
    ...overrides,
  };
}

describe("MCP OAuth token exchange", () => {
  it("consumes a matching authorization code and issues opaque token pairs", async () => {
    mocks.txQuery
      .mockResolvedValueOnce({ rows: [liveGrantRow()] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "code-id" }] })
      .mockResolvedValue({ rowCount: 1, rows: [] });

    const pair = await exchangeAuthorizationCode({
      code: "gmk_mcp_code_secret",
      clientId: "client-id",
      redirectUri: "https://client.example/callback",
      resource: "https://app.glassmkr.com/mcp",
      codeVerifier: "v".repeat(43),
    });

    expect(pair.accessToken).toMatch(/^gmk_mcp_at_/);
    expect(pair.refreshToken).toMatch(/^gmk_mcp_rt_/);
    expect(pair.scope).toBe("glassmkr:read");
    expect(mocks.txQuery.mock.calls.some(([sql]) => String(sql).includes("consumed_at = NOW()")))
      .toBe(true);
  });

  it("does not consume a code when PKCE verification fails", async () => {
    mocks.txQuery.mockResolvedValueOnce({ rows: [liveGrantRow()] });
    await expect(exchangeAuthorizationCode({
      code: "gmk_mcp_code_secret",
      clientId: "client-id",
      redirectUri: "https://client.example/callback",
      resource: "https://app.glassmkr.com/mcp",
      codeVerifier: "x".repeat(43),
    })).rejects.toMatchObject({ code: "invalid_grant" });
    expect(mocks.txQuery).toHaveBeenCalledTimes(1);
  });

  it("revokes the whole refresh family when a consumed token is reused", async () => {
    mocks.txQuery
      .mockResolvedValueOnce({
        rows: [liveGrantRow({
          token_id: "refresh-id",
          family_id: "family-id",
          idle_expires_at: new Date(Date.now() + 60_000),
          token_revoked_at: null,
          consumed_at: new Date(),
        })],
      })
      .mockResolvedValue({ rowCount: 1, rows: [] });

    await expect(rotateRefreshToken({
      refreshToken: "gmk_mcp_rt_reused",
      clientId: "client-id",
      resource: "https://app.glassmkr.com/mcp",
    })).rejects.toMatchObject({ code: "invalid_grant" });

    const statements = mocks.txQuery.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => sql.includes("refresh_token_reuse"))).toBe(true);
    expect(statements.some((sql) => sql.includes("WHERE family_id = $1"))).toBe(true);
  });
});
