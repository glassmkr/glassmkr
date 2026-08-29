import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@glassmkr/db/pg", () => ({ query: vi.fn() }));
vi.mock("@glassmkr/db/clickhouse", () => ({ clickhouse: { query: vi.fn() } }));

import { query } from "@glassmkr/db/pg";
import { clickhouse } from "@glassmkr/db/clickhouse";
import {
  getServerForCustomer,
  getServerHistoryForCustomer,
  listServersForCustomer,
} from "../fleet-read.js";

beforeEach(() => {
  vi.mocked(query).mockReset();
  vi.mocked(clickhouse.query).mockReset();
});

describe("fleet read tenant constraints", () => {
  it("looks up a server with server and customer in the same SQL statement", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    await expect(getServerForCustomer("customer-a", "server-known-to-b"))
      .resolves.toBeNull();
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("s.id = $1 AND s.customer_id = $2");
    expect(params).toEqual(["server-known-to-b", "customer-a"]);
  });

  it("always starts a fleet list with the authenticated customer", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    const result = await listServersForCustomer({ customerId: "customer-a", limit: 20 });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("s.customer_id = $1");
    expect(params?.[0]).toBe("customer-a");
    expect(result).toEqual({
      servers: [],
      hasMore: false,
      nextCreatedAt: null,
      nextServerId: null,
    });
  });

  // Codex 2026-07-21 P2-1: the shared refactor added a deleted filter, which
  // regressed the HTTP route that must still show a soft-deleted server for the
  // trash/restore UI. MCP excludes deleted (default); HTTP opts in.
  it("excludes soft-deleted servers by default (MCP view)", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    await getServerForCustomer("customer-a", "srv-1");
    const [sql] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("s.status != 'deleted'");
  });

  it("includes soft-deleted servers when includeDeleted is set (trash/restore HTTP path)", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    await getServerForCustomer("customer-a", "srv-1", { includeDeleted: true });
    const [sql] = vi.mocked(query).mock.calls[0];
    expect(sql).not.toContain("!= 'deleted'");
  });
});

// Codex 2026-07-21 P2-2: 168h at 5-minute buckets is 2016 rows, over the MCP
// result cap. 5-minute buckets stop at 144h; longer ranges drop to 30 minutes.
describe("fleet history bucketing", () => {
  function mockOwnedThenHistory() {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ id: "srv-1" }], rowCount: 1 } as never);
    vi.mocked(clickhouse.query).mockResolvedValueOnce({ json: async () => [] } as never);
  }

  it("uses 5-minute buckets at 144h (1728 rows, under the 2000 cap)", async () => {
    mockOwnedThenHistory();
    const result = await getServerHistoryForCustomer("customer-a", "srv-1", 144);
    expect(result?.interval_minutes).toBe(5);
    const params = vi.mocked(clickhouse.query).mock.calls[0]?.[0]?.query_params;
    expect(params?.interval_minutes).toBe(5);
  });

  it("uses 30-minute buckets at 168h so the row count stays bounded", async () => {
    mockOwnedThenHistory();
    const result = await getServerHistoryForCustomer("customer-a", "srv-1", 168);
    expect(result?.interval_minutes).toBe(30);
  });
});
