// Feature extraction for trend warnings.
//
// Reads recent snapshots from ClickHouse and computes first-differences,
// burst-max, and baselines for each metric category. The output is a
// ServerFeatures struct consumed by the deterministic trigger modules.
//
// Spec: 07-trend-warnings-spec-v2.md, Stage 1
//
// 2026-05-19: migrated to consume the cross-snapshot library per
// CC_SPEC_CROSS_SNAPSHOT_LIBRARY_2026-05-19.md §1.9. The inline
// ClickHouse query, linearRegressionSlope, find/burstMax closures,
// DAY constant, and safeParse helper have all moved into
// $lib/server/cross_snapshot. Behavior is unchanged — same inputs
// produce the same ServerFeatures.

import { clickhouse } from "@glassmkr/db/clickhouse";

import {
  DAY_MS,
  findNearestByTime,
  largestPositiveStepInWindow,
  linearProjection,
  readWindow,
  safeParse,
  type SnapshotRow,
} from "../cross_snapshot/index.js";
import type {
  ServerFeatures,
  DriveFeatures,
  PartitionFeatures,
  IpmiFeatures,
} from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Back-compat re-export. trend-warnings tests import this name; the
 * implementation now lives in the cross-snapshot library.
 */
export function linearRegressionSlope(
  points: Array<{ t: number; v: number }>,
): number {
  return linearProjection(points).slope_per_day;
}

// ---------------------------------------------------------------------------
// Main extraction
// ---------------------------------------------------------------------------

/**
 * Extract features for a single server from its last 30 days of snapshots.
 * Falls back gracefully when data is missing (e.g. server has < 30 days of
 * history or doesn't expose certain metrics).
 */
export async function extractFeatures(serverId: string): Promise<ServerFeatures> {
  // Pull the last 30 days of snapshots (at most ~8640 rows at 5-min intervals).
  // readWindow returns raw SnapshotRow objects (parsed: false default) to
  // preserve the trend-warnings fast path. JSON columns stay as strings;
  // safeParse runs in the per-section extractors below.
  const rows = (await readWindow(
    serverId,
    { fromSecondsAgo: 30 * 86_400 },
    { columns: ["timestamp", "uptime_seconds", "smart", "disks", "ipmi", "network", "zfs", "io_latency"] },
  )) as TwSnapshotRow[];

  // Also grab hostname from the latest snapshot.
  // Kept inline (single-row meta query, not a windowed read).
  const latestMeta = await clickhouse
    .query({
      query: `SELECT hostname FROM snapshots WHERE server_id = {serverId:String} ORDER BY timestamp DESC LIMIT 1`,
      query_params: { serverId },
      format: "JSONEachRow",
    })
    .then((r) => r.json<{ hostname: string }>());

  const hostname = latestMeta[0]?.hostname ?? serverId;

  return {
    server_id: serverId,
    hostname,
    drives: extractDriveFeatures(rows),
    partitions: extractPartitionFeatures(rows),
    ipmi: extractIpmiFeatures(rows),
    ecc: [], // TODO(fast-follow): EDAC collection now EXISTS in Crucible (snapshot.ecc_edac); this feature is not wired to it yet
    network: extractNetworkFeatures(rows),
    zfs: extractZfsFeatures(rows),
    instability: extractInstabilityFeatures(rows),
    voltage_drift: extractVoltageDriftFeatures(rows),
    missing_drives: extractMissingDrives(rows),
  };
}

// ---------------------------------------------------------------------------
// Snapshot row type (trend-warnings flavour)
// ---------------------------------------------------------------------------

/**
 * Locally-typed projection over SnapshotRow. The cross-snapshot library
 * returns rows with `timestamp: number` (unix ms) and other columns as
 * `unknown`. Trend-warnings narrows each column at use-site via safeParse.
 */
export interface TwSnapshotRow extends SnapshotRow {
  timestamp: number;
  uptime_seconds?: number; // scalar column; 0 or absent when the host did not report it
  smart: string | unknown;
  disks: string | unknown;
  ipmi: string | unknown;
  network: string | unknown;
  zfs: string | unknown;
  io_latency?: string | unknown;
}

// ---------------------------------------------------------------------------
// Drive features (SMART + NVMe)
// ---------------------------------------------------------------------------

interface SmartEntry {
  device: string;
  serial?: string;
  model?: string;
  // Crucible 0.14.0+: controller family for a HW-RAID-passthrough drive
  // ("megaraid", ...); omitted for direct disks. Carried for context/labelling;
  // trend logic keys on serial regardless of transport.
  transport?: string;
  backing_device?: string;
  health?: string;
  reallocated_sectors?: number;
  reported_uncorrectable?: number;
  command_timeout?: number;
  high_fly_writes?: number;
  pending_sectors?: number;
  offline_uncorrectable?: number;
  // SMART 199. Name must match what the collector emits (crucible
  // src/lib/types.ts SmartInfo), per the warning below: ClickHouse stores
  // snap.smart verbatim, so a mismatch here silently reads as absent.
  udma_crc_errors?: number;
  temperature?: number;
  power_on_hours?: number;
  percentage_used?: number;
  // NVMe field names MUST match what the collector emits (crucible
  // src/lib/types.ts SmartInfo) - ClickHouse stores snap.smart verbatim, so a
  // name mismatch here silently zeroes the value and kills the NVMe triggers.
  critical_warning_raw?: number;
  nvme_available_spare?: number;
  nvme_available_spare_threshold?: number;
  media_errors?: number;
}

