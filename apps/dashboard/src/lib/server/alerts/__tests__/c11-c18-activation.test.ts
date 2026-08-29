// Tests for the C11-C18 Forge activation shipped 2026-05-19:
//   systemd_service_failed + systemd_service_oom_killed + service_flapping (C12)
//   lvm_thinpool_metadata_high (C14)
//   link_speed_mismatch TUNE (C15)
//   softnet_drops (C16)
//   nvme_critical_warning (C17)
//   ipmi_sel_critical TUNE (C11) — vendor + parser_quality in evidence
//   kernel_vulnerabilities TUNE (C13) — distro CVE branch
//   disk_io_errors TUNE (C18) — structured scsi/nvme events
//   filesystem_readonly corroboration (C18) — ext4 remount dmesg event
//
// Per CC_SPEC_FORGE_C11_C18_ACTIVATION_2026-05-19.md.

import { describe, expect, it } from "vitest";

import { evaluateAlerts, type AlertResult, type Snapshot } from "../evaluator";
import { healthySnapshot } from "./helpers";

function alertsByType(snap: Snapshot, type: string): AlertResult[] {
  return evaluateAlerts(snap).filter((a) => a.type === type);
}

// ============================================================================
// C12 systemd cluster
// ============================================================================

describe("C12 systemd_service_oom_killed", () => {
  it("fires critical when failed_unit_details has Result=oom-kill", () => {
    const s = healthySnapshot();
    s.systemd = {
      failed_units: ["myapp.service"],
      failed_count: 1,
      failed_unit_details: {
        "myapp.service": {
          name: "myapp.service",
          result: "oom-kill",
          active_state: "failed",
          sub_state: "failed",
          n_restarts: 2,
        },
      },
    };
    const fired = alertsByType(s, "systemd_service_oom_killed");
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("critical");
    expect(fired[0].evidence.unit_name).toBe("myapp.service");
  });

  it("does not fire when Result is not oom-kill", () => {
    const s = healthySnapshot();
    s.systemd = {
      failed_units: ["myapp.service"],
      failed_count: 1,
      failed_unit_details: {
        "myapp.service": {
          name: "myapp.service",
          result: "exit-code",
          active_state: "failed",
          sub_state: "failed",
          n_restarts: 0,
        },
      },
    };
    expect(alertsByType(s, "systemd_service_oom_killed").length).toBe(0);
  });

  it("capability gate: no failed_unit_details (pre-0.12.0) => no emission", () => {
    const s = healthySnapshot();
    s.systemd = { failed_units: ["myapp.service"], failed_count: 1 };
    expect(alertsByType(s, "systemd_service_oom_killed").length).toBe(0);
  });
});

