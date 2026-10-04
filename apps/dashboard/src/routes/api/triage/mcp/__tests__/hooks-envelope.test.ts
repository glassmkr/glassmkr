// The /api error envelope (hooks.server.ts apiErrorShapeHandle) in front of
// the triage endpoint. JSON-RPC errors carry their reason in error.message,
// which the envelope used to replace with "Request failed", so a 406, a bad
// protocol version or a parse error told the client nothing (R2-23).

import { afterEach, describe, expect, it, vi } from "vitest";

const takeState = vi.hoisted(() => ({ allowed: true }));
vi.mock("$lib/server/auth/rate-limit.js", () => ({
  take: vi.fn(async () =>
    takeState.allowed
      ? { allowed: true, remaining: 1, retryAfterSeconds: 0, degraded: false }
      : { allowed: false, remaining: 0, retryAfterSeconds: 7, degraded: false },
  ),
  charge: vi.fn(async () => {}),
}));
vi.mock("$lib/server/watchdog-scheduler", () => ({ startWatchdog: () => {} }));
vi.mock("$lib/server/trend-warnings/scheduler", () => ({ startTrendWarnings: () => {} }));
vi.mock("$lib/server/billing/enforcement-scheduler", () => ({ startBillingEnforcement: () => {} }));
vi.mock("$lib/server/billing/email-reminders-scheduler", () => ({ startEmailReminders: () => {} }));
vi.mock("$lib/server/account/key-expiry-scheduler", () => ({ startKeyExpiry: () => {} }));
vi.mock("$lib/server/endoflife/scheduler", () => ({ startEndoflifeSync: () => {} }));
vi.mock("$lib/server/graceful-shutdown", () => ({ registerGracefulShutdown: () => {} }));
vi.mock("@glassmkr/auth", () => ({ verifyToken: () => null, getCustomerById: async () => null }));

// SvelteKit's request store (needed to run the real handle sequence) is an
// internal entry with no type declarations.
// @ts-expect-error -- untyped internal module
import { with_request_store } from "@sveltejs/kit/internal/server";
import { handle } from "../../../../../hooks.server";
import * as route from "../+server";

const URL_ = "https://app.glassmkr.com/api/triage/mcp";
const LIST = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
const BOTH = { "content-type": "application/json", accept: "application/json, text/event-stream" };

function eventFor(method: string, headers: Record<string, string>, body?: string): any {
  const url = new URL(URL_);
  return {
    url,
    request: new Request(url, { method, headers: { host: url.host, ...headers }, body }),
    locals: {},
    cookies: { get: () => undefined, getAll: () => [], set() {}, delete() {}, serialize: () => "" },
    getClientAddress: () => "203.0.113.9",
    platform: undefined,
    params: {},
    route: { id: "/api/triage/mcp" },
    setHeaders() {},
    isDataRequest: false,
    isSubRequest: false,
    isRemoteRequest: false,
    fetch,
    tracing: { enabled: false, root: {}, current: {} },
  };
}

async function viaHooks(method: string, headers: Record<string, string>, body?: string) {
  const event = eventFor(method, headers, body);
  const state = { tracing: { record_span: ({ fn }: any) => fn({}) } } as any;
  const res: Response = await with_request_store({ event, state } as any, () =>
    handle({ event, resolve: async (e: any) => (route as any)[method](e) } as any),
  );
  return { status: res.status, body: await res.json() };
}

afterEach(() => {
  takeState.allowed = true;
});

describe("the /api error envelope keeps the JSON-RPC reason (R2-23)", () => {
  it("406: the transport's Accept rule", async () => {
    const { status, body } = await viaHooks("POST", { ...BOTH, accept: "application/json" }, LIST);
    expect(status).toBe(406);
    expect(body.message).toMatch(/must accept both application\/json and text\/event-stream/);
    expect(body.details).toContainEqual({ jsonrpc_error: { code: -32000, message: body.message } });
  });

  it("400: a parse error keeps its JSON-RPC code in details", async () => {
    const { status, body } = await viaHooks("POST", BOTH, "{not json");
    expect(status).toBe(400);
    expect(body.message).toBe("Parse error: invalid JSON");
    expect(body.details).toContainEqual({ jsonrpc_error: { code: -32700, message: "Parse error: invalid JSON" } });
  });

  it("400: an unsupported protocol version says which", async () => {
    const { body } = await viaHooks("POST", { ...BOTH, "mcp-protocol-version": "1999-01-01" }, LIST);
    expect(body.message).toMatch(/Unsupported protocol version: 1999-01-01/);
  });

  it("429: the wait is in the message as well as the header field", async () => {
    takeState.allowed = false;
    const { status, body } = await viaHooks("POST", BOTH, LIST);
    expect(status).toBe(429);
    expect(body.message).toBe("Rate limit exceeded; retry after 7 seconds");
    expect(body.retry_after_seconds).toBe(7);
  });

  it("405 keeps the hook's own message and Allow list", async () => {
    const { status, body } = await viaHooks("GET", { accept: "text/event-stream" });
    expect(status).toBe(405);
    expect(body.message).toBe("GET is not supported on this endpoint. Allowed: POST, OPTIONS.");
    expect(body.details).toContainEqual({ allowed_methods: ["POST", "OPTIONS"] });
  });
});
