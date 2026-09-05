// Evaluator tests. Covers all 37 snapshot-driven rules in evaluator.ts (plus
// evaluateUnexpectedReboot). The 38th customer-facing rule, `server_unreachable`,
// is tested separately in watchdog tests because it lives in watchdog.ts.
// Canonical breakdown: see RULES_COUNT.md. Each evaluator rule has a fire case
// and a no-fire-on-healthy case. Rules with severity tiers or distinct branches
// have extra cases.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { agentAtLeast, evaluateAlerts, evaluateUnexpectedReboot, hasCleanRebootEvidence, isCleanIntentionalReboot } from "../evaluator";
import { healthySnapshot, clone } from "./helpers";
import {
  setLifecycleCache,
  __resetLifecycleCacheForTests,
  type LifecycleRow,
} from "../../endoflife/cache";

function alertsOf(type: string, snap = healthySnapshot(), config = {}) {
  return evaluateAlerts(snap, config).filter((a) => a.type === type);
}

describe("evaluateAlerts: healthy baseline", () => {
  it("fires zero alerts on a fully healthy snapshot", () => {
    const alerts = evaluateAlerts(healthySnapshot());
    expect(alerts).toEqual([]);
  });
});

describe("ram_high", () => {
  // 2026-05-18 audit: trigger is now MemAvailable-based (pattern library
  // Cat 2). Fires when available% drops below threshold (default 5%),
  // critical at <2%. Tests below set available_mb explicitly; used_mb
  // is informational only.
  it("fires warning when available is between 2 and 5 percent", () => {
    const s = healthySnapshot();
    // available_mb = 4% of total
    s.memory.available_mb = Math.round(s.memory.total_mb * 0.04);
    s.memory.used_mb = s.memory.total_mb - s.memory.available_mb;
    const [a] = alertsOf("ram_high", s);
    expect(a.severity).toBe("warning");
    expect(a.evidence.trigger).toBe("memavailable");
  });
  it("fires critical when available drops below 2 percent", () => {
    const s = healthySnapshot();
    s.memory.available_mb = Math.round(s.memory.total_mb * 0.01);
    s.memory.used_mb = s.memory.total_mb - s.memory.available_mb;
    const [a] = alertsOf("ram_high", s);
    expect(a.severity).toBe("critical");
  });
  it("no fire when available is at or above 5 percent", () => {
    const s = healthySnapshot();
    s.memory.available_mb = Math.round(s.memory.total_mb * 0.20);
    s.memory.used_mb = s.memory.total_mb - s.memory.available_mb;
    expect(alertsOf("ram_high", s)).toHaveLength(0);
  });
  it("honors ram_available_threshold_percent config override", () => {
    const s = healthySnapshot();
    s.memory.available_mb = Math.round(s.memory.total_mb * 0.08);
    s.memory.used_mb = s.memory.total_mb - s.memory.available_mb;
    // With default 5%, available at 8% would NOT fire.
    expect(alertsOf("ram_high", s)).toHaveLength(0);
    // With override 10%, available at 8% fires.
    expect(evaluateAlerts(s, { ram_available_threshold_percent: 10 }).some((a) => a.type === "ram_high")).toBe(true);
  });
});

describe("cpu_high", () => {
  it("fires warning when usage >= 90% and < 98%", () => {
    const s = healthySnapshot();
    s.cpu.idle_percent = 5; // usage 95%
    const [a] = alertsOf("cpu_high", s);
    expect(a.severity).toBe("warning");
  });
  it("fires critical when usage >= 98%", () => {
    const s = healthySnapshot();
    s.cpu.idle_percent = 1;
    const [a] = alertsOf("cpu_high", s);
    expect(a.severity).toBe("critical");
  });
  it("no fire under 90%", () => {
    expect(alertsOf("cpu_high")).toHaveLength(0);
  });
});

describe("load_high (tiered 1.5x / 3x cores; 2026-05-20 campaign finding)", () => {
  it("warning at 1.5x cores", () => {
    const s = healthySnapshot();
    s.cpu.load_1m = 12; // 8 cores * 1.5
    const [a] = alertsOf("load_high", s);
    expect(a).toBeDefined();
    expect(a.severity).toBe("warning");
    expect(a.evidence.ratio_to_cores).toBe(1.5);
  });
  it("warning at 2x cores (sanity: previous threshold still in warning band)", () => {
    const s = healthySnapshot();
    s.cpu.load_1m = 16; // 8 cores * 2
    const [a] = alertsOf("load_high", s);
    expect(a).toBeDefined();
    expect(a.severity).toBe("warning");
  });
  it("critical at 3x cores", () => {
    const s = healthySnapshot();
    s.cpu.load_1m = 24; // 8 cores * 3
    const [a] = alertsOf("load_high", s);
    expect(a).toBeDefined();
    expect(a.severity).toBe("critical");
  });
  it("critical above 3x cores", () => {
    const s = healthySnapshot();
    s.cpu.load_1m = 50; // 8 cores * 6.25
    const [a] = alertsOf("load_high", s);
    expect(a.severity).toBe("critical");
  });
  it("no fire below 1.5x cores", () => {
    const s = healthySnapshot();
    s.cpu.load_1m = 11; // 8 cores * 1.375 < 1.5
    expect(alertsOf("load_high", s)).toHaveLength(0);
  });
  it("no fire at exactly load == cores (normal under batch workloads)", () => {
    const s = healthySnapshot();
    s.cpu.load_1m = 8; // 8 cores * 1.0
    expect(alertsOf("load_high", s)).toHaveLength(0);
  });
  it("scales with big hosts (64 cores)", () => {
    const s = healthySnapshot();
    s.cpu.cores = Array.from({ length: 64 }, (_, i) => ({ core: i, user_percent: 0, system_percent: 0, iowait_percent: 0, idle_percent: 100 }));
    // Campaign workload on val-mz62hd hit load 60 (~94% of 1.0x cores)
    // and didn't fire under the old 2x threshold; should now fire warning.
    s.cpu.load_1m = 100; // 64 cores * 1.5625
    const [a] = alertsOf("load_high", s);
    expect(a).toBeDefined();
    expect(a.severity).toBe("warning");
  });
});

describe("disk_space_high", () => {
  it("warning between 85 and 95%", () => {
    const s = healthySnapshot();
    s.disks[0].percent_used = 90;
    const [a] = alertsOf("disk_space_high", s);
    expect(a.severity).toBe("warning");
  });
  it("critical at 95%+", () => {
    const s = healthySnapshot();
    s.disks[0].percent_used = 97;
    const [a] = alertsOf("disk_space_high", s);
    expect(a.severity).toBe("critical");
  });
  it("no fire under 85%", () => {
    expect(alertsOf("disk_space_high")).toHaveLength(0);
  });
  it("honors config override", () => {
    const s = healthySnapshot();
    s.disks[0].percent_used = 70;
    expect(evaluateAlerts(s, { disk_threshold_percent: 60 }).some((a) => a.type === "disk_space_high")).toBe(true);
  });
});

describe("cpu_iowait_high", () => {
  it("fires when iowait >= 20% under real load", () => {
    const s = healthySnapshot();
    s.cpu.iowait_percent = 25;
    s.cpu.load_1m = 4;
    expect(alertsOf("cpu_iowait_high", s)).toHaveLength(1);
  });
  it("no fire below threshold", () => {
    expect(alertsOf("cpu_iowait_high")).toHaveLength(0);
  });
  it("no fire on a near-idle box (high iowait% at load ~0 is an artifact, round 5)", () => {
    const s = healthySnapshot();
    s.cpu.iowait_percent = 34;
    s.cpu.load_1m = 0.04;
    expect(alertsOf("cpu_iowait_high", s)).toHaveLength(0);
  });
});

describe("oom_kills", () => {
  it("fires critical when any recent oom kills", () => {
    const s = healthySnapshot();
    s.os_alerts.oom_kills_recent = 2;
    const [a] = alertsOf("oom_kills", s);
    expect(a.severity).toBe("critical");
  });
  it("no fire at 0", () => {
    expect(alertsOf("oom_kills")).toHaveLength(0);
  });
});

describe("smart_failing", () => {
  it("fires on non-PASSED health", () => {
    const s = healthySnapshot();
    s.smart[0].health = "FAILED";
    const [a] = alertsOf("smart_failing", s);
    expect(a.severity).toBe("critical");
  });
  it("fires on reallocated sectors", () => {
    const s = healthySnapshot();
    s.smart[0].reallocated_sectors = 3;
    expect(alertsOf("smart_failing", s)).toHaveLength(1);
  });
  // pending_sectors is NO LONGER a standalone trigger. It oscillates by design and
  // some vendors relabel attr 197 as an ECC counter that flaps 0<->1 on healthy
  // drives; the Crucial MX500 does exactly this. A single-snapshot pending count
  // must not raise CRITICAL. The held/repeated case is caught by the trend engine
  // (smart_197_step_change / smart_197_recurring), which has the history to judge it.
  // Drive-health follow-up 2026-08-04.
  it("does NOT fire on a lone transient pending sector (the MX500 flap)", () => {
    const s = healthySnapshot();
    s.smart[0].pending_sectors = 1; // MX500 signature: always 1, health PASSED, nothing else
    expect(alertsOf("smart_failing", s)).toHaveLength(0);
  });
  it("does NOT fire even on a larger lone pending count with no corroboration", () => {
    // We cannot tell a real held rise from a flap without history, so the per-snapshot
    // CRITICAL stays out of it entirely; the trend engine owns this signal.
    const s = healthySnapshot();
    s.smart[0].pending_sectors = 40;
    expect(alertsOf("smart_failing", s)).toHaveLength(0);
  });
  it("STILL fires on a genuinely failing drive: reallocated present, pending zero", () => {
    // The fleet's real failing drive (HGST at 477 reallocated) presents exactly this
    // way. Regression guard for the true positive the fix must not weaken.
    const s = healthySnapshot();
    s.smart[0].reallocated_sectors = 477;
    s.smart[0].pending_sectors = 0;
    const [a] = alertsOf("smart_failing", s);
    expect(a.severity).toBe("critical");
  });
  it("no fire on healthy drive", () => {
    expect(alertsOf("smart_failing")).toHaveLength(0);
  });
  it("evidence.triggering_signals names the health attribute when health is FAILED (Codex experiment 2026-05-12)", () => {
    const s = healthySnapshot();
    s.smart[0].health = "FAILED";
    const [a] = alertsOf("smart_failing", s);
    const sigs = (a.evidence as any).triggering_signals as Array<{ attribute: string; observed: unknown }>;
    expect(sigs).toHaveLength(1);
    expect(sigs[0].attribute).toBe("health");
    expect(sigs[0].observed).toBe("FAILED");
  });
  it("evidence.triggering_signals names reallocated_sectors when only that trips (the experiment's confusing case: health=PASSED but rule still fires)", () => {
    const s = healthySnapshot();
    s.smart[0].health = "PASSED";
    s.smart[0].reallocated_sectors = 47;
    const [a] = alertsOf("smart_failing", s);
    const sigs = (a.evidence as any).triggering_signals as Array<{ attribute: string; observed: unknown }>;
    expect(sigs).toHaveLength(1);
    expect(sigs[0].attribute).toBe("reallocated_sectors");
    expect(sigs[0].observed).toBe(47);
  });
  it("evidence.triggering_signals lists multiple when multiple LATCHING conditions fire", () => {
    const s = healthySnapshot();
    s.smart[0].health = "FAILED";
    s.smart[0].reallocated_sectors = 3;
    s.smart[0].pending_sectors = 1; // present but not a trigger; must not appear as one
    const [a] = alertsOf("smart_failing", s);
    const sigs = (a.evidence as any).triggering_signals as Array<{ attribute: string }>;
    expect(sigs.map((x) => x.attribute).sort()).toEqual(["health", "reallocated_sectors"]);
  });
});

describe("nvme_wear_high", () => {
  it("fires warning at >= 85%", () => {
    const s = healthySnapshot();
    s.smart[0].percentage_used = 88;
    expect(alertsOf("nvme_wear_high", s)[0].severity).toBe("warning");
  });
  it("fires critical at >= 95%", () => {
    const s = healthySnapshot();
    s.smart[0].percentage_used = 96;
    expect(alertsOf("nvme_wear_high", s)[0].severity).toBe("critical");
  });
  it("no fire when percentage_used is null", () => {
    const s = healthySnapshot();
    s.smart[0].percentage_used = undefined;
    expect(alertsOf("nvme_wear_high", s)).toHaveLength(0);
  });
  // Now covers SATA SSDs too (Crucible maps their wear attribute into
  // percentage_used), with a lower info-level "watch" tier so a well-worn drive
  // (e.g. a Crucial MX500 at 25% life left = 75% used) surfaces before 85%.
  it("fires an info watch between the 75% watch floor and the 85% warning", () => {
    const s = healthySnapshot();
    s.smart[0].percentage_used = 78;
    const [a] = alertsOf("nvme_wear_high", s);
    expect(a.severity).toBe("info");
    expect(a.evidence.percentage_used).toBe(78);
  });
  it("no fire below the watch floor", () => {
    const s = healthySnapshot();
    s.smart[0].percentage_used = 60;
    expect(alertsOf("nvme_wear_high", s)).toHaveLength(0);
  });
});

describe("drive_smart_unreadable", () => {
  it("fires when disks are present but SMART is unreadable (smartctl missing)", () => {
    const s = healthySnapshot();
    s.smart_unreadable = [
      { device: "/dev/sda", reason: "no_smartctl_output" },
      { device: "/dev/sdb", reason: "no_smartctl_output" },
    ];
    const [a] = alertsOf("drive_smart_unreadable", s);
    expect(a.severity).toBe("warning");
    expect(a.evidence.count).toBe(2);
    expect(a.message).toContain("/dev/sda");
    expect(a.message.toLowerCase()).toContain("smartmontools");
  });
  it("leads with the controller device-type cause when that is the reason", () => {
    const s = healthySnapshot();
    s.smart_unreadable = [{ device: "/dev/sdc", reason: "no_smart_data" }];
    const [a] = alertsOf("drive_smart_unreadable", s);
    expect(a.message).toContain("device type");
  });
  it("is worded as an advisory, not a fault", () => {
    const s = healthySnapshot();
    s.smart_unreadable = [{ device: "/dev/sda", reason: "no_smartctl_output" }];
    const [a] = alertsOf("drive_smart_unreadable", s);
    expect(a.recommendation.toLowerCase()).toContain("advisory, not a fault");
  });
  it("no fire when the field is absent (older agents / fully-readable SMART)", () => {
    expect(alertsOf("drive_smart_unreadable")).toHaveLength(0);
  });
  it("no fire when the marker is present but empty", () => {
    const s = healthySnapshot();
    s.smart_unreadable = [];
    expect(alertsOf("drive_smart_unreadable", s)).toHaveLength(0);
  });
});

describe("boot_config_broken", () => {
  const HEALTHY_BC = {
    available: true,
    mounted_root: { source: "/dev/md127", uuid: "real-uuid", label: "root" },
    cmdline_source: { path: "/etc/kernel/cmdline", root_spec: "UUID=real-uuid", resolvable: true, matches_mounted: true },
    entries: [
      { source: "bls", title: "Linux 6.1 good", kernel: "6.1", root_spec: "UUID=real-uuid", resolvable: true, matches_mounted: true, is_default: true },
    ],
    default_entry_bootable: true,
    default_entry_wrong_fs: false,
    unbootable_entry_count: 0,
    source_regressed: false,
  };

  it("fires critical when the default (next-boot) entry cannot find its root fs", () => {
    const s = healthySnapshot();
    s.boot_config = {
      ...HEALTHY_BC,
      cmdline_source: { path: "/etc/kernel/cmdline", root_spec: "UUID=dead-uuid", resolvable: false, matches_mounted: false },
      entries: [
        { source: "bls", title: "Linux 6.2 NEW", kernel: "6.2", root_spec: "UUID=dead-uuid", resolvable: false, matches_mounted: false, is_default: true },
        { source: "bls", title: "Linux 6.1 good", kernel: "6.1", root_spec: "UUID=real-uuid", resolvable: true, matches_mounted: true, is_default: false },
      ],
      default_entry_bootable: false,
      unbootable_entry_count: 1,
      source_regressed: true,
    };
    const [a] = alertsOf("boot_config_broken", s);
    expect(a.severity).toBe("critical");
    expect(a.message).toContain("emergency shell");
    expect(a.recommendation.toLowerCase()).toContain("do not reboot");
  });

  it("no fire on a healthy boot config (default entry resolves)", () => {
    const s = healthySnapshot();
    s.boot_config = { ...HEALTHY_BC };
    expect(alertsOf("boot_config_broken", s)).toHaveLength(0);
  });

  it("no fire when the field is absent (older agents)", () => {
    expect(alertsOf("boot_config_broken")).toHaveLength(0);
  });

  it("no fire when the collector reports available:false (never on missing data)", () => {
    const s = healthySnapshot();
    s.boot_config = { ...HEALTHY_BC, available: false, error: "blkid unavailable", mounted_root: null, default_entry_bootable: null };
    expect(alertsOf("boot_config_broken", s)).toHaveLength(0);
  });
});

