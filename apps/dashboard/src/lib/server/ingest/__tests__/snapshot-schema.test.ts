// Phase 1 Zod schema tests.
//
// Acceptance per master plan:
//   - Malformed payload: validation fails with structured issues
//   - Extra unknown top-level field: passthrough works
//   - Missing required field: logged, not blocked
//
// All paths return SnapshotParseResult; this file does not exercise
// the handler's log-or-reject behaviour (covered in
// validation-failures.test.ts).

import { describe, it, expect } from "vitest";
import { parseSnapshot } from "../snapshot-schema";

function minimalValidSnapshot() {
  return {
    system: {
      hostname: "host-1", ip: "10.0.0.1", os: "Ubuntu 24.04", kernel: "6.8",
      uptime_seconds: 100,
    },
    cpu: {
      user_percent: 1, system_percent: 1, iowait_percent: 0, idle_percent: 98,
      load_1m: 0.1, load_5m: 0.1, load_15m: 0.1,
    },
    memory: {
      total_mb: 16000, used_mb: 4000, available_mb: 12000,
      swap_total_mb: 0, swap_used_mb: 0,
    },
    disks: [{
      device: "/dev/sda1", mount: "/", total_gb: 100,
      used_gb: 30, available_gb: 70, percent_used: 30,
    }],
    smart: [],
    network: [{
      interface: "eth0", speed_mbps: 1000,
      rx_bytes_sec: 0, tx_bytes_sec: 0,
      rx_errors: 0, tx_errors: 0, rx_drops: 0, tx_drops: 0,
    }],
    raid: [],
    ipmi: {
      available: false,
      sensors: [],
      ecc_errors: { correctable: 0, uncorrectable: 0 },
      sel_entries_count: 0,
    },
    os_alerts: { oom_kills_recent: 0, zombie_processes: 0, time_drift_ms: 0 },
  };
}

