// Per-drive disk health rollup. Three-tier state derived from current
// SMART / NVMe / kernel-I/O signals. See `CC_DISK_HEALTH_ROLLUP.md`.
//
// This module is pure: given a snapshot's SMART array and io_errors set, it
// returns one state per drive. Persistence, transition detection, and UI
// rendering live elsewhere. Keep the derivation side-effect-free so it can
// be unit-tested without a database.

export type DiskHealthState = "healthy" | "declining" | "failing" | "broken";

export interface DriveObservation {
  /** Stable device identifier. Currently the kernel device path (`/dev/sda`
   *  or `/dev/nvme0n1`) because Crucible does not expose drive serial yet.
   *  When it does, switch to serial for stability across reboots and
   *  NVMe namespace renumbering. */
  device_id: string;
  model: string | undefined;
  state: DiskHealthState;
  /** Identifiers of signals that matched on this drive, for display in
   *  the dashboard tooltip and for audit. Stable strings. */
  signals: string[];
}

/**
 * Weight of each signal. Used to pick the resulting tier: broken > failing
 * > declining > healthy. `weight` is the tier that a matched signal forces
 * the drive into (unless a higher-weight signal also matches).
 */
interface SignalDef {
  id: string;
  weight: DiskHealthState;
  matches: (d: any, ctx: { ioErrorDevices: Set<string> }) => boolean;
}

// Thresholds. Hardcoded for v1 per spec; make configurable if asked.
const POWER_ON_HOURS_DECLINING = 40_000;
const NVME_WEAR_DECLINING_PCT = 80;