describe("C12 service_flapping", () => {
  it("fires critical on Result=start-limit-hit", () => {
    const s = healthySnapshot();
    s.systemd = {
      failed_units: ["api.service"],
      failed_count: 1,
      failed_unit_details: {
        "api.service": {
          name: "api.service",
          result: "start-limit-hit",
          active_state: "failed",
          sub_state: "failed",
          n_restarts: 7,
        },
      },
    };
    const fired = alertsByType(s, "service_flapping");
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("critical");
  });

  it("fires warning when NRestarts >= 5 (no start-limit-hit)", () => {
    const s = healthySnapshot();
    s.systemd = {
      failed_units: ["api.service"],
      failed_count: 1,
      failed_unit_details: {
        "api.service": {
          name: "api.service",
          result: "exit-code",
          active_state: "activating",
          sub_state: "auto-restart",
          n_restarts: 6,
        },
      },
    };
    const fired = alertsByType(s, "service_flapping");
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("warning");
  });

  it("does not fire with low restart count + non-start-limit-hit", () => {
    const s = healthySnapshot();
    s.systemd = {
      failed_units: ["api.service"],
      failed_count: 1,
      failed_unit_details: {
        "api.service": {
          name: "api.service",
          result: "exit-code",
          active_state: "failed",
          sub_state: "failed",
          n_restarts: 2,
        },
      },
    };
    expect(alertsByType(s, "service_flapping").length).toBe(0);
  });

  // Regression: 2026-05-20 campaign cycle 2 finding 5. The dashboard
  // rule's logic is correct (fires on n_restarts >= 5 regardless of
  // ActiveState); the bug was in Crucible only including
  // currently-failed units in failed_unit_details. Once Crucible
  // ships the broader inclusion criterion (see CC_SPEC_CRUCIBLE_FLAPPING_
  // UNIT_DETECTION spec under ~/Documents/Glassmkr/crucible deep dive/
  // CC_generated/), a unit currently in active state
  // but with high NRestarts shows up here and the rule fires. Lock
  // in the expected behavior.
  it("fires on currently-active but flapping unit (post-Crucible-spec shape)", () => {
    const s = healthySnapshot();
    s.systemd = {
      // Note: failed_units is empty — Crucible's broader inclusion
      // criterion puts the unit in failed_unit_details but not in
      // the failed_units list (which keeps the "currently failed"
      // semantics).
      failed_units: [],
      failed_count: 0,
      failed_unit_details: {
        "glassmkr-test-flap.service": {
          name: "glassmkr-test-flap.service",
          result: "exit-code",
          active_state: "active",
          sub_state: "running",
          n_restarts: 31,
        },
      },
    };
    const fired = alertsByType(s, "service_flapping");
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("warning");
    expect(fired[0].evidence.unit_name).toBe("glassmkr-test-flap.service");
    expect(fired[0].evidence.n_restarts).toBe(31);
    expect(fired[0].evidence.active_state).toBe("active");
  });
});

describe("C12 systemd_service_failed evidence carries failed_unit_details", () => {
  it("evidence includes the new Result-classified details", () => {
    const s = healthySnapshot();
    s.systemd = {
      failed_units: ["api.service"],
      failed_count: 1,
      failed_unit_details: {
        "api.service": {
          name: "api.service",
          result: "watchdog",
          active_state: "failed",
          sub_state: "failed",
          n_restarts: 1,
        },
      },
    };
    const fired = alertsByType(s, "systemd_service_failed");
    expect(fired.length).toBe(1);
    const details = (fired[0].evidence as { failed_unit_details?: Record<string, unknown> })
      .failed_unit_details;
    expect(details).toBeDefined();
  });
});

// ============================================================================
// C14 LVM thin pool metadata
// ============================================================================

describe("C14 lvm_thinpool_metadata_high", () => {
  it("emits critical at 95%+ metadata utilisation", () => {
    const s = healthySnapshot();
    s.lvm = {
      available: true,
      thin_pools: [
        { lv_name: "thinpool", vg_name: "vg0", data_percent: 60, metadata_percent: 96.5 },
      ],
    };
    const fired = alertsByType(s, "lvm_thinpool_metadata_high");
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("critical");
    expect(fired[0].evidence.metadata_percent).toBe(96.5);
  });

  it("emits warning at 80-94% metadata utilisation", () => {
    const s = healthySnapshot();
    s.lvm = {
      available: true,
      thin_pools: [
        { lv_name: "thinpool", vg_name: "vg0", data_percent: 60, metadata_percent: 85 },
      ],
    };
    const fired = alertsByType(s, "lvm_thinpool_metadata_high");
    expect(fired[0]?.severity).toBe("warning");
  });

  it("does not emit below 80%", () => {
    const s = healthySnapshot();
    s.lvm = {
      available: true,
      thin_pools: [
        { lv_name: "thinpool", vg_name: "vg0", data_percent: 60, metadata_percent: 79 },
      ],
    };
    expect(alertsByType(s, "lvm_thinpool_metadata_high").length).toBe(0);
  });

  it("capability gate: lvm.available=false (no LVM on host) => no emission", () => {
    const s = healthySnapshot();
    s.lvm = { available: false, reason: "lvs not available", thin_pools: [] };
    expect(alertsByType(s, "lvm_thinpool_metadata_high").length).toBe(0);
  });
});

