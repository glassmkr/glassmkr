import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Redis-backed buckets fail open without Redis; the wiring is asserted through
// this controllable fake.
const takeMock = vi.hoisted(() =>
  vi.fn(async (_tier: { namespace: string }, _id: string) => ({
    allowed: true,
    remaining: 1,
    retryAfterSeconds: 0,
    degraded: false,
  })),
);
vi.mock("$lib/server/auth/rate-limit.js", () => ({ take: takeMock }));

// HTTP and protocol behaviour only: one fake parser stands in for the registry
// so this file does not depend on how any real parser reads its format. The
// real registry runs end to end in registry-e2e.test.ts.
vi.mock("$lib/server/triage/registry.js", () => ({
  TRIAGE_PARSERS: [
    {
      domain: "mdraid",
      rules: ["raid_degraded"],
      notDeterminable: [],
      detect: (t: string) => t.includes("Personalities"),
      parse: () => ({
        domain: "mdraid",
        formats: ["proc_mdstat"],
        subjects: 1,
        notes: [],
        snapshot: {
          raid: [{ device: "md0", level: "raid1", status: "active", degraded: true, disks: ["sda1", "sdb1"], failed_disks: ["sdb1"] }],
        },
      }),
    },
  ],
}));

import { z } from "zod";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { DELETE, GET, OPTIONS, POST } from "../+server.js";
import { analysisOutputSchema } from "$lib/server/triage/analyze.js";
import { captureOutputSchema } from "$lib/server/triage/capture.js";
import { setupOutputSchema } from "$lib/server/triage/setup.js";
import { isCsrfViolation } from "$lib/server/auth/csrf.js";

const URL_ = "https://app.glassmkr.com/api/triage/mcp";
const MDSTAT = "Personalities : [raid1]\nmd0 : active raid1 sdb1[1](F) sda1[0]\n      976630336 blocks super 1.2 [2/1] [U_]\n\nunused devices: <none>\n";

function eventFor(request: Request): any {
  return {
    request,
    url: new URL(request.url),
    route: { id: "/api/triage/mcp" },
    locals: { request_id: "00000000-0000-4000-8000-000000000001" },
    getClientAddress: () => "198.51.100.7",
  };
}

async function post(body: string, headers: Record<string, string> = {}): Promise<Response> {
  const request = new Request(URL_, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body,
  });
  return await POST(eventFor(request));
}

let nextId = 1;
async function rpc(method: string, params?: Record<string, unknown>, headers?: Record<string, string>) {
  const res = await post(JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, ...(params ? { params } : {}) }), headers);
  return { res, body: res.status === 200 ? await res.json() : null };
}

const INITIALIZE = {
  protocolVersion: "2025-11-25",
  capabilities: {},
  clientInfo: { name: "route-test", version: "1.0.0" },
};

