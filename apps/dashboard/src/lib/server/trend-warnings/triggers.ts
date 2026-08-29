// Deterministic warning triggers (Stage 2).
//
// Each function inspects a ServerFeatures struct and emits zero or more
// Finding objects. Triggers run independently; correlation happens in Stage 3.
//
// Spec: 07-trend-warnings-spec-v2.md, Stage 2

import type { ServerFeatures, DriveFeatures, Finding, ContributingMetric } from "./types";

// Per-model AFR priors. Loaded from the Backblaze-derived JSON once the tree
// ranker ships (v1.1). For v1 we use a conservative inline table.
const MODEL_AFR: Record<string, number> = {
  "ST12000NM0007": 0.0947,
  "ST12000NM0008": 0.0122,
  "ST8000NM0055": 0.0189,
  "WDC WUH721816ALE6L4": 0.0085,
  "TOSHIBA MG08ACA16TE": 0.0106,
};
const DEFAULT_AFR = 0.015;

// A transient SMART attribute that returned to zero but rose from zero this
// many times across the window is treated as a recurring (flaking) signal.
const RECUR_THRESHOLD = 3;

// SMART 199 (UDMA CRC) growth thresholds. Any growth inside 7 days is worth
// saying, because a healthy link produces exactly zero: unlike reallocated
// sectors there is no benign background rate to filter out. The 30d floor
// catches a slow trickle whose weekly deltas keep rounding to zero, and the 7d
// high mark separates "a cable is going" from "something is actively wrong with
// this path". Deliberately NOT calibrated against a fleet failure population:
// no drive in our fleet currently shows GROWING crc (the one nonzero example
// has been flat at 138 for its whole observed life), so these are design-led
// and should be revisited against real growth when it appears.
const CRC_GROWTH_30D = 5;
const CRC_GROWTH_7D_HIGH = 20;

function afr(model: string): number {
  return MODEL_AFR[model] ?? DEFAULT_AFR;
}

function metric(name: string, drive: DriveFeatures, current: number, baseline: number, delta7d: number, delta30d = 0): ContributingMetric {
  return { name, current, baseline, delta_1d: 0, delta_7d: delta7d, delta_30d: delta30d, burst_max_7d: 0, window: "30d" };
}

// ---------------------------------------------------------------------------
// Storage triggers (SMART)
// ---------------------------------------------------------------------------