// ============================================================================
// C15 link_speed_mismatch TUNE
// ============================================================================

describe("C15 link_speed_mismatch TUNE", () => {
  it("fires when current speed below highest advertised", () => {
    const s = healthySnapshot();
    s.network = [
      {
        interface: "eth0",
        speed_mbps: 1000,
        rx_bytes_sec: 0,
        tx_bytes_sec: 0,
        rx_errors: 0,
        tx_errors: 0,
        rx_drops: 0,
        tx_drops: 0,
      },
    ];
    s.ethtool = {
      available: true,
      interfaces: [
        {
          iface: "eth0",
          advertised_auto_negotiation: true,
          advertised_link_modes: ["100baseT/Full", "1000baseT/Full", "10000baseT/Full"],
        },
      ],
    };
    const fired = alertsByType(s, "link_speed_mismatch");
    expect(fired.length).toBe(1);
    expect(fired[0].evidence.advertised_max_mbps).toBe(10000);
    expect(fired[0].evidence.speed_mbps).toBe(1000);
  });

  it("does not fire when current matches highest advertised", () => {
    const s = healthySnapshot();
    s.network = [
      {
        interface: "eth0",
        speed_mbps: 10000,
        rx_bytes_sec: 0,
        tx_bytes_sec: 0,
        rx_errors: 0,
        tx_errors: 0,
        rx_drops: 0,
        tx_drops: 0,
      },
    ];
    s.ethtool = {
      available: true,
      interfaces: [
        {
          iface: "eth0",
          advertised_auto_negotiation: true,
          advertised_link_modes: ["1000baseT/Full", "10000baseT/Full"],
        },
      ],
    };
    expect(alertsByType(s, "link_speed_mismatch").length).toBe(0);
  });

  it("falls back to <1 Gbps legacy check when ethtool absent (pre-0.12.0 path)", () => {
    const s = healthySnapshot();
    s.network = [
      {
        interface: "eth0",
        speed_mbps: 100,
        rx_bytes_sec: 0,
        tx_bytes_sec: 0,
        rx_errors: 0,
        tx_errors: 0,
        rx_drops: 0,
        tx_drops: 0,
      },
    ];
    // No s.ethtool — pre-0.12.0 path.
    expect(alertsByType(s, "link_speed_mismatch").length).toBe(1);
  });

  it("does NOT fire when the gap is below 2x (40 GbE on a 56 GbE-capable NIC): regression for false-positive on Mellanox ConnectX 2026-05-21", () => {
    const s = healthySnapshot();
    s.network = [
      {
        interface: "nic4",
        speed_mbps: 40000,
        rx_bytes_sec: 0,
        tx_bytes_sec: 0,
        rx_errors: 0,
        tx_errors: 0,
        rx_drops: 0,
        tx_drops: 0,
      },
    ];
    s.ethtool = {
      available: true,
      interfaces: [
        {
          iface: "nic4",
          advertised_auto_negotiation: true,
          // ConnectX-style: card advertises both 40 GbE (4x10 G) and
          // 56 GbE (4x14 G) Ethernet modes. Operator chose 40 GbE
          // either by switch port speed or PCIe-bound config.
          advertised_link_modes: ["40000baseSR4/Full", "56000baseSR4/Full"],
        },
      ],
    };
    expect(alertsByType(s, "link_speed_mismatch").length).toBe(0);
  });

  it("fires when the gap is exactly 2x (100 Mb/s on a 1 Gbps NIC): minimum-gap threshold", () => {
    const s = healthySnapshot();
    s.network = [
      {
        interface: "eth0",
        speed_mbps: 500,
        rx_bytes_sec: 0,
        tx_bytes_sec: 0,
        rx_errors: 0,
        tx_errors: 0,
        rx_drops: 0,
        tx_drops: 0,
      },
    ];
    s.ethtool = {
      available: true,
      interfaces: [
        {
          iface: "eth0",
          advertised_auto_negotiation: true,
          advertised_link_modes: ["500baseT/Full", "1000baseT/Full"],
        },
      ],
    };
    // 1000/500 = 2x exactly; rule fires.
    const fired = alertsByType(s, "link_speed_mismatch");
    expect(fired.length).toBe(1);
    expect(fired[0].evidence.advertised_max_mbps).toBe(1000);
  });
});