describe("boot_config_drift", () => {
  const HEALTHY_BC = {
    available: true,
    mounted_root: { source: "/dev/md127", uuid: "real-uuid", label: "root" },
    cmdline_source: { path: "/etc/kernel/cmdline", root_spec: "UUID=real-uuid", resolvable: true, matches_mounted: true },
    entries: [
      { source: "bls", title: "Linux 6.1 good", kernel: "6.1", root_spec: "UUID=real-uuid", resolvable: true, matches_mounted: true, is_default: true },
    ],
    default_entry_bootable: true,
    default_entry_wrong_fs: false,
    unbootable_entry_count: 0,
    source_regressed: false,
  };

  it("fires warning when the kernel-cmdline source has regressed (future kernel would fail)", () => {
    const s = healthySnapshot();
    s.boot_config = {
      ...HEALTHY_BC,
      cmdline_source: { path: "/etc/kernel/cmdline", root_spec: "UUID=other-present-uuid", resolvable: true, matches_mounted: false },
      source_regressed: true,
    };
    const [a] = alertsOf("boot_config_drift", s);
    expect(a.severity).toBe("warning");
    expect(a.message.toLowerCase()).toContain("next kernel install");
  });

  it("fires warning when a fallback/rescue entry references a missing filesystem", () => {
    const s = healthySnapshot();
    s.boot_config = {
      ...HEALTHY_BC,
      entries: [
        { source: "bls", title: "good", kernel: "6.1", root_spec: "UUID=real-uuid", resolvable: true, matches_mounted: true, is_default: true },
        { source: "bls", title: "stale rescue", kernel: null, root_spec: "UUID=gone-uuid", resolvable: false, matches_mounted: false, is_default: false },
      ],
      unbootable_entry_count: 1,
    };
    const [a] = alertsOf("boot_config_drift", s);
    expect(a.severity).toBe("warning");
  });

  it("does NOT double-report when the default entry is already broken (critical owns it)", () => {
    const s = healthySnapshot();
    s.boot_config = {
      ...HEALTHY_BC,
      default_entry_bootable: false,
      unbootable_entry_count: 1,
      source_regressed: true,
    };
    expect(alertsOf("boot_config_drift", s)).toHaveLength(0);
  });

  it("no fire on a healthy boot config", () => {
    const s = healthySnapshot();
    s.boot_config = { ...HEALTHY_BC };
    expect(alertsOf("boot_config_drift", s)).toHaveLength(0);
  });

  it("no fire when the field is absent (older agents)", () => {
    expect(alertsOf("boot_config_drift")).toHaveLength(0);
  });
});

describe("raid_degraded", () => {
  it("fires when array degraded", () => {
    const s = healthySnapshot();
    s.raid[0].degraded = true;
    s.raid[0].failed_disks = ["sdb"];
    expect(alertsOf("raid_degraded", s)[0].severity).toBe("critical");
  });
  it("no fire on clean array", () => {
    expect(alertsOf("raid_degraded")).toHaveLength(0);
  });
  // Grok L0 residual: the re-add command must name the actual failed member,
  // not a `/dev/<member>` placeholder the operator has to fill in (and could
  // fill wrong, targeting the healthy disk).
  it("substitutes the real failed member into the mdadm re-add command", () => {
    const s = healthySnapshot();
    s.raid = [{ device: "md127", level: "raid1", status: "degraded", degraded: true, disks: ["sda2", "sdb2"], failed_disks: ["sdb2"] }];
    const [a] = alertsOf("raid_degraded", s);
    expect(a.recommendation).toContain("--re-add /dev/sdb2");
    expect(a.recommendation).not.toContain("/dev/<member>");
    expect(a.recommendation).toContain("grep sdb2");
  });

  it("derives the SMART parent disk correctly for an NVMe member (Codex round-1 #6)", () => {
    const s = healthySnapshot();
    s.raid = [{ device: "md0", level: "raid1", status: "degraded", degraded: true, disks: ["nvme0n1p2", "nvme1n1p2"], failed_disks: ["nvme1n1p2"] }];
    const [a] = alertsOf("raid_degraded", s);
    expect(a.recommendation).toContain("smartctl -H /dev/nvme1n1");
    // NOT the nonexistent nvme1n1p.
    expect(a.recommendation).not.toContain("smartctl -H /dev/nvme1n1p");
    // The re-add still uses the full partition.
    expect(a.recommendation).toContain("--re-add /dev/nvme1n1p2");
  });

  it("derives the SMART parent disk for an mmcblk member (Codex round-2 #6)", () => {
    const s = healthySnapshot();
    s.raid = [{ device: "md0", level: "raid1", status: "degraded", degraded: true, disks: ["mmcblk0p1", "mmcblk1p1"], failed_disks: ["mmcblk1p1"] }];
    const [a] = alertsOf("raid_degraded", s);
    expect(a.recommendation).toContain("smartctl -H /dev/mmcblk1");
    expect(a.recommendation).not.toContain("smartctl -H /dev/mmcblk1p");
    expect(a.recommendation).toContain("--re-add /dev/mmcblk1p1");
  });
});

describe("disk_latency_high", () => {
  it("fires warning above 50ms", () => {
    const s = healthySnapshot();
    s.io_latency![0].avg_read_latency_ms = 80;
    expect(alertsOf("disk_latency_high", s)[0].severity).toBe("warning");
  });
  it("fires critical above 200ms", () => {
    const s = healthySnapshot();
    s.io_latency![0].avg_write_latency_ms = 300;
    expect(alertsOf("disk_latency_high", s)[0].severity).toBe("critical");
  });
  it("no fire on idle disk", () => {
    const s = healthySnapshot();
    s.io_latency = [{ device: "sda", avg_read_latency_ms: 500, avg_write_latency_ms: 500, read_iops: 0, write_iops: 0 }];
    expect(alertsOf("disk_latency_high", s)).toHaveLength(0);
  });
  it("no fire when latency below threshold", () => {
    expect(alertsOf("disk_latency_high")).toHaveLength(0);
  });
  // Round 2: high latency at HIGH IOPS is I/O saturation (Docker-on-loopback
  // over RAID), not a failing drive. Downgrade to info. Codex re-review 2026-07-18:
  // saturation now compares a TRUE per-second rate (count / interval) against a
  // per-second bar (default 150/s), so read_iops here is a per-interval COUNT.
  it("downgrades to info when latency is high but IOPS saturate on a physical device (load, not fault)", () => {
    const s = healthySnapshot();
    // 60000 ops over a 60s interval = 1000 ops/s, above the 150/s bar.
    s.io_latency = [{ device: "sda", avg_read_latency_ms: 2, avg_write_latency_ms: 2068, read_iops: 5, write_iops: 60000 }];
    const [a] = alertsOf("disk_latency_high", s, { collection_interval_seconds: 60 });
    expect(a).toBeDefined();
    expect(a.severity).toBe("info");
    expect(a.evidence.saturated).toBe(true);
  });
  // Codex 2026-07-18 #7: the saturation bar must sit BELOW the documented benign
  // workload it exists to suppress. That burst is 26761 write ops / 60s = ~446
  // IOPS/s at 2068ms latency; the previous 500/s default classified it as
  // unsaturated -> a false critical page. The 150/s default classifies it as the
  // busy (info) device it is.
  it("treats the documented ~446 IOPS/s busy burst as saturated, not a false critical (Codex #7)", () => {
    const s = healthySnapshot();
    s.io_latency = [{ device: "sda", avg_read_latency_ms: 2, avg_write_latency_ms: 2068, read_iops: 5, write_iops: 26761 }];
    const [a] = alertsOf("disk_latency_high", s, { collection_interval_seconds: 60 });
    expect(a.severity).toBe("info");
    expect(a.evidence.saturated).toBe(true);
  });
  it("is interval-robust: the same per-second rate classifies the same across intervals", () => {
    // 300000 ops over 300s is ALSO 1000 ops/s -> still saturated (a fixed count
    // bar would have mis-classified this vs the 60000/60s case above).
    const s = healthySnapshot();
    s.io_latency = [{ device: "sda", avg_read_latency_ms: 2, avg_write_latency_ms: 2068, read_iops: 5, write_iops: 300000 }];
    const [a] = alertsOf("disk_latency_high", s, { collection_interval_seconds: 300 });
    expect(a.severity).toBe("info");
    expect(a.evidence.saturated).toBe(true);
  });
  it("keeps critical when latency is high at LOW IOPS on a physical device (a genuinely slow drive)", () => {
    const s = healthySnapshot();
    s.io_latency = [{ device: "sdz", avg_read_latency_ms: 300, avg_write_latency_ms: 2, read_iops: 40, write_iops: 5 }];
    const [a] = alertsOf("disk_latency_high", s);
    expect(a.severity).toBe("critical");
    expect(a.evidence.saturated).toBe(false);
    expect(a.evidence.virtual).toBe(false);
  });
  // Round 5: virtual / stacked block devices (loop / dm / md) are not physical
  // drives; their latency reflects the storage stack, not a failing disk. On a
  // marketplace Docker-on-loopback-over-RAID host this is the classic false
  // positive. Classify as info even at LOW IOPS, so the rule stays diagnostic
  // for real physical drives without being blanket-suppressed by the profile.
  it("classifies a virtual/stacked device (loop/dm/md) as info even at low IOPS (round 5)", () => {
    const s = healthySnapshot();
    s.io_latency = [{ device: "dm-3", avg_read_latency_ms: 2, avg_write_latency_ms: 800, read_iops: 5, write_iops: 100 }];
    const [a] = alertsOf("disk_latency_high", s);
    expect(a).toBeDefined();
    expect(a.severity).toBe("info");
    expect(a.evidence.virtual).toBe(true);
    expect(a.evidence.saturated).toBe(false);
  });
  it("suppresses while the backing RAID array is resyncing/recovering", () => {
    const s = healthySnapshot();
    s.raid = [{ device: "md127", level: "raid1", status: "active, recovering", degraded: false, disks: ["sda2", "sdb2"], failed_disks: [] }];
    s.io_latency = [{ device: "md127", avg_read_latency_ms: 2, avg_write_latency_ms: 800, read_iops: 5, write_iops: 100 }];
    expect(alertsOf("disk_latency_high", s)).toHaveLength(0);
  });
});

describe("interface_errors (legacy rule stub)", () => {
  // The three-tier interface_errors logic lives in evaluateInterfaceErrors()
  // because it needs the previous snapshot. The in-rules stub should always
  // return [] so the rule key keeps existing for muting/config purposes.
  // Full threshold behaviour is covered in interface-errors.test.ts.
  it("stub returns no alerts regardless of counter values", () => {
    const s = healthySnapshot();
    s.network[0].rx_errors = 1;
    s.network[0].rx_drops = 5_000;
    expect(alertsOf("interface_errors", s)).toHaveLength(0);
  });
});

describe("link_speed_mismatch", () => {
  it("fires below 1 Gbps", () => {
    const s = healthySnapshot();
    s.network[0].speed_mbps = 100;
    expect(alertsOf("link_speed_mismatch", s)).toHaveLength(1);
  });
  it("no fire at or above 1 Gbps", () => {
    expect(alertsOf("link_speed_mismatch")).toHaveLength(0);
  });
});

describe("interface_saturation", () => {
  it("fires when utilization >= 90%", () => {
    const s = healthySnapshot();
    // 10 Gbps interface => ~1.25 GB/s cap
    s.network[0].rx_bytes_sec = 1_200_000_000;
    expect(alertsOf("interface_saturation", s)).toHaveLength(1);
  });
  it("no fire at low utilization", () => {
    expect(alertsOf("interface_saturation")).toHaveLength(0);
  });
});

describe("bond_slave_down", () => {
  it("fires when a bond slave has operstate=down", () => {
    const s = healthySnapshot();
    s.network = [
      { interface: "bond0", speed_mbps: 10_000, rx_bytes_sec: 0, tx_bytes_sec: 0, rx_errors: 0, tx_errors: 0, rx_drops: 0, tx_drops: 0, operstate: "up" },
      { interface: "enp1s0f0", speed_mbps: 10_000, rx_bytes_sec: 0, tx_bytes_sec: 0, rx_errors: 0, tx_errors: 0, rx_drops: 0, tx_drops: 0, operstate: "up", bond_master: "bond0" },
      { interface: "enp1s0f1", speed_mbps: 0, rx_bytes_sec: 0, tx_bytes_sec: 0, rx_errors: 0, tx_errors: 0, rx_drops: 0, tx_drops: 0, operstate: "down", bond_master: "bond0" },
    ];
    const [a] = alertsOf("bond_slave_down", s);
    expect(a).toBeDefined();
    expect(a.severity).toBe("critical");
    expect(a.title).toContain("enp1s0f1");
    expect(a.title).toContain("bond0");
  });
  it("no fire when all bond slaves are up", () => {
    const s = healthySnapshot();
    s.network = [
      { interface: "bond0", speed_mbps: 10_000, rx_bytes_sec: 0, tx_bytes_sec: 0, rx_errors: 0, tx_errors: 0, rx_drops: 0, tx_drops: 0, operstate: "up" },
      { interface: "enp1s0f0", speed_mbps: 10_000, rx_bytes_sec: 0, tx_bytes_sec: 0, rx_errors: 0, tx_errors: 0, rx_drops: 0, tx_drops: 0, operstate: "up", bond_master: "bond0" },
    ];
    expect(alertsOf("bond_slave_down", s)).toHaveLength(0);
  });
  it("no fire on non-bond interfaces with operstate=down", () => {
    const s = healthySnapshot();
    s.network[0].operstate = "down";
    // No bond_master, so not a bond slave
    expect(alertsOf("bond_slave_down", s)).toHaveLength(0);
  });
});

// Regression guard for a 2026-04-21 bug where the CPU temperature rule,
// after switching to BMC-relative thresholds (warning = uc-15, critical
// = uc-5), was matching any sensor whose name contained "cpu", including
// voltage rails like "CPU_VDDCR0" (upper_critical = 1.578 V). The rule
// subtracted 5 from the voltage upper_critical and fired "critical" on
// any reading above -3.4 V. The fix is to filter by sensor type/unit
// before applying the formula; the tests below lock that behaviour in.
describe("cpu_temperature_high (BMC-relative thresholds)", () => {
  const cpu = (value: number, uc?: number | null) => ({
    name: "CPU1 Temp", value, unit: "C", status: "ok",
    ...(uc !== undefined && uc !== null ? { upper_critical: uc } : {}),
  });

  // Warning = uc - 15; Critical = uc - 5.
  it("1. 83C with uc=100: no alert (below 85C warning threshold)", () => {
    const s = healthySnapshot();
    s.ipmi.sensors = [cpu(83, 100)];
    expect(alertsOf("cpu_temperature_high", s)).toHaveLength(0);
  });
  it("2. 86C with uc=100: warning (above 85, below 95)", () => {
    const s = healthySnapshot();
    s.ipmi.sensors = [cpu(86, 100)];
    const a = alertsOf("cpu_temperature_high", s);
    expect(a[0].severity).toBe("warning");
    expect(a[0].message).toContain("derived from BMC limit of 100°C");
    expect(a[0].message).toContain("85°C");
  });
  it("3. 96C with uc=100: critical (above 95)", () => {
    const s = healthySnapshot();
    s.ipmi.sensors = [cpu(96, 100)];
    const a = alertsOf("cpu_temperature_high", s);
    expect(a[0].severity).toBe("critical");
    expect(a[0].message).toContain("95°C");
  });
  it("4. 81C with uc=85: critical (above uc minus 5 = 80)", () => {
    const s = healthySnapshot();
    s.ipmi.sensors = [cpu(81, 85)];
    expect(alertsOf("cpu_temperature_high", s)[0].severity).toBe("critical");
  });
  it("5. 71C with uc=85: warning (above uc minus 15 = 70)", () => {
    const s = healthySnapshot();
    s.ipmi.sensors = [cpu(71, 85)];
    expect(alertsOf("cpu_temperature_high", s)[0].severity).toBe("warning");
  });
  it("6. 83C without upper_critical: warning (fallback 80C threshold)", () => {
    const s = healthySnapshot();
    s.ipmi.sensors = [cpu(83)];
    const a = alertsOf("cpu_temperature_high", s);
    expect(a[0].severity).toBe("warning");
    expect(a[0].message).toContain("fallback threshold");
  });
  it("7. 91C without upper_critical: critical (fallback 90C threshold)", () => {
    const s = healthySnapshot();
    s.ipmi.sensors = [cpu(91)];
    expect(alertsOf("cpu_temperature_high", s)[0].severity).toBe("critical");
  });
  it("8. 79C without upper_critical: no alert", () => {
    const s = healthySnapshot();
    s.ipmi.sensors = [cpu(79)];
    expect(alertsOf("cpu_temperature_high", s)).toHaveLength(0);
  });
  it("9. dual-socket: each CPU evaluated against its own uc", () => {
    const s = healthySnapshot();
    s.ipmi.sensors = [
      { name: "CPU0 Temp", value: 88, unit: "C", status: "ok", upper_critical: 100 }, // warning range 85-95; 88 -> warning
      { name: "CPU1 Temp", value: 82, unit: "C", status: "ok", upper_critical: 85 },  // critical range >=80; 82 -> critical
    ];
    const alerts = alertsOf("cpu_temperature_high", s);
    expect(alerts).toHaveLength(2);
    const cpu0 = alerts.find(a => a.title?.includes("CPU0"));
    const cpu1 = alerts.find(a => a.title?.includes("CPU1"));
    expect(cpu0?.severity).toBe("warning");
    expect(cpu1?.severity).toBe("critical");
  });
  it("10a. upper_critical is null: uses fallback thresholds", () => {
    const s = healthySnapshot();
    s.ipmi.sensors = [cpu(85, null)];
    const a = alertsOf("cpu_temperature_high", s);
    expect(a[0].severity).toBe("warning"); // >=80 fallback
    expect(a[0].message).toContain("fallback threshold");
  });
  it("10b. upper_critical is NaN: uses fallback thresholds", () => {
    const s = healthySnapshot();
    s.ipmi.sensors = [{ name: "CPU1 Temp", value: 85, unit: "C", status: "ok", upper_critical: NaN } as any];
    const a = alertsOf("cpu_temperature_high", s);
    expect(a[0].severity).toBe("warning");
    expect(a[0].message).toContain("fallback threshold");
  });
  it("ignores ambient/PSU/DIMM sensors even with CPU in name", () => {
    const s = healthySnapshot();
    s.ipmi.sensors = [
      { name: "CPU Inlet Temp", value: 95, unit: "C", status: "ok" },
      { name: "Ambient Temp", value: 95, unit: "C", status: "ok" },
    ];
    expect(alertsOf("cpu_temperature_high", s)).toHaveLength(0);
  });
  it("no fire on cool CPU (uses healthy fixture)", () => {
    expect(alertsOf("cpu_temperature_high")).toHaveLength(0);
  });

  // Regression cases. The 2026-04-21 bug was that CPU_VDDCR0 (a voltage
  // rail, upper_critical in volts) triggered the "above critical"
  // branch. These tests exist because the original BMC-threshold test
  // suite only used temperature-unit fixtures, which is why the
  // regression was not caught.
  it("regression: does NOT fire on voltage sensor named CPU_VDDCR0", () => {
    const s = healthySnapshot();
    s.ipmi.sensors = [{ name: "CPU_VDDCR0", value: 0.948, unit: "Volts", status: "ok", upper_critical: 1.578 }];
    expect(alertsOf("cpu_temperature_high", s)).toHaveLength(0);
  });
  it("regression: does NOT fire on CPU fan RPM sensor", () => {
    const s = healthySnapshot();
    s.ipmi.sensors = [{ name: "CPU_FAN", value: 2000, unit: "RPM", status: "ok", upper_critical: 3000 }];
    expect(alertsOf("cpu_temperature_high", s)).toHaveLength(0);
  });
  it("regression: does NOT fire on current sensor with CPU in name", () => {
    const s = healthySnapshot();
    s.ipmi.sensors = [{ name: "CPU_CURRENT", value: 10, unit: "Amps", status: "ok", upper_critical: 50 }];
    expect(alertsOf("cpu_temperature_high", s)).toHaveLength(0);
  });

  it("numeric values in message are rounded to 1 decimal (no FP artifacts)", () => {
    const s = healthySnapshot();
    // 100.0001 - 15 = 85.0001 is still a warning threshold; 86 should fire warning.
    // Confirm the display shows 85.0 not 85.0001 and not e.g. -3.4219999999999997.
    s.ipmi.sensors = [{ name: "CPU1 Temp", value: 86, unit: "C", status: "ok", upper_critical: 100.0001 }];
    const a = alertsOf("cpu_temperature_high", s);
    expect(a[0].severity).toBe("warning");
    expect(a[0].message).toContain("85°C");       // 85.0 -> "85" after toFixed(1) rounding
    expect(a[0].message).not.toMatch(/85\.00\d+/);
    expect(a[0].message).not.toMatch(/-\d/);
  });

  it("unit fallback: sensor.type missing but unit === 'degrees C' still matches", () => {
    const s = healthySnapshot();
    // No `type` field at all, unit is the SI long form used by some BMCs.
    s.ipmi.sensors = [{ name: "CPU1 Temp", value: 86, unit: "degrees C", status: "ok", upper_critical: 100 }];
    const a = alertsOf("cpu_temperature_high", s);
    expect(a[0].severity).toBe("warning");
    // Unit in message is normalised to °C regardless of BMC spelling.
    expect(a[0].message).toContain("°C");
  });
});

