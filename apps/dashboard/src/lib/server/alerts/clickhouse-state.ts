// Cross-snapshot state helpers for alert evaluators.
//
// Rules that need to compare current readings against historical
// state (cumulative counters whose meaningful signal is the rate of
// change, or recent rebooted state, etc.) live alongside the
// in-snapshot rules but pull their second observation from
// ClickHouse. This module collects those lookups so the rule code
// stays focused on the policy and so the architectural shape (null
// for insufficient data, counter-reset detection, error
// suppression) is consistent across future rate-based rules.
//
// First user: rate-based ECC error detection (glassmkr#24). The
// shape here is the template for future cross-snapshot rules
// including PSU bitmask normalisation (glassmkr#29) if it goes
// that direction.

import { clickhouse } from "@glassmkr/db/clickhouse";

export interface EccDelta {
  /** Correctable ECC errors observed in the window. */
  correctable: number;
  /** Uncorrectable ECC errors observed in the window. */
  uncorrectable: number;
  /** True when the underlying BMC counter regressed between the
   *  oldest-in-window snapshot and the current one (SEL clear, BMC
   *  reboot, host reboot that resets named-sensor counters). When
   *  set, the correctable / uncorrectable fields are zeroed and the
   *  caller should skip this evaluation cycle. */
  counterReset: boolean;
}

interface OldestSnapshotIpmiRow {
  ipmi: string | object;
  timestamp: string;
}

/**
 * Returns the rate of correctable + uncorrectable ECC counts over
 * `windowHours` for `serverId`. The "rate" is current minus oldest-
 * in-window; the caller compares it to a threshold for the same
 * window.
 *
 * Returns null when the lookup cannot produce a meaningful rate:
 *   - no historical snapshot in the window (new server, ingest gap)
 *   - the historical snapshot has no parseable ECC data
 *   - ClickHouse is unavailable (network blip, restart)
 *
 * In all cases the caller should treat null as "skip this cycle"
 * rather than firing or suppressing.
 *
 * The current snapshot's counts come in as arguments rather than
 * being re-derived here - the evaluator already computed them via
 * the named/SEL max(); duplicating that logic risks drift.
 */
export async function getEccDeltaInWindow(
  serverId: string,
  windowHours: number,
  currentCorrectable: number,
  currentUncorrectable: number,
): Promise<EccDelta | null> {
  let oldestIpmi: string | object | null = null;
  try {
    // Exclude the most recent 5 minutes so the oldest-in-window row
    // is definitively older than the snapshot currently being
    // ingested. Without this clause, on the second snapshot a server
    // ever produces the same row would appear as both current and
    // oldest, returning a 0 delta.
    const result = await clickhouse.query({
      query: `SELECT ipmi, toString(timestamp) AS timestamp
              FROM glassmkr.snapshots
              WHERE server_id = {serverId:String}
                AND timestamp >= now() - INTERVAL {windowHours:UInt32} HOUR
                AND timestamp < now() - INTERVAL 5 MINUTE
                AND ipmi != ''
              ORDER BY timestamp ASC
              LIMIT 1`,
      query_params: { serverId, windowHours },
      format: "JSONEachRow",
    });
    const rows = await result.json<OldestSnapshotIpmiRow>();
    if (rows.length === 0) return null;
    oldestIpmi = rows[0].ipmi;
  } catch (err: any) {
    console.warn(
      `[ecc_errors] cross-snapshot lookup failed server=${serverId} ` +
      `window_hours=${windowHours}: ${err?.message ?? err}`,
    );
    return null;
  }

  const parsed = parseIpmiEccCounts(oldestIpmi);
  if (parsed === null) return null;

  // Delta computation with reset detection. A negative delta means
  // the counter regressed (SEL clear, BMC restart, host reboot
  // zeroing named-sensor accumulators). The reset is real signal in
  // its own right but tells us nothing about ECC rate in the window,
  // so the caller should skip this cycle and resume on the next
  // snapshot. Zero out the deltas so any caller that does its own
  // sanity-check on the numbers sees the same shape.
  const correctableDelta = currentCorrectable - parsed.correctable;
  const uncorrectableDelta = currentUncorrectable - parsed.uncorrectable;
  if (correctableDelta < 0 || uncorrectableDelta < 0) {
    return { correctable: 0, uncorrectable: 0, counterReset: true };
  }
  return {
    correctable: correctableDelta,
    uncorrectable: uncorrectableDelta,
    counterReset: false,
  };
}

/**
 * Pull the highest ECC counts (named-sensor max SEL) out of an
 * `ipmi` field as stored in ClickHouse. The field is JSON; the
 * client returns it either as a string (driver default for nested
 * String columns) or, less commonly, as a parsed object.
 *
 * Returns null on parse failure or when neither counter is present
 * in the row.
 */
function parseIpmiEccCounts(
  ipmi: string | object | null | undefined,
): { correctable: number; uncorrectable: number } | null {
  if (ipmi === null || ipmi === undefined || ipmi === "") return null;
  let obj: any;
  try {
    obj = typeof ipmi === "string" ? JSON.parse(ipmi) : ipmi;
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const named = obj.ecc_errors;
  const sel = obj.ecc_errors_from_sel;
  if (!named && !sel) return null;
  const namedCorr = nonNegInt(named?.correctable);
  const namedUnc = nonNegInt(named?.uncorrectable);
  const selCorr = nonNegInt(sel?.correctable);
  const selUnc = nonNegInt(sel?.uncorrectable);
  return {
    correctable: Math.max(namedCorr, selCorr),
    uncorrectable: Math.max(namedUnc, selUnc),
  };
}

function nonNegInt(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : 0;
  return n > 0 ? n : 0;
}
