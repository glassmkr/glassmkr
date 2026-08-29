// host availability signals (2026-06): a previously-stable host that starts
// disappearing from the snapshot stream repeatedly. uptime_seconds then
// disambiguates the cause:
//   - reboots across the gaps (uptime reset)  -> host_instability   (hardware)
//   - gaps but uptime kept climbing           -> host_reporting_gaps (agent/net)
//   - no usable uptime (old history)          -> host_instability, hedged

import { describe, expect, it } from "vitest";
import { extractInstabilityFeatures, type TwSnapshotRow } from "../features";
import { hostStabilityTriggers } from "../triggers";
import { baseFeatures } from "./fixtures";

const MIN = 60_000;
const HOUR = 60 * MIN;

function rowsAt(ts: number[]): TwSnapshotRow[] {
  return ts.map((t) => ({ timestamp: t } as TwSnapshotRow));
}
function rowsWithUptime(pts: Array<{ t: number; up: number }>): TwSnapshotRow[] {
  return pts.map((p) => ({ timestamp: p.t, uptime_seconds: p.up } as TwSnapshotRow));
}

describe("extractInstabilityFeatures", () => {
  it("counts multi-minute disappearances as gaps; ignores normal cadence", () => {
    const now = 1_000_000_000_000;
    const ts: number[] = [];
    let t = now - 6 * HOUR;
    for (let i = 0; i < 30; i++) { ts.push(t); t += MIN; } // steady 1-min cadence
    t += 30 * MIN; ts.push(t);                              // gap 1 (~31 min)
    for (let i = 0; i < 5; i++) { t += MIN; ts.push(t); }
    t += 25 * MIN; ts.push(t);                              // gap 2 (~26 min)
    for (let i = 0; i < 5; i++) { t += MIN; ts.push(t); }

    const f = extractInstabilityFeatures(rowsAt(ts));
    expect(f.gap_threshold_minutes).toBe(15);
    expect(f.recent_gaps).toBe(2);
    expect(f.baseline_gaps).toBe(0);
    expect(f.longest_recent_gap_minutes).toBeGreaterThanOrEqual(29);
    expect(f.uptime_available).toBe(false); // no uptime on these rows
    expect(f.recent_reboot_gaps).toBe(0);
  });

  it("does NOT count a fast (sub-threshold) reboot as a gap", () => {
    const now = 1_000_000_000_000;
    const ts: number[] = [];
    let t = now - 3 * HOUR;
    for (let i = 0; i < 20; i++) { ts.push(t); t += MIN; }
    t += 3 * MIN; ts.push(t);                  // ~3-min blip, below 15-min floor
    for (let i = 0; i < 20; i++) { t += MIN; ts.push(t); }
    expect(extractInstabilityFeatures(rowsAt(ts)).recent_gaps).toBe(0);
  });

  it("returns empty for fewer than 2 rows", () => {
    expect(extractInstabilityFeatures([]).recent_gaps).toBe(0);
  });

  it("flags gaps where uptime RESET as reboots", () => {
    const now = 1_000_000_000_000;
    const pts: Array<{ t: number; up: number }> = [];
    let t = now - 4 * HOUR;
    let up = 100_000;
    for (let i = 0; i < 30; i++) { pts.push({ t, up }); t += MIN; up += 60; }
    t += 30 * MIN; up = 120; pts.push({ t, up });                 // gap 1: rebooted (uptime reset)
    for (let i = 0; i < 5; i++) { t += MIN; up += 60; pts.push({ t, up }); }
    t += 30 * MIN; up = 90; pts.push({ t, up });                  // gap 2: rebooted again
    for (let i = 0; i < 5; i++) { t += MIN; up += 60; pts.push({ t, up }); }

    const f = extractInstabilityFeatures(rowsWithUptime(pts));
    expect(f.recent_gaps).toBe(2);
    expect(f.recent_reboot_gaps).toBe(2);
    expect(f.uptime_available).toBe(true);
  });

  it("does NOT flag gaps as reboots when uptime keeps climbing through them", () => {
    const now = 1_000_000_000_000;
    const pts: Array<{ t: number; up: number }> = [];
    let t = now - 4 * HOUR;
    let up = 100_000;
    for (let i = 0; i < 30; i++) { pts.push({ t, up }); t += MIN; up += 60; }
    t += 30 * MIN; up += 30 * 60; pts.push({ t, up });            // gap 1: stayed up (uptime += gap)
    for (let i = 0; i < 5; i++) { t += MIN; up += 60; pts.push({ t, up }); }
    t += 30 * MIN; up += 30 * 60; pts.push({ t, up });            // gap 2: stayed up
    for (let i = 0; i < 5; i++) { t += MIN; up += 60; pts.push({ t, up }); }

    const f = extractInstabilityFeatures(rowsWithUptime(pts));
    expect(f.recent_gaps).toBe(2);
    expect(f.recent_reboot_gaps).toBe(0);
    expect(f.uptime_available).toBe(true);
  });
});