// R-P2-1 (val-fleet campaign 2026-05-29): when a high CPU temperature is
// correlated with high CPU utilization (>= 70%), the rule keeps firing but
// reframes the message + remediation as load-induced and flips the verdict
// from vendor-side to investigation (via evidence.verdict_prior_override).
// Below 70%, the original vendor-side cooling framing is unchanged.
describe("cpu_temperature_high load correlation (R-P2-1)", () => {
  it("hwmon hot + CPU usage >= 70%: reframes message, flips verdict, keeps severity", () => {
    const s = healthySnapshot();
    s.thermal = { available: true, source: "k10temp", max_cpu_celsius: 92 };
    s.ipmi.sensors = [];
    s.cpu.idle_percent = 5; // 95% utilization
    const a = alertsOf("cpu_temperature_high", s, { cpu_temp_warning_c: 85, cpu_temp_critical_c: 95 });
    expect(a).toHaveLength(1);
    expect(a[0].severity).toBe("warning"); // 92 < 95: severity unchanged, NOT downgraded
    expect((a[0].evidence as any).load_correlated).toBe(true);
    expect((a[0].evidence as any).cpu_utilization).toBe(95);
    expect((a[0].evidence as any).verdict_prior_override).toBe("investigation");
    expect(a[0].message).toContain("tracks workload");
    expect(a[0].recommendation).toContain("correlated with high CPU load");
  });

  it("hwmon hot + CPU usage < 70%: keeps vendor-side framing, no verdict override", () => {
    const s = healthySnapshot();
    s.thermal = { available: true, source: "k10temp", max_cpu_celsius: 92 };
    s.ipmi.sensors = [];
    // healthySnapshot idle_percent = 86 -> 14% utilization
    const a = alertsOf("cpu_temperature_high", s, { cpu_temp_warning_c: 85, cpu_temp_critical_c: 95 });
    expect(a).toHaveLength(1);
    expect((a[0].evidence as any).load_correlated).toBe(false);
    expect((a[0].evidence as any).verdict_prior_override).toBeUndefined();
    expect(a[0].message).not.toContain("tracks workload");
    expect(a[0].recommendation).toContain("thermal paste"); // original vendor-side reco
  });

  it("IPMI hot + CPU usage >= 70%: reframes + flips verdict", () => {
    const s = healthySnapshot();
    s.thermal = undefined;
    s.ipmi.sensors = [{ name: "CPU0 Temp", value: 88, unit: "C", status: "ok", upper_critical: 95, type: "Temperature" }];
    s.cpu.idle_percent = 10; // 90% utilization
    const a = alertsOf("cpu_temperature_high", s);
    expect(a).toHaveLength(1);
    expect((a[0].evidence as any).path).toBe("ipmi");
    expect((a[0].evidence as any).load_correlated).toBe(true);
    expect((a[0].evidence as any).verdict_prior_override).toBe("investigation");
    expect(a[0].message).toContain("tracks workload");
  });

  it("load-correlated CRITICAL temp keeps critical severity (no downgrade)", () => {
    const s = healthySnapshot();
    s.thermal = { available: true, source: "k10temp", max_cpu_celsius: 97 };
    s.ipmi.sensors = [];
    s.cpu.idle_percent = 2; // 98% utilization
    const a = alertsOf("cpu_temperature_high", s, { cpu_temp_warning_c: 85, cpu_temp_critical_c: 95 });
    expect(a[0].severity).toBe("critical");
    expect((a[0].evidence as any).load_correlated).toBe(true);
  });

  it("exactly 70% utilization is treated as load-correlated (boundary)", () => {
    const s = healthySnapshot();
    s.thermal = { available: true, source: "k10temp", max_cpu_celsius: 92 };
    s.ipmi.sensors = [];
    s.cpu.idle_percent = 30; // exactly 70% utilization
    const a = alertsOf("cpu_temperature_high", s, { cpu_temp_warning_c: 85, cpu_temp_critical_c: 95 });
    expect((a[0].evidence as any).load_correlated).toBe(true);
  });
});

// Phase 3 A.2: hwmon-primary path. Reads snap.thermal.max_cpu_celsius and
// only falls back to IPMI when hwmon is unavailable. Mirrors Crucible 0.9.0's
// rule 13 behaviour. Path attribution lands in evidence.path.
describe("cpu_temperature_high (hwmon-primary, Phase 3 A.2)", () => {
  it("hwmon present, above default warning threshold (80°C): fires, path = hwmon", () => {
    const s = healthySnapshot();
    s.thermal = { available: true, source: "hwmon coretemp", max_cpu_celsius: 92 };
    s.ipmi.sensors = []; // empty so we know IPMI fallback wasn't used
    const config = { cpu_temp_warning_c: 85, cpu_temp_critical_c: 95 };
    const a = alertsOf("cpu_temperature_high", s, config);
    expect(a).toHaveLength(1);
    expect(a[0].severity).toBe("warning");
    expect((a[0].evidence as any).path).toBe("hwmon");
    expect((a[0].evidence as any).source).toBe("hwmon coretemp");
    expect((a[0].evidence as any).value).toBe(92);
  });

  it("hwmon present, below threshold: doesn't fire, path = hwmon (logged, no alert)", () => {
    const s = healthySnapshot();
    s.thermal = { available: true, source: "hwmon coretemp", max_cpu_celsius: 60 };
    s.ipmi.sensors = [];
    const config = { cpu_temp_warning_c: 85, cpu_temp_critical_c: 95 };
    expect(alertsOf("cpu_temperature_high", s, config)).toHaveLength(0);
  });

  it("hwmon absent, IPMI present, above threshold: falls back to IPMI, path = ipmi", () => {
    const s = healthySnapshot();
    s.thermal = undefined;
    // Realistic IPMI fixture inspired by Phase 2 mz62hd capture (Gigabyte EPYC).
    s.ipmi.sensors = [
      { name: "CPU0 Temp", value: 88, unit: "C", status: "ok", upper_critical: 95, type: "Temperature" },
    ];
    const a = alertsOf("cpu_temperature_high", s);
    expect(a).toHaveLength(1);
    expect((a[0].evidence as any).path).toBe("ipmi");
    expect((a[0].evidence as any).sensor).toBe("CPU0 Temp");
  });

  it("hwmon absent, IPMI present, below threshold: doesn't fire, path = ipmi", () => {
    const s = healthySnapshot();
    s.thermal = undefined;
    s.ipmi.sensors = [
      { name: "CPU1 Temp", value: 60, unit: "C", status: "ok", upper_critical: 100, type: "Temperature" },
    ];
    expect(alertsOf("cpu_temperature_high", s)).toHaveLength(0);
  });

  it("hwmon absent, IPMI absent: doesn't fire, path = none", () => {
    const s = healthySnapshot();
    s.thermal = undefined;
    s.ipmi.available = false;
    s.ipmi.sensors = [];
    expect(alertsOf("cpu_temperature_high", s)).toHaveLength(0);
  });

  it("hwmon present but null value: falls back to IPMI, fires, path = ipmi", () => {
    const s = healthySnapshot();
    s.thermal = { available: true, max_cpu_celsius: null };
    s.ipmi.sensors = [
      { name: "CPU0 Temp", value: 88, unit: "C", status: "ok", upper_critical: 95, type: "Temperature" },
    ];
    const a = alertsOf("cpu_temperature_high", s);
    expect(a).toHaveLength(1);
    expect((a[0].evidence as any).path).toBe("ipmi");
  });

  it("hwmon present but NaN: falls back to IPMI, fires, path = ipmi", () => {
    const s = healthySnapshot();
    s.thermal = { available: true, max_cpu_celsius: NaN };
    s.ipmi.sensors = [
      { name: "CPU0 Temp", value: 88, unit: "C", status: "ok", upper_critical: 95, type: "Temperature" },
    ];
    const a = alertsOf("cpu_temperature_high", s);
    expect(a).toHaveLength(1);
    expect((a[0].evidence as any).path).toBe("ipmi");
  });

  it("custom threshold (70°C) respected on hwmon path", () => {
    const s = healthySnapshot();
    s.thermal = { available: true, source: "hwmon", max_cpu_celsius: 75 };
    s.ipmi.sensors = [];
    const config = { cpu_temp_warning_c: 70, cpu_temp_critical_c: 90 };
    const a = alertsOf("cpu_temperature_high", s, config);
    expect(a).toHaveLength(1);
    expect(a[0].severity).toBe("warning");
    expect((a[0].evidence as any).path).toBe("hwmon");
    expect((a[0].evidence as any).warning_threshold).toBe(70);
  });

  it("hwmon path emits exactly one alert even with multi-CPU readings (the agent reduces to max)", () => {
    const s = healthySnapshot();
    s.thermal = {
      available: true,
      source: "hwmon coretemp",
      max_cpu_celsius: 88,
      cpu_readings: [
        { chip: "coretemp", label: "Package id 0", celsius: 86 },
        { chip: "coretemp", label: "Package id 1", celsius: 88 }, // max
      ],
    };
    // Even with IPMI sensors that would also fire, hwmon takes precedence.
    s.ipmi.sensors = [
      { name: "CPU0 Temp", value: 92, unit: "C", status: "ok", upper_critical: 95, type: "Temperature" },
    ];
    const a = alertsOf("cpu_temperature_high", s);
    expect(a).toHaveLength(1);
    expect((a[0].evidence as any).path).toBe("hwmon");
    expect((a[0].evidence as any).value).toBe(88);
  });

  it("hwmon path crosses critical threshold: severity = critical", () => {
    const s = healthySnapshot();
    s.thermal = { available: true, source: "hwmon", max_cpu_celsius: 95 };
    s.ipmi.sensors = [];
    const config = { cpu_temp_warning_c: 80, cpu_temp_critical_c: 90 };
    const a = alertsOf("cpu_temperature_high", s, config);
    expect(a[0].severity).toBe("critical");
    expect((a[0].evidence as any).path).toBe("hwmon");
  });
});

describe("ecc_errors (synchronous path: uncorrectable only)", () => {
  // Post-glassmkr#24 the synchronous in-snapshot rule fires ONLY on
  // uncorrectable ECC. Correctable is rate-based and lives in
  // evaluateEccErrors() with ClickHouse access; see
  // evaluateEccErrors.test.ts.
  it("no fire when both named and SEL are zero", () => {
    expect(alertsOf("ecc_errors")).toHaveLength(0);
  });
  it("no fire on synchronous path when only correctable is set (rate-based path handles it)", () => {
    const s = healthySnapshot();
    s.ipmi.ecc_errors = { correctable: 100, uncorrectable: 0 };
    s.ipmi.ecc_errors_from_sel = { correctable: 100, uncorrectable: 0, newest_event_timestamp: null };
    expect(alertsOf("ecc_errors", s)).toHaveLength(0);
  });
  it("critical on named uncorrectable=1, path=named", () => {
    const s = healthySnapshot();
    s.ipmi.ecc_errors = { correctable: 0, uncorrectable: 1 };
    const [a] = alertsOf("ecc_errors", s);
    expect(a.severity).toBe("critical");
    expect((a.evidence as any).path).toBe("named");
    expect((a.evidence as any).evaluation).toBe("uncorrectable_immediate");
  });
  it("critical on SEL uncorrectable=1 with named zero, path=sel", () => {
    const s = healthySnapshot();
    s.ipmi.ecc_errors = { correctable: 0, uncorrectable: 0 };
    s.ipmi.ecc_errors_from_sel = { correctable: 0, uncorrectable: 1, newest_event_timestamp: "2026-05-07T09:00:00Z" };
    const [a] = alertsOf("ecc_errors", s);
    expect(a.severity).toBe("critical");
    expect((a.evidence as any).path).toBe("sel");
    expect((a.evidence as any).max_uncorrectable).toBe(1);
    expect((a.evidence as any).sel.newest_event_timestamp).toBe("2026-05-07T09:00:00Z");
  });
  it("critical when both paths report uncorrectable (synchronous path picks max)", () => {
    const s = healthySnapshot();
    s.ipmi.ecc_errors = { correctable: 0, uncorrectable: 2 };
    s.ipmi.ecc_errors_from_sel = { correctable: 0, uncorrectable: 5, newest_event_timestamp: null };
    const [a] = alertsOf("ecc_errors", s);
    expect(a.severity).toBe("critical");
    expect((a.evidence as any).max_uncorrectable).toBe(5);
  });
  it("coerces null SEL uncorrectable to 0 (no fire)", () => {
    const s = healthySnapshot();
    s.ipmi.ecc_errors = { correctable: 0, uncorrectable: 0 };
    s.ipmi.ecc_errors_from_sel = { correctable: null as unknown as number, uncorrectable: null as unknown as number, newest_event_timestamp: null };
    expect(alertsOf("ecc_errors", s)).toHaveLength(0);
  });
});