beforeEach(() => {
  process.env.MCP_OAUTH_TOKEN_PEPPER = "test-pepper-with-at-least-thirty-two-bytes";
  delete process.env.MCP_PUBLIC_ORIGIN;
  delete process.env.MCP_TRIAGE_ENABLED;
  takeMock.mockClear();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("JSON-RPC over POST: initialize -> tools/list -> tools/call", () => {
  it("initializes a stateless server with instructions and no session id", async () => {
    const { res, body } = await rpc("initialize", INITIALIZE);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("mcp-session-id")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(body.result.serverInfo).toEqual({ name: "glassmkr-triage", version: "0.1.0" });
    expect(body.result.capabilities.tools).toBeTruthy();
    expect(body.result.instructions).toContain("deterministic alert rules");
  });

  it("acknowledges the initialized notification with 202", async () => {
    const res = await post(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
    expect(res.status).toBe(202);
  });

  it("lists every tool with annotations, outputSchema and noauth security schemes", async () => {
    const { res, body } = await rpc("tools/list", {}, { "Mcp-Protocol-Version": "2025-11-25" });
    expect(res.status).toBe(200);
    const tools = body.result.tools as Array<Record<string, any>>;
    expect(tools.map((t) => t.name)).toEqual(["analyze_server_output", "get_capture_command", "get_monitoring_setup"]);
    for (const tool of tools) {
      expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
      expect(tool._meta.securitySchemes).toEqual([{ type: "noauth" }]);
      expect(tool._meta["openai/toolInvocation/invoking"].length).toBeLessThanOrEqual(64);
      expect(tool._meta["openai/toolInvocation/invoked"].length).toBeLessThanOrEqual(64);
      expect(tool.outputSchema.type).toBe("object");
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("analyze_server_output: structuredContent conforms to the declared outputSchema", async () => {
    const { res, body } = await rpc("tools/call", {
      name: "analyze_server_output",
      arguments: { output: MDSTAT, distro: "debian" },
      _meta: { "openai/subject": "v1/anon-subject" },
    });
    expect(res.status).toBe(200);
    expect(body.result.isError).toBeFalsy();
    const sc = analysisOutputSchema.parse(body.result.structuredContent);
    expect(sc.input.formats).toEqual(["proc_mdstat"]);
    expect(sc.findings.map((f) => f.rule_id)).toEqual(["raid_degraded"]);
    expect(body.result.content[0].type).toBe("text");
    expect(body.result.content[0].text).toContain("[critical] RAID array degraded (md_array md0)");
    // The per-subject bucket ran inside the tool handler.
    expect(takeMock.mock.calls.map((c) => c[0].namespace)).toContain("triage:subject");
  });

  it("get_capture_command and get_monitoring_setup conform to their schemas", async () => {
    const capture = await rpc("tools/call", { name: "get_capture_command", arguments: { goal: "bmc_events", distro: "rocky" } });
    expect(captureOutputSchema.parse(capture.body.result.structuredContent).commands.map((c) => c.command))
      .toEqual(["sudo ipmitool sel elist", "sudo ipmitool sel info"]);
    const setup = await rpc("tools/call", { name: "get_monitoring_setup", arguments: { target: "self_hosted" } });
    expect(setupOutputSchema.parse(setup.body.result.structuredContent).target).toBe("self_hosted");
  });

  it("validates every result against the JSON Schema the server itself advertises", async () => {
    // Guards drift between the zod shapes and what tools/list publishes: a
    // client validates structuredContent against the ADVERTISED schema (Ajv,
    // as the SDK client does), not against our zod objects.
    const { body } = await rpc("tools/list", {});
    const ajv = new AjvJsonSchemaValidator();
    const advertised = new Map((body.result.tools as any[]).map((t) => [t.name, t.outputSchema]));
    const calls: Array<[string, Record<string, unknown>]> = [
      ["analyze_server_output", { output: MDSTAT }],
      ["analyze_server_output", { output: "nothing recognisable here" }],
      ["get_capture_command", { goal: "all_disks" }],
      ["get_capture_command", { goal: "one_disk", distro: "arch" }],
      ["get_monitoring_setup", { target: "hosted", distro: "alpine" }],
      ["get_monitoring_setup", { target: "self_hosted" }],
    ];
    for (const [name, args] of calls) {
      const { body: res } = await rpc("tools/call", { name, arguments: args });
      const sc = res.result.structuredContent as Record<string, unknown>;
      const schema = advertised.get(name);
      expect(schema.additionalProperties).toBe(false);
      expect(Object.keys(sc).sort()).toEqual([...schema.required].sort());
      const verdict = ajv.getValidator(schema)(sc);
      expect(verdict.valid, `${name}: ${verdict.errorMessage ?? ""}`).toBe(true);
    }
  });

  it("answers an unrecognised paste with an empty result, not an error", async () => {
    const { body } = await rpc("tools/call", { name: "analyze_server_output", arguments: { output: "is my server ok?" } });
    expect(body.result.isError).toBeFalsy();
    const sc = analysisOutputSchema.parse(body.result.structuredContent);
    expect(sc.findings).toEqual([]);
    expect(sc.input.formats).toEqual([]);
    expect(sc.next_capture.length).toBeGreaterThan(0);
  });
});

describe("HTTP guards", () => {
  it("413s a body over 256 KB without parsing it", async () => {
    const big = JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "analyze_server_output", arguments: { output: "x".repeat(300 * 1024) } },
    });
    const res = await post(big);
    expect(res.status).toBe(413);
    expect((await res.json()).error.message).toBe("Request body is too large");
  });

  it("413s on a declared Content-Length over the cap", async () => {
    const res = await post("{}", { "Content-Length": String(300 * 1024) });
    expect(res.status).toBe(413);
  });

  it("400s malformed JSON with a JSON-RPC parse error", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error: invalid JSON" }, id: null });
  });

  it("400s an oversized batch", async () => {
    const batch = Array.from({ length: 11 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "tools/list" }));
    const res = await post(JSON.stringify(batch));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe(-32600);
  });

  it("415s a non-JSON content type", async () => {
    const res = await post("x", { "Content-Type": "text/plain" });
    expect(res.status).toBe(415);
  });

  it("406s a client that does not accept JSON and SSE (transport rule)", async () => {
    const res = await post(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }), { Accept: "application/json" });
    expect(res.status).toBe(406);
  });

  it("405s GET and DELETE with an Allow header", async () => {
    for (const handler of [GET, DELETE]) {
      const res = await handler(eventFor(new Request(URL_, { method: handler === GET ? "GET" : "DELETE" })));
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST, OPTIONS");
      expect((await res.json()).jsonrpc).toBe("2.0");
    }
  });

  it("421s a request for another host", async () => {
    const res = await POST(eventFor(new Request("https://evil.example.com/api/triage/mcp", {
      method: "POST",
      headers: { host: "evil.example.com", "Content-Type": "application/json" },
      body: "{}",
    })));
    expect(res.status).toBe(421);
  });

  it("404s every method when MCP_TRIAGE_ENABLED is exactly 0", async () => {
    process.env.MCP_TRIAGE_ENABLED = "0";
    expect((await post(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }))).status).toBe(404);
    expect((await GET(eventFor(new Request(URL_)))).status).toBe(404);
    expect((await OPTIONS(eventFor(new Request(URL_, { method: "OPTIONS", headers: { origin: "https://chatgpt.com" } })))).status).toBe(404);
    process.env.MCP_TRIAGE_ENABLED = "false"; // only "0" disables
    expect((await post(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }))).status).toBe(200);
  });
});

