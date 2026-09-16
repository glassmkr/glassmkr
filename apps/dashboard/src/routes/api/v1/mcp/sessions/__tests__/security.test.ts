// Route-level security tests for GET /api/v1/mcp/sessions.
//
// Verifies the wired-up integration of requireAuth (401 when unauthenticated)
// and the happy path for a session principal (which passes requireScopeLevel).
// Tenant isolation + the payload shape are covered at the gateway accessor
// level in ../../../../../lib/server/mcp/__tests__/gateway.test.ts.
//
// Rate limiting and the DB (audit writes) are mocked so this exercises route
// behaviour, not helper internals.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@glassmkr/db/pg", () => ({
  query: vi.fn(async () => ({ rows: [] })),
}));
vi.mock("$lib/server/auth/rate-limit-middleware", () => ({
  checkRateLimits: vi.fn(async () => ({ allowed: true })),
  rateLimitedResponse: vi.fn(),
}));

import { GET } from "../+server.js";
import { resetMcpSessionsForTests } from "$lib/server/mcp/gateway";

beforeEach(() => {
  resetMcpSessionsForTests();
});
afterEach(() => {
  vi.clearAllMocks();
});

function makeEvent(opts: {
  customer?: { id: string; email: string; plan: string } | null;
  authHeader?: string;
}): any {
  return {
    request: {
      method: "GET",
      url: "https://dashboard.test/api/v1/mcp/sessions",
      headers: {
        get(name: string) {
          if (name.toLowerCase() === "authorization") return opts.authHeader ?? null;
          if (name.toLowerCase() === "user-agent") return "test/1";
          return null;
        },
      },
    },
    locals: {
      customer: opts.customer ?? null,
      authKind: opts.customer ? "session" : null,
    },
    getClientAddress: () => "10.0.0.1",
    route: { id: "/api/v1/mcp/sessions" },
  };
}

describe("GET /api/v1/mcp/sessions", () => {
  it("rejects an unauthenticated caller with 401", async () => {
    await expect(GET(makeEvent({}))).rejects.toMatchObject({ status: 401 });
  });

  it("returns the account's live session list for a session principal", async () => {
    const res = await GET(
      makeEvent({ customer: { id: "cust_a", email: "u@x.com", plan: "pro" } }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ count: 0, sessions: [] });
  });
});