describe("psu_redundancy_loss", () => {
  // Helper: extract the path-attribution log line for assertions.
  function pathOfLastEval(snap: ReturnType<typeof healthySnapshot>): { path: string; fired: boolean } {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      evaluateAlerts(snap, {});
      const calls = log.mock.calls.map((c) => String(c[0]));
      const last = calls.find((s) => s.startsWith("[psu_redundancy_loss]"));
      if (!last) throw new Error("no path-attribution log emitted");
      const m = last.match(/path=(\S+) fired=(true|false)/);
      if (!m) throw new Error(`unexpected log shape: ${last}`);
      return { path: m[1], fired: m[2] === "true" };
    } finally {
      log.mockRestore();
    }
  }

  it("aggregate redundancy_lost fires critical, path=aggregate-redundancy", () => {
    const s = healthySnapshot();
    s.ipmi.psu_redundancy_state = "redundancy_lost";
    const [a] = alertsOf("psu_redundancy_loss", s);
    expect(a.severity).toBe("critical");
    expect((a.evidence as any).path).toBe("aggregate-redundancy");
    expect((a.evidence as any).aggregate_state).toBe("redundancy_lost");
    expect(pathOfLastEval(s)).toEqual({ path: "aggregate-redundancy", fired: true });
  });

  it("aggregate redundancy_degraded fires warning, path=aggregate-redundancy", () => {
    const s = healthySnapshot();
    s.ipmi.psu_redundancy_state = "redundancy_degraded";
    const [a] = alertsOf("psu_redundancy_loss", s);
    expect(a.severity).toBe("warning");
    expect((a.evidence as any).path).toBe("aggregate-redundancy");
    expect((a.evidence as any).aggregate_state).toBe("redundancy_degraded");
    expect(pathOfLastEval(s)).toEqual({ path: "aggregate-redundancy", fired: true });
  });

  it("aggregate fully_redundant: no fire, path=aggregate-redundancy (state present and healthy)", () => {
    const s = healthySnapshot();
    s.ipmi.psu_redundancy_state = "fully_redundant";
    // Even with a per-PSU sensor in fault, the aggregate is authoritative
    // — Tier 1 short-circuits to no-fire.
    s.ipmi.sensors = [
      { name: "PS1 Status", value: 0, unit: "", status: "fail" },
      { name: "PS2 Status", value: 0, unit: "", status: "ok" },
    ];
    expect(alertsOf("psu_redundancy_loss", s)).toHaveLength(0);
    expect(pathOfLastEval(s)).toEqual({ path: "aggregate-redundancy", fired: false });
  });

  it("aggregate unknown falls through to per-PSU iteration", () => {
    const s = healthySnapshot();
    s.ipmi.psu_redundancy_state = "unknown";
    s.ipmi.sensors = [
      { name: "PSU1", value: "present", unit: "", status: "ok" },
      { name: "PSU2", value: "fail", unit: "", status: "fail" },
    ];
    const [a] = alertsOf("psu_redundancy_loss", s);
    expect(a.severity).toBe("critical");
    expect((a.evidence as any).path).toBe("per-psu-fault");
    expect(pathOfLastEval(s)).toEqual({ path: "per-psu-fault", fired: true });
  });

  it("undefined aggregate + per-PSU all healthy: no fire, path=all-healthy", () => {
    const s = healthySnapshot();
    s.ipmi.sensors = [
      { name: "PSU1", value: "present", unit: "", status: "ok" },
      { name: "PSU2", value: "present", unit: "", status: "ok" },
    ];
    expect(alertsOf("psu_redundancy_loss", s)).toHaveLength(0);
    expect(pathOfLastEval(s)).toEqual({ path: "all-healthy", fired: false });
  });

  it("undefined aggregate + only one PSU sensor: no fire, path=single-psu", () => {
    const s = healthySnapshot();
    s.ipmi.sensors = [{ name: "PSU1", value: "fail", unit: "", status: "fail" }];
    expect(alertsOf("psu_redundancy_loss", s)).toHaveLength(0);
    expect(pathOfLastEval(s)).toEqual({ path: "single-psu", fired: false });
  });

  it("fires when one of two PSUs has failed (per-psu-fault)", () => {
    const s = healthySnapshot();
    s.ipmi.sensors = [
      { name: "PSU1", value: "present", unit: "", status: "ok" },
      { name: "PSU2", value: "fail", unit: "", status: "fail" },
    ];
    const [a] = alertsOf("psu_redundancy_loss", s);
    expect(a.severity).toBe("critical");
    expect((a.evidence as any).path).toBe("per-psu-fault");
    expect(pathOfLastEval(s)).toEqual({ path: "per-psu-fault", fired: true });
  });

  it("fires on status=cr with Dell-style PS<N> name (per-psu-fault)", () => {
    const s = healthySnapshot();
    s.ipmi.sensors = [
      { name: "PS1 Status", value: 0, unit: "", status: "ok" },
      { name: "PS2 Status", value: 0, unit: "", status: "cr" },
    ];
    const alerts = alertsOf("psu_redundancy_loss", s);
    expect(alerts).toHaveLength(1);
    expect((alerts[0].evidence as any).path).toBe("per-psu-fault");
  });

  it("no false positive on discrete sensors with status=ok (GPU server bug regression)", () => {
    const s = healthySnapshot();
    s.ipmi.sensors = [
      { name: "PS1 Status", value: 0, unit: "discrete", status: "ok" },
      { name: "PS2 Status", value: 0, unit: "discrete", status: "ok" },
    ];
    expect(alertsOf("psu_redundancy_loss", s)).toHaveLength(0);
    // Both are literal status=ok → all-healthy.
    expect(pathOfLastEval(s)).toEqual({ path: "all-healthy", fired: false });
  });

  it("discrete sensors with hex-bitmask status (no literal 'ok'): no fire, path=discrete-status-ok", () => {
    // Real-world fleet shape: x12qch / mz62hd / mc12le report PS<N>_Status
    // sensors with hex bitmask status fields, not literal "ok".
    const s = healthySnapshot();
    s.ipmi.sensors = [
      { name: "PS1_Status", value: "0x0", unit: "discrete", status: "0x0180" },
      { name: "PS2_Status", value: "0x0", unit: "discrete", status: "0x0180" },
    ];
    expect(alertsOf("psu_redundancy_loss", s)).toHaveLength(0);
    expect(pathOfLastEval(s)).toEqual({ path: "discrete-status-ok", fired: false });
  });

  it("zero PSU sensors matched: no fire, path=none", () => {
    // A box with no PSU-named sensors — possible on a 1U workstation where
    // the BMC doesn't surface PSU readings. Don't fire on absence.
    const s = healthySnapshot();
    s.ipmi.sensors = [{ name: "CPU1 Temp", value: 45, unit: "C", status: "ok" }];
    expect(alertsOf("psu_redundancy_loss", s)).toHaveLength(0);
    expect(pathOfLastEval(s)).toEqual({ path: "none", fired: false });
  });

  it("ipmi unavailable: no fire, path=none", () => {
    const s = healthySnapshot();
    s.ipmi.available = false;
    expect(alertsOf("psu_redundancy_loss", s)).toHaveLength(0);
    expect(pathOfLastEval(s)).toEqual({ path: "none", fired: false });
  });

  it("aggregate redundancy_lost takes precedence over per-PSU sensors that look healthy", () => {
    // Reverse of fully_redundant test: aggregate says lost, per-PSU say ok.
    // Tier 1 is authoritative.
    const s = healthySnapshot();
    s.ipmi.psu_redundancy_state = "redundancy_lost";
    s.ipmi.sensors = [
      { name: "PSU1", value: "present", unit: "", status: "ok" },
      { name: "PSU2", value: "present", unit: "", status: "ok" },
    ];
    const [a] = alertsOf("psu_redundancy_loss", s);
    expect(a.severity).toBe("critical");
    expect((a.evidence as any).path).toBe("aggregate-redundancy");
  });
});

describe("ipmi_sel_critical", () => {
  const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  it("fires on recent asserted critical events", () => {
    const s = healthySnapshot();
    s.ipmi.sel_events_recent = [
      { id: 1, timestamp: isoDaysAgo(2), sensor: "DIMM_A1", sensor_type: "memory", event: "Uncorrectable ECC", direction: "Asserted", severity: "critical" },
    ];
    const [a] = alertsOf("ipmi_sel_critical", s);
    expect(a.severity).toBe("critical");
    expect((a.evidence as any).window_days).toBe(30);
    expect((a.evidence as any).critical_events[0].age_days).toBeGreaterThanOrEqual(1);
  });
  it("ignores deasserted events", () => {
    const s = healthySnapshot();
    s.ipmi.sel_events_recent = [
      { id: 1, timestamp: isoDaysAgo(2), sensor: "DIMM_A1", sensor_type: "memory", event: "Uncorrectable ECC", direction: "Deasserted", severity: "critical" },
    ];
    expect(alertsOf("ipmi_sel_critical", s)).toHaveLength(0);
  });
  it("no fire on empty log", () => {
    expect(alertsOf("ipmi_sel_critical")).toHaveLength(0);
  });
  it("time-window filter: events older than 30 days are excluded by default (Codex experiment 2026-05-12)", () => {
    const s = healthySnapshot();
    s.ipmi.sel_events_recent = [
      { id: 1, timestamp: isoDaysAgo(400), sensor: "PS1", sensor_type: "power", event: "Power Supply AC lost", direction: "Asserted", severity: "critical" },
    ];
    expect(alertsOf("ipmi_sel_critical", s)).toHaveLength(0);
  });
  it("time-window filter: mixed events emit alert with recent only + report excluded count", () => {
    const s = healthySnapshot();
    s.ipmi.sel_events_recent = [
      { id: 1, timestamp: isoDaysAgo(400), sensor: "PS1", sensor_type: "power", event: "Old AC lost", direction: "Asserted", severity: "critical" },
      { id: 2, timestamp: isoDaysAgo(5), sensor: "DIMM_A1", sensor_type: "memory", event: "Uncorrectable ECC", direction: "Asserted", severity: "critical" },
    ];
    const [a] = alertsOf("ipmi_sel_critical", s);
    expect((a.evidence as any).critical_events).toHaveLength(1);
    expect((a.evidence as any).critical_events[0].sensor).toBe("DIMM_A1");
    expect((a.evidence as any).events_outside_window).toBe(1);
  });
  it("per-server override widens window to 365 days", () => {
    const s = healthySnapshot();
    s.ipmi.sel_events_recent = [
      { id: 1, timestamp: isoDaysAgo(200), sensor: "PS1", sensor_type: "power", event: "AC lost", direction: "Asserted", severity: "critical" },
    ];
    const [a] = alertsOf("ipmi_sel_critical", s, { ipmi_sel_critical_window_days: 365 });
    expect(a.severity).toBe("critical");
    expect((a.evidence as any).window_days).toBe(365);
  });
  it("fail-open on unparseable timestamps (event included with age_days=null)", () => {
    const s = healthySnapshot();
    s.ipmi.sel_events_recent = [
      { id: 1, timestamp: "24-11-14T16:16:02 UTCZ" as string, sensor: "PS1", sensor_type: "power", event: "AC lost", direction: "Asserted", severity: "critical" },
    ];
    // The shape is parseable by our best-effort helper. Verify it
    // does NOT fail-open into a fire — the timestamp resolves to
    // 2024-11-14 which is far outside the 30-day window, so no fire.
    expect(alertsOf("ipmi_sel_critical", s)).toHaveLength(0);
  });
  it("fail-open on totally unparseable timestamp (truly unknown age)", () => {
    const s = healthySnapshot();
    s.ipmi.sel_events_recent = [
      { id: 1, timestamp: "not-a-date" as string, sensor: "PS1", sensor_type: "power", event: "AC lost", direction: "Asserted", severity: "critical" },
    ];
    const [a] = alertsOf("ipmi_sel_critical", s);
    expect(a.severity).toBe("critical");
    expect((a.evidence as any).critical_events[0].age_days).toBeNull();
  });
  it("transient-pairing (2026-05-24 noise-fix): assert+deassert within 60s on same (sensor, event) is excluded", () => {
    // Verbatim mz62hd BMC-bus glitch trace: INLET_TEMP read 0C for one
    // second at 02:47:17, deasserted at 02:47:18 as the sensor returned
    // to 25C. PSUs simultaneously showed "Presence detected" deassert
    // then re-assert -- all in a one-second window. Physically
    // impossible read; classic BMC bus hiccup signature.
    const s = healthySnapshot();
    const baseMs = Date.now() - 8 * 3600 * 1000; // 8h ago
    const iso = (offsetSec: number) => new Date(baseMs + offsetSec * 1000).toISOString();
    s.ipmi.sel_events_recent = [
      { id: 8, timestamp: iso(0), sensor: "Temperature INLET_TEMP", sensor_type: "temperature", event: "Lower Non-critical going low", direction: "Asserted", severity: "critical" },
      { id: 9, timestamp: iso(0), sensor: "Temperature INLET_TEMP", sensor_type: "temperature", event: "Lower Critical going low", direction: "Asserted", severity: "critical" },
      { id: 12, timestamp: iso(1), sensor: "Temperature INLET_TEMP", sensor_type: "temperature", event: "Lower Critical going low", direction: "Deasserted", severity: "critical" },
      { id: 13, timestamp: iso(1), sensor: "Temperature INLET_TEMP", sensor_type: "temperature", event: "Lower Non-critical going low", direction: "Deasserted", severity: "critical" },
    ];
    const alerts = alertsOf("ipmi_sel_critical", s);
    expect(alerts).toHaveLength(0);
  });
  it("transient-pairing: persistent assertion with no matching deassertion still fires", () => {
    const s = healthySnapshot();
    const baseMs = Date.now() - 5 * 86_400_000;
    s.ipmi.sel_events_recent = [
      { id: 1, timestamp: new Date(baseMs).toISOString(), sensor: "DIMM_A1", sensor_type: "memory", event: "Uncorrectable ECC", direction: "Asserted", severity: "critical" },
    ];
    const [a] = alertsOf("ipmi_sel_critical", s);
    expect(a.severity).toBe("critical");
    expect((a.evidence as any).critical_events).toHaveLength(1);
    expect((a.evidence as any).transient_pairs_excluded).toBe(0);
  });
  it("transient-pairing: deassertion >60s after assertion is treated as a real persistent fault, not transient", () => {
    const s = healthySnapshot();
    const baseMs = Date.now() - 2 * 86_400_000;
    const iso = (offsetSec: number) => new Date(baseMs + offsetSec * 1000).toISOString();
    s.ipmi.sel_events_recent = [
      { id: 1, timestamp: iso(0), sensor: "DIMM_A1", sensor_type: "memory", event: "Uncorrectable ECC", direction: "Asserted", severity: "critical" },
      { id: 2, timestamp: iso(120), sensor: "DIMM_A1", sensor_type: "memory", event: "Uncorrectable ECC", direction: "Deasserted", severity: "critical" },
    ];
    const [a] = alertsOf("ipmi_sel_critical", s);
    expect(a.severity).toBe("critical");
    expect((a.evidence as any).critical_events).toHaveLength(1);
  });
  it("transient-pairing: mixed transient + real fault emits only the real one and reports excluded count", () => {
    const s = healthySnapshot();
    const baseMs = Date.now() - 3 * 86_400_000;
    const iso = (offsetSec: number) => new Date(baseMs + offsetSec * 1000).toISOString();
    s.ipmi.sel_events_recent = [
      // Transient: assert+deassert within 1s.
      { id: 1, timestamp: iso(0), sensor: "Temperature INLET", sensor_type: "temperature", event: "Lower Critical going low", direction: "Asserted", severity: "critical" },
      { id: 2, timestamp: iso(1), sensor: "Temperature INLET", sensor_type: "temperature", event: "Lower Critical going low", direction: "Deasserted", severity: "critical" },
      // Real fault: unmatched assertion.
      { id: 3, timestamp: iso(3600), sensor: "DIMM_A1", sensor_type: "memory", event: "Uncorrectable ECC", direction: "Asserted", severity: "critical" },
    ];
    const [a] = alertsOf("ipmi_sel_critical", s);
    expect((a.evidence as any).critical_events).toHaveLength(1);
    expect((a.evidence as any).critical_events[0].sensor).toBe("DIMM_A1");
    expect((a.evidence as any).transient_pairs_excluded).toBe(1);
  });
});

describe("ipmi_sel_full", () => {
  it("fires on a log-full / logging-disabled Asserted event (the authoritative signal)", () => {
    // The BMC's own "Event Logging Disabled ... Log full ... Asserted"
    // record classifies as info upstream and is dropped by
    // ipmi_sel_critical (severity !== "critical"), so this rule is the
    // only surface for it.
    const s = healthySnapshot();
    s.ipmi.sel_events_recent = [
      { id: 1, timestamp: new Date().toISOString(), sensor: "Event Logging Disabled", sensor_type: "event_logging", event: "Log full", direction: "Asserted", severity: "info" },
    ];
    const [a] = alertsOf("ipmi_sel_full", s);
    expect(a.severity).toBe("warning");
    expect((a.evidence as any).trigger).toBe("log_full_event");
  });
  it("fires on a 'Log area full' Asserted event (vendor phrasing)", () => {
    // Some BMCs phrase the assertion "Log area full" rather than "Log full";
    // the rule's quick_check grep already matches it, so the evaluator must too.
    const s = healthySnapshot();
    s.ipmi.sel_events_recent = [
      { id: 1, timestamp: new Date().toISOString(), sensor: "Event Logging Disabled SEL", sensor_type: "event_logging", event: "Log area full", direction: "Asserted", severity: "info" },
    ];
    const [a] = alertsOf("ipmi_sel_full", s);
    expect(a.severity).toBe("warning");
    expect((a.evidence as any).trigger).toBe("log_full_event");
  });
  it("fires on authoritative SEL fullness (percent/overflow) even at a small entry count (H12)", () => {
    // Grok red-team: a BMC 100% full at its own 512-entry capacity, overflow
    // true. The entry-count heuristic (>=3000) misses it; sel info fullness
    // catches it.
    const s = healthySnapshot();
    s.ipmi.sel_entries_count = 512;
    s.ipmi.sel_percent_used = 100;
    s.ipmi.sel_overflow = true;
    const [a] = alertsOf("ipmi_sel_full", s);
    expect(a.severity).toBe("warning");
    expect((a.evidence as any).trigger).toBe("sel_info_fullness");
    expect((a.evidence as any).sel_overflow).toBe(true);
  });
  it("does NOT fire at low percent with no overflow / event (negative for the new trigger)", () => {
    const s = healthySnapshot();
    s.ipmi.sel_entries_count = 42;
    s.ipmi.sel_percent_used = 8;
    s.ipmi.sel_overflow = false;
    expect(alertsOf("ipmi_sel_full", s)).toHaveLength(0);
  });
  it("fires on the near-full entry-count heuristic (>= 3000)", () => {
    const s = healthySnapshot();
    s.ipmi.sel_entries_count = 3200;
    const [a] = alertsOf("ipmi_sel_full", s);
    expect(a.severity).toBe("warning");
    expect((a.evidence as any).trigger).toBe("entry_count_heuristic");
    expect((a.evidence as any).sel_entries_count).toBe(3200);
  });
  it("does not fire on a normal SEL: low entry count and no log-full event", () => {
    const s = healthySnapshot();
    s.ipmi.sel_entries_count = 42;
    s.ipmi.sel_events_recent = [
      { id: 1, timestamp: new Date().toISOString(), sensor: "DIMM_A1", sensor_type: "memory", event: "Correctable ECC", direction: "Asserted", severity: "info" },
    ];
    expect(alertsOf("ipmi_sel_full", s)).toHaveLength(0);
  });
  it("does not fire on the post-clear Log area reset/cleared event", () => {
    const s = healthySnapshot();
    s.ipmi.sel_entries_count = 1;
    s.ipmi.sel_events_recent = [
      {
        id: 1,
        timestamp: new Date().toISOString(),
        sensor: "Event Logging Disabled SEL",
        sensor_type: "other",
        event: "Log area reset/cleared",
        direction: "Asserted",
        severity: "info",
      },
    ];
    expect(alertsOf("ipmi_sel_full", s)).toHaveLength(0);
  });
  it("capability gate: no fire when IPMI is unavailable", () => {
    const s = healthySnapshot();
    s.ipmi.available = false;
    expect(alertsOf("ipmi_sel_full", s)).toHaveLength(0);
  });
  it("ignores a deasserted log-full event (recovery, not a live blind-spot)", () => {
    const s = healthySnapshot();
    s.ipmi.sel_entries_count = 10;
    s.ipmi.sel_events_recent = [
      { id: 1, timestamp: new Date().toISOString(), sensor: "Event Logging Disabled", sensor_type: "event_logging", event: "Log full", direction: "Deasserted", severity: "info" },
    ];
    expect(alertsOf("ipmi_sel_full", s)).toHaveLength(0);
  });
});

