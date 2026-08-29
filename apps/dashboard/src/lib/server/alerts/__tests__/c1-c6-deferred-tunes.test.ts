// Tests for the three C1-C6 deferred TUNEs shipped 2026-05-19:
//   raid_degraded: hardware RAID activation across four vendors
//   zfs_pool_unhealthy: vdev redundancy severity matrix
//   unexpected_reboot: pstore/vmcore/wtmp corroboration enrichment
//
// All three rules degrade gracefully on pre-Crucible-v0.10.4 hosts;
// capability gates are exercised explicitly.

import { describe, expect, it } from "vitest";

import {
  evaluateAlerts,
  evaluateUnexpectedReboot,
  type AlertResult,
  type Snapshot,
} from "../evaluator";
import { healthySnapshot } from "./helpers";

function alertsByType(snap: Snapshot, type: string): AlertResult[] {
  return evaluateAlerts(snap).filter((a) => a.type === type);
}

// ============================================================================
// raid_degraded hardware RAID activation
// ============================================================================

describe("raid_degraded hardware RAID activation", () => {
  it("emits critical for Dell PERC controller in non-Optimal state with parser_quality=fleet-tested", () => {
    const s = healthySnapshot();
    s.hardware_raid = {
      controllers: [
        { vendor: "dell", controller_id: "0", state: "Degraded", degraded_disks: 1, raw_summary: null },
      ],
    };
    const fired = alertsByType(s, "raid_degraded");
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("critical");
    expect(fired[0].evidence.raid_kind).toBe("hardware");
    expect(fired[0].evidence.controller_vendor).toBe("dell");
    expect(fired[0].evidence.parser_quality).toBe("fleet-tested");
  });

  it("emits critical for LSI/Broadcom MegaRAID controller with parser_quality=fleet-tested", () => {
    const s = healthySnapshot();
    s.hardware_raid = {
      controllers: [
        { vendor: "lsi", controller_id: "0", state: "Failed", degraded_disks: 2, raw_summary: "x" },
      ],
    };
    const fired = alertsByType(s, "raid_degraded");
    expect(fired.length).toBe(1);
    expect(fired[0].evidence.parser_quality).toBe("fleet-tested");
    expect(fired[0].message).toContain("LSI/Broadcom MegaRAID");
  });

  it("emits critical for HPE Smart Array with parser_quality=stub and warning text", () => {
    const s = healthySnapshot();
    s.hardware_raid = {
      controllers: [
        { vendor: "hpe", controller_id: "Slot 0", state: "Degraded", degraded_disks: 1, raw_summary: null },
      ],
    };
    const fired = alertsByType(s, "raid_degraded");
    expect(fired.length).toBe(1);
    expect(fired[0].evidence.parser_quality).toBe("stub");
    expect(fired[0].message).toContain("stub");
  });

  it("emits critical for Adaptec with parser_quality=stub", () => {
    const s = healthySnapshot();
    s.hardware_raid = {
      controllers: [
        { vendor: "adaptec", controller_id: "1", state: "Degraded", degraded_disks: 1, raw_summary: null },
      ],
    };
    const fired = alertsByType(s, "raid_degraded");
    expect(fired.length).toBe(1);
    expect(fired[0].evidence.parser_quality).toBe("stub");
  });

  it("does not emit when controller state is Optimal", () => {
    const s = healthySnapshot();
    s.hardware_raid = {
      controllers: [
        { vendor: "dell", controller_id: "0", state: "Optimal", degraded_disks: 0, raw_summary: null },
      ],
    };
    expect(alertsByType(s, "raid_degraded").length).toBe(0);
  });

  it("emits per-controller when multiple controllers are degraded", () => {
    const s = healthySnapshot();
    s.hardware_raid = {
      controllers: [
        { vendor: "dell", controller_id: "0", state: "Degraded", degraded_disks: 1, raw_summary: null },
        { vendor: "lsi", controller_id: "1", state: "Failed", degraded_disks: 2, raw_summary: null },
      ],
    };
    expect(alertsByType(s, "raid_degraded").length).toBe(2);
  });

  it("emits both software and hardware paths when both are degraded", () => {
    const s = healthySnapshot();
    // Override default raid array (in helpers.ts) to be degraded.
    s.raid = [
      { device: "md0", level: "raid5", status: "degraded", degraded: true, disks: ["sda", "sdb", "sdc"], failed_disks: ["sdc"] },
    ];
    s.hardware_raid = {
      controllers: [
        { vendor: "dell", controller_id: "0", state: "Degraded", degraded_disks: 1, raw_summary: null },
      ],
    };
    const fired = alertsByType(s, "raid_degraded");
    expect(fired.length).toBe(2);
    const kinds = fired.map((f) => f.evidence.raid_kind).sort();
    expect(kinds).toEqual(["hardware", "mdadm"]);
  });

  it("capability gate: no emission when snap.hardware_raid absent", () => {
    const s = healthySnapshot();
    // healthySnapshot has no hardware_raid; default empty raid array.
    expect(alertsByType(s, "raid_degraded").length).toBe(0);
  });
});

