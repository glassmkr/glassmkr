// Pure-function tests for the timeseries primitives.

import { describe, expect, it } from "vitest";

import { DAY_MS } from "../time.js";
import {
  findNearestByTime,
  largestPositiveStepInWindow,
  linearProjection,
  rateOfChange,
  thresholdCrossing,
} from "../timeseries.js";

describe("linearProjection", () => {
  it("zero slope on insufficient data", () => {
    expect(linearProjection([]).slope_per_day).toBe(0);
    expect(linearProjection([{ t: 0, v: 1 }]).slope_per_day).toBe(0);
  });

  it("flat series produces zero slope and no crossing", () => {
    const points = [
      { t: 0, v: 5 },
      { t: 1000, v: 5 },
      { t: 2000, v: 5 },
    ];
    const res = linearProjection(points, 10);
    expect(res.slope_per_day).toBe(0);
    expect(res.crosses_at_ms).toBeNull();
  });

  it("monotonic rising series produces positive slope", () => {
    const start = 1_700_000_000_000;
    const points = [
      { t: start, v: 0 },
      { t: start + DAY_MS, v: 10 },
      { t: start + 2 * DAY_MS, v: 20 },
    ];
    const res = linearProjection(points);
    expect(res.slope_per_day).toBeCloseTo(10, 5);
  });

  it("computes future crossing point", () => {
    const start = 1_700_000_000_000;
    const points = [
      { t: start, v: 0 },
      { t: start + DAY_MS, v: 10 },
      { t: start + 2 * DAY_MS, v: 20 },
    ];
    // Crosses 100 in ~10 days from start (so ~8 days after the latest point).
    const res = linearProjection(points, 100);
    expect(res.crosses_at_ms).not.toBeNull();
    expect(res.crosses_at_ms!).toBeGreaterThan(start + 2 * DAY_MS);
    expect(res.crosses_at_ms!).toBeCloseTo(start + 10 * DAY_MS, -3);
  });

  it("returns null crossing when projection already past the threshold", () => {
    const start = 1_700_000_000_000;
    const points = [
      { t: start, v: 50 },
      { t: start + DAY_MS, v: 60 },
      { t: start + 2 * DAY_MS, v: 70 },
    ];
    // Crossing 0 from a rising line would be in the past.
    const res = linearProjection(points, 0);
    expect(res.crosses_at_ms).toBeNull();
  });
});

describe("rateOfChange", () => {
  it("derives both per-day and per-second from the projection slope", () => {
    const start = 1_700_000_000_000;
    const points = [
      { t: start, v: 0 },
      { t: start + DAY_MS, v: 86_400 },
    ];
    const res = rateOfChange(points);
    expect(res.rate_per_day).toBeCloseTo(86_400, 0);
    expect(res.rate_per_second).toBeCloseTo(1, 5);
  });
});

describe("thresholdCrossing", () => {
  it("detects first above-crossing", () => {
    const points = [
      { t: 1, v: 5 },
      { t: 2, v: 8 },
      { t: 3, v: 12 },
      { t: 4, v: 15 },
    ];
    const res = thresholdCrossing(points, 10, "above");
    expect(res).not.toBeNull();
    expect(res!.first_crossed_at_ms).toBe(3);
    expect(res!.value_at_crossing).toBe(12);
  });

  it("returns null when already above on entry (no transition)", () => {
    const points = [
      { t: 1, v: 15 },
      { t: 2, v: 20 },
    ];
    expect(thresholdCrossing(points, 10, "above")).toBeNull();
  });

  it("detects first below-crossing", () => {
    const points = [
      { t: 1, v: 100 },
      { t: 2, v: 80 },
      { t: 3, v: 40 },
    ];
    const res = thresholdCrossing(points, 50, "below");
    expect(res).not.toBeNull();
    expect(res!.first_crossed_at_ms).toBe(3);
  });
});

describe("findNearestByTime", () => {
  it("returns the closest point", () => {
    const points = [
      { t: 100, v: 1 },
      { t: 200, v: 2 },
      { t: 300, v: 3 },
    ];
    expect(findNearestByTime(points, 180)?.v).toBe(2);
    expect(findNearestByTime(points, 290)?.v).toBe(3);
  });

  it("returns null when nothing within tolerance", () => {
    const points = [{ t: 100, v: 1 }];
    expect(findNearestByTime(points, 1_000_000, 100)).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(findNearestByTime([], 0)).toBeNull();
  });
});

describe("largestPositiveStepInWindow", () => {
  it("returns the largest positive single-step delta", () => {
    const now = Date.now();
    const points = [
      { t: now - 30_000, v: 0 },
      { t: now - 20_000, v: 5 },
      { t: now - 10_000, v: 20 },
      { t: now - 1_000, v: 25 },
    ];
    // Steps: +5, +15, +5; largest is 15.
    expect(largestPositiveStepInWindow(points, 60)).toBe(15);
  });

  it("ignores points outside the window", () => {
    const now = Date.now();
    const points = [
      { t: now - 7200_000, v: 0 }, // Outside the 60s window
      { t: now - 30_000, v: 100 },
      { t: now - 10_000, v: 110 },
    ];
    // Only in-window steps count: +10.
    expect(largestPositiveStepInWindow(points, 60)).toBe(10);
  });

  it("zero when all deltas are negative or zero", () => {
    const now = Date.now();
    const points = [
      { t: now - 30_000, v: 50 },
      { t: now - 20_000, v: 40 },
      { t: now - 10_000, v: 40 },
    ];
    expect(largestPositiveStepInWindow(points, 60)).toBe(0);
  });
});
