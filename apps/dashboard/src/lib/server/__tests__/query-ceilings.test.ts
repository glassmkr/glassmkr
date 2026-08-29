import { describe, it, expect } from "vitest";
import {
  resolveRangeHours,
  assertPointBudget,
  QueryCeilingError,
  MAX_RANGE_HOURS,
  MAX_SERIES_POINTS,
  READ_QUERY_SETTINGS,
} from "../query-ceilings";

// G5 (launch gate, round-3): the ceilings must REFUSE, not clamp. The
// known-bad case these guard against is the previous behaviour: a caller asks
// for 100000 hours, silently receives 720, and cannot tell the difference
// between "your fleet has no older data" and "we truncated your request".

const url = (qs: string) => new URL(`https://x.test/api${qs}`);
const RANGES = { "1h": 1, "24h": 24, "30d": 720 };

describe("resolveRangeHours", () => {
  it("refuses an over-ceiling window instead of clamping", () => {
    expect(() => resolveRangeHours(url("?hours=100000"))).toThrow(QueryCeilingError);
    try {
      resolveRangeHours(url("?hours=100000"));
    } catch (e) {
      const err = e as QueryCeilingError;
      // The message must state the limit so the caller can correct itself.
      expect(err.message).toContain(String(MAX_RANGE_HOURS));
      expect(err.limit).toBe(MAX_RANGE_HOURS);
      expect(err.requested).toBe(100000);
    }
  });

  it("accepts exactly the ceiling", () => {
    expect(resolveRangeHours(url(`?hours=${MAX_RANGE_HOURS}`))).toBe(MAX_RANGE_HOURS);
  });

  it("defaults when no window is given", () => {
    expect(resolveRangeHours(url(""))).toBe(24);
    expect(resolveRangeHours(url(""), RANGES, 6)).toBe(6);
  });

  it("resolves known range tokens and refuses unknown ones", () => {
    expect(resolveRangeHours(url("?range=30d"), RANGES)).toBe(720);
    expect(() => resolveRangeHours(url("?range=10y"), RANGES)).toThrow(QueryCeilingError);
  });

  it("refuses junk rather than silently defaulting", () => {
    for (const bad of ["?hours=abc", "?hours=-5", "?hours=0", "?hours=1.5", "?hours=1e9"]) {
      expect(() => resolveRangeHours(url(bad)), bad).toThrow(QueryCeilingError);
    }
  });
});

describe("assertPointBudget", () => {
  it("allows every combination the UI actually produces", () => {
    expect(() => assertPointBudget(24, 5)).not.toThrow();    // 288 points
    expect(() => assertPointBudget(168, 30)).not.toThrow();  // 336 points
    expect(() => assertPointBudget(720, 60)).not.toThrow();  // 720 points
  });

  it("refuses a window/resolution pair above the point ceiling", () => {
    // 720h at 5-minute buckets is 8640 points: the shape that would ship a
    // huge series if resolution were ever caller-controlled.
    expect(() => assertPointBudget(720, 5)).toThrow(QueryCeilingError);
    try {
      assertPointBudget(720, 5);
    } catch (e) {
      expect((e as QueryCeilingError).message).toContain(String(MAX_SERIES_POINTS));
    }
  });
});

describe("READ_QUERY_SETTINGS", () => {
  it("bounds rows, result size, time, and memory, and throws rather than truncating", () => {
    expect(Number(READ_QUERY_SETTINGS.max_rows_to_read)).toBeGreaterThan(0);
    expect(Number(READ_QUERY_SETTINGS.max_result_rows)).toBeGreaterThan(0);
    expect(Number(READ_QUERY_SETTINGS.max_execution_time)).toBeGreaterThan(0);
    expect(Number(READ_QUERY_SETTINGS.max_memory_usage)).toBeGreaterThan(0);
    // A silent partial result is the failure mode we are avoiding.
    expect(READ_QUERY_SETTINGS.result_overflow_mode).toBe("throw");
    expect(READ_QUERY_SETTINGS.read_overflow_mode).toBe("throw");
  });
});