describe("ipmi_monitoring_unavailable", () => {
  // REPOINTED 2026-07-30 to the facts crucible 0.14.9 ships. The trigger is now
  // "this host has a BMC and this snapshot's collection got nothing from it",
  // which is what fit-study gap P1-2 asked for and what the capability reasons
  // could never express. See the rule header for why it moved twice before this.
  function bmc(opts: { node?: string | null; probe?: { status: string; detail?: string } | undefined }) {
    const s = healthySnapshot();
    if (opts.node !== undefined) (s.ipmi as any).bmc_device_node = opts.node;
    if (opts.probe !== undefined) (s.ipmi as any).probe = opts.probe;
    return s;
  }

  it("fires when a BMC is present and this snapshot's probe failed", () => {
    const s = bmc({ node: "/dev/ipmi0", probe: { status: "failed", detail: "wrapped ipmi-sensor probe returned no output" } });
    const [a] = alertsOf("ipmi_monitoring_unavailable", s);
    expect(a.severity).toBe("warning");
    expect(a.title).toContain("unreadable");
    expect((a.evidence as any).bmc_device_node).toBe("/dev/ipmi0");
    expect((a.evidence as any).probe_status).toBe("failed");
    // Must say what stopped being monitored, not merely that a probe failed.
    expect((a.evidence as any).rules_inactive_while_firing).toContain("psu_redundancy_loss");
    // And must name the loss of remote management, which is the operational
    // consequence an operator plans around.
    expect(a.message).toMatch(/remote power/i);
  });

  it("fires even when the one-shot startup capability still says available", () => {
    // This is the whole point of using per-snapshot facts. `detection` is computed
    // once at agent start, so a BMC that dies later leaves it saying available:true
    // forever. A rule keyed on detection could never see this case (review #2).
    const s = bmc({ node: "/dev/ipmi0", probe: { status: "failed" } });
    (s.ipmi as any).detection = { available: true, method: "ipmitool_in_band", ipmitool_version: "1.8.19" };
    const [a] = alertsOf("ipmi_monitoring_unavailable", s);
    expect(a.severity).toBe("warning");
    // The contradictory startup value is surfaced deliberately, so the distinction
    // is legible to whoever reads the alert.
    expect((a.evidence as any).startup_detection).toMatchObject({ available: true });
  });

  it("does not fire when the probe succeeded", () => {
    expect(alertsOf("ipmi_monitoring_unavailable", bmc({ node: "/dev/ipmi0", probe: { status: "ok" } }))).toHaveLength(0);
  });

  it("FIRES on skipped + no_bmc_device, because that contradicts a present device node", () => {
    // Adversarial review 2026-07-30, finding #1: without this the rule was blind
    // to its own purpose. Once a BMC has been unreachable across one hourly
    // capability refresh, the agent stops probing and every later snapshot reports
    // "skipped", so the alert auto-resolved while the BMC was still dead, and a BMC
    // already dead at agent startup never fired at all. An empty probe on a host
    // where the kernel DOES expose an IPMI device is the signal.
    const s = bmc({ node: "/dev/ipmi0", probe: { status: "skipped", detail: "startup capability: no_bmc_device" } });
    (s.ipmi as any).detection = { available: false, reason: "no_bmc_device" };
    const [a] = alertsOf("ipmi_monitoring_unavailable", s);
    expect(a.severity).toBe("warning");
    expect((a.evidence as any).probe_status).toBe("skipped");
  });

  it("does NOT fire on skipped with a host-side tooling reason", () => {
    // permission_denied and no_ipmitool_binary are our own access path or a
    // missing package, not a BMC fault. Firing here would resurrect the v1
    // false-positive class and mislabel the cause.
    for (const reason of ["permission_denied", "no_ipmitool_binary", "ipmitool_cve_2020_5208"]) {
      const s = bmc({ node: "/dev/ipmi0", probe: { status: "skipped", detail: `startup capability: ${reason}` } });
      (s.ipmi as any).detection = { available: false, reason };
      expect(alertsOf("ipmi_monitoring_unavailable", s)).toHaveLength(0);
    }
  });

  it("does not fire on skipped when detection carries no reason at all", () => {
    expect(alertsOf("ipmi_monitoring_unavailable", bmc({ node: "/dev/ipmi0", probe: { status: "skipped" } }))).toHaveLength(0);
  });

  it("does not fire when there is no BMC device node, even if the probe failed", () => {
    // Null means UNDETERMINED, never "no BMC": ipmi_devintf may not be loaded.
    // Requiring positive evidence is what keeps this off VMs and BMC-less
    // hardware, where absent IPMI is the correct steady state. This replaces the
    // earlier dmi.is_virtual guard, since a VM has no /dev/ipmi* at all.
    expect(alertsOf("ipmi_monitoring_unavailable", bmc({ node: null, probe: { status: "failed" } }))).toHaveLength(0);
  });

  it("does not fire on an agent older than 0.14.9 that omits probe entirely", () => {
    // Capability gate. Without `probe` we cannot tell a failed collection from a
    // skipped one, so older agents degrade silently rather than fire fleet-wide.
    const s = bmc({ node: "/dev/ipmi0" });
    expect((s.ipmi as any).probe).toBeUndefined();
    expect(alertsOf("ipmi_monitoring_unavailable", s)).toHaveLength(0);
  });

  it("does not fire merely because ipmitool reads below the CVE floor", () => {
    // REVERSED from v2 on purpose. crucible 0.14.9 no longer blocks on the
    // version, because the check could not tell a distro-backported 1.8.18 from
    // an unpatched one. The advisory rides in the snapshot; it is NOT a rule,
    // because a rule would be guessing at patch state.
    const s = bmc({ node: "/dev/ipmi0", probe: { status: "ok" } });
    (s.ipmi as any).detection = {
      available: true, method: "ipmitool_in_band", ipmitool_version: "1.8.18",
      ipmitool_below_cve_floor: true,
    };
    expect(alertsOf("ipmi_monitoring_unavailable", s)).toHaveLength(0);
  });

  it("does not assert the BMC failed, since a broken wrapper looks identical", () => {
    // Finding #3: runPrivileged collapses a missing wrapper, a revoked sudo grant,
    // a non-zero exit and a timeout into the same empty result as a silent BMC.
    // Deleting the wrapper produced this alert while `ipmitool mc info` and remote
    // management were both fine, so the headline must not name a cause.
    const [a] = alertsOf("ipmi_monitoring_unavailable", bmc({ node: "/dev/ipmi0", probe: { status: "failed" } }));
    expect(a.title).not.toMatch(/not responding|BMC (is )?down|failed/i);
    expect(a.message).toMatch(/access path/i);
    expect(a.message).toMatch(/mc info/);
    // The remote-power consequence must be conditional, not asserted outright.
    expect(a.message).toMatch(/if the BMC itself is down/i);
  });

  it("never tells an operator to reset the BMC blind", () => {
    // An earlier draft's fallback command chain ended in `ipmitool mc reset cold`,
    // contradicting our own /docs/troubleshooting/ipmi guidance. The recommendation
    // may MENTION a cold reset, but only gated on vendor confirmation.
    const [a] = alertsOf("ipmi_monitoring_unavailable", bmc({ node: "/dev/ipmi0", probe: { status: "failed" } }));
    expect(a.recommendation).toMatch(/vendor/i);
    expect(a.recommendation).toMatch(/do not reset it blind/i);
  });
});

describe("cmos_battery_low", () => {
  it("fires when VBAT reads below 2.6V", () => {
    const s = healthySnapshot();
    s.ipmi.sensors = [
      { name: "P_VBAT", value: 2.45, unit: "Volts", status: "ok" },
    ];
    const [a] = alertsOf("cmos_battery_low", s);
    expect(a.severity).toBe("warning");
    expect((a.evidence as any).low_batteries).toHaveLength(1);
    expect((a.evidence as any).low_batteries[0].name).toBe("P_VBAT");
    expect((a.evidence as any).low_batteries[0].value).toBeCloseTo(2.45, 2);
    expect((a.evidence as any).threshold_v).toBe(2.6);
  });
  it("does not fire on healthy VBAT readings (3.0V-ish)", () => {
    const s = healthySnapshot();
    s.ipmi.sensors = [
      { name: "P_VBAT", value: 3.095, unit: "Volts", status: "ok" },
      { name: "VBAT", value: 3.0, unit: "Volts", status: "ok" },
      { name: "CMOS_BAT", value: 3.1, unit: "Volts", status: "ok" },
    ];
    expect(alertsOf("cmos_battery_low", s)).toHaveLength(0);
  });
  it("does not fire on _SCALED variants even if they read below the threshold", () => {
    // P_VBAT_SCALED on Gigabyte MC12-LE0 reports ~1.55V for a 3.1V
    // cell because the reading is voltage-divided. Without the
    // divider ratio we can't compare to 2.6V safely, so the rule
    // ignores _SCALED sensors entirely.
    const s = healthySnapshot();
    s.ipmi.sensors = [
      { name: "P_VBAT_SCALED", value: 1.55, unit: "Volts", status: "ok" },
    ];
    expect(alertsOf("cmos_battery_low", s)).toHaveLength(0);
  });
  it("ignores non-battery voltage sensors below 2.6V (no false positive on ATX rails)", () => {
    // ATX rails routinely sit below 2.6V (1.05V PCH, 1.8V DDR rail
    // ref, etc.). The name allowlist must not catch them.
    const s = healthySnapshot();
    s.ipmi.sensors = [
      { name: "P_1V05_PCH", value: 1.05, unit: "Volts", status: "ok" },
      { name: "P_1V8_PCH_AUX", value: 1.79, unit: "Volts", status: "ok" },
      { name: "VDDCR", value: 1.10, unit: "Volts", status: "ok" },
      { name: "VCORE", value: 1.05, unit: "Volts", status: "ok" },
    ];
    expect(alertsOf("cmos_battery_low", s)).toHaveLength(0);
  });
  it("ignores non-Volts unit sensors with battery-matching names", () => {
    const s = healthySnapshot();
    s.ipmi.sensors = [
      // Discrete-state battery sensor (some BMCs report VBAT as an
      // enum: present, low, etc.) reads as a string value or wrong
      // unit. Defensive skip.
      { name: "VBAT_STATE", value: 0, unit: "discrete", status: "ok" },
    ];
    expect(alertsOf("cmos_battery_low", s)).toHaveLength(0);
  });
  it("fires on multiple low batteries simultaneously (multi-socket boards)", () => {
    const s = healthySnapshot();
    s.ipmi.sensors = [
      { name: "P_VBAT", value: 2.41, unit: "Volts", status: "ok" },
      { name: "CMOS_BAT", value: 2.55, unit: "Volts", status: "ok" },
    ];
    const [a] = alertsOf("cmos_battery_low", s);
    expect((a.evidence as any).low_batteries).toHaveLength(2);
  });
});

describe("os_end_of_life (currency milestone, two-field advisory)", () => {
  // Dates relative to a fixed "now" so the tests are deterministic regardless
  // of when they run.
  const iso = (daysFromNow: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + daysFromNow);
    return d.toISOString().slice(0, 10);
  };
  const seed = (rows: LifecycleRow[]) => setLifecycleCache(rows);

  // An Ubuntu host with the given version + optional support signal.
  const ubuntuSnap = (versionId: string, extActive?: boolean | null) => {
    const s = healthySnapshot();
    s.system.os_id = "ubuntu";
    s.system.os_version_id = versionId;
    s.system.os = "Ubuntu 24.04.4 LTS";
    if (extActive !== undefined) {
      s.support_status = {
        source: "ubuntu-pro",
        extended_support_active: extActive,
        details: extActive ? "Ubuntu Pro attached; esm-infra enabled" : "Ubuntu Pro not attached",
      };
    }
    return s;
  };

  beforeEach(() => __resetLifecycleCacheForTests());

  it("does not fire when comfortably within standard support", () => {
    seed([{ product: "ubuntu", cycle: "24.04", label: "24.04 LTS", eol_from: iso(1200), eoes_from: iso(3000), is_lts: true }]);
    expect(alertsOf("os_end_of_life", ubuntuSnap("24.04.4"))).toHaveLength(0);
  });

  it("does not fire when the cache has no data for the release", () => {
    seed([]); // cold cache
    expect(alertsOf("os_end_of_life", ubuntuSnap("24.04.4", false))).toHaveLength(0);
  });

  it("fires info when standard support ends within 180 days", () => {
    seed([{ product: "ubuntu", cycle: "24.04", label: "24.04 LTS", eol_from: iso(60), eoes_from: iso(2000), is_lts: true }]);
    const [a] = alertsOf("os_end_of_life", ubuntuSnap("24.04.4"));
    expect(a.severity).toBe("info");
    expect(a.message.toLowerCase()).toContain("ends on");
  });

  it("fires WARNING when past standard support and NOT enrolled (extended window open)", () => {
    seed([{ product: "ubuntu", cycle: "24.04", label: "24.04 LTS", eol_from: iso(-30), eoes_from: iso(2000), is_lts: true }]);
    const [a] = alertsOf("os_end_of_life", ubuntuSnap("24.04.4", false));
    expect(a.severity).toBe("warning");
    expect(a.message.toLowerCase()).toContain("not enrolled");
    expect((a.evidence as any).extended_support_active).toBe(false);
  });

  it("fires INFO (reassuring) when past standard support but enrolled in extended support", () => {
    seed([{ product: "ubuntu", cycle: "24.04", label: "24.04 LTS", eol_from: iso(-30), eoes_from: iso(2000), is_lts: true }]);
    const [a] = alertsOf("os_end_of_life", ubuntuSnap("24.04.4", true));
    expect(a.severity).toBe("info");
    expect(a.message.toLowerCase()).toContain("extended security support");
  });

  it("degrades to 'enrollment not verified' warning when the support signal is absent", () => {
    seed([{ product: "ubuntu", cycle: "24.04", label: "24.04 LTS", eol_from: iso(-30), eoes_from: iso(2000), is_lts: true }]);
    // No support_status on the snapshot (older agent / no unprivileged signal).
    const [a] = alertsOf("os_end_of_life", ubuntuSnap("24.04.4"));
    expect(a.severity).toBe("warning");
    expect(a.message.toLowerCase()).toContain("could not be verified");
  });

  it("fires WARNING 'end of life' when past all support (no extended window)", () => {
    seed([{ product: "rocky-linux", cycle: "9", label: "9", eol_from: iso(-10), eoes_from: null, is_lts: false }]);
    const s = healthySnapshot();
    s.system.os_id = "rocky";
    s.system.os_version_id = "9.5";
    s.system.os = "Rocky Linux 9.5";
    const [a] = alertsOf("os_end_of_life", s);
    expect(a.severity).toBe("warning");
    expect(a.message.toLowerCase()).toContain("end of life");
  });

  it("Debian past standard support but within LTS -> INFO 'Debian LTS', not an enrollment warning (Grok H-D4d)", () => {
    // Debian LTS needs no enrollment (unlike Ubuntu Pro / RHEL EUS), so a
    // Debian host in the LTS window is covered by default: info, not warning,
    // and no "confirm Ubuntu Pro enrollment" copy.
    seed([{ product: "debian", cycle: "12", label: "12 (Bookworm)", eol_from: iso(-30), eoes_from: iso(600), is_lts: true }]);
    const s = healthySnapshot();
    s.system.os_id = "debian";
    s.system.os_version_id = "12";
    s.system.os = "Debian GNU/Linux 12 (bookworm)";
    const [a] = alertsOf("os_end_of_life", s);
    expect(a.severity).toBe("info");
    expect(a.title).toContain("Debian LTS");
    expect(a.message.toLowerCase()).not.toContain("could not be verified");
    expect(a.message.toLowerCase()).not.toContain("ubuntu pro");
    expect((a.evidence as any).debian_lts).toBe(true);
    // Codex round-1 #5: must not ASSERT coverage (arch/packages/security-source
    // are unverified) - it tells the operator to verify instead.
    expect(a.recommendation.toLowerCase()).toContain("verify");
    expect((a.evidence as any).coverage_verified).toBe(false);
  });
});

