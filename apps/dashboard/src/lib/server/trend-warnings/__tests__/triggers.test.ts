import { describe, expect, it } from "vitest";
import {
  storageTriggers,
  nvmeTriggers,
  diskSpaceTriggers,
  ipmiTriggers,
  networkTriggers,
  runDeterministicTriggers,
} from "../triggers";
import { baseDrive, baseNvme, baseFeatures } from "./fixtures";

describe("storage triggers", () => {
  it("fires smart_187_first_appearance when SMART 187 goes from 0 to positive", () => {
    const drive = baseDrive({ smart_187_raw: 2, smart_187_delta_7d: 2 });
    const findings = storageTriggers(baseFeatures({ drives: [drive] }));
    expect(findings.map(f => f.type)).toContain("smart_187_first_appearance");
    expect(findings[0].severity).toBe("high");
  });

  it("fires smart_187_growing when SMART 187 was already non-zero", () => {
    const drive = baseDrive({ smart_187_raw: 5, smart_187_delta_7d: 2 });
    const findings = storageTriggers(baseFeatures({ drives: [drive] }));
    expect(findings.map(f => f.type)).toContain("smart_187_growing");
  });

  it("does not fire SMART 187 when value is zero", () => {
    const drive = baseDrive();
    const findings = storageTriggers(baseFeatures({ drives: [drive] }));
    expect(findings.filter(f => f.type.startsWith("smart_187")).length).toBe(0);
  });

  it("fires smart_197_step_change when pending sectors go 0 -> positive over 30d", () => {
    const drive = baseDrive({ smart_197_raw: 4, smart_197_delta_7d: 4, smart_197_delta_30d: 4 });
    const findings = storageTriggers(baseFeatures({ drives: [drive] }));
    expect(findings.map(f => f.type)).toContain("smart_197_step_change");
  });

  // Codex 2026-08-29 #3: a drive FIRST OBSERVED with held pending sectors was
  // invisible to every trigger. step_change requires a rise from zero inside
  // the window (a new host has no zero baseline), recurring requires the
  // current value to be zero, and smart_failing deliberately does not use
  // attribute 197. A re-provisioned host entering monitoring at pending=40,
  // health PASSED, zero reallocations produced nothing, forever.
  it("fires smart_197_nonzero_baseline for a drive that entered monitoring with held pending sectors", () => {
    const drive = baseDrive({ smart_197_raw: 40, drive_age_days: 30 });
    const f = storageTriggers(baseFeatures({ drives: [drive] })).find(x => x.type === "smart_197_nonzero_baseline");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("medium");
  });

  it("does NOT fire nonzero_baseline before 7 days of observation", () => {
    // "Held" is meaningless over hours. A fresh enrollment must accumulate
    // history before a flat reading is evidence of anything.
    const drive = baseDrive({ smart_197_raw: 40, drive_age_days: 2 });
    const types = storageTriggers(baseFeatures({ drives: [drive] })).map(f => f.type);
    expect(types).not.toContain("smart_197_nonzero_baseline");
  });

  it("does NOT fire nonzero_baseline when the value moved inside the window", () => {
    // A rise from zero is step_change's; anything else moving is not "held".
    const drive = baseDrive({ smart_197_raw: 40, smart_197_delta_30d: 4, drive_age_days: 30 });
    const types = storageTriggers(baseFeatures({ drives: [drive] })).map(f => f.type);
    expect(types).not.toContain("smart_197_nonzero_baseline");
  });

  // THE known-bad from the drive-health campaign: Crucial MX500 firmware
  // relabels attribute 197 as an ECC counter that flaps 0<->1 on healthy
  // drives (35 false CRITICALs in 4 days before #634). A flapping counter
  // sampled mid-blip must not read as a held baseline.
  it("does NOT fire nonzero_baseline on the MX500 flap shape", () => {
    const drive = baseDrive({ smart_197_raw: 1, smart_197_recurrence_count: 3, drive_age_days: 60 });
    const types = storageTriggers(baseFeatures({ drives: [drive] })).map(f => f.type);
    expect(types).not.toContain("smart_197_nonzero_baseline");
  });

  it("nonzero_baseline and step_change are disjoint", () => {
    // step_change requires a positive 30d delta; nonzero_baseline requires a
    // flat one. No drive state satisfies both.
    const stepped = baseDrive({ smart_197_raw: 4, smart_197_delta_7d: 4, smart_197_delta_30d: 4, drive_age_days: 60 });
    const types = storageTriggers(baseFeatures({ drives: [stepped] })).map(f => f.type);
    expect(types).toContain("smart_197_step_change");
    expect(types).not.toContain("smart_197_nonzero_baseline");
  });

  it("fires smart_197_recurring (medium) when pending sectors recurred but are currently zero", () => {
    const drive = baseDrive({ smart_197_raw: 0, smart_197_recurrence_count: 4 });
    const f = storageTriggers(baseFeatures({ drives: [drive] })).find(x => x.type === "smart_197_recurring");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("medium");
  });

  // Drive-health campaign 2026-07-30, N1. The recurrence trigger's condition is
  // about attribute 197/198 and says nothing about attribute 5, but its evidence
  // text asserted "no sectors have reallocated yet" unconditionally. Live and
  // customer-visible on serial V6G97HRR at 477 reallocated sectors.
  it("does NOT claim zero reallocations when the drive has reallocated sectors", () => {
    const drive = baseDrive({ smart_197_raw: 0, smart_197_recurrence_count: 8, smart_5_raw: 477 });
    const f = storageTriggers(baseFeatures({ drives: [drive] })).find(x => x.type === "smart_197_recurring");
    expect(f).toBeDefined();
    expect(f!.evidence_summary).not.toContain("no sectors have reallocated");
    expect(f!.evidence_summary).toContain("477 reallocated sectors");
    // Already paging via smart_failing at critical; do not double-signal.
    expect(f!.severity).toBe("medium");
  });

  it("keeps the pre-reallocation wording when the drive genuinely has none", () => {
    const drive = baseDrive({ smart_197_raw: 0, smart_197_recurrence_count: 8, smart_5_raw: 0 });
    const f = storageTriggers(baseFeatures({ drives: [drive] })).find(x => x.type === "smart_197_recurring");
    expect(f!.evidence_summary).toContain("no sectors have reallocated yet");
  });

  it("singularises the reallocated-sector count", () => {
    const drive = baseDrive({ smart_197_raw: 0, smart_197_recurrence_count: 8, smart_5_raw: 1 });
    const f = storageTriggers(baseFeatures({ drives: [drive] })).find(x => x.type === "smart_197_recurring");
    expect(f!.evidence_summary).toContain("1 reallocated sector,");
  });

  // udma_crc_growing: SMART 199 growth. Drive-health campaign, item N2.
  // The live example (WD-WCC4E3AKJP4L, crc 138) is FLAT, so these are the only
  // coverage this trigger has until a drive with genuinely rising crc appears.
  it("fires udma_crc_growing on crc growth inside 7 days", () => {
    const drive = baseDrive({ smart_199_raw: 12, smart_199_delta_7d: 12, smart_199_delta_30d: 12 });
    const f = storageTriggers(baseFeatures({ drives: [drive] })).find(x => x.type === "udma_crc_growing");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("medium");
    expect(f!.evidence_summary).toContain("cable, connector or backplane");
  });

  it("escalates udma_crc_growing to high on fast crc growth", () => {
    const drive = baseDrive({ smart_199_raw: 40, smart_199_delta_7d: 40, smart_199_delta_30d: 40 });
    const f = storageTriggers(baseFeatures({ drives: [drive] })).find(x => x.type === "udma_crc_growing");
    expect(f!.severity).toBe("high");
  });

  it("catches a slow trickle that no single week would show", () => {
    const drive = baseDrive({ smart_199_raw: 9, smart_199_delta_7d: 0, smart_199_delta_30d: 9 });
    expect(storageTriggers(baseFeatures({ drives: [drive] })).map(f => f.type)).toContain("udma_crc_growing");
  });

  // The whole point of keying on growth: crc never decreases, so a high but
  // STATIC count is an old cable event, not a live fault. This is the real
  // WD-WCC4E3AKJP4L shape and it must stay silent.
  it("stays silent on a high but STATIC crc count (the latch case)", () => {
    const drive = baseDrive({ smart_199_raw: 138, smart_199_delta_7d: 0, smart_199_delta_30d: 0 });
    expect(storageTriggers(baseFeatures({ drives: [drive] })).map(f => f.type)).not.toContain("udma_crc_growing");
  });

  it("stays silent on a clean link", () => {
    const drive = baseDrive({ smart_199_raw: 0, smart_199_delta_7d: 0, smart_199_delta_30d: 0 });
    expect(storageTriggers(baseFeatures({ drives: [drive] })).map(f => f.type)).not.toContain("udma_crc_growing");
  });

  it("does not confuse a link fault with media: crc growth alone raises no smart_5 finding", () => {
    const drive = baseDrive({ smart_199_raw: 30, smart_199_delta_7d: 30, smart_199_delta_30d: 30, smart_5_raw: 0 });
    const types = storageTriggers(baseFeatures({ drives: [drive] })).map(f => f.type);
    expect(types).toContain("udma_crc_growing");
    expect(types).not.toContain("smart_5_growing");
    expect(types).not.toContain("smart_5_step_change");
  });

  it("does not fire smart_197_recurring below the recurrence threshold", () => {
    const drive = baseDrive({ smart_197_raw: 0, smart_197_recurrence_count: 2 });
    expect(storageTriggers(baseFeatures({ drives: [drive] })).map(f => f.type)).not.toContain("smart_197_recurring");
  });

  it("does not double-fire: a currently-nonzero pending count is step_change, not recurring", () => {
    const drive = baseDrive({ smart_197_raw: 3, smart_197_delta_30d: 3, smart_197_recurrence_count: 5 });
    const types = storageTriggers(baseFeatures({ drives: [drive] })).map(f => f.type);
    expect(types).toContain("smart_197_step_change");
    expect(types).not.toContain("smart_197_recurring");
  });

  it("fires smart_5_growing with high severity on elevated-AFR model", () => {
    const drive = baseDrive({ model: "ST12000NM0007", smart_5_raw: 14, smart_5_delta_7d: 3, smart_5_delta_30d: 14 });
    const findings = storageTriggers(baseFeatures({ drives: [drive] }));
    const growing = findings.find(f => f.type === "smart_5_growing");
    expect(growing?.severity).toBe("high");
  });

  it("fires smart_5_growing with medium severity on low-AFR model", () => {
    const drive = baseDrive({ model: "WDC WUH721816ALE6L4", vendor: "WDC", smart_5_raw: 14, smart_5_delta_7d: 3, smart_5_delta_30d: 14 });
    const findings = storageTriggers(baseFeatures({ drives: [drive] }));
    const growing = findings.find(f => f.type === "smart_5_growing");
    expect(growing?.severity).toBe("medium");
  });

  it("does not fire smart_5 for small growth on older drives", () => {
    const drive = baseDrive({ smart_5_raw: 20, smart_5_delta_7d: 1, smart_5_delta_30d: 2 });
    const findings = storageTriggers(baseFeatures({ drives: [drive] }));
    expect(findings.filter(f => f.type === "smart_5_growing").length).toBe(0);
  });

  it("fires smart_188_timeouts when delta_7d >= 3", () => {
    const drive = baseDrive({ smart_188_delta_7d: 4 });
    const findings = storageTriggers(baseFeatures({ drives: [drive] }));
    expect(findings.map(f => f.type)).toContain("smart_188_timeouts");
  });

  it("fires smart_189_burst when burst_max >= 5", () => {
    const drive = baseDrive({ smart_189_burst_max_7d: 7 });
    const findings = storageTriggers(baseFeatures({ drives: [drive] }));
    expect(findings.map(f => f.type)).toContain("smart_189_burst");
  });

  it("skips NVMe drives in storage triggers", () => {
    const drive = baseNvme({ smart_5_delta_7d: 5, smart_5_delta_30d: 15 });
    const findings = storageTriggers(baseFeatures({ drives: [drive] }));
    expect(findings).toHaveLength(0);
  });
});

