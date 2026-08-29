// Route-level BOLA test for GET /api/v1/servers/{id}/metrics (Codex review
// 2026-06-06, finding E). The endpoint gates on a PG ownership SELECT before
// any ClickHouse read; a cross-tenant id must return 404 (not 403), and the
// ownership query must carry the customer_id predicate. The lint:bola static
// check already requires that predicate on the `servers` query; this is the
// runtime complement at the route boundary.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("$lib/server/redis", () => ({
  // G5 added a Redis-backed per-account budget to this endpoint. Without a
  // mock the client retries a real connection and the test times out; a null
  // client exercises the documented fail-open path.
  getRedis: () => null,
  setRedisForTests: () => {},
  quitRedis: async () => {},
}));
vi.mock("@glassmkr/db/pg", () => ({ query: vi.fn() }));
vi.mock("@glassmkr/db/clickhouse", () => ({
  clickhouse: { query: vi.fn(async () => ({ json: async () => [] })) },
}));

import { query } from "@glassmkr/db/pg";
import { GET } from "../+server.js";

function makeEvent(opts: { serverId: string; customerId: string }): any {
  const url = new URL(`https://dashboard.test/api/v1/servers/${opts.serverId}/metrics?range=24h`);
  return {
    request: { method: "GET", url: url.toString(), headers: { get: () => null } },
    locals: { customer: { id: opts.customerId, email: "x", plan: "pro" }, authKind: "session" },
    params: { id: opts.serverId },
    url,
    getClientAddress: () => "10.0.0.1",
    route: { id: "/api/v1/servers/[id]/metrics" },
  };
}

beforeEach(() => {
  (query as any).mockReset();
});

describe("GET /servers/[id]/metrics: BOLA", () => {
  it("returns 404 (not 403) when the server belongs to a different customer", async () => {
    (query as any).mockResolvedValueOnce({ rows: [] }); // ownership check: no row
    const res = await GET(makeEvent({ serverId: "srv_victim", customerId: "cust_attacker" }));
    expect(res.status).toBe(404);
    const call = (query as any).mock.calls[0];
    expect(String(call[0])).toMatch(/FROM servers WHERE id = \$1 AND customer_id = \$2/);
    expect(call[1]).toEqual(["srv_victim", "cust_attacker"]);
  });

  it("returns 200 for the owning customer", async () => {
    (query as any).mockResolvedValueOnce({ rows: [{ id: "srv_mine" }] }); // ownership ok
    const res = await GET(makeEvent({ serverId: "srv_mine", customerId: "cust_owner" }));
    expect(res.status).toBe(200);
  });
});