describe("parseSnapshot: valid inputs", () => {
  it("accepts a minimal-valid snapshot", () => {
    const r = parseSnapshot(minimalValidSnapshot());
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("accepts unknown top-level fields via passthrough (no rejection on schema drift)", () => {
    const snap = minimalValidSnapshot() as any;
    snap.future_field_v2 = { hello: "world" };
    snap.another_one = [1, 2, 3];
    const r = parseSnapshot(snap);
    expect(r.ok).toBe(true);
  });

  it("accepts unknown nested fields under existing objects", () => {
    const snap = minimalValidSnapshot() as any;
    snap.cpu.future_metric = 42;
    snap.ipmi.sensors.push({ name: "x", value: 1, unit: "C", status: "ok", future_attr: true });
    const r = parseSnapshot(snap);
    expect(r.ok).toBe(true);
  });

  it("accepts optional fields when present", () => {
    const snap = minimalValidSnapshot() as any;
    snap.io_errors = { count: 0, devices: [] };
    snap.io_latency = [{
      device: "/dev/sda1", avg_read_latency_ms: null,
      avg_write_latency_ms: 0.5, read_iops: 100, write_iops: 50,
    }];
    snap.expected_reboot = true;
    snap.collector_version = "0.9.0";
    const r = parseSnapshot(snap);
    expect(r.ok).toBe(true);
  });
});

describe("parseSnapshot: invalid inputs (log-mode: reports issues, never throws)", () => {
  it("reports missing required top-level field as a structured issue", () => {
    const snap = minimalValidSnapshot() as any;
    delete snap.cpu;
    const r = parseSnapshot(snap);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.path === "cpu")).toBe(true);
  });

  it("reports wrong-type field with the path that failed", () => {
    const snap = minimalValidSnapshot() as any;
    snap.memory.total_mb = "not a number";
    const r = parseSnapshot(snap);
    expect(r.ok).toBe(false);
    const issue = r.issues.find((i) => i.path === "memory.total_mb");
    expect(issue).toBeDefined();
  });

  it("reports issues from inside an array item", () => {
    const snap = minimalValidSnapshot() as any;
    snap.disks.push({ device: 1234, mount: "/var" }); // device should be string; missing required fields
    const r = parseSnapshot(snap);
    expect(r.ok).toBe(false);
    const deviceIssue = r.issues.find((i) => i.path.startsWith("disks.1.device"));
    expect(deviceIssue).toBeDefined();
  });

  it("never throws even on completely garbage input", () => {
    expect(() => parseSnapshot(null)).not.toThrow();
    expect(() => parseSnapshot("not an object")).not.toThrow();
    expect(() => parseSnapshot(42)).not.toThrow();
    expect(() => parseSnapshot([])).not.toThrow();
  });

  it("issues never include the offending value (telemetry redaction)", () => {
    const snap = minimalValidSnapshot() as any;
    snap.system.hostname = 999999; // Wrong type. The literal value would be PII-adjacent in real traffic.
    const r = parseSnapshot(snap);
    expect(r.ok).toBe(false);
    // Stringify the issues and confirm the offending value isn't echoed.
    const blob = JSON.stringify(r.issues);
    expect(blob).not.toContain("999999");
  });

  it("accepts null celsius in thermal.cpu_readings (Phase 1 detour finding 2026-05-12)", () => {
    // Crucible 0.9.1 emits one entry per detected hwmon chip even when
    // the underlying sensor returns null. Pre-fix the validator logged
    // an [ingest-validation] line per such reading. Verify the schema
    // now accepts the shape.
    const snap = minimalValidSnapshot() as any;
    snap.thermal = {
      available: true,
      source: "hwmon coretemp",
      max_cpu_celsius: 55,
      cpu_readings: [
        { chip: "coretemp-pci-0001", label: "Package id 0", celsius: 55 },
        { chip: "coretemp-pci-0002", label: "Package id 1", celsius: null },
      ],
      other_readings: [
        { chip: "acpi-thermal-0", label: "thermal_zone0", celsius: null },
      ],
    };
    const r = parseSnapshot(snap);
    expect(r.ok).toBe(true);
  });

  it("R-1: accepts the capability-gated blocks when present and well-formed", () => {
    const snap = minimalValidSnapshot() as any;
    snap.psi = { cpu: { some: { avg10: 0.1, avg60: 0.2, avg300: 0.3, total: 100 } } };
    snap.ecc_edac = { edac_corrected_total: 0, edac_uncorrected_total: 0, dimms: [] };
    snap.tcp_stats = { available: true, out_segs_total: 1000, retrans_ratio: 0.001 };
    snap.bonding = { available: true, bonds: [] };
    snap.cve = { available: true, distro: "ubuntu", kernel_cves_pending: [], total_critical_pending: 0, total_important_pending: 0, parser_quality: "fleet-tested" };
    snap.dmesg_events = { available: true, events: [], events_by_type: {}, window_seconds: 300 };
    snap.gpu = {
      available: true,
      capabilities: { nvidia_smi: true, nvidia_driver_version: "550.1", dcgm: false, dcgmi_version: null, redfish_endpoint: null, redfish_oem_schema: null, probe_duration_ms: 12 },
      tier1: { available: true, driver_version: "550.1", xid_events: [], gpus: [] },
    };
    const r = parseSnapshot(snap);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("R-1: accepts the available:false degradation path (no data arrays)", () => {
    // The common case on most hosts: no GPU, no bond, no LVM. The agent
    // sends {available:false, reason} and omits the data arrays. This must
    // NOT log a validation failure (it would drown the drift canary).
    const snap = minimalValidSnapshot() as any;
    snap.gpu = { available: false, reason: "no nvidia device" };
    snap.bonding = { available: false, reason: "no bond interfaces" };
    snap.lvm = { available: false, reason: "lvs not present" };
    snap.tcp_stats = { available: false, reason: "netstat unavailable" };
    const r = parseSnapshot(snap);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("R-1: reports a bad enum in a capability block (drift canary bites)", () => {
    const snap = minimalValidSnapshot() as any;
    snap.cve = { available: true, distro: "ubuntu", kernel_cves_pending: [
      { cve_id: "CVE-2025-1", severity: "catastrophic", package_name: "linux" },
    ] };
    const r = parseSnapshot(snap);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.path.startsWith("cve.kernel_cves_pending.0.severity"))).toBe(true);
  });

  it("R-1: reports a wrong-typed GPU tier1 field", () => {
    const snap = minimalValidSnapshot() as any;
    snap.gpu = {
      available: true,
      tier1: { available: true, driver_version: "550.1", xid_events: [], gpus: [
        // temp_c must be a number; a string here is real drift worth logging.
        { index: 0, uuid: "GPU-x", name: "L4", pci_bdf: "0000:01:00.0", vbios_version: "1",
          vram_total_mib: 24000, vram_used_mib: 1000, temp_c: "hot", power_draw_w: 40, power_limit_w: 72,
          utilization_gpu_percent: 0, utilization_mem_percent: 0, clock_graphics_mhz: 0, clock_sm_mhz: 0,
          clock_mem_mhz: 0, pstate: "P8", pcie_link_gen_current: 4, pcie_link_gen_max: 4,
          pcie_link_width_current: 16, pcie_link_width_max: 16, ecc_mode_current: true,
          ecc_errors_corrected_volatile: 0, ecc_errors_corrected_aggregate: 0,
          ecc_errors_uncorrected_volatile: 0, ecc_errors_uncorrected_aggregate: 0,
          retired_pages_single_bit: 0, retired_pages_double_bit: 0, retired_pages_pending: 0,
          thermal_slowdown_active: false, thermal_violation_total_ms: null, power_violation_total_ms: null,
          fan_speed_percent: null, nvlink_links: [], performance_state_reasons: [] },
      ] },
    };
    const r = parseSnapshot(snap);
    expect(r.ok).toBe(false);
    expect(r.issues.length).toBeGreaterThan(0);
  });

  it("accepts absent celsius in thermal.cpu_readings (post-#60 follow-up 2026-05-13)", () => {
    // Post-deploy verification of PR #60 surfaced the agent also
    // emits ThermalReading entries with no `celsius` key at all
    // (vs the null variant covered above). Validator now treats
    // the field as nullable AND optional.
    const snap = minimalValidSnapshot() as any;
    snap.thermal = {
      available: true,
      source: "hwmon coretemp",
      max_cpu_celsius: 60,
      cpu_readings: [
        { chip: "coretemp-pci-0001", label: "Package id 0", celsius: 60 },
        { chip: "coretemp-pci-0002", label: "Package id 1" }, // celsius absent
      ],
      other_readings: [
        { chip: "acpi-thermal-0", label: "thermal_zone0" }, // celsius absent
      ],
    };
    const r = parseSnapshot(snap);
    expect(r.ok).toBe(true);
  });
});
