// Regression-locks the "oldest-N-stay" ordering shared by the two
// billing-driven suspension paths. If anyone changes either call site
// to use last_seen_at DESC, status DESC, or any other ordering, these
// tests fail.

import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
vi.mock("@glassmkr/db/pg", () => ({ query: (...args: unknown[]) => queryMock(...args) }));

const { suspendExcessServers } = await import("../suspension");

beforeEach(() => {
  queryMock.mockReset();
});

describe("suspendExcessServers", () => {
  it("uses ORDER BY created_at ASC in the active-servers SELECT", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await suspendExcessServers("cust-1", 3, "no_card_on_file");
    const sql = queryMock.mock.calls[0][0] as string;
    expect(sql).toContain("ORDER BY created_at ASC");
    expect(sql).toContain("status = 'active'");
    // Locks against past behaviour: no last_seen_at or status DESC.
    expect(sql).not.toContain("last_seen_at");
    expect(sql).not.toContain("DESC");
  });

  it("returns no suspensions when active count <= freeQuota", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: "s1" }, { id: "s2" }] });
    const r = await suspendExcessServers("cust-1", 3, "no_card_on_file");
    expect(r.suspended_ids).toEqual([]);
    expect(r.kept_ids).toEqual(["s1", "s2"]);
    // No UPDATE issued when nothing to suspend.
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("suspends slice past freeQuota, keeping the first N as 'kept' (oldest stay)", async () => {
    queryMock.mockResolvedValueOnce({ rows: [
      { id: "oldest" }, { id: "second" }, { id: "third" }, { id: "fourth" }, { id: "newest" },
    ] });
    queryMock.mockResolvedValueOnce({ rows: [] }); // UPDATE
    const r = await suspendExcessServers("cust-1", 3, "no_card_on_file");
    expect(r.kept_ids).toEqual(["oldest", "second", "third"]);
    expect(r.suspended_ids).toEqual(["fourth", "newest"]);
    expect(queryMock).toHaveBeenCalledTimes(2);
    const updateSql = queryMock.mock.calls[1][0] as string;
    expect(updateSql).toContain("UPDATE servers");
    expect(updateSql).toContain("status = 'suspended'");
    expect(updateSql).toContain("COALESCE(suspended_at, NOW())");
    expect(updateSql).toContain("COALESCE(suspended_reason");
    expect(queryMock.mock.calls[1][1]).toEqual([["fourth", "newest"], "no_card_on_file", "cust-1"]);
  });

  it("records the reason passed in (no_card_on_file)", async () => {
    queryMock.mockResolvedValueOnce({ rows: [
      { id: "a" }, { id: "b" }, { id: "c" }, { id: "d" },
    ] });
    queryMock.mockResolvedValueOnce({ rows: [] });
    const r = await suspendExcessServers("cust-1", 3, "no_card_on_file");
    expect(r.reason).toBe("no_card_on_file");
    expect(queryMock.mock.calls[1][1][1]).toBe("no_card_on_file");
  });

  it("records the reason passed in (subscription_cancelled)", async () => {
    queryMock.mockResolvedValueOnce({ rows: [
      { id: "a" }, { id: "b" }, { id: "c" }, { id: "d" },
    ] });
    queryMock.mockResolvedValueOnce({ rows: [] });
    const r = await suspendExcessServers("cust-2", 3, "subscription_cancelled");
    expect(r.reason).toBe("subscription_cancelled");
    expect(queryMock.mock.calls[1][1][1]).toBe("subscription_cancelled");
  });

  it("preserves COALESCE on suspended_at + suspended_reason (idempotency)", async () => {
    queryMock.mockResolvedValueOnce({ rows: [
      { id: "a" }, { id: "b" }, { id: "c" }, { id: "d" },
    ] });
    queryMock.mockResolvedValueOnce({ rows: [] });
    await suspendExcessServers("cust-1", 3, "no_card_on_file");
    const updateSql = queryMock.mock.calls[1][0] as string;
    // Re-suspending an already-suspended row keeps the original timestamp.
    expect(updateSql).toMatch(/suspended_at\s*=\s*COALESCE\(suspended_at,\s*NOW\(\)\)/);
    expect(updateSql).toMatch(/suspended_reason\s*=\s*COALESCE\(suspended_reason/);
  });
});