describe("hostStabilityTriggers", () => {
  const base = {
    recent_gaps: 0, recent_days: 3, baseline_gaps: 0, baseline_days: 4,
    longest_recent_gap_minutes: 30, gap_threshold_minutes: 50,
    recent_reboot_gaps: 0, uptime_available: true,
  };

  it("reboot loop (uptime reset) -> host_instability: medium at 2, high at 3+", () => {
    const two = hostStabilityTriggers(baseFeatures({ instability: { ...base, recent_gaps: 2, recent_reboot_gaps: 2 } }));
    expect(two.length).toBe(1);
    expect(two[0].type).toBe("host_instability");
    expect(two[0].severity).toBe("medium");
    const three = hostStabilityTriggers(baseFeatures({ instability: { ...base, recent_gaps: 3, recent_reboot_gaps: 3 } }));
    expect(three[0].severity).toBe("high");
  });

  it("stayed up (gaps, no reboots) -> host_reporting_gaps, medium", () => {
    const out = hostStabilityTriggers(baseFeatures({ instability: { ...base, recent_gaps: 3, recent_reboot_gaps: 0 } }));
    expect(out.length).toBe(1);
    expect(out[0].type).toBe("host_reporting_gaps");
    expect(out[0].severity).toBe("medium");
    expect(out[0].resource.kind).toBe("host");
    expect(out[0].evidence_summary).toContain("stayed powered");
  });

  it("a single reboot among the gaps still reads as host_instability (medium)", () => {
    const out = hostStabilityTriggers(baseFeatures({ instability: { ...base, recent_gaps: 3, recent_reboot_gaps: 1 } }));
    expect(out[0].type).toBe("host_instability");
    expect(out[0].severity).toBe("medium");
  });

  it("uptime unavailable -> host_instability hedged, severity by gap count", () => {
    const two = hostStabilityTriggers(baseFeatures({ instability: { ...base, recent_gaps: 2, uptime_available: false } }));
    expect(two[0].type).toBe("host_instability");
    expect(two[0].severity).toBe("medium");
    expect(two[0].evidence_summary).toContain("Uptime was not available");
    const three = hostStabilityTriggers(baseFeatures({ instability: { ...base, recent_gaps: 3, uptime_available: false } }));
    expect(three[0].severity).toBe("high");
  });

  it("does NOT fire on a single gap (one planned reboot)", () => {
    expect(hostStabilityTriggers(baseFeatures({ instability: { ...base, recent_gaps: 1, recent_reboot_gaps: 1 } })).length).toBe(0);
  });

  it("does NOT fire on a chronically-flaky host (recent rate not above its own baseline)", () => {
    const out = hostStabilityTriggers(baseFeatures({ instability: { ...base, recent_gaps: 2, recent_reboot_gaps: 2, baseline_gaps: 12, baseline_days: 4 } }));
    expect(out.length).toBe(0);
  });

  it("does NOT fire when the instability feature is absent", () => {
    expect(hostStabilityTriggers(baseFeatures({})).length).toBe(0);
  });
});
