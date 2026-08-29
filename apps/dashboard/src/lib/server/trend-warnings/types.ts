// Shared types for the trend warnings system.
// Spec: 07-trend-warnings-spec-v2.md

/** A single contributing metric observation within a finding. */
export interface ContributingMetric {
  name: string;
  current: number;
  baseline: number;
  delta_1d: number;
  delta_7d: number;
  delta_30d: number;
  burst_max_7d: number;
  window: string;
}

/** Resource identifier attached to a finding (drive, DIMM, NIC, partition, etc.). */
export interface ResourceInfo {
  kind: "drive" | "nvme" | "dimm" | "nic" | "partition" | "fan" | "psu" | "host";
  name: string;
  serial?: string;
  model?: string;
  vendor?: string;
  location?: string; // DIMM socket/channel/slot, fan zone, etc.
}

/** A raw finding emitted by a deterministic trigger (Stage 2). */
export interface Finding {
  type: string;
  severity: "high" | "medium";
  resource: ResourceInfo;
  contributing_metrics: ContributingMetric[];
  correlation_match: string | null;
  tree_ranker_score: number | null;
  projected_timeline: string | null;
  evidence_summary: string;
  /** If true, this finding alone is not sufficient for notification;
   *  it must pass a correlation rule in Stage 3. */
  requires_correlation?: boolean;
}

/** Urgency tier computed from severity + projected timeline. */
export type UrgencyTier = "imminent" | "soon" | "scheduled" | "watch";

/** LLM narration output (or template fallback). */
export interface Narration {
  headline: string;
  evidence_summary: string;
  uncertainty_statement: string;
  recommended_checks: string[];
  recommended_actions: string[];
}

/** Computed feature set for a single SMART/NVMe drive. */
export interface DriveFeatures {
  device: string;
  serial: string;
  model: string;
  vendor: string;
  smart_5_raw: number;
  smart_5_delta_1d: number;
  smart_5_delta_7d: number;
  smart_5_delta_30d: number;
  smart_5_burst_max_7d: number;
  smart_187_raw: number;
  smart_187_delta_1d: number;
  smart_187_delta_7d: number;
  smart_187_delta_30d: number;
  smart_187_burst_max_7d: number;
  smart_188_raw: number;
  smart_188_delta_1d: number;
  smart_188_delta_7d: number;
  smart_188_delta_30d: number;
  smart_188_burst_max_7d: number;
  smart_189_raw: number;
  smart_189_delta_1d: number;
  smart_189_delta_7d: number;
  smart_189_delta_30d: number;
  smart_189_burst_max_7d: number;
  smart_197_raw: number;
  smart_197_delta_1d: number;
  smart_197_delta_7d: number;
  smart_197_delta_30d: number;
  smart_197_burst_max_7d: number;
  /** Distinct 0->nonzero episodes for SMART 197 (current pending sectors)
   *  across the window: how many times a pending sector appeared and (usually)
   *  cleared. Surfaces an intermittently-flaking drive that the delta and
   *  step-change triggers miss, because the value oscillates around zero with
   *  no net trend and never reallocates (smart_5 stays flat). */
  smart_197_recurrence_count: number;
  smart_198_raw: number;
  smart_198_delta_1d: number;
  smart_198_delta_7d: number;
  smart_198_delta_30d: number;
  smart_198_burst_max_7d: number;
  /** Distinct 0->nonzero episodes for SMART 198 (offline uncorrectable) across
   *  the window. Same intermittent-recurrence signal as smart_197_recurrence_count. */
  smart_198_recurrence_count: number;
  /** SMART 199 (UDMA CRC error count): errors on the LINK between controller and
   *  drive, so a cable, connector or backplane signal rather than a media one.
   *  Kept here rather than in the alert evaluator because the raw count is a
   *  LIFETIME LATCH that never decreases: a drive that had one bad cable event
   *  years ago reads nonzero forever, so `> 0` alerts permanently on healthy
   *  hardware. Only GROWTH means anything, and growth needs history the
   *  per-snapshot evaluator does not have. */
  smart_199_raw: number;
  smart_199_delta_1d: number;
  smart_199_delta_7d: number;
  smart_199_delta_30d: number;
  /** Days since the earliest observation for this drive in the retention
   *  window. Capped by retention (7d Free, 90d Pro); the training data's
   *  drive_age_days spans years, so treat this as a lower-bound feature
   *  and expect the tree ranker's score to be biased low for aged drives. */
  drive_age_days: number;
  health_passed: boolean;
  // NVMe-specific (null for HDD/SSD)
  nvme_critical_warning?: number;
  nvme_available_spare?: number;
  nvme_available_spare_threshold?: number;
  nvme_media_errors?: number;
  nvme_media_errors_delta_7d?: number;
  nvme_percentage_used?: number;
  // Latency (from /proc/diskstats or iostat deltas in snapshots)
  p99_read_latency_ms?: number;
  p99_write_latency_ms?: number;
  latency_baseline_30d?: number;
  latency_sustained_batches?: number;
}

/** Computed feature set for a partition (disk space prediction). */
export interface PartitionFeatures {
  mount: string;
  device: string;
  total_bytes: number;
  used_bytes: number;
  use_pct: number;
  /** Bytes-per-day growth rate from linear regression over last 6 hours. */
  slope_bytes_per_day: number;
}

