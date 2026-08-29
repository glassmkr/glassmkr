import { describe, it, expect } from "vitest";
import {
  resolveRangeHours,
  assertPointBudget,
  bucketMinutesFor,
  MAX_RANGE_HOURS,
  MAX_SERIES_POINTS,
} from "../query-ceilings";

// Round-3 item 3: the ceilings must never refuse a request our own UI makes.
// A ceiling that 400s the product is worse than no ceiling, because it looks
// like a bug in the dashboard rather than a limit. This test is the standing
// proof, so raising a ceiling or adding a range token cannot silently break
// first-party traffic.

// Every range token the metrics endpoint accepts.
const UI_RANGE_TOKENS = { "1h": 1, "6h": 6, "24h": 24, "7d": 168, "30d": 720 };
// Windows the history endpoint is asked for, including the retention edge.
const HISTORY_WINDOWS = [1, 6, 24, 168, 720, MAX_RANGE_HOURS];

describe("first-party requests stay inside the ceilings", () => {
  it("every UI range token resolves and fits the point budget", () => {
    for (const [token, hours] of Object.entries(UI_RANGE_TOKENS)) {
      const url = new URL(`https://x.test/api?range=${token}`);
      expect(resolveRangeHours(url, UI_RANGE_TOKENS), token).toBe(hours);
      expect(() => assertPointBudget(hours, bucketMinutesFor(hours)), token).not.toThrow();
    }
  });

  it("every history window fits, including the retention edge", () => {
    for (const hours of HISTORY_WINDOWS) {
      const url = new URL(`https://x.test/api?hours=${hours}`);
      expect(resolveRangeHours(url), `${hours}h`).toBe(hours);
      expect(() => assertPointBudget(hours, bucketMinutesFor(hours)), `${hours}h`).not.toThrow();
    }
  });

  it("the range ceiling reaches the full retention window", () => {
    // 90 days of retained snapshots must be queryable, or we keep data nobody
    // can ask for.
    expect(MAX_RANGE_HOURS).toBeGreaterThanOrEqual(90 * 24);
  });

  it("bucket widths keep the worst case inside the point cap", () => {
    for (const hours of [24, 168, 720, MAX_RANGE_HOURS]) {
      const points = Math.ceil((hours * 60) / bucketMinutesFor(hours));
      expect(points, `${hours}h`).toBeLessThanOrEqual(MAX_SERIES_POINTS);
    }
  });
});
