// Tests for evaluateEccErrors (rate-based correctable ECC) and
// getEccDeltaInWindow (cross-snapshot ClickHouse helper).
//
// Phase 7 P1 / glassmkr#24. See evaluator.ts at the bottom for the
// async export and clickhouse-state.ts for the helper.
//
// Test cases mirror the 15 cases enumerated in
// ~/Documents/Glassmkr/CC_PHASE_7_P1_ECC_RATE_BASED.md section
// "Tests (Task 3)".

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the ClickHouse client at the module boundary. Every test
// stubs the next query response with `mockNextEcc(...)` or asserts
// the lookup wasn't called.
const queryMock = vi.fn();
vi.mock("@glassmkr/db/clickhouse", () => ({
  clickhouse: { query: (...args: unknown[]) => queryMock(...args) },
}));

import {
  evaluateEccErrors,
  ECC_RATE_THRESHOLD_DEFAULT,
  ECC_RATE_WINDOW_HOURS_DEFAULT,
  type Snapshot,
  type ServerConfig,
} from "../evaluator";
import { getEccDeltaInWindow } from "../clickhouse-state";

function snap(opts: {
  namedCorr?: number; namedUnc?: number;
  selCorr?: number | null; selUnc?: number | null;
} = {}): Snapshot {
  return {
    system: { hostname: "h", ip: "1.2.3.4", os: "ubuntu", kernel: "6", uptime_seconds: 86400 },
    cpu: { user_percent: 1, system_percent: 1, iowait_percent: 0, idle_percent: 98, load_1m: 0, load_5m: 0, load_15m: 0 },
    memory: { total_mb: 1000, used_mb: 100, available_mb: 900, swap_total_mb: 0, swap_used_mb: 0 },
    disks: [],
    smart: [],
    network: [],
    raid: [],
    ipmi: {
      available: true,
      sensors: [],
      ecc_errors: {
        correctable: opts.namedCorr ?? 0,
        uncorrectable: opts.namedUnc ?? 0,
      },
      ecc_errors_from_sel: opts.selCorr !== undefined || opts.selUnc !== undefined
        ? {
            correctable: opts.selCorr ?? 0,
            uncorrectable: opts.selUnc ?? 0,
            newest_event_timestamp: null,
          } as any
        : undefined,
      sel_entries_count: 0,
    } as any,
    os_alerts: { oom_kills_recent: 0, zombie_processes: 0, time_drift_ms: 0 },
  } as Snapshot;
}

// Helper: stub the next ClickHouse `oldest snapshot in window` response.
function mockOldestEcc(
  oldestNamedCorr: number,
  oldestNamedUnc: number = 0,
  oldestSelCorr?: number,
  oldestSelUnc?: number,
) {
  const ipmi: any = {
    ecc_errors: { correctable: oldestNamedCorr, uncorrectable: oldestNamedUnc },
  };
  if (oldestSelCorr !== undefined || oldestSelUnc !== undefined) {
    ipmi.ecc_errors_from_sel = {
      correctable: oldestSelCorr ?? 0,
      uncorrectable: oldestSelUnc ?? 0,
      newest_event_timestamp: null,
    };
  }
  queryMock.mockResolvedValueOnce({
    json: async () => [{ ipmi: JSON.stringify(ipmi), timestamp: "2026-05-12T00:00:00.000Z" }],
  });
}

function mockEmptyEcc() {
  queryMock.mockResolvedValueOnce({ json: async () => [] });
}

beforeEach(() => { queryMock.mockReset(); });
afterEach(() => { vi.clearAllMocks(); });