export function extractDriveFeatures(rows: TwSnapshotRow[]): DriveFeatures[] {
  if (rows.length === 0) return [];

  // Build per-drive time series: { [serial]: Array<{ ts, entry }> }
  const driveHistory = new Map<string, Array<{ ts: number; entry: SmartEntry }>>();

  for (const row of rows) {
    const entries = safeParse<SmartEntry[]>(row.smart, []);
    const ts = row.timestamp;
    for (const entry of entries) {
      const key = entry.serial || entry.device;
      if (!driveHistory.has(key)) driveHistory.set(key, []);
      driveHistory.get(key)!.push({ ts, entry });
    }
  }

  const results: DriveFeatures[] = [];

  for (const [serial, history] of driveHistory) {
    if (history.length === 0) continue;
    const latest = history[history.length - 1]!.entry;
    const latestTs = history[history.length - 1]!.ts;

    // Find reference points by time (closest snapshot within 2 days).
    const find = (daysAgo: number): SmartEntry | null => {
      const target = latestTs - daysAgo * DAY_MS;
      // Adapt history (ts/entry) -> TimeseriesPoint by using the index
      // as v; we only care about t-matching. Recover the entry by
      // index after the nearest-by-time lookup.
      const points = history.map((h, i) => ({ t: h.ts, v: i }));
      const nearest = findNearestByTime(points, target, 2 * DAY_MS);
      return nearest ? history[nearest.v]!.entry : null;
    };

    const ref1d = find(1);
    const ref7d = find(7);
    const ref30d = find(30);

    // Compute burst-max: largest single-interval delta in last 7 days.
    // Uses largestPositiveStepInWindow per SMART attribute. Snapshots written
    // by an agent that did not yet collect the attribute are SKIPPED, not
    // read as 0: otherwise the first fleet roll that adds an attribute turns
    // every longstanding-nonzero drive into a fake 0->raw step (a fleet-wide
    // false burst/step-change/first-appearance wave for a full window).
    const burstMax = (attr: (e: SmartEntry) => number | undefined) => {
      const points = history
        .filter((h) => attr(h.entry) != null)
        .map((h) => ({ t: h.ts, v: attr(h.entry)! }));
      return largestPositiveStepInWindow(points, 7 * 86_400);
    };

    // Recurrence: count of distinct 0->nonzero transitions (rising edges) across
    // the window. Captures an intermittently-flaking attribute (e.g. a pending
    // sector that appears and clears repeatedly) that the delta and step-change
    // features miss, because the value oscillates around zero with no net trend.
    // A single held episode (nonzero across many snapshots) counts once.
    const recurrenceCount = (attr: (e: SmartEntry) => number | undefined) => {
      let count = 0;
      let prev = 0;
      for (const h of history) {
        const v = attr(h.entry);
        if (v == null) continue; // attribute not collected yet: no edge
        if (v > 0 && prev === 0) count++;
        prev = v;
      }
      return count;
    };

    // Raw accessors preserve absence (an agent that predates the attribute)
    // so delta and the series helpers can tell "not collected" from a
    // genuine 0. The zero-coalescing wrappers stay for current-value reads.
    const s5raw = (e: SmartEntry) => e.reallocated_sectors;
    const s187raw = (e: SmartEntry) => e.reported_uncorrectable;
    const s188raw = (e: SmartEntry) => e.command_timeout;
    const s189raw = (e: SmartEntry) => e.high_fly_writes;
    const s197raw = (e: SmartEntry) => e.pending_sectors;
    const s198raw = (e: SmartEntry) => e.offline_uncorrectable;
    const s199raw = (e: SmartEntry) => e.udma_crc_errors;
    const s5 = (e: SmartEntry) => s5raw(e) ?? 0;
    const s187 = (e: SmartEntry) => s187raw(e) ?? 0;
    const s188 = (e: SmartEntry) => s188raw(e) ?? 0;
    const s189 = (e: SmartEntry) => s189raw(e) ?? 0;
    const s197 = (e: SmartEntry) => s197raw(e) ?? 0;
    const s198 = (e: SmartEntry) => s198raw(e) ?? 0;
    const s199 = (e: SmartEntry) => s199raw(e) ?? 0;

    // A reference snapshot that predates collection of the attribute is NO
    // reference (delta 0), not a zero baseline; see the burstMax comment.
    const delta = (current: number, ref: SmartEntry | null, attr: (e: SmartEntry) => number | undefined) => {
      if (!ref) return 0;
      const r = attr(ref);
      return r == null ? 0 : current - r;
    };

    const isNvme =
      latest.percentage_used != null ||
      latest.critical_warning_raw != null ||
      latest.media_errors != null;

    // drive_age_days is the span (in days) from the earliest observation
    // for this drive in the retention window to the latest. Capped by
    // retention; documented training-vs-runtime distribution mismatch.
    const earliestTs = history[0]!.ts;
    const driveAgeDays = Math.max(0, Math.floor((latestTs - earliestTs) / DAY_MS));

    results.push({
      device: latest.device,
      serial: serial,
      model: latest.model ?? "unknown",
      vendor: guessVendor(latest.model ?? ""),
      drive_age_days: driveAgeDays,
      smart_5_raw: s5(latest),
      smart_5_delta_1d: delta(s5(latest), ref1d, s5raw),
      smart_5_delta_7d: delta(s5(latest), ref7d, s5raw),
      smart_5_delta_30d: delta(s5(latest), ref30d, s5raw),
      smart_5_burst_max_7d: burstMax(s5raw),
      smart_187_raw: s187(latest),
      smart_187_delta_1d: delta(s187(latest), ref1d, s187raw),
      smart_187_delta_7d: delta(s187(latest), ref7d, s187raw),
      smart_187_delta_30d: delta(s187(latest), ref30d, s187raw),
      smart_187_burst_max_7d: burstMax(s187raw),
      smart_188_raw: s188(latest),
      smart_188_delta_1d: delta(s188(latest), ref1d, s188raw),
      smart_188_delta_7d: delta(s188(latest), ref7d, s188raw),
      smart_188_delta_30d: delta(s188(latest), ref30d, s188raw),
      smart_188_burst_max_7d: burstMax(s188raw),
      smart_189_raw: s189(latest),
      smart_189_delta_1d: delta(s189(latest), ref1d, s189raw),
      smart_189_delta_7d: delta(s189(latest), ref7d, s189raw),
      smart_189_delta_30d: delta(s189(latest), ref30d, s189raw),
      smart_189_burst_max_7d: burstMax(s189raw),
      smart_197_raw: s197(latest),
      smart_197_delta_1d: delta(s197(latest), ref1d, s197raw),
      smart_197_delta_7d: delta(s197(latest), ref7d, s197raw),
      smart_197_delta_30d: delta(s197(latest), ref30d, s197raw),
      smart_197_burst_max_7d: burstMax(s197raw),
      smart_197_recurrence_count: recurrenceCount(s197raw),
      smart_198_raw: s198(latest),
      smart_198_delta_1d: delta(s198(latest), ref1d, s198raw),
      smart_198_delta_7d: delta(s198(latest), ref7d, s198raw),
      smart_198_delta_30d: delta(s198(latest), ref30d, s198raw),
      smart_198_burst_max_7d: burstMax(s198raw),
      smart_198_recurrence_count: recurrenceCount(s198raw),
      smart_199_raw: s199(latest),
      smart_199_delta_1d: delta(s199(latest), ref1d, s199raw),
      smart_199_delta_7d: delta(s199(latest), ref7d, s199raw),
      smart_199_delta_30d: delta(s199(latest), ref30d, s199raw),
      health_passed: !latest.health || latest.health === "PASSED",
      // NVMe fields
      ...(isNvme
        ? {
            nvme_critical_warning: latest.critical_warning_raw ?? 0,
            nvme_available_spare: latest.nvme_available_spare,
            nvme_available_spare_threshold: latest.nvme_available_spare_threshold,
            nvme_media_errors: latest.media_errors ?? 0,
            nvme_media_errors_delta_7d: delta(
              latest.media_errors ?? 0,
              ref7d,
              (e) => e.media_errors,
            ),
            nvme_percentage_used: latest.percentage_used,
          }
        : {}),
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Missing-drive detection (a physical disk that de-enumerated)
// ---------------------------------------------------------------------------

// Thresholds for "this drive was a fixture and is now gone" (5-min cadence).
const MISSING_MIN_OBSERVATIONS = 6;                     // ~30 min: an established drive
const MISSING_MIN_PRESENT_SPAN_MS = 60 * 60 * 1000;     // present >= 1h before vanishing
const MISSING_MIN_GAP_MS = 20 * 60 * 1000;              // absent >= 20 min (several missed snapshots)
const MISSING_MIN_HOST_SNAPSHOTS_SINCE = 2;             // host reported >= 2x without it

/**
 * Detect drives that were consistently present and then dropped out of
 * telemetry while the host kept reporting. See ServerFeatures.missing_drives.
 * Serial-keyed (a bare /dev path reshuffles and would false-positive);
 * serial-less drives are skipped. Comparing drive-last-seen to HOST-last-seen
 * means a whole-host outage produces nothing here (that is server_unreachable).
 */
export function extractMissingDrives(rows: TwSnapshotRow[]): NonNullable<ServerFeatures["missing_drives"]> {
  if (rows.length === 0) return [];

  const hostTimestamps = rows.map((r) => r.timestamp).sort((a, b) => a - b);
  const hostLastTs = hostTimestamps[hostTimestamps.length - 1]!;

  const history = new Map<string, { device: string; model?: string; firstTs: number; lastTs: number; count: number }>();
  // Last snapshot ts each device PATH appeared at, tracked for every entry
  // including serial-less ones. Serial is optional in the ingest schema while
  // device is required, so a present, still-enumerating drive can report
  // without a serial for a stretch (transient smartctl failure). This lets the
  // fire loop suppress a false de-enumeration when the path is still reporting.
  const deviceLastSeen = new Map<string, number>();
  for (const row of rows) {
    const entries = safeParse<SmartEntry[]>(row.smart, []);
    for (const entry of entries) {
      const prevSeen = deviceLastSeen.get(entry.device);
      if (prevSeen === undefined || row.timestamp > prevSeen) deviceLastSeen.set(entry.device, row.timestamp);
      const serial = entry.serial;
      if (!serial) continue; // cannot track a drive without a stable serial
      const h = history.get(serial);
      if (!h) {
        history.set(serial, { device: entry.device, model: entry.model, firstTs: row.timestamp, lastTs: row.timestamp, count: 1 });
      } else {
        h.lastTs = row.timestamp;
        h.count += 1;
        h.device = entry.device; // keep the last-known path
        if (entry.model) h.model = entry.model;
      }
    }
  }

  const out: NonNullable<ServerFeatures["missing_drives"]> = [];
  for (const [serial, h] of history) {
    const gap = hostLastTs - h.lastTs;
    const presentSpan = h.lastTs - h.firstTs;
    if (h.count < MISSING_MIN_OBSERVATIONS) continue;         // never established
    if (presentSpan < MISSING_MIN_PRESENT_SPAN_MS) continue;  // a brief blip, not a fixture
    if (gap < MISSING_MIN_GAP_MS) continue;                   // still present / single miss
    const hostSnapshotsSince = hostTimestamps.filter((t) => t > h.lastTs).length;
    if (hostSnapshotsSince < MISSING_MIN_HOST_SNAPSHOTS_SINCE) continue; // host barely reported since
    // Suppress a false de-enumeration: if this drive's device PATH is still
    // reporting in a snapshot after its serial last appeared, the drive is
    // present and merely serial-less recently (transient smartctl failure),
    // not gone. The genuine-de-enumeration path (device path also stopped
    // appearing) is unaffected.
    const deviceSeenTs = deviceLastSeen.get(h.device);
    if (deviceSeenTs !== undefined && deviceSeenTs > h.lastTs) continue;
    out.push({
      device: h.device,
      serial,
      model: h.model ?? "unknown",
      vendor: guessVendor(h.model ?? ""),
      observations: h.count,
      present_span_hours: Math.round((presentSpan / 3_600_000) * 10) / 10,
      missing_for_minutes: Math.round(gap / 60_000),
      host_snapshots_since: hostSnapshotsSince,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Partition features (disk space prediction)
// ---------------------------------------------------------------------------

interface DiskEntry {
  mount: string;
  device?: string;
  total_gb?: number;
  used_gb?: number;
  available_gb?: number;
  percent_used?: number;
}

function extractPartitionFeatures(rows: TwSnapshotRow[]): PartitionFeatures[] {
  if (rows.length === 0) return [];

  // Use the last 6 hours of data for the linear regression slope.
  const latestTs = rows[rows.length - 1]!.timestamp;
  const sixHoursAgo = latestTs - 6 * 3_600_000;
  const recentRows = rows.filter((r) => r.timestamp >= sixHoursAgo);

  // Build per-mount time series.
  const mountHistory = new Map<string, Array<{ t: number; used: number; total: number }>>();

  for (const row of recentRows) {
    const disks = safeParse<DiskEntry[]>(row.disks, []);
    const ts = row.timestamp;
    for (const d of disks) {
      if (!d.mount || d.total_gb == null || d.used_gb == null) continue;
      if (!mountHistory.has(d.mount)) mountHistory.set(d.mount, []);
      mountHistory.get(d.mount)!.push({
        t: ts,
        used: d.used_gb * 1_073_741_824, // GB to bytes
        total: d.total_gb * 1_073_741_824,
      });
    }
  }

  const latest = safeParse<DiskEntry[]>(rows[rows.length - 1]!.disks, []);
  const results: PartitionFeatures[] = [];

  for (const d of latest) {
    if (!d.mount || d.total_gb == null || d.used_gb == null) continue;
    const history = mountHistory.get(d.mount) ?? [];
    const points = history.map((h) => ({ t: h.t, v: h.used }));
    const slope = linearProjection(points).slope_per_day;

    results.push({
      mount: d.mount,
      device: d.device ?? "unknown",
      total_bytes: d.total_gb * 1_073_741_824,
      used_bytes: d.used_gb * 1_073_741_824,
      use_pct: d.percent_used ?? 0,
      slope_bytes_per_day: slope,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// IPMI features
// ---------------------------------------------------------------------------

interface IpmiSensor {
  name: string;
  value?: number;
  unit?: string;
  status?: string;
}

/**
 * Crucible's snapshot schema (see ingest/snapshot-schema.ts:139) wraps the
 * sensor array in an object: `{ available, sensors: IpmiSensor[], ecc_errors,
 * sel_entries_count, ... }`. Older ClickHouse rows (pre-0.8.0) stored a bare
 * array. Codex F2 review 2026-05-22 caught that this extractor was calling
 * `safeParse<IpmiSensor[]>(row.ipmi, [])` on the current shape, getting `[]`
 * back, and silently producing no fan/PSU/temp trend warnings fleet-wide.
 *
 * Accept both shapes so backfill against historical snapshots keeps working.
 */
function readIpmiSensors(raw: unknown): IpmiSensor[] {
  // Legacy: bare array.
  const asArray = safeParse<IpmiSensor[]>(raw, []);
  if (Array.isArray(asArray) && asArray.length > 0 && typeof asArray[0] === "object") {
    return asArray;
  }
  // Current: { available, sensors: [...] }.
  const asObject = safeParse<{ sensors?: IpmiSensor[] }>(raw, {});
  if (asObject && Array.isArray(asObject.sensors)) {
    return asObject.sensors;
  }
  return [];
}

export function extractIpmiFeatures(rows: TwSnapshotRow[]): IpmiFeatures {
  const empty: IpmiFeatures = { fans: [], psu_rails: [], temps: [] };
  if (rows.length === 0) return empty;

  const latest = readIpmiSensors(rows[rows.length - 1]!.ipmi);
  if (latest.length === 0) return empty;

  const latestTs = rows[rows.length - 1]!.timestamp;

  // Find a reference snapshot ~14 days ago for fan RPM decline.
  // findNearestByTime needs TimeseriesPoint[]; map row->point with index as v.
  const tsPoints = rows.map((r, i) => ({ t: r.timestamp, v: i }));

  const ref14dPoint = findNearestByTime(tsPoints, latestTs - 14 * DAY_MS);
  const ref14dSensors =
    ref14dPoint !== null ? readIpmiSensors(rows[ref14dPoint.v]!.ipmi) : [];

  const ref7dPoint = findNearestByTime(tsPoints, latestTs - 7 * DAY_MS);
  const ref7dSensors =
    ref7dPoint !== null ? readIpmiSensors(rows[ref7dPoint.v]!.ipmi) : [];

  const findSensor = (sensors: IpmiSensor[], name: string) =>
    sensors.find((s) => s.name === name);

  const fans: IpmiFeatures["fans"] = [];
  const psuRails: IpmiFeatures["psu_rails"] = [];
  const temps: IpmiFeatures["temps"] = [];

  for (const sensor of latest) {
    if (sensor.value == null) continue;

    const lowerName = sensor.name.toLowerCase();

    if (sensor.unit === "RPM" || lowerName.includes("fan")) {
      const ref = findSensor(ref14dSensors, sensor.name);
      // Estimate baseline from 14d-ago reading (simple; full EWMA in v1.1)
      const baseline = ref?.value ?? sensor.value;
      fans.push({
        name: sensor.name,
        rpm: sensor.value,
        rpm_delta_14d: ref?.value != null ? sensor.value - ref.value : 0,
        rpm_baseline: baseline,
      });
    } else if (sensor.unit === "Volts" || lowerName.includes("volt")) {
      // Skip CMOS / motherboard coin-cell sensors; they ride a different
      // tolerance band and a different remediation (CR2032 swap, not PSU
      // replacement). Mz62hd was paging psu_rail_drift on P_VBAT=3.095V
      // (nominal CR2032 sits 2.7-3.3V) because the heuristic below
      // assigned a 3.3V "rail" nominal to it. 2026-05-23 noise-fix.
      if (/vbat|cmos|^bat$|_bat$/i.test(sensor.name)) continue;
      // Detect PSU rail voltage out-of-spec (deviation from nominal).
      // This is a point-in-time deviation, not change over time; the
      // signal is `psu_rail_out_of_spec`. True drift over a baseline
      // window is the deferred R-P2-3 V2 follow-up.
      const nominal = guessNominalVoltage(sensor.name, sensor.value);
      if (nominal > 0) {
        const deviation_pct = Math.abs(sensor.value - nominal) / nominal;
        psuRails.push({
          rail: sensor.name,
          current_v: sensor.value,
          nominal_v: nominal,
          deviation_pct,
          sustained_batches: 0, // TODO(fast-follow): track across batches
          // Carry the BMC's own status word so the trigger can defer to the
          // board's calibrated per-rail thresholds (see ipmiTriggers).
          bmc_status: sensor.status,
        });
      }
    } else if (sensor.unit === "degrees C" || lowerName.includes("temp")) {
      const ref = findSensor(ref7dSensors, sensor.name);
      temps.push({
        name: sensor.name,
        current_c: sensor.value,
        delta_7d: ref?.value != null ? sensor.value - ref.value : 0,
      });
    }
  }

  return { fans, psu_rails: psuRails, temps };
}

// ---------------------------------------------------------------------------
// Host instability (availability gaps in the snapshot timeline)
// ---------------------------------------------------------------------------

const INSTABILITY_RECENT_MS = 3 * DAY_MS;
const INSTABILITY_GAP_FLOOR_MS = 15 * 60_000; // 15 min: ignore jitter + fast planned reboots

/**
 * Detect host-availability gaps from the snapshot timeline. A "gap" is a
 * stretch between consecutive snapshots far longer than the host's own cadence
 * (the host stopped reporting: crash / reboot / unreachable, regardless of
 * cause). Gaps are split into a recent window vs an earlier baseline so the
 * trigger can distinguish "newly unstable" from "always flaky". Derived from
 * timestamps alone, so it is board- and sensor-agnostic and generalizes across
 * every intermittent-then-permanent hardware failure mode (VRM, PSU, RAM, ...).
 */
export function extractInstabilityFeatures(rows: TwSnapshotRow[]): NonNullable<ServerFeatures["instability"]> {
  const empty = {
    recent_gaps: 0, recent_days: 0, baseline_gaps: 0, baseline_days: 0,
    longest_recent_gap_minutes: 0, gap_threshold_minutes: 0,
    recent_reboot_gaps: 0, uptime_available: false,
  };
  if (rows.length < 2) return empty;

  // Cadence = median consecutive delta (robust to the gaps themselves). A real
  // gap is >> cadence: 10x, floored at 15 min, so 1-2 missed snapshots from a
  // fast planned reboot are NOT a gap, but a multi-minute disappearance is.
  const deltas: number[] = [];
  for (let i = 1; i < rows.length; i++) deltas.push(rows[i]!.timestamp - rows[i - 1]!.timestamp);
  const sorted = [...deltas].sort((a, b) => a - b);
  const medianDelta = sorted[Math.floor(sorted.length / 2)]!;
  const gapThresholdMs = Math.max(INSTABILITY_GAP_FLOOR_MS, medianDelta * 10);

  const earliestTs = rows[0]!.timestamp;
  const latestTs = rows[rows.length - 1]!.timestamp;
  const recentCutoff = latestTs - INSTABILITY_RECENT_MS;

  let recentGaps = 0;
  let baselineGaps = 0;
  let longestRecentGapMs = 0;
  // Reboot detection: a gap "is a reboot" when uptime_seconds reset across it
  // (the snapshot after the gap reports LOWER uptime than the one before). Only
  // judgeable when both boundary snapshots actually reported uptime (> 0); old
  // pre-uptime history reports 0 and is treated as "can't tell".
  let recentRebootGaps = 0;
  let recentJudgeableGaps = 0;
  for (let i = 1; i < rows.length; i++) {
    const delta = rows[i]!.timestamp - rows[i - 1]!.timestamp;
    if (delta <= gapThresholdMs) continue;
    if (rows[i]!.timestamp >= recentCutoff) {
      recentGaps++;
      if (delta > longestRecentGapMs) longestRecentGapMs = delta;
      const upBefore = rows[i - 1]!.uptime_seconds;
      const upAfter = rows[i]!.uptime_seconds;
      if (typeof upBefore === "number" && upBefore > 0 && typeof upAfter === "number" && upAfter > 0) {
        recentJudgeableGaps++;
        if (upAfter < upBefore) recentRebootGaps++;
      }
    } else {
      baselineGaps++;
    }
  }

  const recentDays = Math.min(INSTABILITY_RECENT_MS, latestTs - earliestTs) / DAY_MS;
  const baselineDays = Math.max(0, recentCutoff - earliestTs) / DAY_MS;

  return {
    recent_gaps: recentGaps,
    recent_days: Number(recentDays.toFixed(2)),
    baseline_gaps: baselineGaps,
    baseline_days: Number(baselineDays.toFixed(2)),
    longest_recent_gap_minutes: Math.round(longestRecentGapMs / 60_000),
    gap_threshold_minutes: Math.round(gapThresholdMs / 60_000),
    recent_reboot_gaps: recentRebootGaps,
    uptime_available: recentJudgeableGaps > 0,
  };
}

// ---------------------------------------------------------------------------
// Voltage drift (slow analog degradation) features  [R-P2-3 V2]
// ---------------------------------------------------------------------------

const VDRIFT_RECENT_MS = 7 * DAY_MS;  // recent window vs everything before it
const VDRIFT_MIN_SAMPLES = 20;        // per window, for a stable mean/stddev
const VDRIFT_MAX_PARSE = 800;         // cap IPMI JSON parses via stride-sampling
const VDRIFT_SENSOR_FLOOR_V = 0.02;   // 20 mV: BMC ADC quantisation floor, so a
                                      // dead-flat rail can never yield z = inf

/**
 * Per fixed (regulated) PSU rail, compare its mean over the RECENT window to
 * its mean over the BASELINE window, in units of the baseline's own standard
 * deviation. This is true temporal drift (the deferred R-P2-3 V2 signal),
 * NOT the point-in-time out-of-spec measure that extractIpmiFeatures computes.
 *
 * Only rails with a known nominal (guessNominalVoltage > 0: the fixed 12/5/3.3
 * family + standby) are considered. DVFS core rails (VCORE/VDDCR, no fixed
 * nominal) are excluded by construction, and the z-score gate in the trigger
 * is a second guard against any residual load-correlated rail.
 *
 * IPMI JSON is parsed for at most VDRIFT_MAX_PARSE stride-sampled rows: rail
 * means move slowly, so ~1 sample every few minutes is ample, and this keeps
 * the cost off the per-row parse path the rest of feature extraction avoids.
 */
export function extractVoltageDriftFeatures(rows: TwSnapshotRow[]): NonNullable<ServerFeatures["voltage_drift"]> {
  const out: NonNullable<ServerFeatures["voltage_drift"]> = [];
  if (rows.length < 2 * VDRIFT_MIN_SAMPLES) return out;

  const latestTs = rows[rows.length - 1]!.timestamp;
  const recentCutoff = latestTs - VDRIFT_RECENT_MS;
  const stride = Math.max(1, Math.floor(rows.length / VDRIFT_MAX_PARSE));

  type Acc = { n: number; sum: number; sumsq: number };
  const rails = new Map<string, { nominal: number; recent: Acc; baseline: Acc }>();

  for (let i = 0; i < rows.length; i += stride) {
    const row = rows[i]!;
    const sensors = readIpmiSensors(row.ipmi);
    if (sensors.length === 0) continue;
    const isRecent = row.timestamp >= recentCutoff;
    for (const sensor of sensors) {
      // Skip null AND non-finite readings (NaN/Infinity, or a non-numeric
      // "No Reading" string an unpopulated sensor reports). A non-finite value
      // poisons the running mean to NaN, and NaN drift then slips the trigger's
      // `< floor` guards (NaN < x is always false), firing a garbage warning
      // (observed on unpopulated PSU VIN sensors, 2026-07-14).
      if (sensor.value == null || !Number.isFinite(sensor.value)) continue;
      const lowerName = sensor.name.toLowerCase();
      if (!(sensor.unit === "Volts" || lowerName.includes("volt"))) continue;
      // CMOS / coin-cell: different tolerance band + remediation (see
      // extractIpmiFeatures). Never a PSU-rail drift signal.
      if (/vbat|cmos|^bat$|_bat$/i.test(sensor.name)) continue;
      // PSU INPUT voltage (VIN): not a regulated rail. It tracks the mains /
      // source and legitimately varies, so drift against a fixed nominal is
      // meaningless; on boards that expose it unpopulated it reads "No Reading".
      if (/\bvin\b|input/i.test(sensor.name)) continue;
      const nominal = guessNominalVoltage(sensor.name, sensor.value);
      if (nominal <= 0) continue; // only fixed regulated rails
      let r = rails.get(sensor.name);
      if (!r) {
        r = { nominal, recent: { n: 0, sum: 0, sumsq: 0 }, baseline: { n: 0, sum: 0, sumsq: 0 } };
        rails.set(sensor.name, r);
      }
      const acc = isRecent ? r.recent : r.baseline;
      acc.n++;
      acc.sum += sensor.value;
      acc.sumsq += sensor.value * sensor.value;
    }
  }

  for (const [rail, r] of rails) {
    if (r.recent.n < VDRIFT_MIN_SAMPLES || r.baseline.n < VDRIFT_MIN_SAMPLES) continue;
    const baselineMean = r.baseline.sum / r.baseline.n;
    const recentMean = r.recent.sum / r.recent.n;
    const baselineVar = Math.max(0, r.baseline.sumsq / r.baseline.n - baselineMean * baselineMean);
    const baselineStd = Math.sqrt(baselineVar);
    const driftV = recentMean - baselineMean;
    const driftPct = Math.abs(driftV) / r.nominal;
    const z = Math.abs(driftV) / Math.max(baselineStd, VDRIFT_SENSOR_FLOOR_V);
    out.push({
      rail,
      nominal_v: r.nominal,
      baseline_mean_v: Number(baselineMean.toFixed(4)),
      baseline_stddev_v: Number(baselineStd.toFixed(4)),
      recent_mean_v: Number(recentMean.toFixed(4)),
      drift_v: Number(driftV.toFixed(4)),
      drift_pct: Number(driftPct.toFixed(4)),
      z_score: Number(z.toFixed(2)),
      baseline_samples: r.baseline.n,
      recent_samples: r.recent.n,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Network features
// ---------------------------------------------------------------------------

// Codex F2 review 2026-05-22: Crucible's NetworkSchema (see
// ingest/snapshot-schema.ts:85) writes the device name as `interface`, not
// `iface`. This extractor previously read `entry.iface`, so the lookup was
// always undefined and the 7-day delta collapsed to 0 for every interface,
// effectively disabling network trend warnings. We accept either key so
// backfill against legacy snapshots (pre-rename) keeps producing a signal.
// The output key stays `iface` because ServerFeatures["network"] (and the
// downstream triggers/tests) reference it.
interface NetEntry {
  interface?: string;
  iface?: string;
  rx_errors?: number;
  tx_errors?: number;
  rx_drops?: number;
  tx_drops?: number;
}

function netIface(entry: NetEntry): string | undefined {
  return entry.interface ?? entry.iface;
}

export function extractNetworkFeatures(rows: TwSnapshotRow[]): ServerFeatures["network"] {
  if (rows.length === 0) return [];

  const latest = safeParse<NetEntry[]>(rows[rows.length - 1]!.network, []);
  if (latest.length === 0) return [];

  const latestTs = rows[rows.length - 1]!.timestamp;
  const tsPoints = rows.map((r, i) => ({ t: r.timestamp, v: i }));
  const ref7dPoint = findNearestByTime(tsPoints, latestTs - 7 * DAY_MS);
  const ref7dNet =
    ref7dPoint !== null
      ? safeParse<NetEntry[]>(rows[ref7dPoint.v]!.network, [])
      : [];

  const out: ServerFeatures["network"] = [];
  for (const entry of latest) {
    const name = netIface(entry);
    if (!name) continue;
    const ref = ref7dNet.find((r) => netIface(r) === name);
    out.push({
      iface: name,
      crc_errors_delta_7d: ref ? (entry.rx_errors ?? 0) - (ref.rx_errors ?? 0) : 0,
      frame_errors_delta_7d: ref ? (entry.tx_errors ?? 0) - (ref.tx_errors ?? 0) : 0,
      tcp_retransmits_delta_7d: 0, // TODO(fast-follow): retransmit collection now EXISTS in Crucible (snapshot.tcp_stats.retrans_segs_total); not wired to this feature yet
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// ZFS features
// ---------------------------------------------------------------------------

interface ZfsEntry {
  pool?: string;
  devices?: Array<{
    device: string;
    state: string;
    read_errors?: number;
    write_errors?: number;
    cksum_errors?: number;
  }>;
}

function extractZfsFeatures(rows: TwSnapshotRow[]): ServerFeatures["zfs"] {
  if (rows.length === 0) return [];
  const latest = safeParse<ZfsEntry[]>(rows[rows.length - 1]!.zfs, []);
  const results: ServerFeatures["zfs"] = [];

  for (const pool of latest) {
    // safeParse on the outer zfs array is hardened, but a malformed
    // nested payload (pool.devices is a string / object / null) would
    // still throw at for-of and skip trend processing for this server.
    // Codex 2026-05-12 P2.
    if (!Array.isArray(pool.devices)) continue;
    for (const dev of pool.devices) {
      results.push({
        pool: pool.pool ?? "unknown",
        device: dev.device,
        cksum_errors: dev.cksum_errors ?? 0,
        read_errors: dev.read_errors ?? 0,
        write_errors: dev.write_errors ?? 0,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function guessVendor(model: string): string {
  const m = model.toLowerCase();
  if (m.startsWith("st") || m.includes("seagate")) return "Seagate";
  if (m.startsWith("wdc") || m.includes("western digital")) return "WDC";
  if (m.includes("hitachi") || m.startsWith("hgst") || m.startsWith("hus")) return "HGST";
  if (m.includes("toshiba") || m.startsWith("dt") || m.startsWith("md")) return "Toshiba";
  if (m.includes("samsung")) return "Samsung";
  if (m.includes("intel") || m.startsWith("ssdsc")) return "Intel";
  if (m.includes("crucial") || m.includes("micron")) return "Micron";
  return "unknown";
}

export function guessNominalVoltage(name: string, value: number): number {
  const n = name.toLowerCase();
  // 2026-05-29 fix: the prior approach only knew 12V / 5V / 3.3V by name and
  // guessed everything else by value range. A sensor named "2.5V BMC" matched
  // no named pattern and fell through to the value-range heuristic, where a
  // healthy 2.51V reading was assigned nominal=3.3 (the 2.5-4V band). That
  // produced a fake ~24% drift that paged HIGH on val-RTXA4000 (and the same
  // heuristic class previously misfired on prod: gpu-1, the production host).
  // The robust fix is to parse the explicit voltage out of the sensor name,
  // falling back to the value-range heuristic only when the name has no
  // voltage token.
  //
  // "X V Y" alt-spelling first (3V3 -> 3.3, 1V8 -> 1.8, 1V05 -> 1.05); run
  // before the plain pattern so "3V3" is not read as "3V".
  const alt = n.match(/(?:^|[^\d.])(\d+)v(\d+)\b/);
  if (alt) return parseFloat(`${alt[1]}.${alt[2]}`);
  // Plain "<number>V" with optional decimal: 12V, +5V, P_5V, 2.5V, 1.05V,
  // 5V_STBY, 5VSB. The (?:^|[^\d.]) prefix keeps "2.5V" capturing 2.5 (not 5);
  // the (?![\d.]) suffix stops "3V3" being read as "3V" while still allowing
  // "5V_STBY" / "5VSB" / "2.5V BMC".
  const plain = n.match(/(?:^|[^\d.])(\d+(?:\.\d+)?)\s*v(?![\d.])/);
  if (plain) {
    // Bare "3V"/"3VSB" is ATX/BMC shorthand for the 3.3V rail (and its
    // standby). 3.0V is not a standard PSU output rail: the only ~3.0V rail,
    // the CMOS coin cell, is already excluded above (vbat/cmos/bat). Without
    // this, a healthy 3.34V "3V" rail scores ~11% out of spec against a 3.0
    // nominal (a validation host asrock FP, 2026-07-14). Explicit "3.0V" (with the
    // decimal) is left as 3.0.
    if (plain[1] === "3") return 3.3;
    const v = parseFloat(plain[1]);
    if (v > 0 && v <= 13) return v;
  }
  // Value-range heuristic: only when the name has no explicit voltage token.
  // The ranges intentionally bracket the named rails closely (10-14V around
  // 12V, 4-6V around 5V, 2.5-4V around 3.3V) so non-PSU rails (typically
  // 0.8-1.8V) fall outside.
  if (value > 10 && value < 14) return 12;
  if (value > 4 && value < 6) return 5;
  if (value > 2.5 && value < 4) return 3.3;
  return 0; // unknown, skip
}