// ============================================================================
// zfs_pool_unhealthy severity matrix
// ============================================================================

function poolBase(overrides: Partial<{
  name: string;
  state: string;
  vdevs: Array<{ name: string; state: string; redundancy_class?: string; spare_in_progress?: boolean }>;
  slog_vdevs: Array<{ name: string; state: string }>;
  l2arc_vdevs: Array<{ name: string; state: string }>;
}> = {}) {
  return {
    name: overrides.name ?? "tank",
    state: overrides.state ?? "ONLINE",
    errors_text: "",
    vdevs: overrides.vdevs,
    slog_vdevs: overrides.slog_vdevs,
    l2arc_vdevs: overrides.l2arc_vdevs,
  };
}

describe("zfs_pool_unhealthy severity matrix", () => {
  it("pool SUSPENDED -> critical (dominates vdev signals)", () => {
    const s = healthySnapshot();
    s.zfs = {
      pools: [
        poolBase({
          state: "SUSPENDED",
          vdevs: [{ name: "raidz1-0", state: "DEGRADED", redundancy_class: "raidz1" }],
        }),
      ],
    };
    const fired = alertsByType(s, "zfs_pool_unhealthy");
    // SUSPENDED short-circuits; only one emission, severity critical.
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("critical");
    expect(fired[0].evidence.scope).toBe("pool");
  });

  it("FAULTED top-level vdev -> critical", () => {
    const s = healthySnapshot();
    s.zfs = {
      pools: [
        poolBase({
          state: "DEGRADED",
          vdevs: [{ name: "raidz2-0", state: "FAULTED", redundancy_class: "raidz2" }],
        }),
      ],
    };
    const fired = alertsByType(s, "zfs_pool_unhealthy");
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("critical");
    expect(fired[0].evidence.vdev_state).toBe("FAULTED");
  });

  it("DEGRADED on single -> critical (zero redundancy)", () => {
    const s = healthySnapshot();
    s.zfs = {
      pools: [
        poolBase({
          state: "DEGRADED",
          vdevs: [{ name: "vdev-0", state: "DEGRADED", redundancy_class: "single" }],
        }),
      ],
    };
    expect(alertsByType(s, "zfs_pool_unhealthy")[0]?.severity).toBe("critical");
  });

  it("DEGRADED on raidz1 -> critical (zero remaining tolerance)", () => {
    const s = healthySnapshot();
    s.zfs = {
      pools: [
        poolBase({
          state: "DEGRADED",
          vdevs: [{ name: "raidz1-0", state: "DEGRADED", redundancy_class: "raidz1" }],
        }),
      ],
    };
    expect(alertsByType(s, "zfs_pool_unhealthy")[0]?.severity).toBe("critical");
  });

  it("DEGRADED on mirror_2way -> critical", () => {
    const s = healthySnapshot();
    s.zfs = {
      pools: [
        poolBase({
          state: "DEGRADED",
          vdevs: [{ name: "mirror-0", state: "DEGRADED", redundancy_class: "mirror_2way" }],
        }),
      ],
    };
    expect(alertsByType(s, "zfs_pool_unhealthy")[0]?.severity).toBe("critical");
  });

  it("DEGRADED on raidz2 without spare -> critical", () => {
    const s = healthySnapshot();
    s.zfs = {
      pools: [
        poolBase({
          state: "DEGRADED",
          vdevs: [{ name: "raidz2-0", state: "DEGRADED", redundancy_class: "raidz2" }],
        }),
      ],
    };
    expect(alertsByType(s, "zfs_pool_unhealthy")[0]?.severity).toBe("critical");
  });

  it("DEGRADED on raidz2 WITH spare in progress -> warning", () => {
    const s = healthySnapshot();
    s.zfs = {
      pools: [
        poolBase({
          state: "DEGRADED",
          vdevs: [{ name: "raidz2-0", state: "DEGRADED", redundancy_class: "raidz2", spare_in_progress: true }],
        }),
      ],
    };
    const fired = alertsByType(s, "zfs_pool_unhealthy");
    expect(fired[0]?.severity).toBe("warning");
    expect(fired[0]?.evidence.spare_in_progress).toBe(true);
  });

  it("DEGRADED on raidz3 -> warning (retains tolerance)", () => {
    const s = healthySnapshot();
    s.zfs = {
      pools: [
        poolBase({
          state: "DEGRADED",
          vdevs: [{ name: "raidz3-0", state: "DEGRADED", redundancy_class: "raidz3" }],
        }),
      ],
    };
    expect(alertsByType(s, "zfs_pool_unhealthy")[0]?.severity).toBe("warning");
  });

  it("DEGRADED on mirror_3way -> warning", () => {
    const s = healthySnapshot();
    s.zfs = {
      pools: [
        poolBase({
          state: "DEGRADED",
          vdevs: [{ name: "mirror-0", state: "DEGRADED", redundancy_class: "mirror_3way" }],
        }),
      ],
    };
    expect(alertsByType(s, "zfs_pool_unhealthy")[0]?.severity).toBe("warning");
  });

  it("OFFLINE administrative -> info", () => {
    const s = healthySnapshot();
    s.zfs = {
      pools: [
        poolBase({
          state: "DEGRADED",
          vdevs: [{ name: "vdev-0", state: "OFFLINE", redundancy_class: "raidz2" }],
        }),
      ],
    };
    expect(alertsByType(s, "zfs_pool_unhealthy")[0]?.severity).toBe("info");
  });

  it("L2ARC FAULTED -> info, distinct from pool emission", () => {
    const s = healthySnapshot();
    s.zfs = {
      pools: [
        poolBase({
          state: "ONLINE",
          // Pool itself is healthy; only the L2ARC failed.
          vdevs: [{ name: "raidz2-0", state: "ONLINE", redundancy_class: "raidz2" }],
          l2arc_vdevs: [{ name: "nvme0n1p1", state: "FAULTED" }],
        }),
      ],
    };
    const fired = alertsByType(s, "zfs_pool_unhealthy");
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("info");
    expect(fired[0].evidence.scope).toBe("l2arc");
  });

  it("SLOG FAULTED does NOT emit from zfs_pool_unhealthy (handled by zfs_slog_faulted)", () => {
    const s = healthySnapshot();
    s.zfs = {
      pools: [
        poolBase({
          state: "ONLINE",
          vdevs: [{ name: "raidz2-0", state: "ONLINE", redundancy_class: "raidz2" }],
          slog_vdevs: [{ name: "nvme1n1", state: "FAULTED" }],
        }),
      ],
    };
    expect(alertsByType(s, "zfs_pool_unhealthy").length).toBe(0);
    // But zfs_slog_faulted does fire on the same snapshot.
    expect(alertsByType(s, "zfs_slog_faulted").length).toBe(1);
  });

  it("pre-0.10.4 fallback: pool DEGRADED without vdev metadata -> warning with legacy_uniform", () => {
    const s = healthySnapshot();
    s.zfs = {
      pools: [
        poolBase({ state: "DEGRADED" }), // no vdevs[], no l2arc_vdevs[]
      ],
    };
    const fired = alertsByType(s, "zfs_pool_unhealthy");
    expect(fired.length).toBe(1);
    expect(fired[0].severity).toBe("warning");
    expect(fired[0].evidence.parser_quality).toBe("legacy_uniform");
  });

  it("pre-0.10.4 fallback: pool FAULTED without vdev metadata -> critical with legacy_uniform", () => {
    const s = healthySnapshot();
    s.zfs = {
      pools: [poolBase({ state: "FAULTED" })],
    };
    const fired = alertsByType(s, "zfs_pool_unhealthy");
    expect(fired[0]?.severity).toBe("critical");
    expect(fired[0]?.evidence.parser_quality).toBe("legacy_uniform");
  });

  it("ONLINE pool with no failed vdevs/l2arc -> no emission", () => {
    const s = healthySnapshot();
    s.zfs = {
      pools: [
        poolBase({
          state: "ONLINE",
          vdevs: [{ name: "raidz2-0", state: "ONLINE", redundancy_class: "raidz2" }],
        }),
      ],
    };
    expect(alertsByType(s, "zfs_pool_unhealthy").length).toBe(0);
  });
});