describe("bios_firmware_age (currency milestone, info-only advisory)", () => {
  // healthySnapshot() carries no dmi block, so the base case never fires.
  const bareMetalDmi = (bios_date: string) => ({
    available: true,
    vendor: "Dell Inc.",
    raw_vendor: "Dell Inc.",
    product_name: "PowerEdge R740",
    bios_version: "2.1.0",
    bios_date,
    is_virtual: false,
  });

  it("fires (info) on a bare-metal BIOS older than 24 months", () => {
    const s = healthySnapshot();
    s.dmi = bareMetalDmi("05/01/2020");
    const [a] = alertsOf("bios_firmware_age", s);
    expect(a.severity).toBe("info");
    expect((a.evidence as any).bios_date).toBe("05/01/2020");
    expect((a.evidence as any).age_months).toBeGreaterThanOrEqual(24);
    // Wording must not be a should-update instruction.
    expect(a.message.toLowerCase()).toContain("not a fault");
    expect(a.message.toLowerCase()).toContain("verify");
  });

  it("does not fire when there is no dmi block (base snapshot)", () => {
    expect(alertsOf("bios_firmware_age")).toHaveLength(0);
  });

  it("does not fire on a virtual host even with an old placeholder date", () => {
    const s = healthySnapshot();
    // GCE reports 01/01/2011; is_virtual guards it regardless of age.
    s.dmi = { ...bareMetalDmi("01/01/2011"), is_virtual: true };
    expect(alertsOf("bios_firmware_age", s)).toHaveLength(0);
  });

  it("does not fire on a recent BIOS (within 24 months)", () => {
    const s = healthySnapshot();
    const recent = new Date();
    recent.setUTCMonth(recent.getUTCMonth() - 6);
    const mmddyyyy = `${String(recent.getUTCMonth() + 1).padStart(2, "0")}/01/${recent.getUTCFullYear()}`;
    s.dmi = bareMetalDmi(mmddyyyy);
    expect(alertsOf("bios_firmware_age", s)).toHaveLength(0);
  });

  it("does not fire on an implausible / placeholder year", () => {
    const s = healthySnapshot();
    s.dmi = bareMetalDmi("01/01/1999");
    expect(alertsOf("bios_firmware_age", s)).toHaveLength(0);
  });

  it("does not fire on an unparseable bios_date", () => {
    const s = healthySnapshot();
    s.dmi = bareMetalDmi("0date");
    expect(alertsOf("bios_firmware_age", s)).toHaveLength(0);
  });
});

describe("ipmi_fan_failure", () => {
  it("fires on stopped fan (BMC-flagged critical)", () => {
    // A genuinely stopped numeric fan trips its BMC threshold (cr/nr) or, when
    // the sensor line carries no status code at all, the collector itself
    // parses rpm 0 as critical. Either way it arrives here as status critical.
    const s = healthySnapshot();
    s.ipmi.fans = [
      { name: "Fan1", rpm: 0, status: "critical" },
      { name: "Fan2", rpm: 5000, status: "ok" },
    ];
    expect(alertsOf("ipmi_fan_failure", s)[0].severity).toBe("critical");
  });
  it("fires on zero RPM with a non-ok non-absent status", () => {
    const s = healthySnapshot();
    s.ipmi.fans = [
      { name: "Fan1", rpm: 0, status: "warning" },
      { name: "Fan2", rpm: 5000, status: "ok" },
    ];
    expect(alertsOf("ipmi_fan_failure", s)).toHaveLength(1);
  });
  it("does not fire on a discrete ok sensor with no RPM reading (a validation host phantom)", () => {
    // This test previously asserted the opposite (rpm 0 + ok => fire). Round C
    // disproved it live: discrete PSU fan sensors (ASUS "PSU1 Slow FAN1 ...
    // ok ... Transition to OK") report a state string instead of an RPM, so
    // the collector's rpm defaults to 0 while the BMC says ok. That fired a
    // PERMANENT phantom "2 of 9 fans" that no operator action could clear.
    // The BMC's explicit ok verdict wins over a zero we synthesized.
    const s = healthySnapshot();
    s.ipmi.fans = [
      { name: "PSU1 Slow FAN1", rpm: 0, status: "ok" },
      { name: "PSU2 Slow FAN1", rpm: 0, status: "ok" },
      { name: "FRNT_FAN1", rpm: 14170, status: "ok" },
    ];
    expect(alertsOf("ipmi_fan_failure", s)).toHaveLength(0);
  });
  it("ignores absent fan bay", () => {
    const s = healthySnapshot();
    s.ipmi.fans = [
      { name: "Fan3", rpm: 0, status: "absent" },
      { name: "Fan1", rpm: 5000, status: "ok" },
    ];
    expect(alertsOf("ipmi_fan_failure", s)).toHaveLength(0);
  });
  it("no fire when all fans spinning", () => {
    expect(alertsOf("ipmi_fan_failure")).toHaveLength(0);
  });
});

describe("filesystem_readonly", () => {
  it("fires as a WARNING on a bare mount flag, since a flag is not a diagnosis", () => {
    // collector_version is required now: an agent older than 0.14.11 cannot be
    // trusted about mount options at all (review 2026-07-30 #6).
    // Until 2026-07-30 this asserted "Likely I/O errors or corruption" at CRITICAL
    // from one string, which is how a systemd mount-namespace artifact presented as
    // disk corruption on 19 of 21 hosts. Read-only also has benign causes.
    const s = healthySnapshot();
    s.collector_version = "0.14.12";
    s.disks[0].options = "ro,relatime";
    const [a] = alertsOf("filesystem_readonly", s);
    expect(a.severity).toBe("warning");
    expect(a.message).not.toMatch(/corruption/i);
    expect(a.evidence.kernel_remount_event).toBe(false);
  });

  it("escalates to CRITICAL when the kernel corroborates the remount", () => {
    // The kernel is the authority on "it went read-only because it broke", and a
    // dmesg event is unaffected by any mount namespace.
    const s = healthySnapshot();
    s.collector_version = "0.14.12";
    s.disks[0].options = "ro,relatime";
    s.dmesg_events = {
      available: true,
      events: [{
        event_type: "ext4_remount_readonly",
        timestamp_iso: "2026-07-30T12:00:00Z",
        raw_line: "EXT4-fs (sda1): Remounting filesystem read-only",
        details: { device: "sda1" },
      }],
    } as any;
    const crit = alertsOf("filesystem_readonly", s).filter(a => a.severity === "critical");
    expect(crit.length).toBeGreaterThan(0);
    expect(crit.some(a => a.evidence.kernel_remount_event === true)).toBe(true);
  });
  it("does not fire on errors=remount-ro policy (not actually ro)", () => {
    const s = healthySnapshot();
    s.collector_version = "0.14.12";
    s.disks[0].options = "rw,errors=remount-ro";
    expect(alertsOf("filesystem_readonly", s)).toHaveLength(0);
  });
  it("ignores /boot/efi and proc-like mounts", () => {
    const s = healthySnapshot();
    s.disks = [{ device: "/dev/sda1", mount: "/boot/efi", total_gb: 1, used_gb: 0.1, available_gb: 0.9, percent_used: 10, options: "ro", fstype: "vfat" }];
    expect(alertsOf("filesystem_readonly", s)).toHaveLength(0);
  });
  it("ABSTAINS when the agent flags its mount options as sandbox-derived", () => {
    // 2026-07-30: the agent's own unit sets ProtectSystem=strict, which remounts
    // `/` read-only inside the service's mount namespace. Reading /proc/self/mounts
    // therefore reported `ro` on hosts whose root was writable, and this rule fired
    // CRITICAL on 19 of 21 fleet hosts. Crucible 0.14.11+ reads /proc/1/mounts and
    // sets options_unreliable only when it could not, so the correct response to
    // the flag is silence, not a confident wrong answer.
    const s = healthySnapshot();
    s.collector_version = "0.14.12";
    s.disks[0].options = "ro,relatime";
    s.disks[0].options_unreliable = true;
    expect(alertsOf("filesystem_readonly", s)).toHaveLength(0);
  });
  it("still fires on a genuine ro root from a 0.14.11+ agent, which omits the flag", () => {
    // The namespace fix must not degrade into "never report read-only". Severity is
    // warning rather than critical here on purpose: no kernel event corroborates
    // it, which is a separate deliberate change made the same day.
    const s = healthySnapshot();
    s.collector_version = "0.14.12";
    s.disks[0].options = "ro,relatime";
    delete s.disks[0].options_unreliable;
    const fired = alertsOf("filesystem_readonly", s);
    expect(fired.length).toBeGreaterThan(0);
    expect(fired[0].severity).toBe("warning");
  });
});

describe("inode_high", () => {
  it("warning at 85%+ inode usage", () => {
    const s = healthySnapshot();
    s.disks[0].inodes_used = 26_000_000; // ~86%
    expect(alertsOf("inode_high", s)[0].severity).toBe("warning");
  });
  it("critical at 95%+", () => {
    const s = healthySnapshot();
    s.disks[0].inodes_used = 29_000_000; // ~96.6%
    expect(alertsOf("inode_high", s)[0].severity).toBe("critical");
  });
  it("no fire under 85%", () => {
    expect(alertsOf("inode_high")).toHaveLength(0);
  });
});

describe("clock_drift", () => {
  it("warning between 5s and 60s", () => {
    const s = healthySnapshot();
    s.os_alerts.time_drift_ms = 10_000;
    expect(alertsOf("clock_drift", s)[0].severity).toBe("warning");
  });
  it("critical at 60s+", () => {
    const s = healthySnapshot();
    s.os_alerts.time_drift_ms = 120_000;
    expect(alertsOf("clock_drift", s)[0].severity).toBe("critical");
  });
  it("handles negative drift via abs", () => {
    const s = healthySnapshot();
    s.os_alerts.time_drift_ms = -65_000;
    expect(alertsOf("clock_drift", s)[0].severity).toBe("critical");
  });
  it("no fire under 5s", () => {
    expect(alertsOf("clock_drift")).toHaveLength(0);
  });
});

describe("ssh_root_password", () => {
  it("fires when rootPasswordExposed is true", () => {
    const s = healthySnapshot();
    s.security!.ssh = { permitRootLogin: "yes", passwordAuthentication: "yes", rootPasswordExposed: true };
    expect(alertsOf("ssh_root_password", s)).toHaveLength(1);
  });
  it("no fire when key-only root login", () => {
    expect(alertsOf("ssh_root_password")).toHaveLength(0);
  });
});

describe("ssh_config_unapplied", () => {
  it("fires when the on-disk config is newer than the running daemon", () => {
    const s = healthySnapshot();
    s.security!.ssh = { permitRootLogin: "prohibit-password", passwordAuthentication: "no", rootPasswordExposed: false, configApplied: false, configMtime: 200, configLoadedAt: 100 };
    const out = alertsOf("ssh_config_unapplied", s);
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe("warning");
  });
  it("no fire once the daemon has reloaded (configApplied true)", () => {
    const s = healthySnapshot();
    s.security!.ssh = { permitRootLogin: "prohibit-password", passwordAuthentication: "no", rootPasswordExposed: false, configApplied: true };
    expect(alertsOf("ssh_config_unapplied", s)).toHaveLength(0);
  });
  it("no fire when configApplied is absent (pre-0.13.16 agents)", () => {
    const s = healthySnapshot();
    s.security!.ssh = { permitRootLogin: "yes", passwordAuthentication: "yes", rootPasswordExposed: true };
    expect(alertsOf("ssh_config_unapplied", s)).toHaveLength(0);
  });
});

describe("no_firewall", () => {
  it("fires when firewall inactive", () => {
    const s = healthySnapshot();
    s.security!.firewall = { active: false, source: "none", details: "no firewall" };
    expect(alertsOf("no_firewall", s)).toHaveLength(1);
  });
  it("names the backends the collector actually consulted instead of a fixed list", () => {
    // remote-codex (2026-09-04): the fixed "(checked UFW, firewalld, nftables,
    // iptables)" wording claimed a firewalld check on a host that never had it.
    // Crucible 1.2.3+ puts its own account of the consulted backends in details.
    const s = healthySnapshot();
    s.security!.firewall = { active: false, source: "ufw", details: "checked ufw: inactive; iptables: INPUT chain has no protective verdict" };
    const [alert] = alertsOf("no_firewall", s);
    expect(alert.message).toContain("checked ufw: inactive; iptables: INPUT chain has no protective verdict");
    expect(alert.message).not.toContain("firewalld");
  });
  it("no fire when firewall active", () => {
    expect(alertsOf("no_firewall")).toHaveLength(0);
  });
});

describe("pending_security_updates", () => {
  it("fires on one or more pending updates when auto-updates are OFF", () => {
    const s = healthySnapshot();
    s.security!.pending_updates = { distro: "ubuntu", pendingCount: 1, available: true };
    s.security!.auto_updates = { configured: false, mechanism: "none", details: "not configured" };
    expect(alertsOf("pending_security_updates", s)).toHaveLength(1);
  });
  it("no fire at 0", () => {
    expect(alertsOf("pending_security_updates")).toHaveLength(0);
  });
  it("no fire when not available (unknown distro)", () => {
    const s = healthySnapshot();
    s.security!.pending_updates = { distro: "unknown", pendingCount: 5, available: false };
    expect(alertsOf("pending_security_updates", s)).toHaveLength(0);
  });
  // Noise-reduction: when unattended-upgrades / dnf-automatic is running,
  // pending updates will be applied automatically on their own timer, so
  // paging the user for a condition the OS resolves itself is not useful.
  // The `unattended_upgrades_disabled` rule fires instead when auto-updates
  // are off, which is the case that actually needs user action.
  it("suppressed when auto-updates are configured", () => {
    const s = healthySnapshot();
    s.security!.pending_updates = { distro: "ubuntu", pendingCount: 4, available: true };
    s.security!.auto_updates = { configured: true, mechanism: "unattended-upgrades", details: "active" };
    expect(alertsOf("pending_security_updates", s)).toHaveLength(0);
  });

});

describe("kernel_vulnerabilities", () => {
  it("fires when any vuln is unmitigated", () => {
    const s = healthySnapshot();
    s.security!.kernel_vulns = [{ name: "itlb_multihit", status: "KVM: Mitigation: VMX disabled", mitigated: false }];
    expect(alertsOf("kernel_vulnerabilities", s)).toHaveLength(1);
  });
  it("no fire when all mitigated", () => {
    expect(alertsOf("kernel_vulnerabilities")).toHaveLength(0);
  });

  // Dogfood-loop iteration 4 (2026-05-18): drop to info when ALL
  // unmitigated vulns are running the kernel software mitigation
  // ("Clear CPU buffers attempted"). Customer-facing rationale is
  // that the only remediation is waiting for upstream microcode;
  // not warning-grade actionable.
  it("downgrades to info when all unmitigated vulns have kernel software mitigation engaged", () => {
    const s = healthySnapshot();
    s.security!.kernel_vulns = [
      { name: "tsa", status: "Vulnerable: Clear CPU buffers attempted, no microcode", mitigated: false },
    ];
    const alerts = alertsOf("kernel_vulnerabilities", s);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("info");
    expect(alerts[0].title).toMatch(/kernel software mitigation engaged/);
    expect(alerts[0].evidence?.all_software_mitigated).toBe(true);
  });

  it("stays at warning when any unmitigated vuln has no kernel mitigation", () => {
    const s = healthySnapshot();
    s.security!.kernel_vulns = [
      // AMD tsa with software mitigation engaged
      { name: "tsa", status: "Vulnerable: Clear CPU buffers attempted, no microcode", mitigated: false },
      // Intel Downfall with NO software mitigation available
      { name: "gather_data_sampling", status: "Vulnerable", mitigated: false },
    ];
    const alerts = alertsOf("kernel_vulnerabilities", s);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("warning");
    expect(alerts[0].evidence?.all_software_mitigated).toBe(false);
  });

  it("stays at warning when a single vuln has no software mitigation phrasing", () => {
    const s = healthySnapshot();
    s.security!.kernel_vulns = [
      { name: "gather_data_sampling", status: "Vulnerable", mitigated: false },
    ];
    const alerts = alertsOf("kernel_vulnerabilities", s);
    expect(alerts[0].severity).toBe("warning");
  });

  // Cycle 3 iteration (2026-05-21): extend the software-mitigation
  // phrase list. AMD SRSO ("Safe RET") and legacy spectre_v2
  // ("Retpoline") are functionally the same case as TSA — kernel
  // doing the work that microcode would, customer can't do anything
  // until upstream microcode ships. Discovered on val-L4 (AMD EPYC):
  // tsa downgrades to info but srso stayed warning, so a host with
  // both running software mitigation still fired warning.
  it("downgrades to info on AMD SRSO (Safe RET) kernel software mitigation", () => {
    const s = healthySnapshot();
    s.security!.kernel_vulns = [
      { name: "spec_rstack_overflow", status: "Vulnerable: Safe RET, no microcode", mitigated: false },
    ];
    const alerts = alertsOf("kernel_vulnerabilities", s);
    expect(alerts[0].severity).toBe("info");
    expect(alerts[0].evidence?.all_software_mitigated).toBe(true);
  });

  it("downgrades to info on combined AMD TSA + SRSO (val-L4 actual case)", () => {
    const s = healthySnapshot();
    s.security!.kernel_vulns = [
      { name: "tsa", status: "Vulnerable: Clear CPU buffers attempted, no microcode", mitigated: false },
      { name: "spec_rstack_overflow", status: "Vulnerable: Safe RET, no microcode", mitigated: false },
    ];
    const alerts = alertsOf("kernel_vulnerabilities", s);
    expect(alerts[0].severity).toBe("info");
  });

  it("downgrades to info on legacy retpoline spectre_v2 software mitigation", () => {
    const s = healthySnapshot();
    s.security!.kernel_vulns = [
      { name: "spectre_v2", status: "Mitigation: Retpolines, IBPB", mitigated: false },
    ];
    const alerts = alertsOf("kernel_vulnerabilities", s);
    expect(alerts[0].severity).toBe("info");
  });

  // Per-vuln message + operator_action evidence (added 2026-05-22).
  // Message format: one bullet per unmitigated vuln with state hint;
  // operator_action = "ack_vendor_side" if every vuln is vendor-side
  // (microcode pending), "review" if any is operator-actionable.

  it("emits per_vuln evidence with state + hint for each unmitigated vuln", () => {
    const s = healthySnapshot();
    s.security!.kernel_vulns = [
      { name: "tsa", status: "Vulnerable: Clear CPU buffers attempted, no microcode", mitigated: false },
      { name: "gather_data_sampling", status: "Vulnerable", mitigated: false },
    ];
    const alerts = alertsOf("kernel_vulnerabilities", s);
    const pv = alerts[0].evidence?.per_vuln as Array<{ name: string; state: string; hint: string }>;
    expect(pv).toHaveLength(2);
    expect(pv[0].name).toBe("tsa");
    expect(pv[0].state).toBe("software_engaged");
    expect(pv[0].hint).toContain("AMD");
    expect(pv[1].name).toBe("gather_data_sampling");
    expect(pv[1].state).toBe("actionable");
    expect(pv[1].hint).toContain("microcode");
  });

  it("renders message with multi-line per-vuln bullets in the agreed format", () => {
    const s = healthySnapshot();
    s.security!.kernel_vulns = [
      { name: "tsa", status: "Vulnerable: Clear CPU buffers attempted, no microcode", mitigated: false },
    ];
    const alerts = alertsOf("kernel_vulnerabilities", s);
    expect(alerts[0].message).toMatch(/^Unmitigated CPU vulnerabilities:\n/);
    expect(alerts[0].message).toContain("• tsa: Vulnerable: Clear CPU buffers attempted, no microcode");
    expect(alerts[0].message).toContain("[software band-aid engaged");
  });

  it("sets operator_action=ack_vendor_side only when every vuln has a software band-aid engaged", () => {
    const s = healthySnapshot();
    s.security!.kernel_vulns = [
      { name: "tsa", status: "Vulnerable: Clear CPU buffers attempted, no microcode", mitigated: false },
      { name: "spec_rstack_overflow", status: "Vulnerable: Safe RET, no microcode", mitigated: false },
    ];
    const alerts = alertsOf("kernel_vulnerabilities", s);
    expect(alerts[0].evidence?.operator_action).toBe("ack_vendor_side");
  });

  it("sets operator_action=review when at least one unmitigated vuln is actionable", () => {
    const s = healthySnapshot();
    s.security!.kernel_vulns = [
      { name: "tsa", status: "Vulnerable: Clear CPU buffers attempted, no microcode", mitigated: false },
      { name: "made_up_vuln", status: "Vulnerable: Update kernel package", mitigated: false },
    ];
    const alerts = alertsOf("kernel_vulnerabilities", s);
    expect(alerts[0].evidence?.operator_action).toBe("review");
    const pv = alerts[0].evidence?.per_vuln as Array<{ name: string; state: string }>;
    const actionable = pv.find((p) => p.name === "made_up_vuln");
    expect(actionable?.state).toBe("actionable");
  });

  // 2026-07-03: "Vulnerable: No microcode" and bare "Vulnerable" are
  // ACTIONABLE (update the microcode package + reboot), NOT vendor-side.
  // sysfs "No microcode" means the loaded microcode lacks the mitigation,
  // not that the vendor shipped no fix. Regression lock for the blind-
  // remediation finding (Intel GDS was fixable but the alert said ACK).
  it("classifies bare-Vulnerable and No-microcode as actionable, not vendor-side", () => {
    const s = healthySnapshot();
    s.security!.kernel_vulns = [
      { name: "gather_data_sampling", status: "Vulnerable: No microcode", mitigated: false },
      { name: "spectre_v2", status: "Vulnerable", mitigated: false },
    ];
    const alerts = alertsOf("kernel_vulnerabilities", s);
    const pv = alerts[0].evidence?.per_vuln as Array<{ name: string; state: string }>;
    expect(pv[0].state).toBe("actionable");
    expect(pv[1].state).toBe("actionable");
    expect(alerts[0].evidence?.operator_action).toBe("review");
    expect(alerts[0].severity).toBe("warning");
  });
});