export function storageTriggers(features: ServerFeatures): Finding[] {
  const findings: Finding[] = [];

  for (const drive of features.drives) {
    // Skip NVMe drives (handled by nvmeTriggers)
    if (drive.nvme_critical_warning != null) continue;

    // SMART 187: reported uncorrectable errors. Above zero is always actionable.
    if (drive.smart_187_raw > 0) {
      const isNew = drive.smart_187_delta_7d > 0 && (drive.smart_187_raw - drive.smart_187_delta_7d) === 0;
      findings.push({
        type: isNew ? "smart_187_first_appearance" : "smart_187_growing",
        severity: "high",
        resource: { kind: "drive", name: drive.device, serial: drive.serial, model: drive.model, vendor: drive.vendor },
        contributing_metrics: [metric("smart_187_raw", drive, drive.smart_187_raw, 0, drive.smart_187_delta_7d, drive.smart_187_delta_30d)],
        correlation_match: null,
        tree_ranker_score: null,
        projected_timeline: null,
        evidence_summary: `SMART 187 (reported uncorrectable errors) is ${drive.smart_187_raw} on ${drive.device} (${drive.model}, serial ${drive.serial}).${isNew ? " First appearance this week." : ` Grew by ${drive.smart_187_delta_7d} in the last 7 days.`}`,
      });
    }

    // SMART 197 or 198: step-change from zero
    for (const [attr, raw, d7, d30, label] of [
      [197, drive.smart_197_raw, drive.smart_197_delta_7d, drive.smart_197_delta_30d, "current pending sectors"],
      [198, drive.smart_198_raw, drive.smart_198_delta_7d, drive.smart_198_delta_30d, "offline uncorrectable"],
    ] as Array<[number, number, number, number, string]>) {
      if (raw > 0 && d30 > 0 && (raw - d30) === 0) {
        findings.push({
          type: `smart_${attr}_step_change`,
          severity: "high",
          resource: { kind: "drive", name: drive.device, serial: drive.serial, model: drive.model, vendor: drive.vendor },
          contributing_metrics: [metric(`smart_${attr}_raw`, drive, raw, 0, d7, d30)],
          correlation_match: null,
          tree_ranker_score: null,
          projected_timeline: null,
          evidence_summary: `SMART ${attr} (${label}) went from 0 to ${raw} on ${drive.device} (${drive.model}) in the last 30 days.`,
        });
      }
    }

    // SMART 197 / 198 recurrence: intermittently-flaking but currently clear.
    // The step-change trigger above only fires when the count is nonzero right
    // now and held; a pending sector that keeps appearing and clearing reads as
    // "currently 0, no trend" to every delta-based trigger and slips through
    // (the smart_failing alert catches each blip but just flaps). Recurrence
    // catches the pattern: back at zero, but rose from zero RECUR_THRESHOLD+
    // times across the window. raw === 0 keeps this complementary to the
    // step-change trigger (raw > 0), so a drive never double-fires.
    //
    // The "pre-reallocation precursor" framing this trigger was written around is
    // an ASSUMPTION the condition never checked: `raw === 0` is about attribute
    // 197/198 and says nothing whatsoever about attribute 5. The evidence text
    // asserted it as fact anyway, so on a drive with reallocations the product
    // stated a falsehood. Observed live and customer-visible on
    // /api/v1/trend-warnings/active: serial V6G97HRR, 477 reallocated sectors,
    // described as "no sectors have reallocated yet". Drive-health campaign
    // 2026-07-30, finding N1.
    //
    // Severity deliberately stays medium in BOTH branches. Recurrence on top of
    // existing reallocations is genuinely worse, but such a drive is already
    // paging: reallocated > 0 fires smart_failing at critical, which is the
    // anchor rule. Re-escalating the scheduled-tier trend warning would
    // double-signal the same drive rather than tell anyone something new.
    for (const [attr, raw, recur, label] of [
      [197, drive.smart_197_raw, drive.smart_197_recurrence_count, "current pending sectors"],
      [198, drive.smart_198_raw, drive.smart_198_recurrence_count, "offline uncorrectable"],
    ] as Array<[number, number, number, string]>) {
      if (raw === 0 && recur >= RECUR_THRESHOLD) {
        const reallocated = drive.smart_5_raw;
        const context = reallocated > 0
          ? `It reads zero now, but this drive already has ${reallocated} reallocated sector${reallocated === 1 ? "" : "s"}, so the transient is recurring on media that has already failed elsewhere.`
          : "It reads zero now and no sectors have reallocated yet, but a transient that keeps recurring is an early failure precursor the growth-based triggers miss.";
        findings.push({
          type: `smart_${attr}_recurring`,
          severity: "medium",
          resource: { kind: "drive", name: drive.device, serial: drive.serial, model: drive.model, vendor: drive.vendor },
          contributing_metrics: [metric(`smart_${attr}_recurrence_count`, drive, recur, 0, 0, 0)],
          correlation_match: null,
          tree_ranker_score: null,
          projected_timeline: null,
          evidence_summary: `SMART ${attr} (${label}) on ${drive.device} (${drive.model}, serial ${drive.serial}) appeared and cleared ${recur} times over the window. ${context}`,
        });
      }
    }

    // SMART 197 / 198 nonzero baseline: the drive ENTERED monitoring already
    // carrying pending / offline-uncorrectable sectors, and they are holding.
    //
    // Every other trigger needs the rise or the flap to happen ON CAMERA.
    // step_change requires a 0 -> N inside the window; a drive first observed
    // at N has no zero baseline and its deltas read 0. recurring requires the
    // current value to be zero. smart_failing deliberately excludes attribute
    // 197 (MX500 relabeling, see the evaluator). So a new or re-provisioned
    // host reporting pending=40, health PASSED, zero reallocations produced no
    // signal at all, forever (Codex 2026-08-29 #3).
    //
    // Guards, each load-bearing:
    //   - drive_age_days >= 7: "held" is meaningless over hours; a fresh
    //     enrollment must accumulate history before flat is evidence.
    //   - d7 === 0 && d30 === 0: anything moving is not a baseline. A rise
    //     from zero belongs to step_change; the two are disjoint by
    //     construction (it needs d30 > 0, this needs d30 === 0).
    //   - recur <= 1: a held-since-entry value produces exactly one rising
    //     edge (the window's first sample). Two or more edges is the flapping
    //     MX500 ECC-counter shape the drive-health campaign proved benign;
    //     that shape is recurring's, and only when it settles back to zero.
    //
    // Severity stays medium (scheduled tier, dashboard-visible, not paged):
    // pending alone must never page (campaign 2026-07-30 / #634), but a
    // stranger's drive arriving with held suspect sectors is exactly what an
    // operator wants to see during onboarding, not never.
    for (const [attr, raw, d7, d30, recur, label] of [
      [197, drive.smart_197_raw, drive.smart_197_delta_7d, drive.smart_197_delta_30d, drive.smart_197_recurrence_count, "current pending sectors"],
      [198, drive.smart_198_raw, drive.smart_198_delta_7d, drive.smart_198_delta_30d, drive.smart_198_recurrence_count, "offline uncorrectable"],
    ] as Array<[number, number, number, number, number, string]>) {
      if (raw > 0 && d7 === 0 && d30 === 0 && recur <= 1 && drive.drive_age_days >= 7) {
        const reallocated = drive.smart_5_raw;
        const context = reallocated > 0
          ? `This drive also has ${reallocated} reallocated sector${reallocated === 1 ? "" : "s"}, which already fires the smart_failing alert; this warning adds that the suspect sectors are not being retired or cleared.`
          : "No sectors have reallocated, so nothing pages for this drive; a held suspect count on arrival is worth a look before trusting the hardware.";
        findings.push({
          type: `smart_${attr}_nonzero_baseline`,
          severity: "medium",
          resource: { kind: "drive", name: drive.device, serial: drive.serial, model: drive.model, vendor: drive.vendor },
          contributing_metrics: [metric(`smart_${attr}_raw`, drive, raw, raw, 0, 0)],
          correlation_match: null,
          tree_ranker_score: null,
          projected_timeline: null,
          evidence_summary: `SMART ${attr} (${label}) on ${drive.device} (${drive.model}, serial ${drive.serial}) has read ${raw} since this drive was first observed ${drive.drive_age_days} days ago, without clearing or growing. ${context}`,
        });
      }
    }

    // SMART 199 (UDMA CRC): the LINK is degrading, not the media.
    //
    // Named udma_crc_growing, not link_path_risk as the campaign sketched it.
    // The track-record endpoint credits a warning with "preceding" a later alert
    // when SPLIT_PART(warning_type, _, 1) appears in the alert type, so a
    // link_* warning would be scored as having predicted gpu_pcie_link_degraded,
    // link_speed_mismatch or nvlink_link_down, none of which is a drive link
    // fault. That silently inflates a customer-facing precision number. "udma"
    // collides with no alert type, and an attribute-led name matches the
    // siblings (smart_5_growing, smart_188_timeouts).
    //
    // These are errors on the path between controller and drive: a cable, a
    // connector, a backplane slot, occasionally a controller port. The platter
    // and the flash are fine, and no amount of drive replacement fixes it. It
    // gets its own finding precisely so nobody reads it as impending media
    // failure and RMAs a healthy drive: exactly that call had to be made by hand
    // on the drive-health campaign (WD-WCC4E3AKJP4L, crc 138 with reallocated 0,
    // pending 0 and health PASSED, "cable, do NOT RMA").
    //
    // Keyed on GROWTH, never on `raw > 0`. The raw count is a lifetime latch that
    // never decreases, so a drive that saw one bad cable event years ago reads
    // nonzero for the rest of its life; a `> 0` rule would alert permanently on
    // healthy hardware and be muted within a week. Growth is also why this lives
    // in the trend engine rather than the alert evaluator, which sees a single
    // snapshot and has no history to difference against.
    //
    // Advisory, never a page: a degrading cable is a scheduled-maintenance fact.
    // 30d is the escalation window rather than the trigger, because a slow
    // trickle across a month is the same fault as a burst in a day.
    if (drive.smart_199_delta_7d > 0 || drive.smart_199_delta_30d >= CRC_GROWTH_30D) {
      const fast = drive.smart_199_delta_7d >= CRC_GROWTH_7D_HIGH;
      findings.push({
        type: "udma_crc_growing",
        severity: fast ? "high" : "medium",
        resource: { kind: "drive", name: drive.device, serial: drive.serial, model: drive.model, vendor: drive.vendor },
        contributing_metrics: [metric("smart_199_raw", drive, drive.smart_199_raw, drive.smart_199_raw - drive.smart_199_delta_30d, drive.smart_199_delta_7d, drive.smart_199_delta_30d)],
        correlation_match: null,
        tree_ranker_score: null,
        projected_timeline: null,
        evidence_summary: `SMART 199 (UDMA CRC errors) on ${drive.device} (${drive.model}, serial ${drive.serial}) rose by ${drive.smart_199_delta_7d} in 7 days and ${drive.smart_199_delta_30d} in 30 days, now ${drive.smart_199_raw}. These are errors on the link between the controller and the drive, so the likely cause is a cable, connector or backplane slot rather than the drive itself. Reseat or replace the data cable and recheck before considering the drive suspect: replacing the drive does not fix a bad path, and this count never decreases once raised, so judge it by growth and not by its total.`,
      });
    }

    // SMART 5: repeated growth (not just "above 0")
    if (drive.smart_5_delta_7d >= 3 || drive.smart_5_delta_30d >= 10) {
      const severity = afr(drive.model) > 0.03 ? "high" : "medium";
      findings.push({
        type: "smart_5_growing",
        severity,
        resource: { kind: "drive", name: drive.device, serial: drive.serial, model: drive.model, vendor: drive.vendor },
        contributing_metrics: [metric("smart_5_raw", drive, drive.smart_5_raw, drive.smart_5_raw - drive.smart_5_delta_30d, drive.smart_5_delta_7d, drive.smart_5_delta_30d)],
        correlation_match: null,
        tree_ranker_score: null,
        projected_timeline: null,
        evidence_summary: `SMART 5 (reallocated sectors) is ${drive.smart_5_raw} on ${drive.device} (${drive.model}), growing by ${drive.smart_5_delta_7d} in 7 days and ${drive.smart_5_delta_30d} in 30 days.${afr(drive.model) > 0.03 ? ` ${drive.model} has elevated AFR (${(afr(drive.model) * 100).toFixed(1)}%).` : ""}`,
      });
    }

    // SMART 188: command timeouts
    if (drive.smart_188_delta_7d >= 3) {
      findings.push({
        type: "smart_188_timeouts",
        severity: "medium",
        resource: { kind: "drive", name: drive.device, serial: drive.serial, model: drive.model, vendor: drive.vendor },
        contributing_metrics: [metric("smart_188_raw", drive, drive.smart_188_raw, drive.smart_188_raw - drive.smart_188_delta_7d, drive.smart_188_delta_7d)],
        correlation_match: null,
        tree_ranker_score: null,
        projected_timeline: null,
        evidence_summary: `SMART 188 (command timeout count) increased by ${drive.smart_188_delta_7d} in 7 days on ${drive.device} (${drive.model}).`,
      });
    }

    // SMART 189: burst (HDD only, per Backblaze clustering)
    if (drive.smart_189_burst_max_7d >= 5) {
      findings.push({
        type: "smart_189_burst",
        severity: "medium",
        resource: { kind: "drive", name: drive.device, serial: drive.serial, model: drive.model, vendor: drive.vendor },
        contributing_metrics: [{ name: "smart_189_burst_max_7d", current: drive.smart_189_burst_max_7d, baseline: 0, delta_1d: 0, delta_7d: drive.smart_189_burst_max_7d, delta_30d: 0, burst_max_7d: drive.smart_189_burst_max_7d, window: "7d" }],
        correlation_match: null,
        tree_ranker_score: null,
        projected_timeline: null,
        evidence_summary: `SMART 189 (high fly writes) burst of ${drive.smart_189_burst_max_7d} detected on ${drive.device} (${drive.model}) in the last 7 days.`,
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// NVMe triggers
// ---------------------------------------------------------------------------

export function nvmeTriggers(features: ServerFeatures): Finding[] {
  const findings: Finding[] = [];

  for (const drive of features.drives) {
    if (drive.nvme_critical_warning == null) continue;

    // NVMe critical_warning any bit set
    if (drive.nvme_critical_warning > 0) {
      const bits: string[] = [];
      if (drive.nvme_critical_warning & 1) bits.push("available spare low");
      if (drive.nvme_critical_warning & 2) bits.push("temperature threshold exceeded");
      if (drive.nvme_critical_warning & 4) bits.push("reliability degraded");
      if (drive.nvme_critical_warning & 8) bits.push("read-only mode");
      if (drive.nvme_critical_warning & 16) bits.push("volatile memory backup failed");

      findings.push({
        type: "nvme_critical_warning",
        severity: "high",
        resource: { kind: "nvme", name: drive.device, serial: drive.serial, model: drive.model, vendor: drive.vendor },
        contributing_metrics: [{ name: "nvme_critical_warning", current: drive.nvme_critical_warning, baseline: 0, delta_1d: 0, delta_7d: 0, delta_30d: 0, burst_max_7d: 0, window: "current" }],
        correlation_match: null,
        tree_ranker_score: null,
        projected_timeline: bits.includes("read-only mode") ? "immediate" : "within 7 days",
        evidence_summary: `NVMe critical warning on ${drive.device} (${drive.model}): ${bits.join(", ")}.`,
      });
    }

    // NVMe available_spare below or approaching threshold
    if (drive.nvme_available_spare != null && drive.nvme_available_spare_threshold != null) {
      if (drive.nvme_available_spare < drive.nvme_available_spare_threshold) {
        findings.push({
          type: "nvme_spare_exhausted",
          severity: "high",
          resource: { kind: "nvme", name: drive.device, serial: drive.serial, model: drive.model, vendor: drive.vendor },
          contributing_metrics: [{ name: "nvme_available_spare", current: drive.nvme_available_spare, baseline: drive.nvme_available_spare_threshold, delta_1d: 0, delta_7d: 0, delta_30d: 0, burst_max_7d: 0, window: "current" }],
          correlation_match: null,
          tree_ranker_score: null,
          projected_timeline: "immediate",
          evidence_summary: `NVMe ${drive.device} (${drive.model}) available spare is ${drive.nvme_available_spare}%, below threshold of ${drive.nvme_available_spare_threshold}%.`,
        });
      } else if (drive.nvme_available_spare < drive.nvme_available_spare_threshold + 5) {
        findings.push({
          type: "nvme_spare_approaching",
          severity: "medium",
          resource: { kind: "nvme", name: drive.device, serial: drive.serial, model: drive.model, vendor: drive.vendor },
          contributing_metrics: [{ name: "nvme_available_spare", current: drive.nvme_available_spare, baseline: drive.nvme_available_spare_threshold, delta_1d: 0, delta_7d: 0, delta_30d: 0, burst_max_7d: 0, window: "current" }],
          correlation_match: null,
          tree_ranker_score: null,
          projected_timeline: "within 30 days",
          evidence_summary: `NVMe ${drive.device} (${drive.model}) available spare is ${drive.nvme_available_spare}%, approaching threshold of ${drive.nvme_available_spare_threshold}%.`,
        });
      }
    }

    // NVMe media errors growing
    if ((drive.nvme_media_errors_delta_7d ?? 0) > 0) {
      findings.push({
        type: "nvme_media_errors_growing",
        severity: "medium",
        resource: { kind: "nvme", name: drive.device, serial: drive.serial, model: drive.model, vendor: drive.vendor },
        contributing_metrics: [{ name: "nvme_media_errors", current: drive.nvme_media_errors ?? 0, baseline: (drive.nvme_media_errors ?? 0) - (drive.nvme_media_errors_delta_7d ?? 0), delta_1d: 0, delta_7d: drive.nvme_media_errors_delta_7d ?? 0, delta_30d: 0, burst_max_7d: 0, window: "7d" }],
        correlation_match: null,
        tree_ranker_score: null,
        projected_timeline: null,
        evidence_summary: `NVMe ${drive.device} (${drive.model}) media errors increased by ${drive.nvme_media_errors_delta_7d} in the last 7 days (total: ${drive.nvme_media_errors}).`,
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Disk space prediction (works on Free tier)
// ---------------------------------------------------------------------------

export function diskSpaceTriggers(features: ServerFeatures): Finding[] {
  const findings: Finding[] = [];

  for (const part of features.partitions) {
    // Skip fresh/empty partitions
    if (part.use_pct < 25) continue;
    // Skip if not growing
    if (part.slope_bytes_per_day <= 0) continue;

    const bytesTo85 = part.total_bytes * 0.85 - part.used_bytes;
    const bytesTo95 = part.total_bytes * 0.95 - part.used_bytes;

    // Already past the threshold — disk_space_high covers the
    // current-state alert; trend-warnings shouldn't "project a fill"
    // for a disk that's already full. Without this guard a 100%-full
    // disk with any non-zero positive slope produces a negative
    // bytesTo95, a negative daysTo95, and (since `negative < 7` is
    // trivially true) a bogus "in ~-21392373 days" warning. Observed
    // on synthetic test mounts 2026-05-21.
    if (bytesTo95 <= 0) continue;

    const daysTo85 = bytesTo85 / part.slope_bytes_per_day;
    const daysTo95 = bytesTo95 / part.slope_bytes_per_day;

    if (daysTo95 < 7) {
      findings.push({
        type: "disk_fill_imminent",
        severity: "high",
        resource: { kind: "partition", name: part.mount },
        contributing_metrics: [{ name: "disk_used_pct", current: part.use_pct, baseline: 0, delta_1d: 0, delta_7d: 0, delta_30d: 0, burst_max_7d: 0, window: "6h" }],
        correlation_match: null,
        tree_ranker_score: null,
        projected_timeline: `~${Math.ceil(daysTo95)} days to 95%`,
        evidence_summary: `${part.mount} on ${part.device} is at ${part.use_pct.toFixed(1)}% and growing at ${(part.slope_bytes_per_day / 1_073_741_824).toFixed(2)} GB/day. At this rate, 95% will be reached in ~${Math.ceil(daysTo95)} days.`,
      });
    } else if (bytesTo85 > 0 && daysTo85 < 14) {
      findings.push({
        type: "disk_fill_projection",
        severity: "medium",
        resource: { kind: "partition", name: part.mount },
        contributing_metrics: [{ name: "disk_used_pct", current: part.use_pct, baseline: 0, delta_1d: 0, delta_7d: 0, delta_30d: 0, burst_max_7d: 0, window: "6h" }],
        correlation_match: null,
        tree_ranker_score: null,
        projected_timeline: `~${Math.ceil(daysTo85)} days to 85%`,
        evidence_summary: `${part.mount} on ${part.device} is at ${part.use_pct.toFixed(1)}% and growing at ${(part.slope_bytes_per_day / 1_073_741_824).toFixed(2)} GB/day. At this rate, 85% will be reached in ~${Math.ceil(daysTo85)} days.`,
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// IPMI triggers
// ---------------------------------------------------------------------------

export function ipmiTriggers(features: ServerFeatures): Finding[] {
  const findings: Finding[] = [];

  // PSU rail out-of-spec (deviation from nominal). Two-tier severity
  // (2026-05-23 noise-fix). This signal measures point-in-time deviation
  // from the rail's nominal voltage (|current - nominal| / nominal), NOT
  // change over time. It was previously mislabelled `psu_rail_drift`,
  // which implied a temporal trend it never computed (R-P2-3, val-fleet
  // 2026-05-29; renamed to psu_rail_out_of_spec). True drift over a
  // baseline window is the deferred V2 follow-up.
  //
  // Old threshold was >= 2% deviation fires `high`. That's well inside the
  // ATX-spec ±5% tolerance band AND inside the typical ±1-2% BMC sensor
  // accuracy floor, so healthy rails routinely tripped it. mz62hd was
  // paging four false positives (P_5V at +2.8%, P_3V3 at +3.3%,
  // P_5V_STBY at +2.8%, plus a mis-classified VBAT at -6.2% which was
  // actually a healthy CR2032 — fixed in features.ts).
  //
  // New tiers:
  //   - deviation >= 8%       -> high   (genuinely out-of-spec; ATX limit
  //                                      is ±5% and we double it so the
  //                                      BMC reading-error floor doesn't
  //                                      push a borderline-healthy rail
  //                                      into a paging alert)
  //   - 5% <= deviation < 8%  -> medium (at or past ATX spec edge; worth
  //                                      watching but not paging)
  //   - deviation < 5%        -> no fire (inside spec)
  //
  // +5VSB tolerance: the +5V Standby rail is regulated less tightly than
  // the main +5V (different power path, runs off the BMC island even when
  // the host is "off"). Most boards' BMCs report it idling at 5.10-5.15V
  // by design. Treat its `<= 6%` deviation as no-fire — only escalate it
  // when it crosses into the same high band as the main rails.
  for (const rail of features.ipmi.psu_rails) {
    // Defer to the BMC's own verdict. The board evaluates each rail against
    // its calibrated per-rail thresholds and reports a status word; when that
    // status is "ok" the rail is in spec by the authoritative measure, and a
    // fixed deviation-from-guessed-nominal heuristic must not override it.
    // Server boards routinely regulate rails a few % high yet well inside the
    // vendor's upper-non-critical limit (val gigabyte box: P_5V/P_3V3/P_12V
    // all ~+6% vs our nominal but BMC "ok", 2026-07-15). Only fire when our
    // heuristic AND the hardware agree the rail is off. If the snapshot has no
    // status (older agents), fall back to the heuristic alone.
    if (rail.bmc_status && rail.bmc_status.toLowerCase() === "ok") continue;
    // Standby rails are regulated less tightly; recognize the 3.3V standby
    // ("3VSB") as well as the 5V standby via a generic VSB match (2026-07-14).
    const isStandby = /5v.*stby|stb_5v|vsb|standby/i.test(rail.rail);
    const deviationPct = rail.deviation_pct;
    let severity: "high" | "medium" | null = null;
    if (deviationPct >= 0.08) {
      severity = "high";
    } else if (!isStandby && deviationPct >= 0.05) {
      severity = "medium";
    }
    if (severity === null) continue;
    findings.push({
      type: "psu_rail_out_of_spec",
      severity,
      resource: { kind: "psu", name: rail.rail },
      // window: "current" marks this as a point-in-time deviation metric;
      // the renderer suppresses the meaningless "7d change" badge for it.
      contributing_metrics: [{ name: rail.rail, current: rail.current_v, baseline: rail.nominal_v, delta_1d: 0, delta_7d: 0, delta_30d: 0, burst_max_7d: 0, window: "current" }],
      correlation_match: null,
      tree_ranker_score: null,
      projected_timeline: null,
      // Pre-fix: the evidence claimed "Sustained for N consecutive
      // batches" but `sustained_batches` was hard-coded to 0 in
      // extractIpmiFeatures and nothing in ipmiTriggers gated on it.
      // The persistence-layer gate (2 consecutive batches in the
      // trend_warnings table) provides equivalent false-positive
      // protection. Drop the false precision until cross-batch
      // counting is actually implemented in v1.1. Codex 2026-05-12 P2.
      evidence_summary: `PSU rail ${rail.rail} is at ${rail.current_v.toFixed(3)}V (nominal ${rail.nominal_v}V, ${(deviationPct * 100).toFixed(1)}% out of spec).`,
    });
  }

  // Fan RPM decline (>= 20% below baseline, requires correlation in Stage 3)
  for (const fan of features.ipmi.fans) {
    if (fan.rpm_baseline > 0 && fan.rpm_delta_14d < -(fan.rpm_baseline * 0.20)) {
      findings.push({
        type: "fan_rpm_decline",
        severity: "medium",
        resource: { kind: "fan", name: fan.name, location: fan.zone },
        contributing_metrics: [{ name: "fan_rpm", current: fan.rpm, baseline: fan.rpm_baseline, delta_1d: 0, delta_7d: 0, delta_30d: 0, burst_max_7d: 0, window: "14d" }],
        correlation_match: null,
        tree_ranker_score: null,
        projected_timeline: null,
        evidence_summary: `Fan ${fan.name} RPM dropped from ~${Math.round(fan.rpm_baseline)} to ${fan.rpm} (${Math.round(Math.abs(fan.rpm_delta_14d / fan.rpm_baseline) * 100)}% decline over 14 days).`,
        requires_correlation: true,
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Network triggers
// ---------------------------------------------------------------------------

export function networkTriggers(features: ServerFeatures): Finding[] {
  const findings: Finding[] = [];

  for (const iface of features.network) {
    if (iface.crc_errors_delta_7d > 10 || iface.frame_errors_delta_7d > 10) {
      findings.push({
        type: "nic_errors",
        severity: "medium",
        resource: { kind: "nic", name: iface.iface },
        contributing_metrics: [
          { name: "crc_errors", current: iface.crc_errors_delta_7d, baseline: 0, delta_1d: 0, delta_7d: iface.crc_errors_delta_7d, delta_30d: 0, burst_max_7d: 0, window: "7d" },
          { name: "frame_errors", current: iface.frame_errors_delta_7d, baseline: 0, delta_1d: 0, delta_7d: iface.frame_errors_delta_7d, delta_30d: 0, burst_max_7d: 0, window: "7d" },
        ],
        correlation_match: null,
        tree_ranker_score: null,
        projected_timeline: null,
        evidence_summary: `Interface ${iface.iface}: ${iface.crc_errors_delta_7d} CRC errors and ${iface.frame_errors_delta_7d} frame errors in the last 7 days.`,
        requires_correlation: true,
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Aggregate: run all triggers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Host stability (availability flapping) trigger
// ---------------------------------------------------------------------------

/**
 * A previously-stable host that has started disappearing from the snapshot
 * stream repeatedly (>= 2 gaps in the recent window) at a rate well above its
 * own baseline. A single planned reboot is one gap and does NOT fire; a
 * chronically-flaky host does not fire either (rate must exceed its own
 * baseline).
 *
 * Uptime then disambiguates the cause (the uptime-correlation follow-up):
 *   - reboots across the gaps (uptime reset)  -> host_instability   (hardware:
 *     the crash -> power-cycle -> recover loop that precedes a dead board)
 *   - gaps but uptime kept climbing           -> host_reporting_gaps (the host
 *     stayed powered; agent / network / ingest lost visibility, not hardware)
 *   - no usable uptime (old history)          -> host_instability, hedged
 */
export function hostStabilityTriggers(features: ServerFeatures): Finding[] {
  const findings: Finding[] = [];
  const s = features.instability;
  if (!s) return findings;

  const MIN_RECENT_GAPS = 2; // clustered disappearances, not a single reboot
  if (s.recent_gaps < MIN_RECENT_GAPS) return findings;

  // Only flag a host that was stable and is NOW flapping: the recent gap rate
  // must clearly exceed the baseline rate (a chronically-flaky host stays
  // quiet). No prior baseline gaps clears the bar outright.
  const recentRate = s.recent_days > 0 ? s.recent_gaps / s.recent_days : s.recent_gaps;
  const baselineRate = s.baseline_days > 0 ? s.baseline_gaps / s.baseline_days : 0;
  const newlyUnstable = baselineRate === 0 ? s.baseline_gaps === 0 : recentRate >= baselineRate * 2;
  if (!newlyUnstable) return findings;

  const resource = { kind: "host" as const, name: features.hostname };
  const gapWindow = `${s.recent_days.toFixed(0)}d`;
  const gapLine = `gaps over ${s.gap_threshold_minutes} min; longest ${s.longest_recent_gap_minutes} min`;

  if (!s.uptime_available) {
    // No usable uptime on the gap boundaries (pre-uptime history). Cannot tell
    // a reboot loop from a reporting outage, so keep the cautious framing.
    const severity: "high" | "medium" = s.recent_gaps >= 3 ? "high" : "medium";
    findings.push({
      type: "host_instability",
      severity,
      resource,
      contributing_metrics: [
        { name: "stream_gaps", current: s.recent_gaps, baseline: s.baseline_gaps, delta_1d: 0, delta_7d: s.recent_gaps, delta_30d: 0, burst_max_7d: 0, window: gapWindow },
      ],
      correlation_match: null,
      tree_ranker_score: null,
      projected_timeline: null,
      evidence_summary: `Host stopped reporting ${s.recent_gaps} times in the last ${s.recent_days.toFixed(0)} days (${gapLine}), versus ${s.baseline_gaps} in the prior ${s.baseline_days.toFixed(0)} days. Uptime was not available on the gap boundaries, so this is either repeated reboots (a hardware-failure precursor) or an agent / network outage: check the reboot history to tell which.`,
    });
    return findings;
  }

  if (s.recent_reboot_gaps >= 1) {
    // The host actually rebooted across one or more recent gaps: the crash ->
    // power-cycle -> recover pattern. The hardware concern. Severity scales
    // with the reboot count (a single reboot is medium, a loop is high).
    const severity: "high" | "medium" = s.recent_reboot_gaps >= 3 ? "high" : "medium";
    const plural = s.recent_reboot_gaps === 1 ? "" : "s";
    const lead = `Host rebooted ${s.recent_reboot_gaps} time${plural} in the last ${s.recent_days.toFixed(0)} days (uptime reset across the gaps; longest gap ${s.longest_recent_gap_minutes} min), having been stable before.`;
    // Reserve the hardware-failure-precursor framing for a genuine loop (>= 3,
    // high severity). A low count reads as a false alarm during planned
    // maintenance, so ask the operator to confirm intent first before treating
    // it as hardware.
    const interpretation = severity === "high"
      ? "Repeated unexpected reboots on a previously-stable host commonly precede a permanent hardware failure (power delivery, PSU, RAM, or thermal)."
      : "Unexpected reboots detected; confirm via `last -x reboot shutdown` whether these were planned (maintenance, kernel update) before treating them as a hardware signal.";
    findings.push({
      type: "host_instability",
      severity,
      resource,
      contributing_metrics: [
        { name: "reboots", current: s.recent_reboot_gaps, baseline: 0, delta_1d: 0, delta_7d: s.recent_reboot_gaps, delta_30d: 0, burst_max_7d: 0, window: gapWindow },
      ],
      correlation_match: null,
      tree_ranker_score: null,
      projected_timeline: null,
      evidence_summary: `${lead} ${interpretation}`,
    });
    return findings;
  }

  // Gaps present, but uptime climbed straight through every one: the host
  // stayed powered. This is lost visibility (agent / network / ingest), not a
  // failing machine. Surface it honestly, at medium (a dashboard signal).
  findings.push({
    type: "host_reporting_gaps",
    severity: "medium",
    resource,
    contributing_metrics: [
      { name: "stream_gaps", current: s.recent_gaps, baseline: s.baseline_gaps, delta_1d: 0, delta_7d: s.recent_gaps, delta_30d: 0, burst_max_7d: 0, window: gapWindow },
    ],
    correlation_match: null,
    tree_ranker_score: null,
    projected_timeline: null,
    evidence_summary: `Host stopped reporting ${s.recent_gaps} times in the last ${s.recent_days.toFixed(0)} days (${gapLine}), but its uptime counter kept climbing across every gap: the host stayed powered the whole time. This points to the agent, the network, or the ingest path, not the hardware.`,
  });
  return findings;
}

// ---------------------------------------------------------------------------
// PSU rail voltage drift (slow analog degradation)  [R-P2-3 V2]
// ---------------------------------------------------------------------------

const VDRIFT_PCT_FLOOR = 0.015; // 1.5% of nominal: below this is sensor noise
const VDRIFT_Z_FLOOR = 3;       // recent mean must be >= 3 baseline-sigma away
const VDRIFT_PCT_HIGH = 0.03;   // 3%: a large drift (still inside +/-5% spec)

/**
 * psu_rail_voltage_drift: a fixed (regulated) rail whose RECENT mean has walked
 * away from its own BASELINE mean by more than its historical noise band
 * (>= VDRIFT_Z_FLOOR sigma) AND by a materially large fraction of nominal
 * (>= VDRIFT_PCT_FLOOR). True temporal drift, distinct from the point-in-time
 * psu_rail_out_of_spec deviation: this can fire while the rail is still well
 * inside the +/-5% ATX band, because the point is the TREND, an early marker
 * of analog degradation (ageing VRM or PSU capacitors). Variance-aware and
 * self-baselined, so DVFS core rails and board-specific nominals do not matter.
 */
export function voltageDriftTriggers(features: ServerFeatures): Finding[] {
  const findings: Finding[] = [];
  for (const d of features.voltage_drift ?? []) {
    // Defense in depth against NaN: a rail with no usable readings in the
    // window yields NaN means -> NaN drift_pct/z_score. `NaN < floor` is always
    // false, so without this the two threshold guards below fail open and a
    // garbage NaN drift fires (unpopulated PSU VIN sensors, 2026-07-14). The
    // extractor now drops non-finite readings upstream; this is the backstop.
    if (!Number.isFinite(d.drift_pct) || !Number.isFinite(d.z_score)) continue;
    if (d.drift_pct < VDRIFT_PCT_FLOOR) continue;
    if (d.z_score < VDRIFT_Z_FLOOR) continue;
    const severity: "high" | "medium" = d.drift_pct >= VDRIFT_PCT_HIGH ? "high" : "medium";
    const direction = d.drift_v < 0 ? "down" : "up";
    findings.push({
      type: "psu_rail_voltage_drift",
      severity,
      resource: { kind: "psu", name: d.rail },
      contributing_metrics: [
        { name: d.rail, current: d.recent_mean_v, baseline: d.baseline_mean_v, delta_1d: 0, delta_7d: d.drift_v, delta_30d: 0, burst_max_7d: 0, window: "7d-vs-baseline" },
      ],
      correlation_match: null,
      tree_ranker_score: null,
      projected_timeline: null,
      evidence_summary: `PSU rail ${d.rail} has drifted ${direction} from a baseline mean of ${d.baseline_mean_v}V to ${d.recent_mean_v}V over the last 7 days (${(d.drift_pct * 100).toFixed(1)}% of the ${d.nominal_v}V nominal, ${d.z_score.toFixed(1)} sigma beyond its typical +/-${d.baseline_stddev_v}V noise band). Still inside the +/-5% ATX tolerance, but a steady walk away from a rail's historical mean is an early marker of analog degradation (ageing VRM or PSU capacitors).`,
    });
  }
  return findings;
}

// A drive that was consistently present and then vanished from telemetry while
// the host kept reporting. Standalone / non-RAID disks are invisible to
// raid_degraded and smart_failing when they de-enumerate, so this is the only
// signal for "a disk dropped off the bus / unseated / failed hard". Medium
// severity with advisory wording: a planned hot-swap or decommission looks
// identical from telemetry, so the operator confirms whether it was expected.
export function missingDriveTriggers(features: ServerFeatures): Finding[] {
  const findings: Finding[] = [];
  for (const d of features.missing_drives ?? []) {
    findings.push({
      type: "drive_disappeared",
      severity: "medium",
      resource: { kind: "drive", name: d.device, serial: d.serial, model: d.model, vendor: d.vendor },
      contributing_metrics: [{
        name: "missing_for_minutes",
        current: d.missing_for_minutes,
        baseline: 0,
        delta_1d: 0,
        delta_7d: 0,
        delta_30d: 0,
        burst_max_7d: 0,
        window: "current",
      }],
      correlation_match: null,
      tree_ranker_score: null,
      projected_timeline: null,
      evidence_summary: `Drive ${d.device} (${d.model}, serial ${d.serial}) was present in ${d.observations} snapshots over ${d.present_span_hours}h and has been absent from telemetry for ${d.missing_for_minutes} min while the host kept reporting (${d.host_snapshots_since} snapshots since it vanished). A standalone disk that de-enumerates like this is invisible to the RAID and SMART rules.`,
    });
  }
  return findings;
}

export function runDeterministicTriggers(features: ServerFeatures): Finding[] {
  return [
    ...storageTriggers(features),
    ...nvmeTriggers(features),
    ...missingDriveTriggers(features),
    ...diskSpaceTriggers(features),
    ...ipmiTriggers(features),
    ...networkTriggers(features),
    ...hostStabilityTriggers(features),
    ...voltageDriftTriggers(features),
    // ECC triggers will be added when rasdaemon/edac collection ships in Crucible
  ];
}