describe("nvme triggers", () => {
  it("fires nvme_critical_warning with decoded bits", () => {
    const drive = baseNvme({ nvme_critical_warning: 0b00100 }); // reliability degraded
    const findings = nvmeTriggers(baseFeatures({ drives: [drive] }));
    expect(findings[0].type).toBe("nvme_critical_warning");
    expect(findings[0].severity).toBe("high");
    expect(findings[0].evidence_summary).toContain("reliability degraded");
  });

  it("does not fire critical_warning when zero", () => {
    const findings = nvmeTriggers(baseFeatures({ drives: [baseNvme()] }));
    expect(findings.filter(f => f.type === "nvme_critical_warning")).toHaveLength(0);
  });

  it("fires nvme_spare_exhausted when spare below threshold", () => {
    const drive = baseNvme({ nvme_available_spare: 5, nvme_available_spare_threshold: 10 });
    const findings = nvmeTriggers(baseFeatures({ drives: [drive] }));
    expect(findings.map(f => f.type)).toContain("nvme_spare_exhausted");
  });

  it("fires nvme_spare_approaching when within 5pp of threshold", () => {
    const drive = baseNvme({ nvme_available_spare: 12, nvme_available_spare_threshold: 10 });
    const findings = nvmeTriggers(baseFeatures({ drives: [drive] }));
    expect(findings.map(f => f.type)).toContain("nvme_spare_approaching");
  });

  it("fires nvme_media_errors_growing on positive 7d delta", () => {
    const drive = baseNvme({ nvme_media_errors: 3, nvme_media_errors_delta_7d: 3 });
    const findings = nvmeTriggers(baseFeatures({ drives: [drive] }));
    expect(findings.map(f => f.type)).toContain("nvme_media_errors_growing");
  });
});

