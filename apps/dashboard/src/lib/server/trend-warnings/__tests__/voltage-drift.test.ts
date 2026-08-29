// psu_rail_voltage_drift trend warning (2026-06-09): true temporal drift of a
// fixed (regulated) PSU rail away from its own historical mean, measured in
// baseline standard deviations. Distinct from psu_rail_out_of_spec (point-in-
// time deviation from a guessed nominal). Variance-aware so DVFS / noisy rails
// do not trip, and self-baselined so no board-specific thresholds. This is the
// general voltage-degradation signal that complements host_instability.

import { describe, expect, it } from "vitest";
import { extractVoltageDriftFeatures, type TwSnapshotRow } from "../features";
import { voltageDriftTriggers } from "../triggers";
import { baseFeatures } from "./fixtures";

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

function ipmi(rails: Array<{ name: string; value: number }>): string {
  return JSON.stringify({
    available: true,
    sensors: rails.map((r) => ({ name: r.name, value: r.value, unit: "Volts", status: "ok" })),
  });
}

function vrow(tsOffsetMs: number, rails: Array<{ name: string; value: number }>): TwSnapshotRow {
  return {
    timestamp: NOW + tsOffsetMs,
    ipmi: ipmi(rails),
    smart: "[]", disks: "[]", network: "[]", zfs: "[]",
  } as TwSnapshotRow;
}

// n baseline samples over [-30d, -8d] then n recent over [-7d, 0]. Each rail
// supplies a value function for each window.
function buildRows(
  n: number,
  rails: Array<{ name: string; baseline: (i: number) => number; recent: (i: number) => number }>,
): TwSnapshotRow[] {
  const rows: TwSnapshotRow[] = [];
  for (let i = 0; i < n; i++) {
    const off = -30 * DAY + (i / (n - 1)) * (22 * DAY);
    rows.push(vrow(off, rails.map((r) => ({ name: r.name, value: r.baseline(i) }))));
  }
  for (let i = 0; i < n; i++) {
    const off = -7 * DAY + (i / (n - 1)) * (7 * DAY);
    rows.push(vrow(off, rails.map((r) => ({ name: r.name, value: r.recent(i) }))));
  }
  return rows;
}