// Parse the device "short name" from a device path like "/dev/sda" -> "sda".
// io_errors.devices reports short names, SmartInfo.device reports full paths.
// Normalising lets us match reliably either way.
function shortDevice(path: string | undefined): string | null {
  if (!path) return null;
  const trimmed = path.trim();
  if (!trimmed) return null;
  const idx = trimmed.lastIndexOf("/");
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

// Signal list. Only signals backed by fields Crucible currently reports are
// active. The remaining signals from the spec
// (nvme_critical_warning_nonzero, nvme_media_errors_present,
//  udma_crc_errors_rising, nvme_unrecovered_read_errors_present,
//  drdy_err_in_smart_log, reallocated_sectors_exceeds_manufacturer_threshold)
// require Crucible schema additions and/or a 7-day trend query against
// ClickHouse. Deferred to disk-health v1.1; documented here so the list
// matches the spec 1:1 when the other fields land.
const SIGNALS: SignalDef[] = [
  // === Broken ===
  {
    // Kernel log shows I/O errors for this device. More trustworthy than
    // SMART overall status; per spec edge case 23 this path wins on
    // contradictory signals.
    id: "io_errors_in_dmesg",
    weight: "broken",
    matches: (d, { ioErrorDevices }) => {
      const s = shortDevice(d.device);
      return s !== null && ioErrorDevices.has(s);
    },
  },
  {
    // SMART self-reports failure. Crucible's `health` field maps to
    // smartctl's overall-health output. "PASSED" / "OK" are healthy;
    // anything else (including "FAILED!", "FAILING_NOW", "Unknown") is a
    // hard fail signal.
    id: "smart_overall_health_fail",
    weight: "broken",
    matches: (d) => {
      const h = (d.health ?? "").toString().toUpperCase();
      // Treat unpopulated health as healthy rather than broken; some
      // backends just don't report it for certain controllers.
      if (!h) return false;
      return h !== "PASSED" && h !== "OK";
    },
  },

  // === Failing ===
  {
    // Any pending sector is a failing signal. These are sectors the drive
    // hasn't been able to read and hasn't yet reallocated. Spec note 2:
    // once failing, stay failing (sticky). This matches the behavior
    // because the attribute does not clear.
    id: "pending_sectors_present",
    weight: "failing",
    matches: (d) => typeof d.pending_sectors === "number" && d.pending_sectors > 0,
  },
  {
    // Any reallocated sector. Spec's richer definition uses a 7d trend
    // (`reallocated_sectors_present_and_rising`); v1 here uses the simpler
    // "any > 0" until the trend query is wired in. Matches spec's own
    // "sticky" guidance in open question 2.
    id: "reallocated_sectors_present",
    weight: "failing",
    matches: (d) => typeof d.reallocated_sectors === "number" && d.reallocated_sectors > 0,
  },

  // === Declining ===
  {
    id: "power_on_hours_high",
    weight: "declining",
    matches: (d) =>
      typeof d.power_on_hours === "number" && d.power_on_hours > POWER_ON_HOURS_DECLINING,
  },
  {
    id: "nvme_wear_high",
    weight: "declining",
    matches: (d) =>
      typeof d.percentage_used === "number" && d.percentage_used > NVME_WEAR_DECLINING_PCT,
  },
];

const RANK: Record<DiskHealthState, number> = {
  healthy: 0,
  declining: 1,
  failing: 2,
  broken: 3,
};

/**
 * Derive per-drive disk health state for one snapshot. Pure.
 *
 * @param smart The snapshot's `smart` array (SmartInfo entries).
 * @param ioErrors The snapshot's `io_errors` section, used for the
 *                 kernel-I/O-error signal. `null`/`undefined` is treated
 *                 as "no I/O errors reported".
 */
export function deriveDiskHealth(
  smart: Array<any> | undefined,
  ioErrors: { count: number; devices: string[] } | null | undefined,
): DriveObservation[] {
  if (!Array.isArray(smart)) return [];
  const ioErrorDevices = new Set((ioErrors?.devices ?? []).map((s) => s.trim()).filter(Boolean));
  const ctx = { ioErrorDevices };
  const out: DriveObservation[] = [];
  for (const drive of smart) {
    if (!drive || typeof drive.device !== "string" || drive.device === "") continue;
    const matched: string[] = [];
    let tier: DiskHealthState = "healthy";
    for (const sig of SIGNALS) {
      if (sig.matches(drive, ctx)) {
        matched.push(sig.id);
        if (RANK[sig.weight] > RANK[tier]) tier = sig.weight;
      }
    }
    out.push({
      device_id: drive.device,
      model: typeof drive.model === "string" && drive.model ? drive.model : undefined,
      state: tier,
      signals: matched,
    });
  }
  return out;
}

/**
 * Transition-priority classification for a (previous, next) state pair.
 * Used in Phase 2 when notifications get wired up. Phase 1 ships without
 * notifications but we expose this here so the ingest path can already
 * record transitions with the correct semantic category in logs/audit.
 *
 * Returns null for (healthy -> declining) and (x -> x) per spec: those are
 * either too noisy or not a transition at all.
 */
export type TransitionClass =
  | { kind: "fire"; priority: 1 | 3 | 4 }
  | { kind: "resolution" }
  | { kind: "informational"; note: string };

export function classifyTransition(
  prev: DiskHealthState | null,
  next: DiskHealthState,
): TransitionClass | null {
  if (prev === next) return null;
  // Newly observed healthy drive: no event. "Resolution" only makes sense
  // if there was a prior non-healthy state to resolve from.
  if (prev === null && next === "healthy") return null;
  if (next === "healthy") return { kind: "resolution" };
  if (prev === null || prev === "healthy") {
    if (next === "declining") return null; // too noisy
    if (next === "failing") return { kind: "fire", priority: 3 };
    if (next === "broken") return { kind: "fire", priority: 1 };
  }
  if (prev === "declining") {
    if (next === "failing") return { kind: "fire", priority: 3 };
    if (next === "broken") return { kind: "fire", priority: 1 };
  }
  if (prev === "failing") {
    if (next === "broken") return { kind: "fire", priority: 1 };
    if (next === "declining") {
      return { kind: "informational", note: "signal cleared, verify" };
    }
  }
  if (prev === "broken") {
    return {
      kind: "informational",
      note: "state improved, verify this is expected (possible hardware swap)",
    };
  }
  return null;
}

// Expose constants for tests and for any future config surface.
export const THRESHOLDS = {
  POWER_ON_HOURS_DECLINING,
  NVME_WEAR_DECLINING_PCT,
} as const;

// === Persistence (Phase 1: upsert + log transitions; no notifications) ===

import { query } from "@glassmkr/db/pg";

interface PersistedRow {
  device_id: string;
  state: DiskHealthState;
  signals: string[];
  model: string | null;
  entered_state_at: Date;
  missed_observations: number;
}

// How many consecutive snapshots a drive must be absent from before we
// treat the row as a real removal (vs. a transient smartctl probe
// failure). At a 5-min snapshot cadence this is ~15 min of confirmed
// absence. Codex review 2026-05-05 flagged single-snapshot deletion as
// too aggressive; this guards against false-recovery dashboard flicker.
const MISSED_OBSERVATIONS_THRESHOLD = 3;

export interface DiskHealthTransition {
  device_id: string;
  prev: DiskHealthState | null;
  next: DiskHealthState;
  class: TransitionClass | null;
  signals: string[];
}

/**
 * Persist derived disk health for one server's snapshot. Returns the list
 * of state transitions that occurred (new rows, state changes, removed
 * drives). Phase 1 ships without notifications, so the caller logs these
 * and moves on; Phase 2 will dispatch on them.
 *
 * Mechanics:
 *  - Read current rows for the server
 *  - For each observation: upsert, bump `entered_state_at` if state changed
 *  - For rows not in the current observation set: delete (hardware swap)
 */
export async function persistDiskHealth(
  serverId: string,
  observations: DriveObservation[],
): Promise<DiskHealthTransition[]> {
  const prevRes = await query(
    `SELECT device_id, state, signals, model, entered_state_at, missed_observations
     FROM disk_health_state WHERE server_id = $1`,
    [serverId],
  );
  const prevByDevice = new Map<string, PersistedRow>();
  for (const r of prevRes.rows) {
    prevByDevice.set(r.device_id, {
      device_id: r.device_id,
      state: r.state as DiskHealthState,
      signals: Array.isArray(r.signals) ? r.signals : [],
      model: r.model ?? null,
      entered_state_at: new Date(r.entered_state_at),
      missed_observations: r.missed_observations ?? 0,
    });
  }

  const transitions: DiskHealthTransition[] = [];
  const seen = new Set<string>();

  for (const obs of observations) {
    seen.add(obs.device_id);
    const prev = prevByDevice.get(obs.device_id) ?? null;
    const prevState: DiskHealthState | null = prev ? prev.state : null;
    const stateChanged = prev === null || prev.state !== obs.state;

    if (stateChanged) {
      // Always reset missed_observations to 0 on a real observation.
      await query(
        `INSERT INTO disk_health_state
           (server_id, device_id, state, signals, model, first_observed_at, entered_state_at, last_updated_at, missed_observations)
         VALUES ($1, $2, $3, $4::jsonb, $5, NOW(), NOW(), NOW(), 0)
         ON CONFLICT (server_id, device_id) DO UPDATE
           SET state = EXCLUDED.state,
               signals = EXCLUDED.signals,
               model = EXCLUDED.model,
               entered_state_at = NOW(),
               last_updated_at = NOW(),
               missed_observations = 0`,
        [serverId, obs.device_id, obs.state, JSON.stringify(obs.signals), obs.model ?? null],
      );
      transitions.push({
        device_id: obs.device_id,
        prev: prevState,
        next: obs.state,
        class: classifyTransition(prevState, obs.state),
        signals: obs.signals,
      });
    } else {
      // Same state: refresh signals + last_updated_at, reset miss
      // counter. Signals set can change (a signal cleared, a new
      // same-tier signal appeared) without a tier change.
      await query(
        `UPDATE disk_health_state
           SET signals = $3::jsonb, model = $4, last_updated_at = NOW(),
               missed_observations = 0
         WHERE server_id = $1 AND device_id = $2`,
        [serverId, obs.device_id, JSON.stringify(obs.signals), obs.model ?? null],
      );
    }
  }

  // Drives missing from this snapshot's observation set: increment
  // miss counter; only delete after MISSED_OBSERVATIONS_THRESHOLD
  // consecutive misses. Crucible's smartctl probe can fail
  // transiently for a single device; pre-2026-05-05 this code
  // deleted on the first miss and produced false-recovery flicker
  // in the dashboard. Phase 1 stays silent so transitions away
  // from broken/failing don't fire notifications either way, but
  // the rollup badge on the server card was misleading.
  for (const prev of prevByDevice.values()) {
    if (seen.has(prev.device_id)) continue;
    const nextMiss = (prev.missed_observations ?? 0) + 1;
    if (nextMiss >= MISSED_OBSERVATIONS_THRESHOLD) {
      await query(
        `DELETE FROM disk_health_state WHERE server_id = $1 AND device_id = $2`,
        [serverId, prev.device_id],
      );
    } else {
      await query(
        `UPDATE disk_health_state
           SET missed_observations = $3, last_updated_at = NOW()
         WHERE server_id = $1 AND device_id = $2`,
        [serverId, prev.device_id, nextMiss],
      );
    }
  }

  return transitions;
}