describe("disk space triggers", () => {
  it("projects fill within 14 days (disk_fill_projection)", () => {
    const totalBytes = 1_000_000_000_000;
    const usedBytes = totalBytes * 0.7;
    const slope = (totalBytes * 0.85 - usedBytes) / 10; // fills to 85% in 10 days
    const findings = diskSpaceTriggers(baseFeatures({
      partitions: [{
        mount: "/",
        device: "/dev/sda1",
        total_bytes: totalBytes,
        used_bytes: usedBytes,
        use_pct: 70,
        slope_bytes_per_day: slope,
      }],
    }));
    expect(findings.map(f => f.type)).toContain("disk_fill_projection");
  });

  it("projects fill within 7 days (disk_fill_imminent)", () => {
    const totalBytes = 1_000_000_000_000;
    const usedBytes = totalBytes * 0.9;
    const slope = (totalBytes * 0.95 - usedBytes) / 3; // fills to 95% in 3 days
    const findings = diskSpaceTriggers(baseFeatures({
      partitions: [{
        mount: "/",
        device: "/dev/sda1",
        total_bytes: totalBytes,
        used_bytes: usedBytes,
        use_pct: 90,
        slope_bytes_per_day: slope,
      }],
    }));
    expect(findings.map(f => f.type)).toContain("disk_fill_imminent");
  });

  it("ignores partitions under 25% full (avoids fresh-instance false positives)", () => {
    const findings = diskSpaceTriggers(baseFeatures({
      partitions: [{
        mount: "/",
        device: "/dev/sda1",
        total_bytes: 1_000_000_000_000,
        used_bytes: 100_000_000_000,
        use_pct: 10,
        slope_bytes_per_day: 10_000_000_000,
      }],
    }));
    expect(findings).toHaveLength(0);
  });

  it("ignores partitions with zero or negative slope", () => {
    const findings = diskSpaceTriggers(baseFeatures({
      partitions: [{
        mount: "/",
        device: "/dev/sda1",
        total_bytes: 1_000_000_000_000,
        used_bytes: 800_000_000_000,
        use_pct: 80,
        slope_bytes_per_day: 0,
      }],
    }));
    expect(findings).toHaveLength(0);
  });

  // Regression for 2026-05-21 bug: synthetic test mount at 100% full
  // with a tiny positive slope generated "fill in ~-21392373 days"
  // because bytesTo95 was negative + daysTo95 = negative/positive =
  // negative, and `negative < 7` is trivially true. Guard added in
  // triggers.ts.
  it("does not fire when already past the 95% threshold (no negative-days projection)", () => {
    const findings = diskSpaceTriggers(baseFeatures({
      partitions: [{
        mount: "/mnt/test_diskwarn",
        device: "/dev/loop0",
        total_bytes: 1_000_000_000,
        used_bytes: 1_000_000_000,   // 100% full
        use_pct: 100,
        slope_bytes_per_day: 1_000,   // tiny positive (rounds to 0.00 GB/day)
      }],
    }));
    expect(findings).toHaveLength(0);
  });

  it("does not fire projection branch when already past 85% but not 95% (95% branch already covers this)", () => {
    const findings = diskSpaceTriggers(baseFeatures({
      partitions: [{
        mount: "/",
        device: "/dev/sda1",
        total_bytes: 1_000_000_000_000,
        used_bytes: 900_000_000_000,   // 90% used; past 85%
        use_pct: 90,
        slope_bytes_per_day: 100_000_000,   // 0.1 GB/day; daysTo95 = 500
      }],
    }));
    // 95% branch: daysTo95 = (950 - 900) GB / 0.1 GB/day = 500 days > 7, doesn't fire.
    // 85% branch must NOT fire either since bytesTo85 is negative.
    expect(findings.map(f => f.type)).not.toContain("disk_fill_projection");
    expect(findings.map(f => f.type)).not.toContain("disk_fill_imminent");
  });
});