// ============================================================================
// C16 softnet_drops
// ============================================================================

describe("C16 softnet_drops", () => {
  function snapWithRate(rate: number | null): Snapshot {
    const s = healthySnapshot();
    s.softnet = {
      available: true,
      total_dropped_cumulative: 1000,
      per_cpu_dropped: [500, 500],
      total_dropped_rate_per_sec: rate,
    };
    return s;
  }

  it("emits critical at rate > 10/s", () => {
    const fired = alertsByType(snapWithRate(15), "softnet_drops");
    expect(fired[0]?.severity).toBe("critical");
  });

  it("emits warning at rate 1-10/s", () => {
    expect(alertsByType(snapWithRate(5), "softnet_drops")[0]?.severity).toBe("warning");
  });

  it("does not emit at rate <= 1/s", () => {
    expect(alertsByType(snapWithRate(0.5), "softnet_drops").length).toBe(0);
  });

  it("does not emit on first snapshot (rate null)", () => {
    expect(alertsByType(snapWithRate(null), "softnet_drops").length).toBe(0);
  });

  it("capability gate: no softnet field => no emission", () => {
    const s = healthySnapshot();
    expect(alertsByType(s, "softnet_drops").length).toBe(0);
  });
});

// ============================================================================
// C17 nvme_critical_warning
// ============================================================================

describe("C17 nvme_critical_warning", () => {
  it("emits critical when any flag is set", () => {
    const s = healthySnapshot();
    s.smart = [
      {
        device: "/dev/nvme0",
        model: "INTEL SSDPE2KX020T8",
        health: "PASSED",
        critical_warning_raw: 0x08, // read_only bit
        critical_warning_decoded: {
          available_spare_low: false,
          temperature_threshold: false,
          reliability_degraded: false,
          read_only: true,
          volatile_memory_backup_failed: false,
          persistent_memory_readonly: false,
        },
      },
    ];
    const fired = alertsByType(s, "nvme_critical_warning");
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("critical");
    expect(fired[0].evidence.flags_active).toEqual(["read_only"]);
  });

  it("does not emit when all flags false", () => {
    const s = healthySnapshot();
    s.smart = [
      {
        device: "/dev/nvme0",
        model: "X",
        health: "PASSED",
        critical_warning_raw: 0,
        critical_warning_decoded: {
          available_spare_low: false,
          temperature_threshold: false,
          reliability_degraded: false,
          read_only: false,
          volatile_memory_backup_failed: false,
          persistent_memory_readonly: false,
        },
      },
    ];
    expect(alertsByType(s, "nvme_critical_warning").length).toBe(0);
  });

  it("capability gate: smart device without decoded field => no emission (SATA)", () => {
    const s = healthySnapshot();
    s.smart = [
      { device: "/dev/sda", model: "SATA SSD", health: "PASSED" },
    ];
    expect(alertsByType(s, "nvme_critical_warning").length).toBe(0);
  });

  it("emits with multiple flags listed in evidence", () => {
    const s = healthySnapshot();
    s.smart = [
      {
        device: "/dev/nvme0",
        model: "X",
        health: "FAILED",
        critical_warning_raw: 0x07,
        critical_warning_decoded: {
          available_spare_low: true,
          temperature_threshold: true,
          reliability_degraded: true,
          read_only: false,
          volatile_memory_backup_failed: false,
          persistent_memory_readonly: false,
        },
      },
    ];
    const fired = alertsByType(s, "nvme_critical_warning");
    expect(fired[0].evidence.flags_active).toEqual([
      "available_spare_low",
      "temperature_threshold",
      "reliability_degraded",
    ]);
  });
});

