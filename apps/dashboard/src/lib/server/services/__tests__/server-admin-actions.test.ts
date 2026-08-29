import { beforeEach, describe, expect, it, vi } from "vitest";

// softDeleteServerForCustomer, rotateCollectorKeyForCustomer and
// createServerForCustomer now delegate to a *Tx core so an MCP commit can run
// the same write inside its own transaction (see mcp/confirmed-actions.ts).
// The default withTransaction here therefore hands the callback a client whose
// query IS the `query` mock, so these tests keep asserting on the statements
// the way they always did.
vi.mock("@glassmkr/db/pg", () => {
  const query = vi.fn();
  return {
    query,
    withTransaction: vi.fn(async (fn: (tx: { query: unknown }) => unknown) => fn({ query })),
  };
});
vi.mock("$lib/server/billing/sync", () => ({ syncSubscriptionQuantitySafe: vi.fn() }));

import { query, withTransaction } from "@glassmkr/db/pg";
import { syncSubscriptionQuantitySafe } from "$lib/server/billing/sync";
import {
  softDeleteServerForCustomer,
  restoreDeletedServerForCustomer,
  rotateCollectorKeyForCustomer,
  createServerForCustomer,
} from "../server-admin-actions.js";

beforeEach(() => {
  process.env.MCP_OAUTH_TOKEN_PEPPER = "test-pepper-with-at-least-thirty-two-bytes";
  process.env.GLASSMKR_KEY_PEPPER = "test-key-pepper-with-at-least-thirty-two-chars";
  vi.mocked(query).mockReset();
  vi.mocked(withTransaction).mockReset();
  vi.mocked(syncSubscriptionQuantitySafe).mockReset();
});

describe("softDeleteServerForCustomer", () => {
  it("sets status='deleted' scoped to the customer and syncs billing", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ id: "srv1", name: "web-1" }], rowCount: 1 } as never);
    const row = await softDeleteServerForCustomer("cust-a", "srv1");
    expect(row).toEqual({ id: "srv1", name: "web-1" });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("status = 'deleted'");
    expect(sql).toContain("customer_id = $2");
    expect(params).toEqual(["srv1", "cust-a"]);
    expect(vi.mocked(syncSubscriptionQuantitySafe)).toHaveBeenCalledWith("cust-a");
  });

  it("returns null and does not sync when the server is not owned / already deleted", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    expect(await softDeleteServerForCustomer("cust-a", "srvX")).toBeNull();
    expect(vi.mocked(syncSubscriptionQuantitySafe)).not.toHaveBeenCalled();
  });
});

// Restore + create run their quota check inside a per-customer advisory-locked
// transaction, so drive them by queuing tx.query results in call order:
// [advisory-lock, ...selects/updates].
function txWithQueue(results: Array<{ rows: unknown[]; rowCount?: number }>): void {
  const q = vi.fn();
  for (const r of results) q.mockResolvedValueOnce(r as never);
  q.mockResolvedValue({ rows: [], rowCount: 0 } as never);
  vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn({ query: q }));
}

describe("restoreDeletedServerForCustomer", () => {
  it("restores a deleted, owned server under quota and syncs", async () => {
    txWithQueue([
      { rows: [] },                                    // advisory lock
      { rows: [{ name: "web-1" }] },                   // owned + deleted
      { rows: [{ plan_server_limit: 10 }] },           // plan limit
      { rows: [{ count: "0" }] },                      // active count
      { rows: [{ id: "srv1", name: "web-1" }] },       // update RETURNING
    ]);
    const result = await restoreDeletedServerForCustomer("cust-a", "srv1");
    expect(result).toEqual({ status: "restored", id: "srv1", name: "web-1" });
    expect(vi.mocked(syncSubscriptionQuantitySafe)).toHaveBeenCalledWith("cust-a");
  });

  it("refuses to restore past the plan node quota (Codex #2)", async () => {
    txWithQueue([
      { rows: [] },                          // lock
      { rows: [{ name: "web-1" }] },         // owned + deleted
      { rows: [{ plan_server_limit: 3 }] },  // limit
      { rows: [{ count: "3" }] },            // already at limit
    ]);
    const result = await restoreDeletedServerForCustomer("cust-a", "srv1");
    expect(result).toEqual({ status: "quota_exceeded", limit: 3 });
    expect(vi.mocked(syncSubscriptionQuantitySafe)).not.toHaveBeenCalled();
  });

  it("returns not_found when the server is not a deleted owned one", async () => {
    txWithQueue([{ rows: [] }, { rows: [] }]); // lock, owned-select empty
    expect((await restoreDeletedServerForCustomer("cust-a", "srv1")).status).toBe("not_found");
  });
});

describe("createServerForCustomer", () => {
  it("refuses at the plan node quota (no insert)", async () => {
    txWithQueue([
      { rows: [] },                          // lock
      { rows: [{ plan_server_limit: 3 }] },  // limit
      { rows: [{ count: "3" }] },            // at limit
    ]);
    const result = await createServerForCustomer("cust-a", { name: "web-9", createdByUserId: null });
    expect(result).toEqual({ status: "quota_exceeded", limit: 3 });
    expect(vi.mocked(syncSubscriptionQuantitySafe)).not.toHaveBeenCalled();
  });

  it("creates a server + mints a one-time key under quota, then syncs", async () => {
    txWithQueue([
      { rows: [] },                           // lock
      { rows: [{ plan_server_limit: 10 }] },  // limit
      { rows: [{ count: "2" }] },             // under limit
      { rows: [] },                           // insert servers
      { rows: [] },                           // insert key
    ]);
    const result = await createServerForCustomer("cust-a", { name: "web-9", createdByUserId: null });
    expect(result.status).toBe("created");
    if (result.status === "created") {
      expect(result.serverId).toMatch(/^srv_[0-9a-f]{16}$/);
      expect(result.collectorKey).toMatch(/^gmk_cru_live_/);
    }
    expect(vi.mocked(syncSubscriptionQuantitySafe)).toHaveBeenCalledWith("cust-a");
  });
});

describe("rotateCollectorKeyForCustomer", () => {
  it("checks ownership INSIDE the transaction, not before it", async () => {
    // This assertion used to be `withTransaction` was NOT called on an
    // ownership miss, because the check ran on the pool first. That ordering
    // was the bug: a server could stop being owned between the check and the
    // write. The check now runs inside the transaction that performs the
    // rotation, so the two cannot disagree, and an unowned server still
    // returns null without rotating anything.
    const tx = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn({ query: tx }));
    expect(await rotateCollectorKeyForCustomer("cust-a", "srvX", null)).toBeNull();
    expect(vi.mocked(withTransaction)).toHaveBeenCalled();
    const statements = tx.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((s2) => s2.includes("SELECT id FROM servers"))).toBe(true);
    // Nothing was written.
    expect(statements.some((s2) => s2.includes("INSERT INTO account_api_keys"))).toBe(false);
    expect(statements.some((s2) => s2.includes("UPDATE account_api_keys"))).toBe(false);
  });

  it("rotates for an owned server and returns the new one-time key", async () => {
    const tx = vi.fn(async (sql: string) =>
      String(sql).includes("SELECT id FROM servers")
        ? { rows: [{ id: "srv1" }], rowCount: 1 }
        : { rows: [{ last_4: "abcd" }], rowCount: 1 },
    );
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn({ query: tx }));
    const result = await rotateCollectorKeyForCustomer("cust-a", "srv1", null);
    expect(result?.collectorKey).toMatch(/^gmk_cru_live_/);
    expect(result?.oldLast4).toBe("abcd");
    expect(typeof result?.newLast4).toBe("string");
  });
});