describe("ipmi triggers", () => {
  // psu_rail_out_of_spec two-tier thresholds (2026-05-23 noise-fix):
  //   < 5%      no fire
  //   5%-7.99%  medium
  //   >= 8%     high
  // +5V Standby exemption from the medium band (standby rail typically
  // idles at ~5.1V by design).

  it("fires psu_rail_out_of_spec high when drift >= 8%", () => {
    const findings = ipmiTriggers(baseFeatures({
      ipmi: {
        fans: [],
        psu_rails: [{ rail: "12V", current_v: 11.0, nominal_v: 12.0, deviation_pct: 0.083, sustained_batches: 3 }],
        temps: [],
      },
    }));
    const fired = findings.find(f => f.type === "psu_rail_out_of_spec");
    expect(fired).toBeDefined();
    expect(fired?.severity).toBe("high");
  });

  it("fires psu_rail_out_of_spec medium when drift is 5-7.99% on a main rail", () => {
    const findings = ipmiTriggers(baseFeatures({
      ipmi: {
        fans: [],
        psu_rails: [{ rail: "12V", current_v: 11.3, nominal_v: 12.0, deviation_pct: 0.058, sustained_batches: 3 }],
        temps: [],
      },
    }));
    const fired = findings.find(f => f.type === "psu_rail_out_of_spec");
    expect(fired).toBeDefined();
    expect(fired?.severity).toBe("medium");
  });

  it("does not fire psu_rail_out_of_spec with drift below 5% (was: 2% — too tight)", () => {
    const findings = ipmiTriggers(baseFeatures({
      ipmi: {
        fans: [],
        // 2.8% drift — would have fired pre-fix; matches mz62hd's
        // healthy P_5V reading of 5.14V (within ATX ±5% spec).
        psu_rails: [{ rail: "P_5V", current_v: 5.14, nominal_v: 5.0, deviation_pct: 0.028, sustained_batches: 3 }],
        temps: [],
      },
    }));
    expect(findings.filter(f => f.type === "psu_rail_out_of_spec")).toHaveLength(0);
  });

  it("does not fire psu_rail_out_of_spec on +5V Standby at the medium band (regulated differently)", () => {
    const findings = ipmiTriggers(baseFeatures({
      ipmi: {
        fans: [],
        psu_rails: [{ rail: "P_5V_STBY", current_v: 5.3, nominal_v: 5.0, deviation_pct: 0.06, sustained_batches: 3 }],
        temps: [],
      },
    }));
    expect(findings.filter(f => f.type === "psu_rail_out_of_spec")).toHaveLength(0);
  });

  it("DOES fire psu_rail_out_of_spec on +5V Standby when it crosses the high band", () => {
    const findings = ipmiTriggers(baseFeatures({
      ipmi: {
        fans: [],
        psu_rails: [{ rail: "P_5V_STBY", current_v: 4.5, nominal_v: 5.0, deviation_pct: 0.10, sustained_batches: 3 }],
        temps: [],
      },
    }));
    const fired = findings.find(f => f.type === "psu_rail_out_of_spec");
    expect(fired).toBeDefined();
    expect(fired?.severity).toBe("high");
  });

  it("does NOT fire psu_rail_out_of_spec when the BMC reports the rail ok (defer to calibrated thresholds) — val gigabyte 2026-07-15", () => {
    // The gigabyte val box regulates every rail a few % high, well inside the
    // board's own upper-non-critical thresholds, so the BMC reports "ok":
    // P_3V3 3.529V (nominal 3.3, +6.9%) sits below its 3.616V non-critical
    // limit. Our fixed-percentage heuristic would fire medium; the BMC's own
    // verdict is authoritative and must suppress it.
    const findings = ipmiTriggers(baseFeatures({
      ipmi: {
        fans: [],
        psu_rails: [
          { rail: "P_3V3", current_v: 3.529, nominal_v: 3.3, deviation_pct: 0.069, sustained_batches: 3, bmc_status: "ok" },
          { rail: "P_12V", current_v: 12.675, nominal_v: 12.0, deviation_pct: 0.056, sustained_batches: 3, bmc_status: "ok" },
        ],
        temps: [],
      },
    }));
    expect(findings.filter(f => f.type === "psu_rail_out_of_spec")).toHaveLength(0);
  });

  it("DOES fire psu_rail_out_of_spec when the deviation is out of spec AND the BMC flags the rail (nc)", () => {
    const findings = ipmiTriggers(baseFeatures({
      ipmi: {
        fans: [],
        psu_rails: [{ rail: "P_12V", current_v: 13.2, nominal_v: 12.0, deviation_pct: 0.10, sustained_batches: 3, bmc_status: "nc" }],
        temps: [],
      },
    }));
    const fired = findings.find(f => f.type === "psu_rail_out_of_spec");
    expect(fired).toBeDefined();
    expect(fired?.severity).toBe("high");
  });

  it("fires fan_rpm_decline when RPM falls >= 20% from baseline", () => {
    const findings = ipmiTriggers(baseFeatures({
      ipmi: {
        fans: [{ name: "FAN1", rpm: 2000, rpm_baseline: 3000, rpm_delta_14d: -1000, zone: "cpu" }],
        psu_rails: [],
        temps: [],
      },
    }));
    const fan = findings.find(f => f.type === "fan_rpm_decline");
    expect(fan).toBeDefined();
    expect(fan?.requires_correlation).toBe(true);
  });
});