/** Computed feature set for IPMI sensors. */
export interface IpmiFeatures {
  fans: Array<{
    name: string;
    rpm: number;
    rpm_delta_14d: number;
    rpm_baseline: number;
    zone?: string;
  }>;
  psu_rails: Array<{
    rail: string;
    current_v: number;
    nominal_v: number;
    // Deviation from nominal: |current - nominal| / nominal. This is a
    // point-in-time out-of-spec measure, NOT change over time (true drift
    // is the deferred R-P2-3 V2 signal). Named `deviation_pct` so the
    // field stops implying a temporal trend it doesn't measure.
    deviation_pct: number;
    sustained_batches: number;
    // The BMC's own status word for this sensor ("ok" / "nc" / "cr" / ...),
    // as reported by `ipmitool sensor`. The BMC evaluates each rail against
    // the board's calibrated per-rail thresholds, so "ok" is the authoritative
    // in-spec signal and the out-of-spec trigger defers to it.
    bmc_status?: string;
  }>;
  temps: Array<{
    name: string;
    current_c: number;
    delta_7d: number;
  }>;
}

/** Top-level extracted features for a server, consumed by trigger modules. */
export interface ServerFeatures {
  server_id: string;
  hostname: string;
  drives: DriveFeatures[];
  partitions: PartitionFeatures[];
  ipmi: IpmiFeatures;
  ecc: Array<{
    dimm_location: string;
    ce_count_24h: number;
    ce_count_7d: number;
    ce_rate_7d: number;
    ce_rate_30d: number;
  }>;
  network: Array<{
    iface: string;
    crc_errors_delta_7d: number;
    frame_errors_delta_7d: number;
    tcp_retransmits_delta_7d: number;
  }>;
  zfs: Array<{
    pool: string;
    device: string;
    device_serial?: string;
    cksum_errors: number;
    read_errors: number;
    write_errors: number;
  }>;
  /** Host-level availability stability. A "gap" is a stretch where the host
   *  stopped reporting snapshots for materially longer than its own cadence
   *  (crash / reboot / unreachable, regardless of cause). A previously-stable
   *  host that starts gapping repeatedly is the canonical signature of failing
   *  hardware (power-delivery, PSU, RAM, thermal) about to fail permanently.
   *  Board- and sensor-agnostic: derived from the snapshot timeline alone. */
  instability?: {
    recent_gaps: number;        // gaps ending within the recent window
    recent_days: number;        // span of the recent window actually observed
    baseline_gaps: number;      // gaps before the recent window
    baseline_days: number;      // span of the baseline window actually observed
    longest_recent_gap_minutes: number;
    gap_threshold_minutes: number; // the cadence-derived "this is a real gap" cutoff
    /** Of the recent gaps, how many coincided with a reboot (uptime_seconds
     *  reset across the gap). Lets the trigger separate a crash/reboot loop
     *  (hardware) from a host that merely stopped reporting while staying up
     *  (agent / network / ingest). */
    recent_reboot_gaps: number;
    /** Whether we had usable uptime_seconds on the gap boundaries to judge
     *  reboots at all. False for pre-uptime-collection history; the trigger
     *  then falls back to the cautious, undifferentiated wording. */
    uptime_available: boolean;
  };
  /** Per-rail voltage DRIFT over the retention window: how far each fixed
   *  (regulated) PSU rail's RECENT mean has moved from its own BASELINE mean,
   *  measured in standard deviations of its baseline noise. Distinct from
   *  psu_rail_out_of_spec (point-in-time deviation from a guessed nominal): a
   *  rail can sit comfortably inside the +/-5% ATX band yet be slowly walking
   *  away from where it has historically sat, which is an early marker of
   *  analog degradation (ageing VRM or PSU capacitors, regulator wear).
   *  Variance-aware, so load-dependent (DVFS) core rails, which swing by design
   *  and carry a large baseline sigma, do not trip on a mean shift well inside
   *  their normal range. Self-baselined, so no board-specific thresholds. */
  voltage_drift?: Array<{
    rail: string;
    nominal_v: number;
    baseline_mean_v: number;
    baseline_stddev_v: number;
    recent_mean_v: number;
    drift_v: number;   // recent_mean - baseline_mean (signed)
    drift_pct: number; // |drift_v| / nominal_v
    z_score: number;   // |drift_v| / max(baseline_stddev, sensor_floor)
    baseline_samples: number;
    recent_samples: number;
  }>;
  /** Physical drives that were consistently present in the snapshot history and
   *  have since dropped out of telemetry while the HOST kept reporting - i.e. a
   *  disk that de-enumerated (dropped off the bus, unseated, controller dropped
   *  it, or failed hard so it stopped presenting to /sys/block). This is the gap
   *  raid_degraded and smart_failing miss for a standalone / non-RAID disk,
   *  which simply vanishes with no signal. Keyed on serial to avoid /dev-path
   *  reshuffle false-positives; drives without a serial cannot be tracked and
   *  are excluded. A whole host going quiet produces NO entries here (every
   *  drive's last-seen equals the host's), so this never overlaps
   *  server_unreachable. */
  missing_drives?: Array<{
    device: string;              // last-known /dev path
    serial: string;
    model: string;
    vendor: string;
    observations: number;        // snapshots it appeared in (how established it was)
    present_span_hours: number;  // first-seen -> last-seen span
    missing_for_minutes: number; // host_last_seen - drive_last_seen
    host_snapshots_since: number; // host snapshots recorded after it vanished
  }>;
}
