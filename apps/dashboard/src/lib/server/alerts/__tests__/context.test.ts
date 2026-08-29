import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the clickhouse client so fetchSamples can be tested without a live DB.
vi.mock("@glassmkr/db/clickhouse", () => ({
  clickhouse: {
    query: vi.fn(),
  },
}));

import { clickhouse } from "@glassmkr/db/clickhouse";
import {
  computeSummary,
  renderContextBlock,
  buildContextBlock,
  CONTEXT_METRICS,
  type Sample,
} from "../context";

// Access the Sample type via the module's public type. computeSummary takes
// Sample[], so a test-local builder suffices.
function s(tsMinutesAgoFromNow: number, value: number): Sample {
  return { ts: Date.now() - tsMinutesAgoFromNow * 60_000, value } as Sample;
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("computeSummary", () => {
  it("returns null with fewer than 3 samples", () => {
    expect(computeSummary([], { trendWindowMinutes: 30, trendNoiseFloor: 0.1 })).toBeNull();
    expect(
      computeSummary([s(10, 1), s(5, 2)], { trendWindowMinutes: 30, trendNoiseFloor: 0.1 }),
    ).toBeNull();
  });

  it("computes current/min/max/average from a stable trace", () => {
    const samples = [s(60, 100), s(45, 100), s(30, 100), s(15, 100), s(0, 100)];
    const out = computeSummary(samples, { trendWindowMinutes: 30, trendNoiseFloor: 0.1 })!;
    expect(out.current).toBe(100);
    expect(out.min).toBe(100);
    expect(out.max).toBe(100);
    expect(out.average).toBe(100);
    expect(out.trend).toEqual({ kind: "stable" });
  });

  it("classifies rising trend above noise floor", () => {
    // Rising from 100 to 130 over 30 minutes: slope = 60/hr exactly,
    // range (max - min) = 30, noise floor 0.1 * 30 = 3. 60 > 3 -> slope.
    const samples = [
      s(120, 100), s(105, 100), s(90, 100), s(75, 100), s(60, 100),
      s(45, 100), s(30, 100), s(20, 110), s(10, 120), s(0, 130),
    ];
    const out = computeSummary(samples, { trendWindowMinutes: 30, trendNoiseFloor: 0.1 })!;
    expect(out.trend.kind).toBe("slope");
    if (out.trend.kind === "slope") {
      expect(out.trend.perHour).toBeGreaterThan(0);
    }
  });

  it("classifies gentle drift below noise floor as stable", () => {
    // Range 1, noise floor 0.1 * 1 = 0.1. Tail slope ~0.5/hr would
    // normally register, but we inflate range to trigger stable.
    const samples = [
      s(120, 90), s(105, 100), s(90, 99), s(75, 100), s(60, 100),
      s(45, 100), s(30, 100), s(20, 100.1), s(10, 100.15), s(0, 100.2),
    ];
    const out = computeSummary(samples, { trendWindowMinutes: 30, trendNoiseFloor: 0.1 })!;
    expect(out.trend.kind).toBe("stable");
  });

  it("min/max carry their timestamps", () => {
    const samples = [s(50, 80), s(40, 70), s(30, 90), s(20, 85), s(10, 75)];
    const out = computeSummary(samples, { trendWindowMinutes: 30, trendNoiseFloor: 0.1 })!;
    expect(out.min).toBe(70);
    expect(out.max).toBe(90);
    expect(out.minAt).toBe(samples[1].ts);
    expect(out.maxAt).toBe(samples[2].ts);
  });
});

describe("renderContextBlock (ram_high config)", () => {
  const cfg = CONTEXT_METRICS.ram_high!;
  it("renders current / average / min / max / stable trend with MB/GB formatting", () => {
    const summary = {
      samples: [] as Sample[],
      current: 12288,   // 12 GB
      average: 11776,   // 11.5 GB
      min: 10240,       // 10 GB
      max: 13312,       // 13 GB
      minAt: Date.UTC(2026, 3, 24, 9, 15),
      maxAt: Date.UTC(2026, 3, 24, 10, 42),
      trend: { kind: "stable" as const },
    };
    const text = renderContextBlock(summary, cfg, 120);
    expect(text).toMatch(/Context \(last 2 hours\):/);
    expect(text).toMatch(/current: 12\.0 GB/);
    expect(text).toMatch(/minimum: 10\.0 GB\s+at 09:15/);
    expect(text).toMatch(/maximum: 13\.0 GB\s+at 10:42/);
    expect(text).toMatch(/trend:\s+stable/);
  });

  it("uses MB formatting under 1 GiB threshold", () => {
    const summary = {
      samples: [] as Sample[],
      current: 500, average: 400, min: 300, max: 600,
      minAt: 0, maxAt: 0, trend: { kind: "stable" as const },
    };
    const text = renderContextBlock(summary, cfg, 120);
    expect(text).toMatch(/current: 500 MB/);
  });

  it("renders rising trend with signed slope and direction word", () => {
    const summary = {
      samples: [] as Sample[],
      current: 13312, average: 12000, min: 10240, max: 13312,
      minAt: 0, maxAt: 0,
      trend: { kind: "slope" as const, perHour: 2048 }, // +2 GB/hr
    };
    const text = renderContextBlock(summary, cfg, 120);
    expect(text).toMatch(/trend:\s+rising at 2\.0 GB\/hour over last 30 min/);
  });

  it("renders falling trend with magnitude only", () => {
    const summary = {
      samples: [] as Sample[],
      current: 10240, average: 12000, min: 10240, max: 13312,
      minAt: 0, maxAt: 0,
      trend: { kind: "slope" as const, perHour: -1536 }, // -1.5 GB/hr
    };
    const text = renderContextBlock(summary, cfg, 120);
    expect(text).toMatch(/trend:\s+falling at 1\.5 GB\/hour/);
  });
});

describe("buildContextBlock (integration with mocked clickhouse)", () => {
  it("returns null for alert types with no config", async () => {
    expect(await buildContextBlock("totally_fake_rule", "srv_x")).toBeNull();
    expect(clickhouse.query).not.toHaveBeenCalled();
  });

  it("returns 'insufficient history' when fewer than 3 samples come back", async () => {
    (clickhouse.query as any).mockResolvedValueOnce({
      json: async () => ([
        { ts: Date.now() - 5 * 60_000, v: 8000 },
        { ts: Date.now(),              v: 8100 },
      ]),
    });
    const out = await buildContextBlock("ram_high", "srv_x");
    expect(out).toBe("Context: insufficient history.");
  });

  it("renders a full block when samples are present", async () => {
    const now = Date.now();
    (clickhouse.query as any).mockResolvedValueOnce({
      json: async () => ([
        { ts: now - 110 * 60_000, v: 8192 },
        { ts: now -  90 * 60_000, v: 8192 },
        { ts: now -  60 * 60_000, v: 8192 },
        { ts: now -  30 * 60_000, v: 8192 },
        { ts: now,                v: 8192 },
      ]),
    });
    const out = await buildContextBlock("ram_high", "srv_x");
    expect(out).toMatch(/Context \(last 2 hours\):/);
    expect(out).toMatch(/current: 8\.0 GB/);
    expect(out).toMatch(/trend:\s+stable/);
  });

  it("never throws when clickhouse rejects; returns a benign 'unavailable' note", async () => {
    (clickhouse.query as any).mockRejectedValueOnce(new Error("clickhouse down"));
    const out = await buildContextBlock("ram_high", "srv_x");
    expect(out).toBe("Context: unavailable (history query failed).");
  });
});