// ============================================================================
// C11 ipmi_sel_critical TUNE (vendor + parser_quality in evidence)
// ============================================================================

describe("C11 ipmi_sel_critical TUNE", () => {
  function snapWithSel(
    bmcVendor: "dell" | "hpe" | "supermicro" | "lenovo" | "cisco" | "openbmc" | "unknown",
    parser: "fleet-tested" | "stub" | "unknown",
  ): Snapshot {
    const s = healthySnapshot();
    const now = new Date().toISOString();
    s.ipmi = {
      available: true,
      bmc_vendor: bmcVendor,
      sensors: [],
      ecc_errors: { correctable: 0, uncorrectable: 0 },
      sel_entries_count: 1,
      sel_events_recent: [
        {
          id: 1,
          timestamp: now,
          sensor: "PSU 1",
          sensor_type: "power",
          event: "Power Supply Failure",
          direction: "Asserted",
          severity: "critical",
          parser_quality: parser,
        },
      ],
    };
    return s;
  }

  it("surfaces bmc_vendor + parser_quality in evidence on fleet-tested vendor", () => {
    const fired = alertsByType(snapWithSel("dell", "fleet-tested"), "ipmi_sel_critical");
    expect(fired.length).toBe(1);
    expect(fired[0].evidence.bmc_vendor).toBe("dell");
    expect(fired[0].evidence.parser_quality).toBe("fleet-tested");
    // No stub disclosure in the message for fleet-tested vendors.
    expect(fired[0].message).not.toContain("stub");
  });

  it("includes stub disclosure in message for stub-parser vendors", () => {
    const fired = alertsByType(snapWithSel("lenovo", "stub"), "ipmi_sel_critical");
    expect(fired[0].evidence.parser_quality).toBe("stub");
    expect(fired[0].message).toContain("stub");
    expect(fired[0].message).toContain("lenovo");
  });
});

// ============================================================================
// C13 kernel_vulnerabilities distro-CVE branch
// ============================================================================

describe("C13 kernel_vulnerabilities distro CVE branch", () => {
  it("emits warning on critical CVEs pending", () => {
    const s = healthySnapshot();
    s.cve = {
      available: true,
      distro: "ubuntu",
      kernel_cves_pending: [
        { cve_id: "CVE-2026-1234", severity: "critical", package_name: "linux-image" },
        { cve_id: "CVE-2026-5678", severity: "important", package_name: "linux-image" },
      ],
      total_critical_pending: 1,
      total_important_pending: 1,
      parser_quality: "fleet-tested",
    };
    const fired = alertsByType(s, "kernel_vulnerabilities").filter(
      (a) => (a.evidence as { scope?: string }).scope === "distro_cve",
    );
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("warning");
    expect(fired[0].evidence.top_critical_cves).toContain("CVE-2026-1234");
  });

  it("emits info when only important (no critical)", () => {
    const s = healthySnapshot();
    s.cve = {
      available: true,
      distro: "rhel",
      kernel_cves_pending: [
        { cve_id: "RHSA-2026:5678", severity: "important", package_name: "kernel" },
      ],
      total_critical_pending: 0,
      total_important_pending: 1,
      parser_quality: "stub",
    };
    const fired = alertsByType(s, "kernel_vulnerabilities").filter(
      (a) => (a.evidence as { scope?: string }).scope === "distro_cve",
    );
    expect(fired[0].severity).toBe("info");
  });

  it("includes stub disclosure when parser_quality is stub", () => {
    const s = healthySnapshot();
    s.cve = {
      available: true,
      distro: "rhel",
      kernel_cves_pending: [],
      total_critical_pending: 1,
      total_important_pending: 0,
      parser_quality: "stub",
    };
    const fired = alertsByType(s, "kernel_vulnerabilities").filter(
      (a) => (a.evidence as { scope?: string }).scope === "distro_cve",
    );
    expect(fired[0].message).toContain("stub");
  });

  it("does not fire distro CVE branch when no pending CVEs", () => {
    const s = healthySnapshot();
    s.cve = {
      available: true,
      distro: "ubuntu",
      kernel_cves_pending: [],
      total_critical_pending: 0,
      total_important_pending: 0,
      parser_quality: "fleet-tested",
    };
    const fired = alertsByType(s, "kernel_vulnerabilities").filter(
      (a) => (a.evidence as { scope?: string }).scope === "distro_cve",
    );
    expect(fired.length).toBe(0);
  });
});

