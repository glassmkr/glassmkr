// Public types for the cross-snapshot library.
//
// CC_SPEC_CROSS_SNAPSHOT_LIBRARY_2026-05-19.md §1.2. The library has two
// consumers: the trend-warnings job (raw SnapshotRow path, fast) and the
// per-snapshot alert evaluator (parsed: true path, typed). Both share the
// same readWindow + primitives.

/** Time-based snapshot window expressed relative to "now". */
export interface TimeWindow {
  /** Inclusive lower bound, relative to now. */
  fromSecondsAgo: number;
  /** Default 0 (= now). */
  toSecondsAgo?: number;
}

/** Count-based window: most recent N snapshots regardless of time. */
export interface SnapshotCountWindow {
  count: number;
}

/**
 * Snapshot columns the library knows how to read. Adding a new column
 * requires updating the ClickHouse SELECT in read_window.ts AND adding
 * an entry here. The Zod rule schema (Phase 2) re-uses this enum.
 */
export type SnapshotColumn =
  | "timestamp"
  | "uptime_seconds"
  | "smart"
  | "disks"
  | "ipmi"
  | "network"
  | "zfs"
  | "io_latency"
  | "cpu"
  | "memory"
  | "psi"
  | "vmstat"
  | "reboot_evidence"
  | "hardware_raid"
  | "ecc_edac"
  | "security";

export interface ReadWindowOptions {
  /** Default ['timestamp']. */
  columns?: SnapshotColumn[];
  /**
   * Default false. When true, JSON-string columns are parsed through
   * the malformed-shape-tolerant safeParse guards (Codex 2026-05-12 P2
   * fix) and returned as typed objects. Trend-warnings stays on the
   * raw path; alert evaluator opts into parsed.
   */
  parsed?: boolean;
}

/**
 * A single snapshot row. `timestamp` is always present and always a
 * number (unix ms). Other columns are either JSON strings (parsed=false)
 * or parsed objects (parsed=true). Type-narrowing per consumer is the
 * consumer's responsibility — matches the existing trend-warnings
 * pattern.
 */
export interface SnapshotRow {
  timestamp: number;
  [column: string]: unknown;
}

export interface TimeseriesPoint {
  t: number;
  v: number;
}

export interface ProjectionResult {
  slope_per_day: number;
  /** Unix ms when projection crosses threshold; null when no crossing. */
  crosses_at_ms: number | null;
}

export interface RateResult {
  rate_per_second: number;
  rate_per_day: number;
}

export interface CrossingResult {
  first_crossed_at_ms: number;
  value_at_crossing: number;
}

export interface CorrelationResult {
  /** Rule types (alert_type) that have active alerts on this host. */
  matched: string[];
  /** Unix ms of the oldest first_seen across matched rules; null when empty. */
  oldest_first_seen_ms: number | null;
}