describe("extractVoltageDriftFeatures", () => {
  it("captures a fixed rail that walked away from baseline (high z), ignores a stable rail and a DVFS rail", () => {
    const rows = buildRows(60, [
      // 12V rail sagged from 12.00 to 11.80 with tight noise -> real drift
      { name: "P_12V", baseline: (i) => (i % 2 ? 12.01 : 11.99), recent: (i) => (i % 2 ? 11.81 : 11.79) },
      // 5V rail rock-steady -> ~0 drift
      { name: "P_5V", baseline: (i) => (i % 2 ? 5.01 : 4.99), recent: (i) => (i % 2 ? 5.01 : 4.99) },
      // VCORE: DVFS core rail, no fixed nominal -> excluded by construction
      { name: "VCORE", baseline: () => 1.0, recent: () => 1.05 },
    ]);

    const out = extractVoltageDriftFeatures(rows);

    const v12 = out.find((d) => d.rail === "P_12V")!;
    expect(v12).toBeDefined();
    expect(v12.baseline_mean_v).toBeCloseTo(12.0, 2);
    expect(v12.recent_mean_v).toBeCloseTo(11.8, 2);
    expect(v12.drift_v).toBeCloseTo(-0.2, 2);
    expect(v12.drift_pct).toBeCloseTo(0.0167, 3);
    expect(v12.z_score).toBeGreaterThanOrEqual(5);

    const v5 = out.find((d) => d.rail === "P_5V")!;
    expect(v5.drift_pct).toBeLessThan(0.005);

    expect(out.find((d) => d.rail === "VCORE")).toBeUndefined(); // DVFS excluded
  });

  it("is variance-aware: a noisy rail with a big baseline sigma yields low z and does NOT fire the trigger", () => {
    // 12V rail swinging 11.0/13.0 (sigma ~1.0V), recent mean nudged to 12.3.
    // drift_pct 2.5% clears the pct floor, but 0.3V is only ~0.3 sigma -> quiet.
    const rows = buildRows(60, [
      { name: "P_12V", baseline: (i) => (i % 2 ? 13.0 : 11.0), recent: (i) => (i % 2 ? 12.6 : 12.0) },
    ]);

    const out = extractVoltageDriftFeatures(rows);
    const v = out.find((d) => d.rail === "P_12V")!;
    expect(v.baseline_stddev_v).toBeGreaterThan(0.5);
    expect(v.drift_pct).toBeGreaterThanOrEqual(0.015); // would clear the pct floor
    expect(v.z_score).toBeLessThan(3);                 // but fails the variance gate

    expect(voltageDriftTriggers(baseFeatures({ voltage_drift: out })).length).toBe(0);
  });

  it("returns empty when there are too few samples", () => {
    expect(extractVoltageDriftFeatures([]).length).toBe(0);
  });

  it("excludes PSU input-voltage (VIN) sensors even with drifting readings (2026-07-14)", () => {
    // Input voltage tracks the mains/source, not a regulated rail, so it must
    // never enter the regulated-rail drift detector (a validation host asrock FP).
    const rows = buildRows(60, [
      { name: "P_12V", baseline: (i) => (i % 2 ? 12.01 : 11.99), recent: (i) => (i % 2 ? 11.81 : 11.79) },
      { name: "PSU1 VIN", baseline: () => 12.0, recent: () => 11.5 },
      { name: "PSU2 VIN", baseline: () => 12.0, recent: () => 11.5 },
    ]);
    const out = extractVoltageDriftFeatures(rows);
    expect(out.find((d) => d.rail === "P_12V")).toBeDefined();
    expect(out.find((d) => d.rail === "PSU1 VIN")).toBeUndefined();
    expect(out.find((d) => d.rail === "PSU2 VIN")).toBeUndefined();
  });

  it("drops a non-finite reading (No Reading string) instead of emitting a NaN row (2026-07-14)", () => {
    const mk = (off: number) =>
      ({
        timestamp: NOW + off,
        ipmi: JSON.stringify({ available: true, sensors: [{ name: "GHOST_3V", value: "No Reading", unit: "Volts", status: "ns" }] }),
        smart: "[]", disks: "[]", network: "[]", zfs: "[]",
      }) as TwSnapshotRow;
    const rows: TwSnapshotRow[] = [];
    for (let i = 0; i < 60; i++) rows.push(mk(-30 * DAY + (i / 59) * (22 * DAY)));
    for (let i = 0; i < 60; i++) rows.push(mk(-7 * DAY + (i / 59) * (7 * DAY)));
    const out = extractVoltageDriftFeatures(rows);
    expect(out.find((d) => d.rail === "GHOST_3V")).toBeUndefined();
    expect(out.every((d) => Number.isFinite(d.drift_pct) && Number.isFinite(d.z_score))).toBe(true);
  });
});

describe("voltageDriftTriggers", () => {
  const entry = (o: Record<string, number> = {}) => ({
    rail: "P_12V", nominal_v: 12, baseline_mean_v: 12.0, baseline_stddev_v: 0.01,
    recent_mean_v: 11.8, drift_v: -0.2, drift_pct: 0.0167, z_score: 10,
    baseline_samples: 60, recent_samples: 60, ...o,
  });

  it("fires (medium) for a 1.5-3% drift that clears the variance gate", () => {
    const out = voltageDriftTriggers(baseFeatures({ voltage_drift: [entry()] }));
    expect(out.length).toBe(1);
    expect(out[0].type).toBe("psu_rail_voltage_drift");
    expect(out[0].severity).toBe("medium");
    expect(out[0].resource.kind).toBe("psu");
  });

  it("escalates to high at >= 3% drift", () => {
    const out = voltageDriftTriggers(baseFeatures({ voltage_drift: [entry({ drift_pct: 0.04 })] }));
    expect(out[0].severity).toBe("high");
  });

  it("does NOT fire below the variance (z) gate", () => {
    expect(voltageDriftTriggers(baseFeatures({ voltage_drift: [entry({ z_score: 1.5 })] })).length).toBe(0);
  });

  it("does NOT fire below the drift-percent floor", () => {
    expect(voltageDriftTriggers(baseFeatures({ voltage_drift: [entry({ drift_pct: 0.005 })] })).length).toBe(0);
  });

  it("does NOT fire when the voltage_drift feature is absent", () => {
    expect(voltageDriftTriggers(baseFeatures({})).length).toBe(0);
  });
});
