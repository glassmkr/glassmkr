import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@glassmkr/db/pg", () => ({ query: vi.fn() }));

import { query } from "@glassmkr/db/pg";
import { writeAudit } from "../audit.js";
import type { Principal } from "../principal.js";

beforeEach(() => {
  (query as any).mockReset();
  (query as any).mockResolvedValue({ rows: [] });
});

function makeEvent(opts: {
  ip?: string;
  ua?: string;
  method?: string;
  routeId?: string;
} = {}): any {
  return {
    request: {
      method: opts.method ?? "POST",
      headers: {
        get(name: string) {
          if (name.toLowerCase() === "user-agent") return opts.ua ?? "test-ua";
          if (name.toLowerCase() === "x-forwarded-for") return null;
          return null;
        },
      },
      url: "https://dashboard.test/api/v1/servers",
    },
    getClientAddress: () => opts.ip ?? "10.0.0.1",
    route: { id: opts.routeId ?? "/api/v1/servers" },
    locals: {},
  };
}

describe("writeAudit", () => {
  it("writes one row with all fields populated for a session principal", async () => {
    const principal: Principal = {
      kind: "session",
      customer_id: "cust_1",
      email: "u@x.com",
      plan: "pro",
    };
    await writeAudit({
      event: makeEvent(),
      principal,
      action: "create",
      result: "success",
      status_code: 201,
      resource_type: "server",
      resource_id: "srv_a1",
      metadata: { hostname: "h" },
    });
    expect((query as any).mock.calls).toHaveLength(1);
    const params = (query as any).mock.calls[0][1];
    // [customer_id, key_id, user_id, source_ip, user_agent, method, path,
    //  resource_type, resource_id, action, result, status_code, request_id, metadata]
    expect(params[0]).toBe("cust_1"); // customer_id
    expect(params[1]).toBe(null);     // key_id (sessions don't have one)
    expect(params[2]).toBe("cust_1"); // user_id (session = same as customer)
    expect(params[3]).toBe("10.0.0.1"); // source_ip
    expect(params[4]).toBe("test-ua");  // user_agent
    expect(params[5]).toBe("POST");
    expect(params[6]).toBe("/api/v1/servers");
    expect(params[7]).toBe("server");
    expect(params[8]).toBe("srv_a1");
    expect(params[9]).toBe("create");
    expect(params[10]).toBe("success");
    expect(params[11]).toBe(201);
    expect(typeof params[12]).toBe("string"); // request_id (uuid)
    expect(JSON.parse(params[13])).toEqual({ hostname: "h" });
  });

  it("populates key_id but not user_id for an acct_key principal", async () => {
    const principal: Principal = {
      kind: "acct_key",
      customer_id: "cust_1",
      key_id: "key_xyz",
      scope: "admin",
      capabilities: [],
      plan: "pro",
    };
    await writeAudit({
      event: makeEvent(),
      principal,
      action: "list",
      result: "success",
      status_code: 200,
    });
    const params = (query as any).mock.calls[0][1];
    expect(params[0]).toBe("cust_1");
    expect(params[1]).toBe("key_xyz");
    expect(params[2]).toBe(null); // user_id null for non-session
  });

  it("records OAuth grant and MCP fields without a bearer or raw session", async () => {
    const principal: Principal = {
      kind: "oauth",
      customer_id: "cust_1",
      user_id: "cust_1",
      client_id: "client_1",
      client_name: "Pilot",
      grant_id: "grant_1",
      token_id: "token_1",
      scopes: new Set(["glassmkr:read"]),
      scope: "read",
      plan: "pro",
      resource: "https://app.glassmkr.com/mcp",
      allowed_origins: new Set(),
    };
    await writeAudit({
      event: makeEvent(),
      principal,
      action: "mcp_tool_call",
      result: "success",
      status_code: 200,
      mcp_tool: "glassmkr.fleet.list_servers",
      mcp_session_hash: "session-hash",
    });
    const params = (query as any).mock.calls[0][1];
    expect(params[14]).toBe("client_1");
    expect(params[15]).toBe("grant_1");
    expect(params[16]).toBe("glassmkr.fleet.list_servers");
    expect(params[17]).toBe("session-hash");
    expect(JSON.stringify(params)).not.toContain("token_1");
  });

  it("records server_id in metadata for cru_key principal", async () => {
    const principal: Principal = {
      kind: "cru_key",
      customer_id: "cust_1",
      server_id: "srv_42",
      key_id: "key_q",
      is_legacy_format: false,
    };
    await writeAudit({
      event: makeEvent(),
      principal,
      action: "ingest",
      result: "success",
      status_code: 200,
    });
    const params = (query as any).mock.calls[0][1];
    expect(JSON.parse(params[13])).toEqual({ server_id: "srv_42" });
  });

  it("works with null principal (failed auth case)", async () => {
    await writeAudit({
      event: makeEvent(),
      principal: null,
      action: "create",
      result: "auth_failed",
      status_code: 401,
    });
    const params = (query as any).mock.calls[0][1];
    expect(params[0]).toBe(null); // customer_id null
    expect(params[1]).toBe(null); // key_id null
    expect(params[2]).toBe(null); // user_id null
    expect(params[10]).toBe("auth_failed");
  });

  it("never throws even if the DB write fails", async () => {
    (query as any).mockRejectedValueOnce(new Error("boom"));
    // Should not reject:
    await expect(
      writeAudit({
        event: makeEvent(),
        principal: null,
        action: "x",
        result: "error",
        status_code: 500,
      }),
    ).resolves.toBeUndefined();
  });

  it("keys source_ip on the trusted last X-Forwarded-For hop, not a spoofable leading entry", async () => {
    const principal: Principal = { kind: "session", customer_id: "c", email: "e", plan: "pro" };
    const ev: any = {
      request: {
        method: "GET",
        headers: {
          get(name: string) {
            // An external caller forges leading hops; our nginx appends the
            // real connecting peer LAST ($proxy_add_x_forwarded_for). Only the
            // last entry is trustworthy.
            if (name.toLowerCase() === "x-forwarded-for") return "1.2.3.4, 203.0.113.5, 10.0.0.7";
            if (name.toLowerCase() === "user-agent") return "ua";
            return null;
          },
        },
        url: "https://dashboard.test/x",
      },
      getClientAddress: () => "10.0.0.7",
      route: { id: "/x" },
      locals: {},
    };
    await writeAudit({ event: ev, principal, action: "x", result: "success", status_code: 200 });
    const params = (query as any).mock.calls[0][1];
    expect(params[3]).toBe("10.0.0.7"); // the real peer, NOT the forged 1.2.3.4
  });

  it("uses event.locals.request_id when provided", async () => {
    const principal: Principal = { kind: "session", customer_id: "c", email: "e", plan: "pro" };
    const ev: any = {
      request: {
        method: "POST",
        headers: { get() { return null; } },
        url: "https://x/y",
      },
      getClientAddress: () => "1.1.1.1",
      route: { id: "/y" },
      locals: { request_id: "fixed-req-id-123" },
    };
    await writeAudit({ event: ev, principal, action: "x", result: "success", status_code: 200 });
    const params = (query as any).mock.calls[0][1];
    expect(params[12]).toBe("fixed-req-id-123");
  });
});