// ============================================================================
// C18 disk_io_errors + filesystem_readonly dmesg corroboration
// ============================================================================

describe("C18 disk_io_errors structured event consumption", () => {
  it("emits per scsi_sense event with appropriate severity", () => {
    const s = healthySnapshot();
    s.dmesg_events = {
      available: true,
      events: [
        {
          timestamp_iso: new Date().toISOString(),
          event_type: "scsi_sense",
          severity: "critical",
          details: { device: "sda", sense_key: "Medium Error" },
          raw_line: "sd 1:0:0:0: [sda] Sense Key : Medium Error [current]",
        },
        {
          timestamp_iso: new Date().toISOString(),
          event_type: "scsi_sense",
          severity: "warning",
          details: { device: "sdb", sense_key: "Recovered Error" },
          raw_line: "sd 2:0:0:0: [sdb] Sense Key : Recovered Error",
        },
      ],
      events_by_type: { scsi_sense: 2, nvme_reset: 0, ext4_remount_readonly: 0 },
      window_seconds: 3600,
    };
    const fired = alertsByType(s, "disk_io_errors").filter(
      (a) => (a.evidence as { scope?: string }).scope === "scsi_sense",
    );
    expect(fired.length).toBe(2);
    expect(fired[0].severity).toBe("critical"); // Medium Error
    expect(fired[1].severity).toBe("warning");  // Recovered Error
  });

  it("emits critical on nvme_reset event", () => {
    const s = healthySnapshot();
    s.dmesg_events = {
      available: true,
      events: [
        {
          timestamp_iso: new Date().toISOString(),
          event_type: "nvme_reset",
          severity: "critical",
          details: { controller: "nvme0", action: "timeout" },
          raw_line: "nvme nvme0: I/O 256 QID 1 timeout, reset controller",
        },
      ],
      events_by_type: { scsi_sense: 0, nvme_reset: 1, ext4_remount_readonly: 0 },
      window_seconds: 3600,
    };
    const fired = alertsByType(s, "disk_io_errors").filter(
      (a) => (a.evidence as { scope?: string }).scope === "nvme_reset",
    );
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("critical");
  });
});

describe("C18 filesystem_readonly dmesg corroboration", () => {
  it("emits critical on ext4_remount_readonly dmesg event", () => {
    const s = healthySnapshot();
    s.dmesg_events = {
      available: true,
      events: [
        {
          timestamp_iso: new Date().toISOString(),
          event_type: "ext4_remount_readonly",
          severity: "critical",
          details: { device: "sda1", remount_readonly: true },
          raw_line: "EXT4-fs (sda1): Remounting filesystem read-only",
        },
      ],
      events_by_type: { scsi_sense: 0, nvme_reset: 0, ext4_remount_readonly: 1 },
      window_seconds: 3600,
    };
    const fired = alertsByType(s, "filesystem_readonly").filter(
      (a) => (a.evidence as { scope?: string }).scope === "dmesg_remount_readonly",
    );
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("critical");
    expect(fired[0].evidence.kernel_initiated).toBe(true);
  });
});