describe("evaluateEccErrors (rate-based correctable ECC)", () => {
  it("1. returns no alerts when the snapshot has no ECC data", async () => {
    const s: any = { ipmi: { available: false, sensors: [] } };
    const out = await evaluateEccErrors(s as Snapshot, {} as ServerConfig, "srv_x");
    expect(out).toHaveLength(0);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("2. uncorrectable count is handled by the sync rule, not this function (no fire here)", async () => {
    // The sync rule fires critical at the same evaluation moment; this
    // function intentionally returns [] so we don't double-fire.
    const s = snap({ namedCorr: 0, namedUnc: 1 });
    const out = await evaluateEccErrors(s, {} as ServerConfig, "srv_x");
    expect(out).toHaveLength(0);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("3. correctable below threshold (delta 5 in 24h, threshold 10) does not fire", async () => {
    const s = snap({ namedCorr: 105 });
    mockOldestEcc(100); // delta = 5
    const out = await evaluateEccErrors(s, {} as ServerConfig, "srv_x");
    expect(out).toHaveLength(0);
  });

  it("4. correctable at threshold (delta 10 == threshold) fires warning", async () => {
    const s = snap({ namedCorr: 110 });
    mockOldestEcc(100); // delta = 10
    const out = await evaluateEccErrors(s, {} as ServerConfig, "srv_x");
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe("warning");
    expect((out[0].evidence as any).delta_correctable).toBe(10);
    expect((out[0].evidence as any).threshold).toBe(ECC_RATE_THRESHOLD_DEFAULT);
    expect((out[0].evidence as any).window_hours).toBe(ECC_RATE_WINDOW_HOURS_DEFAULT);
    expect((out[0].evidence as any).evaluation).toBe("rate_based");
  });

  it("5. correctable far above threshold (delta 50) fires warning", async () => {
    const s = snap({ namedCorr: 150 });
    mockOldestEcc(100); // delta = 50
    const out = await evaluateEccErrors(s, {} as ServerConfig, "srv_x");
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe("warning");
    expect((out[0].evidence as any).delta_correctable).toBe(50);
  });

  it("6. counter reset (current < oldest) is logged and skipped (no fire)", async () => {
    const s = snap({ namedCorr: 5 });
    mockOldestEcc(100); // current 5 < oldest 100 = reset
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const out = await evaluateEccErrors(s, {} as ServerConfig, "srv_x");
      expect(out).toHaveLength(0);
      expect(log).toHaveBeenCalledWith(expect.stringContaining("counter reset"));
    } finally {
      log.mockRestore();
    }
  });

  it("7. insufficient snapshots in window returns no alert (does not false-positive)", async () => {
    const s = snap({ namedCorr: 50 });
    mockEmptyEcc(); // no historical row in window
    const out = await evaluateEccErrors(s, {} as ServerConfig, "srv_x");
    expect(out).toHaveLength(0);
  });

  it("8. per-server window override (168h = 7d) is honoured", async () => {
    const s = snap({ namedCorr: 110 });
    mockOldestEcc(100); // delta = 10
    const out = await evaluateEccErrors(s, { ecc_rate_window_hours: 168 } as ServerConfig, "srv_x");
    expect(out).toHaveLength(1);
    expect((out[0].evidence as any).window_hours).toBe(168);
    // Confirm the helper was called with windowHours=168 (4th
    // positional in the SQL params).
    const params = (queryMock.mock.calls[0][0] as any).query_params;
    expect(params.windowHours).toBe(168);
  });

  it("9. per-server rate threshold override (100) suppresses below and fires above", async () => {
    // Below threshold (delta 50 < 100)
    const sA = snap({ namedCorr: 150 });
    mockOldestEcc(100); // delta = 50
    const a = await evaluateEccErrors(sA, { ecc_correctable_rate_warning: 100 } as ServerConfig, "srv_x");
    expect(a).toHaveLength(0);

    // At threshold (delta 100 >= 100)
    const sB = snap({ namedCorr: 200 });
    mockOldestEcc(100); // delta = 100
    const b = await evaluateEccErrors(sB, { ecc_correctable_rate_warning: 100 } as ServerConfig, "srv_x");
    expect(b).toHaveLength(1);
    expect((b[0].evidence as any).threshold).toBe(100);
  });

  it("10. legacy ecc_correctable_warning is used as rate threshold when new field is absent", async () => {
    const s = snap({ namedCorr: 210 });
    mockOldestEcc(100); // delta = 110
    const out = await evaluateEccErrors(s, { ecc_correctable_warning: 100 } as ServerConfig, "srv_x");
    expect(out).toHaveLength(1);
    expect((out[0].evidence as any).threshold).toBe(100);
    expect((out[0].evidence as any).delta_correctable).toBe(110);
  });
});

describe("getEccDeltaInWindow (ClickHouse helper)", () => {
  it("11. returns correct delta when oldest snapshot is found in window", async () => {
    mockOldestEcc(50, 0, 60, 1);
    // Current named 80, sel 90 → max 90; oldest max(50, 60) = 60.
    // Helper uses caller-supplied current values (90, 1) and the parsed
    // oldest values (60, 1) — delta correctable = 30, uncorrectable = 0.
    const d = await getEccDeltaInWindow("srv_a", 24, 90, 1);
    expect(d).toEqual({ correctable: 30, uncorrectable: 0, counterReset: false });
  });

  it("12. returns null when ClickHouse returns no rows (insufficient data)", async () => {
    mockEmptyEcc();
    const d = await getEccDeltaInWindow("srv_a", 24, 50, 0);
    expect(d).toBeNull();
  });

  it("13. returns null when the ClickHouse query throws (suppressed lookup failure)", async () => {
    queryMock.mockRejectedValueOnce(new Error("clickhouse blip"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const d = await getEccDeltaInWindow("srv_a", 24, 50, 0);
      expect(d).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("cross-snapshot lookup failed"));
    } finally {
      warn.mockRestore();
    }
  });

  it("14. flags counterReset and zeroes deltas when current < oldest", async () => {
    mockOldestEcc(100);
    const d = await getEccDeltaInWindow("srv_a", 24, 30, 0);
    expect(d).toEqual({ correctable: 0, uncorrectable: 0, counterReset: true });
  });

  it("15. returns null when the oldest row has no parseable ECC field", async () => {
    queryMock.mockResolvedValueOnce({
      json: async () => [{ ipmi: JSON.stringify({ sensors: [] }), timestamp: "2026-05-12T00:00:00Z" }],
    });
    const d = await getEccDeltaInWindow("srv_a", 24, 30, 0);
    expect(d).toBeNull();
  });
});