describe("CORS", () => {
  it("answers a preflight from an https origin without credentials", async () => {
    const res = await OPTIONS(eventFor(new Request(URL_, { method: "OPTIONS", headers: { origin: "https://chatgpt.com" } })));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://chatgpt.com");
    expect(res.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    expect(res.headers.get("access-control-allow-headers")).toContain("Mcp-Protocol-Version");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("refuses a preflight with no origin, an http origin, or an opaque origin", async () => {
    for (const origin of [undefined, "http://claude.ai", "null", "https://claude.ai/path"]) {
      const headers: Record<string, string> = origin ? { origin } : {};
      const res = await OPTIONS(eventFor(new Request(URL_, { method: "OPTIONS", headers })));
      expect(res.status).toBe(403);
    }
  });

  it("echoes an https origin on POST and refuses a plain-http one", async () => {
    const ok = await post(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }), { Origin: "https://claude.ai" });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://claude.ai");
    expect(ok.headers.get("vary")).toBe("Origin");
    expect(ok.headers.get("access-control-allow-credentials")).toBeNull();
    const bad = await post(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }), { Origin: "http://evil.example" });
    expect(bad.status).toBe(403);
  });
});

describe("rate limits", () => {
  it("debits a per-IP and a global bucket before parsing the body", async () => {
    await post(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    expect(takeMock.mock.calls.map((c) => [c[0].namespace, c[1]])).toEqual([
      ["triage:ip", "198.51.100.7"],
      ["triage:global", "all"],
    ]);
  });

  it("429s with Retry-After when the IP bucket is empty", async () => {
    takeMock.mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 3, degraded: false });
    const res = await post(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("3");
    expect(await res.json()).toEqual({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Rate limit exceeded; retry after 3 seconds" },
      id: null,
    });
  });

  it("429s when the global bucket is empty", async () => {
    takeMock
      .mockResolvedValueOnce({ allowed: true, remaining: 10, retryAfterSeconds: 0, degraded: false })
      .mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 1, degraded: false });
    const res = await post(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    expect(res.status).toBe(429);
  });

  it("turns a per-subject limit into a tool error, not an HTTP error", async () => {
    takeMock.mockImplementation(async (tier) => ({
      allowed: tier.namespace !== "triage:subject",
      remaining: 0,
      retryAfterSeconds: 4,
      degraded: false,
    }));
    const { res, body } = await rpc("tools/call", {
      name: "analyze_server_output",
      arguments: { output: MDSTAT },
      _meta: { "openai/subject": "v1/busy-user" },
    });
    expect(res.status).toBe(200);
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("Wait about 4 seconds");
    takeMock.mockReset();
    takeMock.mockImplementation(async () => ({ allowed: true, remaining: 1, retryAfterSeconds: 0, degraded: false }));
  });
});

describe("hooks.server.ts compatibility", () => {
  it("an anonymous JSON POST (no cookie, cross-origin or no origin) is not a CSRF violation", () => {
    for (const origin of [null, "https://chatgpt.com", "https://claude.ai"]) {
      expect(isCsrfViolation({
        method: "POST",
        pathname: "/api/triage/mcp",
        hasSessionCookie: false,
        contentType: "application/json",
        origin,
        siteOrigin: "https://app.glassmkr.com",
      })).toBe(false);
    }
  });
});

describe("zod sanity", () => {
  it("rejects structuredContent with an extra key (the schemas are strict)", () => {
    const parsed = z.object({ a: z.string() }).strict().safeParse({ a: "x", b: 1 });
    expect(parsed.success).toBe(false);
    const sample = analysisOutputSchema.safeParse({
      input: { formats: [], bytes: 0, lines: 0, sha256_prefix: "000000000000", subjects: 0 },
      findings: [], checked_no_signal: [], not_determinable: [], next_capture: [], notes: [],
      continuous_monitoring: { docs_url: "https://glassmkr.com/docs/getting-started?ref=mcp-triage", source_url: "https://github.com/glassmkr/crucible" },
      generated_at: "2026-10-03T00:00:00Z",
    });
    expect(sample.success).toBe(false);
  });
});
