// Pure decision functions extracted from the ingest endpoint so they can be
// unit-tested without a running PostgreSQL or ClickHouse instance.

import type { Snapshot } from "$lib/server/alerts/evaluator";

// Rate limit window enforced per-server. We accept at most one ingest within
// this many milliseconds. Set to 55s rather than 60s to absorb collector jitter.
export const RATE_LIMIT_WINDOW_MS = 55_000;

export function isRateLimited(lastSeenMs: number | null, nowMs: number): boolean {
  if (lastSeenMs == null) return false;
  return (nowMs - lastSeenMs) < RATE_LIMIT_WINDOW_MS;
}

// Crackers send tokens that have the right shape but won't bcrypt-match. We
// reject those before touching the database.
export function isPlausibleApiKey(apiKey: string): boolean {
  // Edge filter before any auth work. Accepts both the legacy
  // collector key format (col_<32 hex>, total 36 chars) and the new
  // format introduced in Crucible 0.9.0 (gmk_cru_<env>_<43>_<4>,
  // total 49 chars). Strict format/checksum validation happens later
  // in the auth path; this is just the cheap rejection.
  if (apiKey.startsWith("col_") && apiKey.length >= 20) return true;
  if (apiKey.startsWith("gmk_cru_") && apiKey.length >= 40) return true;
  return false;
}

// Extract OS family + version from the kernel-reported os string. Used so the
// /servers row stays human-readable.
export function parseOsString(os: string | undefined): { osType: string; osVersion: string } {
  if (!os) return { osType: "", osVersion: "" };
  const m = os.match(/^(\w+)\s+(.+?)(?:\s+LTS)?$/);
  return { osType: m?.[1]?.toLowerCase() ?? "", osVersion: m?.[2] ?? "" };
}

// Snapshot -> ClickHouse row. Encodes JSON columns and applies safe defaults.
export function snapshotToClickhouseRow(
  serverId: string,
  snap: Snapshot & { collector_version?: string },
  insertedTsMs: number
): Record<string, unknown> {
  return {
    server_id: serverId,
    timestamp: insertedTsMs,
    collector_version: snap.collector_version || "0.1.0",
    hostname: snap.system?.hostname || "",
    ip: snap.system?.ip || "",
    os: snap.system?.os || "",
    kernel: snap.system?.kernel || "",
    uptime_seconds: snap.system?.uptime_seconds || 0,
    cpu_user_percent: snap.cpu?.user_percent || 0,
    cpu_system_percent: snap.cpu?.system_percent || 0,
    cpu_iowait_percent: snap.cpu?.iowait_percent || 0,
    cpu_idle_percent: snap.cpu?.idle_percent || 0,
    cpu_cores: JSON.stringify(snap.cpu?.cores || []),
    load_1m: snap.cpu?.load_1m || 0,
    load_5m: snap.cpu?.load_5m || 0,
    load_15m: snap.cpu?.load_15m || 0,
    ram_total_mb: snap.memory?.total_mb || 0,
    ram_used_mb: snap.memory?.used_mb || 0,
    ram_available_mb: snap.memory?.available_mb || 0,
    // free_mb (MemFree) since Crucible 0.13.12; 0 for older agents (the UI
    // falls back to a Used/Available bar). Per migration 004.
    ram_free_mb: snap.memory?.free_mb || 0,
    swap_total_mb: snap.memory?.swap_total_mb || 0,
    swap_used_mb: snap.memory?.swap_used_mb || 0,
    disks: JSON.stringify(snap.disks || []),
    smart: JSON.stringify(snap.smart || []),
    network: JSON.stringify(snap.network || []),
    raid: JSON.stringify(snap.raid || []),
    ipmi: JSON.stringify(snap.ipmi || { available: false, sensors: [], ecc_errors: { correctable: 0, uncorrectable: 0 }, sel_entries_count: 0 }),
    security: JSON.stringify(snap.security || {}),
    zfs: JSON.stringify(snap.zfs || {}),
    // '' (not '{}') when absent: pre-0.13.19 agents have no topology and the
    // UI hides the channels line on empty string (matches the column default).
    memory_topology: snap.memory_topology ? JSON.stringify(snap.memory_topology) : "",
    io_errors: JSON.stringify(snap.io_errors || {}),
    io_latency: JSON.stringify(snap.io_latency || []),
    conntrack: JSON.stringify(snap.conntrack || {}),
    systemd: JSON.stringify(snap.systemd || {}),
    ntp: JSON.stringify(snap.ntp || {}),
    file_descriptors: JSON.stringify(snap.file_descriptors || {}),
    // GPU block (Crucible v0.13.0+, C19 collector). Stored as JSON
    // string for symmetry with the other complex fields above; the
    // /health endpoint JSON.parse()s it back before returning to the
    // SPA. Pre-0.13.0 agents don't emit snap.gpu; the field is
    // stored as the empty-object sentinel and the dashboard treats it
    // as "no GPU data" identically to a literal absent block.
    // Per migrations/clickhouse/002_snapshot_gpu.sql (2026-05-20).
    gpu: JSON.stringify(snap.gpu || {}),
    // Thermal block (hwmon CPU temps; Crucible 0.8.0+). Stored as a JSON
    // string like gpu/ipmi/etc. so the metrics endpoint can chart CPU
    // temperature over time. Per migrations/clickhouse/003_snapshot_thermal.sql.
    // Pre-003 rows / agents without thermal keep the '{}' sentinel.
    thermal: JSON.stringify(snap.thermal || {}),
    // Chassis power provenance (Crucible 0.15.0+). Stored as a JSON string like
    // gpu/thermal/ipmi so the reboot root-cause rollup can read a HISTORY of it:
    // the question is always about a PREVIOUS boot, so the current value alone is
    // useless. Per migrations/clickhouse/006_snapshot_chassis.sql. Pre-006 rows and
    // older agents keep the '{}' sentinel.
    //
    // Stored verbatim and NEVER interpreted here. `last_power_event` is a bit set in
    // which a healthy host can legitimately assert `ac_failed`, and `restart_cause`
    // names a management path rather than an actor, so any verdict belongs in a rule
    // that has been calibrated per platform, not in the ingest writer.
    chassis: JSON.stringify(snap.chassis || {}),
    oom_kills_recent: snap.os_alerts?.oom_kills_recent || 0,
    zombie_processes: snap.os_alerts?.zombie_processes || 0,
    time_drift_ms: snap.os_alerts?.time_drift_ms || 0,
  };
}
