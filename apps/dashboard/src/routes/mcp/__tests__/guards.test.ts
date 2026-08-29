import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET, OPTIONS } from "../+server.js";

// Codex 2026-07-21 P2-3: the /mcp route guards (flag gate, Host check, CORS/Origin
// preflight) had no tests: the gateway was exercised directly, bypassing them.
// These drive the route handlers before any auth/rate-limit dependency is reached
// (flag-off and host-mismatch short-circuit first; OPTIONS is self-contained).

function eventFor(request: Request): any {
  return {
    request,
    url: new URL(request.url),
    route: { id: "/mcp" },
    locals: { request_id: "00000000-0000-4000-8000-000000000001" },
    getClientAddress: () => "127.0.0.1",
  };
}

beforeEach(() => {
  process.env.MCP_OAUTH_TOKEN_PEPPER = "test-pepper-with-at-least-thirty-two-bytes";
  process.env.MCP_OAUTH_ENABLED = "1";
  process.env.MCP_READ_ENABLED = "1";
  delete process.env.MCP_PUBLIC_ORIGIN; // default https://app.glassmkr.com
});

afterEach(() => {
  delete process.env.MCP_OAUTH_ENABLED;
  delete process.env.MCP_READ_ENABLED;
});

describe("/mcp flag gate", () => {
  it("404s the main handler when the feature flags are off", async () => {
    process.env.MCP_OAUTH_ENABLED = "";
    const res = await GET(eventFor(new Request("https://app.glassmkr.com/mcp")));
    expect(res.status).toBe(404);
  });

  it("404s the OPTIONS preflight when the feature flags are off", async () => {
    process.env.MCP_READ_ENABLED = "";
    const res = await OPTIONS(eventFor(new Request("https://app.glassmkr.com/mcp", { method: "OPTIONS" })));
    expect(res.status).toBe(404);
  });
});

describe("/mcp Host guard", () => {
  it("421s a request whose Host is not the configured public origin", async () => {
    const res = await GET(eventFor(new Request("https://evil.example.com/mcp", {
      headers: { host: "evil.example.com" },
    })));
    expect(res.status).toBe(421);
  });
});

describe("/mcp CORS preflight (Origin guard)", () => {
  it("rejects a preflight with no Origin", async () => {
    const res = await OPTIONS(eventFor(new Request("https://app.glassmkr.com/mcp", { method: "OPTIONS" })));
    expect(res.status).toBe(403);
  });

  it("rejects a non-HTTPS, non-loopback Origin", async () => {
    const res = await OPTIONS(eventFor(new Request("https://app.glassmkr.com/mcp", {
      method: "OPTIONS",
      headers: { origin: "http://evil.example.com" },
    })));
    expect(res.status).toBe(403);
  });

  it("allows a valid HTTPS Origin and echoes CORS headers", async () => {
    const res = await OPTIONS(eventFor(new Request("https://app.glassmkr.com/mcp", {
      method: "OPTIONS",
      headers: { origin: "https://claude.ai" },
    })));
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://claude.ai");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });
});