describe("kernel_needs_reboot", () => {
  it("fires when needsReboot is true", () => {
    const s = healthySnapshot();
    s.security!.kernel_reboot = { running: "6.8.0-107", installed: "6.8.0-108", needsReboot: true };
    expect(alertsOf("kernel_needs_reboot", s)).toHaveLength(1);
  });
  it("no fire when up to date", () => {
    expect(alertsOf("kernel_needs_reboot")).toHaveLength(0);
  });
  // The collector sets needsReboot from a string inequality, so it also fires
  // when the running kernel is NEWER than apt's newest installed one (a host
  // booted on a mainline linux-image-unsigned-* kernel the collector cannot
  // see). A reboot cannot clear that, so the rule must not fire.
  it("no fire when the running kernel is newer than the installed one", () => {
    const s = healthySnapshot();
    s.security!.kernel_reboot = {
      running: "6.10.0-061000-generic",
      installed: "6.8.0-136-generic",
      needsReboot: true,
    };
    expect(alertsOf("kernel_needs_reboot", s)).toHaveLength(0);
  });
  it("compares numerically, not as strings (6.10 outranks 6.8)", () => {
    const s = healthySnapshot();
    // A plain string compare would rank "6.8" above "6.10" and fire here.
    s.security!.kernel_reboot = { running: "6.10.0-1", installed: "6.8.0-9", needsReboot: true };
    expect(alertsOf("kernel_needs_reboot", s)).toHaveLength(0);
  });
  it("still fires when the installed kernel is genuinely newer", () => {
    const s = healthySnapshot();
    s.security!.kernel_reboot = {
      running: "6.8.0-124-generic",
      installed: "6.8.0-136-generic",
      needsReboot: true,
    };
    expect(alertsOf("kernel_needs_reboot", s)).toHaveLength(1);
  });
  it("falls back to the collector when a version is unparseable", () => {
    const s = healthySnapshot();
    s.security!.kernel_reboot = { running: "unknown", installed: "unknown", needsReboot: true };
    expect(alertsOf("kernel_needs_reboot", s)).toHaveLength(1);
  });
});

describe("unattended_upgrades_disabled", () => {
  it("fires when auto updates not configured", () => {
    const s = healthySnapshot();
    s.security!.auto_updates = { configured: false, mechanism: "unattended-upgrades", details: "package installed but service not active" };
    expect(alertsOf("unattended_upgrades_disabled", s)).toHaveLength(1);
  });
  it("no fire when configured", () => {
    expect(alertsOf("unattended_upgrades_disabled")).toHaveLength(0);
  });
});

describe("disk_io_errors", () => {
  it("fires critical on any I/O errors", () => {
    const s = healthySnapshot();
    s.io_errors = { count: 3, devices: ["sdb"] };
    expect(alertsOf("disk_io_errors", s)[0].severity).toBe("critical");
  });
  it("no fire at 0", () => {
    expect(alertsOf("disk_io_errors")).toHaveLength(0);
  });
  it("joins kernel-log device names to SMART identity (affected_drives)", () => {
    // Provider-facing surfaces (ticket drafts) need the physical unit, not
    // the node name; the evaluator resolves it from the SMART inventory.
    const s = healthySnapshot();
    s.io_errors = { count: 3, devices: ["sdb"] };
    s.smart = [
      { device: "/dev/sda", model: "OTHER", serial: "AAA" },
      { device: "/dev/sdb", model: "CT500MX500SSD1", serial: "2315E6C685B0", firmware: "M3CR046" },
    ] as any;
    const a = alertsOf("disk_io_errors", s)[0];
    expect(a.evidence.affected_drives).toEqual([
      { device: "/dev/sdb", model: "CT500MX500SSD1", serial: "2315E6C685B0", firmware: "M3CR046" },
    ]);
  });
  it("matches partitions to their disk but never similar-named siblings", () => {
    const s = healthySnapshot();
    s.io_errors = { count: 1, devices: ["sda1"] };
    s.smart = [
      { device: "/dev/sdaa", model: "WRONG", serial: "W" },
      { device: "/dev/sda", model: "RIGHT", serial: "R" },
    ] as any;
    const a = alertsOf("disk_io_errors", s)[0];
    const drives = a.evidence.affected_drives as Array<{ model?: string }>;
    expect(drives).toHaveLength(1);
    expect(drives[0].model).toBe("RIGHT");
  });
});

describe("zfs_pool_unhealthy", () => {
  it("fires warning on DEGRADED", () => {
    const s = healthySnapshot();
    s.zfs!.pools[0].state = "DEGRADED";
    expect(alertsOf("zfs_pool_unhealthy", s)[0].severity).toBe("warning");
  });
  it("fires critical on FAULTED", () => {
    const s = healthySnapshot();
    s.zfs!.pools[0].state = "FAULTED";
    expect(alertsOf("zfs_pool_unhealthy", s)[0].severity).toBe("critical");
  });
  it("no fire on ONLINE", () => {
    expect(alertsOf("zfs_pool_unhealthy")).toHaveLength(0);
  });
});

describe("zfs_scrub_errors", () => {
  it("fires on scrub errors > 0", () => {
    const s = healthySnapshot();
    s.zfs!.pools[0].scrub_errors = 5;
    expect(alertsOf("zfs_scrub_errors", s)).toHaveLength(1);
  });
  it("fires INFO (advisory, not a fault) when never scrubbed (Codex/H-D4i)", () => {
    const s = healthySnapshot();
    s.zfs!.pools[0].scrub_never_run = true;
    s.zfs!.pools[0].last_scrub_date = undefined;
    const [a] = alertsOf("zfs_scrub_errors", s);
    expect(a.severity).toBe("info");
    expect(a.message.toLowerCase()).toContain("just created");
  });
  it("fires when last scrub > 30 days ago", () => {
    const s = healthySnapshot();
    s.zfs!.pools[0].last_scrub_date = new Date(Date.now() - 45 * 24 * 3600 * 1000).toISOString();
    expect(alertsOf("zfs_scrub_errors", s)).toHaveLength(1);
  });
  it("no fire on a recent clean scrub", () => {
    expect(alertsOf("zfs_scrub_errors")).toHaveLength(0);
  });
});

describe("conntrack_exhaustion", () => {
  // 2026-05-18 audit TUNE: thresholds bumped 75/90 -> 80/95 per
  // HashiCorp KB vendor-anchor.
  it("warning at 80%+", () => {
    const s = healthySnapshot();
    s.conntrack = { available: true, count: 210_000, max: 262_144, percent: 81 };
    expect(alertsOf("conntrack_exhaustion", s)[0].severity).toBe("warning");
  });
  it("critical at 95%+", () => {
    const s = healthySnapshot();
    s.conntrack = { available: true, count: 250_000, max: 262_144, percent: 96 };
    expect(alertsOf("conntrack_exhaustion", s)[0].severity).toBe("critical");
  });
  it("no fire when not available", () => {
    const s = healthySnapshot();
    s.conntrack = { available: false, count: 0, max: 0, percent: 0 };
    expect(alertsOf("conntrack_exhaustion", s)).toHaveLength(0);
  });
});

describe("systemd_service_failed", () => {
  it("fires critical with failed units", () => {
    const s = healthySnapshot();
    s.systemd = { failed_units: ["nginx.service", "foo.service"], failed_count: 2 };
    expect(alertsOf("systemd_service_failed", s)[0].severity).toBe("critical");
  });
  it("no fire at 0", () => {
    expect(alertsOf("systemd_service_failed")).toHaveLength(0);
  });
  it("evidence.journal_excerpts maps every failed unit, with Crucible-supplied lines when present", () => {
    const s = healthySnapshot();
    s.systemd = {
      failed_units: ["fail2ban.service", "nginx.service"],
      failed_count: 2,
      journal_excerpts: {
        "fail2ban.service": ["Have not found any log file for sshd jail", "Async configuration of server failed"],
        "nginx.service": [],
      },
    };
    const [a] = alertsOf("systemd_service_failed", s);
    const j = (a.evidence as any).journal_excerpts as Record<string, string[]>;
    expect(j["fail2ban.service"][0]).toMatch(/sshd jail/);
    expect(j["nginx.service"]).toEqual([]);
  });
  it("evidence.journal_excerpts is empty per-unit when Crucible omits the field (pre-0.9.2 agents)", () => {
    const s = healthySnapshot();
    s.systemd = { failed_units: ["nginx.service"], failed_count: 1 };
    const [a] = alertsOf("systemd_service_failed", s);
    const j = (a.evidence as any).journal_excerpts as Record<string, string[]>;
    expect(j["nginx.service"]).toEqual([]);
  });
  // Phase 2 validation finding 2026-05-29: the evidence-baked fix_commands
  // ended in `sudo systemctl restart <unit>`, but for one-shot / transient
  // units (the `iperf3-test.service` artifact on val-gigabyte-mz62hd is
  // the canonical case) restart is wrong: the unit has already exited
  // and there's nothing to restart. Append a commented reset-failed line
  // so an operator reading the alert card sees the transient-unit path.
  it("evidence.fix_commands include the reset-failed transient-unit hint", () => {
    const s = healthySnapshot();
    s.systemd = { failed_units: ["iperf3-test.service"], failed_count: 1 };
    const [a] = alertsOf("systemd_service_failed", s);
    const cmds = (a.evidence as any).fix_commands as string[];
    expect(cmds.join("\n")).toContain("reset-failed iperf3-test.service");
  });
  // Grok H-D4k: a failed .mount unit is not fixed by "restart"; the fix is
  // `mount` after correcting the cause.
  it("fix_commands for a .mount unit use mount, not restart", () => {
    const s = healthySnapshot();
    s.systemd = { failed_units: ["boot-efi.mount"], failed_count: 1 };
    const [a] = alertsOf("systemd_service_failed", s);
    const cmds = (a.evidence as any).fix_commands as string[];
    const joined = cmds.join("\n");
    expect(joined).toContain("sudo mount");
    expect(joined).toContain("systemctl show boot-efi.mount -p Where");
    expect(joined).not.toContain("systemctl restart boot-efi.mount");
  });
});

describe("ntp_not_synced", () => {
  // Matrix covers the four (daemon_running, synced) combinations plus extras.
  it("(4) daemon_running=true, synced=true -> no alert", () => {
    expect(alertsOf("ntp_not_synced")).toHaveLength(0);
  });
  it("(1) daemon_running=false, synced=true -> warning (daemon stopped, clock still accurate)", () => {
    const s = healthySnapshot();
    s.ntp = { synced: true, offset_seconds: 0.001, source: "systemd-timesyncd", daemon_running: false, daemon_name: "" };
    const [a] = alertsOf("ntp_not_synced", s);
    expect(a).toBeDefined();
    expect(a.severity).toBe("warning");
    expect(a.title).toContain("drift");
  });
  it("(3) daemon_running=true, synced=false -> critical (clock drifting despite daemon)", () => {
    const s = healthySnapshot();
    s.ntp = { synced: false, offset_seconds: 5, source: "chrony", daemon_running: true, daemon_name: "chrony" };
    const [a] = alertsOf("ntp_not_synced", s);
    expect(a).toBeDefined();
    expect(a.severity).toBe("critical");
    expect(a.title).toContain("not synchronized");
  });
  it("(2) daemon_running=false, synced=false -> critical", () => {
    const s = healthySnapshot();
    s.ntp = { synced: false, offset_seconds: 0, source: "none", daemon_running: false, daemon_name: "" };
    const [a] = alertsOf("ntp_not_synced", s);
    expect(a).toBeDefined();
    expect(a.severity).toBe("critical");
    expect(a.title).toContain("not synchronized");
  });
});

describe("swap_high", () => {
  it("warning at 50%+", () => {
    const s = healthySnapshot();
    s.memory.swap_used_mb = Math.round(s.memory.swap_total_mb * 0.6);
    expect(alertsOf("swap_high", s)[0].severity).toBe("warning");
  });
  it("critical at 80%+", () => {
    const s = healthySnapshot();
    s.memory.swap_used_mb = Math.round(s.memory.swap_total_mb * 0.9);
    expect(alertsOf("swap_high", s)[0].severity).toBe("critical");
  });
  it("no fire with no swap configured", () => {
    const s = healthySnapshot();
    s.memory.swap_total_mb = 0;
    s.memory.swap_used_mb = 0;
    expect(alertsOf("swap_high", s)).toHaveLength(0);
  });
});

describe("fd_exhaustion", () => {
  it("warning at 80%+", () => {
    const s = healthySnapshot();
    s.file_descriptors = { allocated: 820_000, free: 180_000, max: 1_000_000, percent: 82 };
    expect(alertsOf("fd_exhaustion", s)[0].severity).toBe("warning");
  });
  it("critical at 95%+", () => {
    const s = healthySnapshot();
    s.file_descriptors = { allocated: 960_000, free: 40_000, max: 1_000_000, percent: 96 };
    expect(alertsOf("fd_exhaustion", s)[0].severity).toBe("critical");
  });
  it("no fire under 80%", () => {
    expect(alertsOf("fd_exhaustion")).toHaveLength(0);
  });
});

