// Regression: the key-expiry cycle must isolate each step. A bad first
// query (the `column c.name does not exist` schema mismatch) used to throw
// and silently abort the grace reaper + all warning emails for days. Each
// step now runs in its own try/catch.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@glassmkr/db/pg", () => ({ query: vi.fn() }));
vi.mock("../email", () => ({
  sendKeyExpiringT7: vi.fn(async () => true),
  sendKeyExpiringT1: vi.fn(async () => true),
  sendKeyExpired: vi.fn(async () => true),
}));

import { query } from "@glassmkr/db/pg";
import { runKeyExpiryCycle } from "../key-expiry";

beforeEach(() => {
  (query as any).mockReset();
});

describe("runKeyExpiryCycle step isolation", () => {
  it("still reaps grace-ended keys when the T-7 query throws (the c.name regression)", async () => {
    (query as any)
      .mockRejectedValueOnce(new Error("column c.name does not exist")) // T-7 throws
      .mockResolvedValueOnce({ rows: [] }) // T-1
      .mockResolvedValueOnce({ rows: [] }) // expired revoke
      .mockResolvedValueOnce({ rowCount: 3 }); // grace reaper
    const r = await runKeyExpiryCycle();
    expect(r.grace_reaped).toBe(3); // the reaper ran despite the earlier failure
    expect(r.t7).toBe(0);
  });

  it("runs all four steps to completion on a clean cycle", async () => {
    (query as any)
      .mockResolvedValueOnce({ rows: [] }) // T-7
      .mockResolvedValueOnce({ rows: [] }) // T-1
      .mockResolvedValueOnce({ rows: [] }) // expired
      .mockResolvedValueOnce({ rowCount: 1 }); // grace
    expect(await runKeyExpiryCycle()).toEqual({ t7: 0, t1: 0, expired: 0, grace_reaped: 1 });
  });
});
