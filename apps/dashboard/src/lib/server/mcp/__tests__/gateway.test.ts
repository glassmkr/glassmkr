import { beforeEach, describe, expect, it } from "vitest";
import type { OAuthPrincipal } from "$lib/server/auth/principal.js";
import {
  getMcpSessionCountForTests,
  handleMcpGatewayRequest,
  resetMcpSessionsForTests,
} from "../gateway.js";

beforeEach(() => {
  process.env.MCP_OAUTH_TOKEN_PEPPER = "test-pepper-with-at-least-thirty-two-bytes";
  resetMcpSessionsForTests();
});

function principal(overrides: Partial<OAuthPrincipal> = {}): OAuthPrincipal {
  return {
    kind: "oauth",
    customer_id: "customer-a",
    user_id: "user-a",
    client_id: "client-a",
    client_name: "Test client",
    grant_id: "grant-a",
    token_id: "token-a",
    scopes: new Set(["glassmkr:read"]),
    scope: "read",
    plan: "pro",
    resource: "https://app.glassmkr.com/mcp",
    allowed_origins: new Set(),
    ...overrides,
  };
}

function eventFor(request: Request): any {
  return {
    request,
    url: new URL(request.url),
    route: { id: "/mcp" },
    locals: { request_id: "00000000-0000-4000-8000-000000000001" },
    getClientAddress: () => "127.0.0.1",
  };
}

describe("MCP session binding", () => {
  it("terminates a session when a different grant presents its identifier", async () => {
    const initialize = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    };
    const initialRequest = new Request("https://app.glassmkr.com/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(initialize),
    });
    const initialResponse = await handleMcpGatewayRequest(
      eventFor(initialRequest),
      principal(),
      initialize,
    );
    expect(initialResponse.status).toBe(200);
    const sessionId = initialResponse.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();
    expect(getMcpSessionCountForTests()).toBe(1);

    const listBody = { jsonrpc: "2.0", id: 2, method: "tools/list" };
    const listRequest = new Request("https://app.glassmkr.com/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "Mcp-Session-Id": sessionId!,
      },
      body: JSON.stringify(listBody),
    });
    const listResponse = await handleMcpGatewayRequest(
      eventFor(listRequest),
      principal({ token_id: "refreshed-token-for-same-grant" }),
      listBody,
    );
    expect(listResponse.status).toBe(200);
    const listPayload = await listResponse.json() as any;
    expect(listPayload.result.tools.map((tool: any) => tool.name)).toEqual([
      "glassmkr.fleet.list_servers",
      "glassmkr.servers.get",
      "glassmkr.servers.get_health",
      "glassmkr.servers.get_history",
      "glassmkr.host_profiles.list",
    ]);
    expect(listPayload.result.tools.every((tool: any) => (
      tool.annotations?.readOnlyHint === true
      && tool.annotations?.destructiveHint === false
    ))).toBe(true);

    const nextBody = { jsonrpc: "2.0", id: 3, method: "tools/list" };
    const hijackRequest = new Request("https://app.glassmkr.com/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "Mcp-Session-Id": sessionId!,
      },
      body: JSON.stringify(nextBody),
    });
    const response = await handleMcpGatewayRequest(
      eventFor(hijackRequest),
      principal({ grant_id: "grant-b", token_id: "token-b" }),
      nextBody,
    );
    expect(response.status).toBe(401);
    expect(getMcpSessionCountForTests()).toBe(0);
  });
});

describe("MCP admin tools (Phase 2b)", () => {
  function initHeaders(sessionId?: string): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (sessionId) h["Mcp-Session-Id"] = sessionId;
    return h;
  }

  it("registers admin tools when MCP_ADMIN_ENABLED and denies them to a non-admin grant", async () => {
    process.env.MCP_ADMIN_ENABLED = "1";
    try {
      resetMcpSessionsForTests();
      const initialize = {
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      };
      const initRes = await handleMcpGatewayRequest(
        eventFor(new Request("https://app.glassmkr.com/mcp", { method: "POST", headers: initHeaders(), body: JSON.stringify(initialize) })),
        principal(),
        initialize,
      );
      const sessionId = initRes.headers.get("mcp-session-id")!;

      const listBody = { jsonrpc: "2.0", id: 2, method: "tools/list" };
      const listRes = await handleMcpGatewayRequest(
        eventFor(new Request("https://app.glassmkr.com/mcp", { method: "POST", headers: initHeaders(sessionId), body: JSON.stringify(listBody) })),
        principal(),
        listBody,
      );
      const names = ((await listRes.json()) as any).result.tools.map((t: any) => t.name);
      for (const t of ["glassmkr.admin.prepare", "glassmkr.admin.delete_server", "glassmkr.admin.rotate_key", "glassmkr.admin.enroll_server"]) {
        expect(names).toContain(t);
      }

      // A read-only grant calling a destructive tool is denied by the admin scope
      // gate BEFORE any DB access or confirm-token check.
      const callBody = {
        jsonrpc: "2.0", id: 3, method: "tools/call",
        params: { name: "glassmkr.admin.delete_server", arguments: { server_id: "srv_1", confirm_token: "x", confirm_name: "web-1" } },
      };
      const callRes = await handleMcpGatewayRequest(
        eventFor(new Request("https://app.glassmkr.com/mcp", { method: "POST", headers: initHeaders(sessionId), body: JSON.stringify(callBody) })),
        principal(),
        callBody,
      );
      const payload = (await callRes.json()) as any;
      expect(payload.result.isError).toBe(true);
      expect(JSON.stringify(payload.result)).toContain("INSUFFICIENT_SCOPE");
    } finally {
      delete process.env.MCP_ADMIN_ENABLED;
      resetMcpSessionsForTests();
    }
  });
});
