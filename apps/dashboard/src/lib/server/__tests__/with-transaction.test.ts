// Regression test for withTransaction helper in @glassmkr/db/pg.
//
// The defect this guards against: pre-fix, route handlers issued
// BEGIN/COMMIT via pool.query(), which auto-checks-in connections per
// statement. A failure mid-transaction wouldn't actually roll back the
// earlier statements because they ran on a different connection. The
// new helper acquires one client and runs every statement plus the
// BEGIN/COMMIT on it.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { connectFn, queryFn, releaseFn } = vi.hoisted(() => ({
  connectFn: vi.fn(),
  queryFn: vi.fn(),
  releaseFn: vi.fn(),
}));

vi.mock("pg", () => {
  class FakePool {
    constructor() {}
    on() {}
    connect = connectFn;
    query() {
      throw new Error(
        "pool.query() must not be reached in a withTransaction test",
      );
    }
  }
  return { default: { Pool: FakePool } };
});

import { withTransaction } from "@glassmkr/db/pg";

beforeEach(() => {
  connectFn.mockReset();
  queryFn.mockReset();
  releaseFn.mockReset();
  connectFn.mockResolvedValue({ query: queryFn, release: releaseFn });
  queryFn.mockResolvedValue({ rows: [] });
});

describe("withTransaction", () => {
  it("brackets fn with BEGIN/COMMIT and runs every inner query on the pinned client", async () => {
    await withTransaction(async (tx) => {
      await tx.query("INSERT INTO foo (x) VALUES (1)");
      await tx.query("UPDATE bar SET y = 2");
    });
    const stmts = queryFn.mock.calls.map((c) => String(c[0]).trim());
    expect(stmts).toEqual([
      "BEGIN",
      "INSERT INTO foo (x) VALUES (1)",
      "UPDATE bar SET y = 2",
      "COMMIT",
    ]);
    expect(connectFn).toHaveBeenCalledTimes(1);
    expect(releaseFn).toHaveBeenCalledTimes(1);
  });

  it("issues ROLLBACK and does not COMMIT when fn throws", async () => {
    await expect(
      withTransaction(async (tx) => {
        await tx.query("INSERT INTO foo (x) VALUES (1)");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const stmts = queryFn.mock.calls.map((c) => String(c[0]).trim());
    expect(stmts).toContain("BEGIN");
    expect(stmts).toContain("ROLLBACK");
    expect(stmts).not.toContain("COMMIT");
    expect(releaseFn).toHaveBeenCalledTimes(1);
  });

  it("releases the client even if ROLLBACK itself fails", async () => {
    queryFn.mockImplementation(async (sql: string) => {
      if (sql === "ROLLBACK") throw new Error("rollback failed");
      if (sql === "BEGIN") return { rows: [] };
      throw new Error("inner failure");
    });
    await expect(
      withTransaction(async (tx) => {
        await tx.query("INSERT INTO foo VALUES (1)");
        return null;
      }),
    ).rejects.toThrow("inner failure");
    expect(releaseFn).toHaveBeenCalledTimes(1);
  });

  it("returns the value produced by the callback on success", async () => {
    const result = await withTransaction(async () => ({ ok: true, n: 7 }));
    expect(result).toEqual({ ok: true, n: 7 });
  });
});
