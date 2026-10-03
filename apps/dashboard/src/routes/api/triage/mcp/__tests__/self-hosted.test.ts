import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A self-hosted dashboard must not expose the anonymous endpoint unless its
// operator opts in; hosted keeps it on by default (route.test.ts).
vi.mock("$lib/server/self-hosted", () => ({ SELF_HOSTED: true }));
vi.mock("$lib/server/auth/rate-limit.js", () => ({
  take: vi.fn(async () => ({ allowed: true, remaining: 1, retryAfterSeconds: 0, degraded: false })),
}));

import { POST } from "../+server.js";

function listTools(): Promise<Response> {
  const request = new Request("https://app.glassmkr.com/api/triage/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  return POST({
    request,
    url: new URL(request.url),
    route: { id: "/api/triage/mcp" },
    locals: { request_id: "00000000-0000-4000-8000-000000000002" },
    getClientAddress: () => "198.51.100.8",
  } as any);
}

beforeEach(() => {
  delete process.env.MCP_PUBLIC_ORIGIN;
  delete process.env.MCP_TRIAGE_ENABLED;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.MCP_TRIAGE_ENABLED;
  vi.restoreAllMocks();
});

describe("self-hosted default", () => {
  it("is off when MCP_TRIAGE_ENABLED is unset", async () => {
    expect((await listTools()).status).toBe(404);
  });

  it("is on when the operator sets MCP_TRIAGE_ENABLED=1", async () => {
    process.env.MCP_TRIAGE_ENABLED = "1";
    expect((await listTools()).status).toBe(200);
  });
});