// ============================================================================
// unexpected_reboot enrichment
// ============================================================================

describe("unexpected_reboot pstore/vmcore/wtmp enrichment", () => {
  const now = 1_700_000_000_000;

  function rebootScenario(re?: Snapshot["reboot_evidence"]): Snapshot {
    const s = healthySnapshot();
    s.system.uptime_seconds = 60;
    s.reboot_evidence = re;
    return s;
  }

  it("uptime only (no reboot_evidence, pre-0.10.4 agent) -> warning", () => {
    const s = rebootScenario(undefined);
    const out = evaluateUnexpectedReboot(s, 86400, now - 5 * 60_000, false, now);
    expect(out?.severity).toBe("warning");
    expect(
      (out?.evidence as { detection_signals?: { reboot_evidence_available?: boolean } })
        .detection_signals?.reboot_evidence_available,
    ).toBe(false);
  });

  it("pstore_present -> critical with via_pstore=true", () => {
    const s = rebootScenario({
      pstore_present: true,
      pstore_record_count: 3,
      vmcore_present: false,
      wtmp_reboot_record: null,
      prior_shutdown_clean: true,
    });
    const out = evaluateUnexpectedReboot(s, 86400, now - 5 * 60_000, false, now);
    expect(out?.severity).toBe("critical");
    expect(out?.title).toContain("kernel crash");
    const sigs = (out?.evidence as { detection_signals?: { via_pstore?: boolean } }).detection_signals;
    expect(sigs?.via_pstore).toBe(true);
  });

  it("vmcore_present -> critical with via_vmcore=true", () => {
    const s = rebootScenario({
      pstore_present: false,
      pstore_record_count: 0,
      vmcore_present: true,
      wtmp_reboot_record: null,
      prior_shutdown_clean: true,
    });
    const out = evaluateUnexpectedReboot(s, 86400, now - 5 * 60_000, false, now);
    expect(out?.severity).toBe("critical");
    const sigs = (out?.evidence as { detection_signals?: { via_vmcore?: boolean } }).detection_signals;
    expect(sigs?.via_vmcore).toBe(true);
  });

  // Round-3 recalibration: a missing clean-shutdown record, with NO kernel
  // crash dump, is a softer signal (possible power loss, but also fires on
  // clean reboots where `last` does not surface the shutdown record). Warning,
  // not a critical page.
  it("wtmp prior_shutdown_clean=false (no kernel dump) -> warning with via_wtmp_unclean=true", () => {
    const s = rebootScenario({
      pstore_present: false,
      pstore_record_count: 0,
      vmcore_present: false,
      wtmp_reboot_record: null,
      prior_shutdown_clean: false,
    });
    const out = evaluateUnexpectedReboot(s, 86400, now - 5 * 60_000, false, now);
    expect(out?.severity).toBe("warning");
    const sigs = (out?.evidence as { detection_signals?: { via_wtmp_unclean?: boolean } }).detection_signals;
    expect(sigs?.via_wtmp_unclean).toBe(true);
  });

  // A clean shutdown recorded with no crash evidence is an intentional reboot,
  // not an active alert (the deliberate `sudo reboot` case).
  it("clean shutdown recorded, no kernel dump -> no active alert", () => {
    const s = rebootScenario({
      pstore_present: false,
      pstore_record_count: 0,
      vmcore_present: false,
      wtmp_reboot_record: null,
      prior_shutdown_clean: true,
    });
    expect(evaluateUnexpectedReboot(s, 86400, now - 5 * 60_000, false, now)).toBeNull();
  });

  it("all three corroborators -> critical with all flags set", () => {
    const s = rebootScenario({
      pstore_present: true,
      pstore_record_count: 1,
      vmcore_present: true,
      wtmp_reboot_record: "boot record",
      prior_shutdown_clean: false,
    });
    const out = evaluateUnexpectedReboot(s, 86400, now - 5 * 60_000, false, now);
    expect(out?.severity).toBe("critical");
    const sigs = (out?.evidence as {
      detection_signals?: { via_pstore?: boolean; via_vmcore?: boolean; via_wtmp_unclean?: boolean };
    }).detection_signals;
    expect(sigs?.via_pstore).toBe(true);
    expect(sigs?.via_vmcore).toBe(true);
    expect(sigs?.via_wtmp_unclean).toBe(true);
  });
});