describe("unexpected_reboot (evaluateUnexpectedReboot)", () => {
  const now = 1_700_000_000_000; // arbitrary ms

  it("fires at warning when uptime detection has no kernel corroboration", () => {
    // 2026-05-19 C1-C6 deferred TUNES: uptime-only detection now warns
    // (lower-signal). Kernel-corroborated detection escalates to
    // critical. See evaluator.ts evaluateUnexpectedReboot.
    const snap = healthySnapshot();
    snap.system.uptime_seconds = 120; // 2 minutes
    const prevUptime = 7 * 24 * 3600; // 1 week
    const prevTs = now - 5 * 60 * 1000; // 5 min ago
    const alert = evaluateUnexpectedReboot(snap, prevUptime, prevTs, false, now);
    expect(alert).not.toBeNull();
    expect(alert!.severity).toBe("warning");
    expect(alert!.title).toContain("rebooted unexpectedly");
  });

  it("escalates to critical when reboot_evidence corroborates the reboot", () => {
    const snap = healthySnapshot();
    snap.system.uptime_seconds = 120;
    snap.reboot_evidence = {
      pstore_present: true,
      pstore_record_count: 1,
      vmcore_present: false,
      wtmp_reboot_record: null,
      prior_shutdown_clean: false,
    };
    const prevUptime = 7 * 24 * 3600;
    const prevTs = now - 5 * 60 * 1000;
    const alert = evaluateUnexpectedReboot(snap, prevUptime, prevTs, false, now);
    expect(alert).not.toBeNull();
    expect(alert!.severity).toBe("critical");
    expect(alert!.title).toContain("kernel crash");
    expect(hasCleanRebootEvidence({ reboot_evidence: snap.reboot_evidence })).toBe(false);
    const sigs = (alert!.evidence as { detection_signals?: { via_pstore?: boolean } })
      .detection_signals;
    expect(sigs?.via_pstore).toBe(true);
  });

  it("does not fire for a reboot with a recorded clean shutdown", () => {
    const snap = healthySnapshot();
    snap.system.uptime_seconds = 120;
    snap.reboot_evidence = {
      pstore_present: false,
      pstore_record_count: 0,
      vmcore_present: false,
      wtmp_reboot_record: "reboot   system boot",
      prior_shutdown_clean: true,
    };
    const prevUptime = 7 * 24 * 3600;
    const prevTs = now - 5 * 60 * 1000;
    expect(evaluateUnexpectedReboot(snap, prevUptime, prevTs, false, now)).toBeNull();
    expect(isCleanIntentionalReboot(snap, prevUptime, prevTs, now)).toBe(true);
    expect(hasCleanRebootEvidence({ reboot_evidence: snap.reboot_evidence })).toBe(true);
  });

  it("returns null when uptime > 10 minutes", () => {
    const snap = healthySnapshot();
    snap.system.uptime_seconds = 3600; // 1 hour
    const prevUptime = 7 * 24 * 3600;
    const prevTs = now - 5 * 60 * 1000;
    expect(evaluateUnexpectedReboot(snap, prevUptime, prevTs, false, now)).toBeNull();
  });

  it("returns null when an active reboot alert already exists", () => {
    const snap = healthySnapshot();
    snap.system.uptime_seconds = 60;
    const prevUptime = 7 * 24 * 3600;
    const prevTs = now - 5 * 60 * 1000;
    expect(evaluateUnexpectedReboot(snap, prevUptime, prevTs, true, now)).toBeNull();
  });

  it("returns null when prevUptime/prevTs missing", () => {
    const snap = healthySnapshot();
    snap.system.uptime_seconds = 60;
    expect(evaluateUnexpectedReboot(snap, null, null, false, now)).toBeNull();
  });

  it("registered type fires zero alerts in the main evaluator (handled separately)", () => {
    expect(alertsOf("unexpected_reboot")).toHaveLength(0);
  });
});

describe("muted rules", () => {
  it("skips muted rule types", () => {
    const s = healthySnapshot();
    s.memory.used_mb = Math.round(s.memory.total_mb * 0.97);
    const alerts = evaluateAlerts(s, { muted_rules: ["ram_high"] });
    expect(alerts.some((a) => a.type === "ram_high")).toBe(false);
  });
});

describe("io_pressure_high (2026-05-20 campaign cycle 2, NVMe-friendly companion to cpu_iowait_high)", () => {
  function withPsiIo(s: ReturnType<typeof healthySnapshot>, avg10: number) {
    s.psi = { ...(s.psi ?? {}), io: { some: { avg10: avg10, avg60: avg10, avg300: avg10, total: 0 }, full: { avg10: avg10, avg60: avg10, avg300: avg10, total: 0 } } };
    return s;
  }

  it("does not fire below 10% PSI io.full.avg10", () => {
    const s = withPsiIo(healthySnapshot(), 5);
    s.io_latency = [{ device: "nvme0n1", avg_read_latency_ms: 100, avg_write_latency_ms: 100, read_iops: 0, write_iops: 0 }];
    expect(alertsOf("io_pressure_high", s)).toHaveLength(0);
  });

  it("does not fire on PSI alone without corroborator (NVMe normal)", () => {
    const s = withPsiIo(healthySnapshot(), 15);
    // No slow devices, no I/O errors, iowait under 5%.
    s.io_latency = [{ device: "nvme0n1", avg_read_latency_ms: 1, avg_write_latency_ms: 1, read_iops: 0, write_iops: 0 }];
    s.cpu.iowait_percent = 1;
    expect(alertsOf("io_pressure_high", s)).toHaveLength(0);
  });

  it("fires warning on PSI + slow-device corroborator", () => {
    const s = withPsiIo(healthySnapshot(), 15);
    s.io_latency = [{ device: "sda", avg_read_latency_ms: 80, avg_write_latency_ms: 5, read_iops: 0, write_iops: 0 }];
    const [a] = alertsOf("io_pressure_high", s);
    expect(a).toBeDefined();
    expect(a.severity).toBe("warning");
    expect((a.evidence.slow_devices as unknown[]).length).toBe(1);
  });

  it("fires warning on PSI + moderate iowait corroborator (>= 5%)", () => {
    const s = withPsiIo(healthySnapshot(), 12);
    s.cpu.iowait_percent = 8;
    const [a] = alertsOf("io_pressure_high", s);
    expect(a).toBeDefined();
    expect(a.evidence.iowait_percent).toBe(8);
  });

  it("fires warning on PSI + recent I/O errors corroborator", () => {
    const s = withPsiIo(healthySnapshot(), 12);
    s.io_errors = { count: 3, devices: ["sda"] };
    const [a] = alertsOf("io_pressure_high", s);
    expect(a).toBeDefined();
    expect(a.evidence.io_errors_count).toBe(3);
  });
});

describe("evaluator fault tolerance", () => {
  it("one rule throwing does not block others", () => {
    const s = healthySnapshot();
    // Force the interface rule to throw by giving network an object that isn't iterable
    // but still have another rule fire so we can assert ordering survived.
    (s as unknown as { network: unknown }).network = { boom: true };
    s.os_alerts.oom_kills_recent = 1;
    const alerts = evaluateAlerts(clone(s));
    expect(alerts.some((a) => a.type === "oom_kills")).toBe(true);
  });
});

// R-P2-2 (val-fleet campaign 2026-05-29): every vendor-side physical
// rule's recommendation must carry the ownership-branch note so a reader
// who cannot physically service the chassis (rented / provider-managed)
// still has an actionable path. One regression test per affected rule;
// catches a refactor that drops the shared OWNERSHIP_REMEDIATION_NOTE.
describe("ownership-branch remediation note (R-P2-2)", () => {
  const NOTE_MARK = "file a hardware service ticket with your provider";

  it("cpu_temperature_high (vendor-side path, not load-correlated)", () => {
    const s = healthySnapshot();
    s.thermal = { available: true, source: "coretemp", max_cpu_celsius: 92 };
    s.ipmi.sensors = [];
    // default idle_percent 86 -> 14% util -> NOT load-correlated -> vendor-side path
    const a = alertsOf("cpu_temperature_high", s, { cpu_temp_warning_c: 85, cpu_temp_critical_c: 95 });
    expect(a[0].recommendation).toContain(NOTE_MARK);
  });

  it("ipmi_fan_failure", () => {
    const s = healthySnapshot();
    s.ipmi.fans = [
      { name: "Fan1", rpm: 0, status: "critical" },
      { name: "Fan2", rpm: 5000, status: "ok" },
    ];
    expect(alertsOf("ipmi_fan_failure", s)[0].recommendation).toContain(NOTE_MARK);
  });

  it("psu_redundancy_loss", () => {
    const s = healthySnapshot();
    s.ipmi.psu_redundancy_state = "redundancy_lost";
    expect(alertsOf("psu_redundancy_loss", s)[0].recommendation).toContain(NOTE_MARK);
  });

  it("smart_failing", () => {
    const s = healthySnapshot();
    s.smart[0].health = "FAILED";
    expect(alertsOf("smart_failing", s)[0].recommendation).toContain(NOTE_MARK);
  });

  it("raid_degraded (software md)", () => {
    const s = healthySnapshot();
    s.raid[0].degraded = true;
    s.raid[0].failed_disks = ["sdb"];
    expect(alertsOf("raid_degraded", s)[0].recommendation).toContain(NOTE_MARK);
  });

  it("ecc_errors (uncorrectable)", () => {
    const s = healthySnapshot();
    s.ipmi.ecc_errors = { correctable: 0, uncorrectable: 1 };
    expect(alertsOf("ecc_errors", s)[0].recommendation).toContain(NOTE_MARK);
  });

  it("nvme_critical_warning", () => {
    const s = healthySnapshot();
    s.smart = [
      {
        device: "/dev/nvme0",
        model: "INTEL SSDPE2KX020T8",
        health: "PASSED",
        critical_warning_raw: 0x08,
        critical_warning_decoded: {
          available_spare_low: false,
          temperature_threshold: false,
          reliability_degraded: false,
          read_only: true,
          volatile_memory_backup_failed: false,
          persistent_memory_readonly: false,
        },
      } as any,
    ];
    expect(alertsOf("nvme_critical_warning", s)[0].recommendation).toContain(NOTE_MARK);
  });
});

// R-P2-4 (val-fleet campaign 2026-05-29): mem_pressure_high was the only
// synthesize-only rule with ZERO behavioral coverage — no test exercised
// its predicate, and its YAML provenance falsely claimed "PSI synthetic
// test fixtures" that did not exist. This block is that fixture. The rule
// fires only when PSI memory.full.avg10 > 10% AND a corroborator is
// present (active swap-in via vmstat.pswpin_rate, or a recent OOM kill);
// PSI-high alone must NOT fire (the corroboration gate is the whole point,
// distinguishing genuine pressure from transient PSI spikes).
//
// Subordination note: mem_pressure_high declares `subordinate_to:
// oom_kills`. That demotion is an ingest-path concern (routeAlertEmission
// over active_alerts rows) and is covered generically in
// subordination.test.ts — NOT in evaluateAlerts(), which is why the
// oom-corroborated case below still shows both rules firing here.
describe("mem_pressure_high (PSI + corroborator) — R-P2-4 behavioral fixture", () => {
  const psi = (avg10: number) => ({ memory: { some: { avg10, avg60: avg10, avg300: avg10, total: 0 }, full: { avg10, avg60: avg10, avg300: avg10, total: 0 } } });

  it("fires (warning) when PSI full.avg10 > 10% with active swap-in", () => {
    const s = healthySnapshot();
    (s as any).psi = psi(15);
    (s as any).vmstat = { pswpin_total: 100, pswpout_total: 0, pswpin_rate: 12, pswpout_rate: 0 };
    const a = alertsOf("mem_pressure_high", s);
    expect(a).toHaveLength(1);
    expect(a[0].severity).toBe("warning");
    expect((a[0].evidence as any).pswpin_active).toBe(true);
  });

  it("fires when PSI full.avg10 > 10% with a recent OOM kill (oom corroborator)", () => {
    const s = healthySnapshot();
    (s as any).psi = psi(20);
    s.os_alerts.oom_kills_recent = 1;
    const a = alertsOf("mem_pressure_high", s);
    expect(a).toHaveLength(1);
    expect((a[0].evidence as any).oom_recent).toBe(true);
    // oom_kills also fires here; ingest-path subordination (tested in
    // subordination.test.ts) demotes mem_pressure_high under it downstream.
    expect(alertsOf("oom_kills", s).length).toBe(1);
  });

  it("does NOT fire when PSI is high but no corroborator is present", () => {
    const s = healthySnapshot();
    (s as any).psi = psi(40); // very high PSI
    (s as any).vmstat = { pswpin_total: 0, pswpout_total: 0, pswpin_rate: 0, pswpout_rate: 0 };
    s.os_alerts.oom_kills_recent = 0;
    expect(alertsOf("mem_pressure_high", s)).toHaveLength(0);
  });

  it("does NOT fire when PSI full.avg10 is at/below the 10% threshold", () => {
    const s = healthySnapshot();
    (s as any).psi = psi(8);
    (s as any).vmstat = { pswpin_total: 100, pswpout_total: 0, pswpin_rate: 12, pswpout_rate: 0 };
    expect(alertsOf("mem_pressure_high", s)).toHaveLength(0);
  });

  it("does NOT fire on a pre-PSI agent (no psi.memory.full)", () => {
    const s = healthySnapshot();
    (s as any).vmstat = { pswpin_total: 100, pswpout_total: 0, pswpin_rate: 12, pswpout_rate: 0 };
    expect(alertsOf("mem_pressure_high", s)).toHaveLength(0);
  });
});

describe("filesystem_readonly: adversarial review 2026-07-30 round 3", () => {
  const ev = (device: string) => ({
    available: true,
    events: [{ event_type: "ext4_remount_readonly", timestamp_iso: "2026-07-30T12:00:00Z", raw_line: `EXT4-fs (${device}): Remounting filesystem read-only`, details: { device } }],
  }) as any;

  it("FINDING #4: an unrelated device's kernel event must NOT escalate this mount", () => {
    // Repro: intentionally read-only /archive on sda1 + a remount event for sdb1.
    // Host-wide corroboration made /archive critical and blamed sda1.
    const s = healthySnapshot();
    s.collector_version = "0.14.12";
    s.disks = [{ device: "/dev/sda1", mount: "/archive", total_gb: 10, used_gb: 1, available_gb: 9, percent_used: 10, fstype: "ext4", options: "ro,relatime" }] as any;
    s.dmesg_events = ev("sdb1");
    const mountPath = alertsOf("filesystem_readonly", s).filter(a => a.evidence?.scope === "mount_options");
    expect(mountPath).toHaveLength(1);
    expect(mountPath[0].severity).toBe("warning");
    expect(mountPath[0].message).not.toMatch(/because it failed/);
  });

  it("FINDING #4: the MATCHING device still escalates to critical", () => {
    const s = healthySnapshot();
    s.collector_version = "0.14.12";
    s.disks = [{ device: "/dev/sdb1", mount: "/data", total_gb: 10, used_gb: 1, available_gb: 9, percent_used: 10, fstype: "ext4", options: "ro,relatime" }] as any;
    s.dmesg_events = ev("sdb1");
    const mountPath = alertsOf("filesystem_readonly", s).filter(a => a.evidence?.scope === "mount_options");
    expect(mountPath[0].severity).toBe("critical");
    expect(mountPath[0].evidence.kernel_remount_event).toBe(true);
  });

  it("FINDING #4: matches an md device name without the /dev/ prefix", () => {
    const s = healthySnapshot();
    s.collector_version = "0.14.12";
    s.disks = [{ device: "/dev/md127", mount: "/", total_gb: 10, used_gb: 1, available_gb: 9, percent_used: 10, fstype: "ext4", options: "ro,relatime" }] as any;
    s.dmesg_events = ev("md127");
    expect(alertsOf("filesystem_readonly", s).filter(a => a.evidence?.scope === "mount_options")[0].severity).toBe("critical");
  });

  it("FINDING #6: abstains entirely for a pre-0.14.11 agent, whose options are untrustworthy", () => {
    // Those agents read their own sandboxed namespace and send no reliability flag,
    // so a healthy host reported `ro` for / and got a permanent false alert.
    const s = healthySnapshot();
    s.collector_version = "0.14.9";
    s.disks[0].options = "ro,relatime";
    expect(alertsOf("filesystem_readonly", s)).toHaveLength(0);
  });

  it("FINDING #6: abstains when the agent version is absent or unparseable", () => {
    for (const v of [undefined, "", "dev"]) {
      const s = healthySnapshot();
      s.collector_version = v as any;
      s.disks[0].options = "ro,relatime";
      expect(alertsOf("filesystem_readonly", s)).toHaveLength(0);
    }
  });

  it("FINDING #6: the kernel-event path still fires on an OLD agent", () => {
    // Abstaining on mount options must not blind us to a real failure.
    const s = healthySnapshot();
    s.collector_version = "0.14.9";
    s.dmesg_events = ev("sdb1");
    const crit = alertsOf("filesystem_readonly", s).filter(a => a.severity === "critical");
    expect(crit.length).toBeGreaterThan(0);
  });
});

describe("agentAtLeast", () => {
  it("compares numerically so 0.14.9 does not outrank 0.14.11", () => {
    expect(agentAtLeast("0.14.9", "0.14.11")).toBe(false);
    expect(agentAtLeast("0.14.11", "0.14.11")).toBe(true);
    expect(agentAtLeast("0.14.12", "0.14.11")).toBe(true);
    expect(agentAtLeast("1.0.0", "0.14.11")).toBe(true);
  });
  it("treats absent or unparseable as NOT trusted", () => {
    expect(agentAtLeast(undefined, "0.14.11")).toBe(false);
    expect(agentAtLeast("nightly", "0.14.11")).toBe(false);
  });
});

describe("agentAtLeast: strict parsing (adversarial review round 4, finding #5)", () => {
  it("REJECTS a prerelease or trailing garbage, per its own not-trusted contract", () => {
    // Unanchored, these returned true and let a malformed or prerelease agent switch
    // on the trusted mount-namespace interpretation.
    expect(agentAtLeast("0.14.11-rc.1", "0.14.11")).toBe(false);
    expect(agentAtLeast("0.14.11garbage", "0.14.11")).toBe(false);
    expect(agentAtLeast("0.14.11 ", "0.14.11")).toBe(true); // whitespace is trimmed
  });

  it("still accepts clean released versions", () => {
    expect(agentAtLeast("0.14.11", "0.14.11")).toBe(true);
    expect(agentAtLeast("0.14.13", "0.14.11")).toBe(true);
    expect(agentAtLeast("0.14.9", "0.14.11")).toBe(false);
  });

  it("a prerelease agent therefore ABSTAINS from the mount-options path", () => {
    const s = healthySnapshot();
    s.collector_version = "0.14.13-rc.1";
    s.disks[0].options = "ro,relatime";
    expect(alertsOf("filesystem_readonly", s)).toHaveLength(0);
  });
});