describe("network triggers", () => {
  it("fires nic_errors on CRC error growth and marks as requires_correlation", () => {
    const findings = networkTriggers(baseFeatures({
      network: [{ iface: "eth0", crc_errors_delta_7d: 20, frame_errors_delta_7d: 2, tcp_retransmits_delta_7d: 50 }],
    }));
    const nic = findings.find(f => f.type === "nic_errors");
    expect(nic).toBeDefined();
    expect(nic?.requires_correlation).toBe(true);
  });

  it("does not fire under the threshold", () => {
    const findings = networkTriggers(baseFeatures({
      network: [{ iface: "eth0", crc_errors_delta_7d: 3, frame_errors_delta_7d: 2, tcp_retransmits_delta_7d: 10 }],
    }));
    expect(findings).toHaveLength(0);
  });
});

describe("runDeterministicTriggers", () => {
  it("combines triggers from all categories", () => {
    const drive = baseDrive({ smart_187_raw: 2, smart_187_delta_7d: 2 });
    const nvme = baseNvme({ nvme_critical_warning: 1 });
    const findings = runDeterministicTriggers(baseFeatures({ drives: [drive, nvme] }));
    const types = findings.map(f => f.type);
    expect(types).toContain("smart_187_first_appearance");
    expect(types).toContain("nvme_critical_warning");
  });
});
