import { describe, it, expect } from "vitest";
import {
  evaluateAlerts,
  evaluateUnexpectedReboot,
  type Snapshot,
  type SuppressedAlert,
} from "../evaluator";

// Build a snapshot that WILL trigger cpu_temperature_high (uc=100, value=96,
// critical threshold 95). Uptime is parameterised so we can test the grace.
function hotSnapshot(uptimeSeconds: number): Snapshot {
  return {
    system: { hostname: "t", ip: "1.1.1.1", os: "Linux", kernel: "6.1", uptime_seconds: uptimeSeconds },
    cpu: { user_percent: 1, system_percent: 1, iowait_percent: 0, idle_percent: 98, load_1m: 0.1, load_5m: 0.1, load_15m: 0.1 },
    memory: { total_mb: 65536, used_mb: 5000, available_mb: 60000, swap_total_mb: 0, swap_used_mb: 0 },
    disks: [],
    smart: [],
    network: [],
    raid: [],
    ipmi: {
      available: true,
      sensors: [{ name: "CPU1 Temp", value: 96, unit: "C", status: "ok", upper_critical: 100 }],
      ecc_errors: { correctable: 0, uncorrectable: 0 },
      sel_entries_count: 0,
    },
    os_alerts: { oom_kills_recent: 0, zombie_processes: 0, time_drift_ms: 0 },
  };
}

describe("evaluateAlerts boot_grace_seconds", () => {
  it("1. rule with grace=60 and condition met at uptime=30s: suppressed", () => {
    const sup: SuppressedAlert[] = [];
    const alerts = evaluateAlerts(hotSnapshot(30), {}, sup);
    expect(alerts.find((a) => a.type === "cpu_temperature_high")).toBeUndefined();
    expect(sup.find((s) => s.type === "cpu_temperature_high")?.reason).toBe("boot_grace");
    expect(sup.find((s) => s.type === "cpu_temperature_high")?.grace_seconds).toBe(60);
  });

  it("2. rule with grace=60 and condition met at uptime=61s: fires normally", () => {
    const sup: SuppressedAlert[] = [];
    const alerts = evaluateAlerts(hotSnapshot(61), {}, sup);
    expect(alerts.find((a) => a.type === "cpu_temperature_high")?.severity).toBe("critical");
    expect(sup.find((s) => s.type === "cpu_temperature_high")).toBeUndefined();
  });

  it("3. rule with grace and condition NOT met at uptime=30s: no history, no fire", () => {
    const sup: SuppressedAlert[] = [];
    const cool = hotSnapshot(30);
    cool.ipmi.sensors = [{ name: "CPU1 Temp", value: 50, unit: "C", status: "ok", upper_critical: 100 }];
    const alerts = evaluateAlerts(cool, {}, sup);
    expect(alerts.find((a) => a.type === "cpu_temperature_high")).toBeUndefined();
    expect(sup).toHaveLength(0);
  });

  it("4. grace=0 rule fires at uptime=0 (regression guard: no accidental global gate)", () => {
    const sup: SuppressedAlert[] = [];
    const s = hotSnapshot(0);
    // Use a rule with no declared grace: ram_high
    s.memory = { total_mb: 1000, used_mb: 990, available_mb: 10, swap_total_mb: 0, swap_used_mb: 0 };
    const alerts = evaluateAlerts(s, {}, sup);
    expect(alerts.find((a) => a.type === "ram_high")).toBeDefined();
    expect(sup.find((s2) => s2.type === "ram_high")).toBeUndefined();
  });

  it("5. backward compat: suppressions array is optional", () => {
    const alerts = evaluateAlerts(hotSnapshot(30));
    // cpu_temperature_high still suppressed silently when no collector passed
    expect(alerts.find((a) => a.type === "cpu_temperature_high")).toBeUndefined();
  });

  it("6. boundary: uptime equal to grace fires (strict `<`, not `<=`)", () => {
    const sup: SuppressedAlert[] = [];
    // clock_drift has grace=300; at uptime=300 it should fire
    const s = hotSnapshot(300);
    s.os_alerts = { oom_kills_recent: 0, zombie_processes: 0, time_drift_ms: 60000 }; // 60 s drift
    const alerts = evaluateAlerts(s, {}, sup);
    expect(alerts.find((a) => a.type === "clock_drift")).toBeDefined();
    expect(sup.find((s2) => s2.type === "clock_drift")).toBeUndefined();
  });
});

describe("evaluateUnexpectedReboot planned-reboot suppression", () => {
  function rebootSnapshot(opts: { uptime: number; expected?: boolean; reason?: string }): Snapshot {
    const s = hotSnapshot(opts.uptime);
    s.ipmi.sensors = []; // disable the CPU temp trigger
    s.expected_reboot = opts.expected;
    s.expected_reboot_reason = opts.reason;
    return s;
  }

  it("11. marker present, uptime<5min: does NOT fire, writes suppressed_planned_reboot", () => {
    const sup: SuppressedAlert[] = [];
    const out = evaluateUnexpectedReboot(
      rebootSnapshot({ uptime: 60, expected: true, reason: "kernel update" }),
      86400, // prev uptime: 1 day
      Date.now() - 120_000, // prev snapshot 2 min ago
      false,
      Date.now(),
      sup,
    );
    expect(out).toBeNull();
    expect(sup[0]?.reason).toBe("planned_reboot");
    expect(sup[0]?.planned_reboot_reason).toBe("kernel update");
  });

  it("12. no marker, uptime<5min: fires (warning when uptime-only; critical when corroborated)", () => {
    // 2026-05-19 C1-C6 deferred TUNES: uptime-only detection emits at
    // warning; kernel-side corroboration via snap.reboot_evidence
    // escalates to critical. See evaluator.ts evaluateUnexpectedReboot.
    const sup: SuppressedAlert[] = [];
    const out = evaluateUnexpectedReboot(
      rebootSnapshot({ uptime: 60 }),
      86400,
      Date.now() - 120_000,
      false,
      Date.now(),
      sup,
    );
    expect(out?.severity).toBe("warning");
    expect(out?.type).toBe("unexpected_reboot");
    expect(sup).toHaveLength(0);
  });
});
