// Alert-stream flapping / recurrence detector (round-2 report C-1).
//
// The metric trend engine (features.ts) watches snapshot columns over time; it
// never looks at the alert fire stream itself. So a rule that fires and clears
// every ~25 min (an intermittent / expected-at-idle condition) shows up only as
// a string of benign auto-resolves and never escalates, even though "this keeps
// happening" is the actionable signal.
//
// This detector reads the alert_history "fired" stream. Since B-1 made
// alert_history a STATE-TRANSITION log (one "fired" row per episode, not one
// per snapshot), the episodes group naturally into clusters: a CHRONIC alert
// has one episode (one cluster), a FLAPPING alert has many separated clusters.
// >=3 clusters in 6h => one "alert_flapping" trend warning per (host, rule).
//
// It emits a medium-severity, host-resource Finding, which the persistence
// layer assigns the "scheduled" tier: dashboard-visible, NOT paged. Flapping is
// a watch-it signal, not an incident.

import { clickhouse } from "@glassmkr/db/clickhouse";
import type { Finding } from "./types";

/** Window the detector looks back over. */
export const FLAP_WINDOW_HOURS = 6;
/** Two fires within this gap belong to the same cluster (episode). At the ~5
 *  min snapshot cadence, 10 min spans one quiet snapshot between fires. */
export const FLAP_CLUSTER_GAP_MS = 10 * 60 * 1000;
/** Minimum distinct clusters in the window to call a (host, rule) flapping. */
export const FLAP_MIN_CLUSTERS = 3;

export interface FlapStat {
  alert_type: string;
  clusters: number;
  episodes: number;
  cadence_min: number | null; // mean minutes between cluster starts
  first_ms: number;
  last_ms: number;
}

/**
 * Group fire-event timestamps (unix ms) into clusters separated by a quiet gap.
 * Pure. A dense burst with no gaps (e.g. pre-B-1 per-snapshot flood still inside
 * the window) collapses into ONE cluster, so it is not mistaken for flapping.
 */
export function clusterFires(timestampsMs: number[], gapMs: number = FLAP_CLUSTER_GAP_MS): number[][] {
  const sorted = [...timestampsMs].sort((a, b) => a - b);
  const clusters: number[][] = [];
  for (const t of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && t - last[last.length - 1] <= gapMs) last.push(t);
    else clusters.push([t]);
  }
  return clusters;
}

/**
 * Classify one (host, rule) fire stream. Returns a FlapStat when the rule
 * flapped (>= minClusters distinct clusters), else null. Pure.
 */
export function classifyFlapping(
  alertType: string,
  timestampsMs: number[],
  minClusters: number = FLAP_MIN_CLUSTERS,
): FlapStat | null {
  if (timestampsMs.length === 0) return null;
  const clusters = clusterFires(timestampsMs);
  if (clusters.length < minClusters) return null;

  const starts = clusters.map((c) => c[0]);
  let cadence_min: number | null = null;
  if (starts.length >= 2) {
    let sum = 0;
    for (let i = 1; i < starts.length; i++) sum += starts[i] - starts[i - 1];
    cadence_min = Math.round(sum / (starts.length - 1) / 60000);
  }
  const lastCluster = clusters[clusters.length - 1];
  return {
    alert_type: alertType,
    clusters: clusters.length,
    episodes: timestampsMs.length,
    cadence_min,
    first_ms: starts[0],
    last_ms: lastCluster[lastCluster.length - 1],
  };
}

/** Build a trend-warnings Finding from a FlapStat. Pure. */
export function flapStatToFinding(stat: FlapStat, hostname: string): Finding {
  const cadenceText = stat.cadence_min != null ? ` (about every ${stat.cadence_min} min)` : "";
  return {
    type: "alert_flapping",
    severity: "medium",
    // The flapping resource IS the rule; using its name as the resource keeps
    // one warning per (host, rule) and reads as "Alert flapping on <rule>".
    resource: { kind: "host", name: stat.alert_type },
    contributing_metrics: [
      {
        name: `${stat.alert_type} clusters in ${FLAP_WINDOW_HOURS}h`,
        current: stat.clusters,
        baseline: 0,
        delta_1d: 0,
        delta_7d: 0,
        delta_30d: 0,
        burst_max_7d: stat.clusters,
        window: `${FLAP_WINDOW_HOURS}h`,
      },
    ],
    correlation_match: null,
    tree_ranker_score: null,
    projected_timeline: null,
    evidence_summary: `${stat.alert_type} on ${hostname} fired and auto-resolved ${stat.clusters} separate times in the last ${FLAP_WINDOW_HOURS}h${cadenceText}. A rule that repeatedly fires and clears is usually an intermittent or expected-at-idle condition, not ${stat.clusters} independent incidents; treat it as one recurring pattern to investigate or suppress.`,
  };
}

/**
 * Query alert_history for fire episodes over the last FLAP_WINDOW_HOURS and
 * return one flapping Finding per (host, rule) that crosses the threshold.
 * Failure is non-fatal (returns []), like the rest of the feature extractors.
 */
export async function detectFlappingAlerts(serverId: string, hostname: string): Promise<Finding[]> {
  let rows: Array<{ alert_type: string; ts: string | number }>;
  // Window cutoff is computed in JS and passed as a bound parameter (no query
  // interpolation, per the clickhouse-params lint). Compared against the
  // event's epoch-ms so it does not depend on the ClickHouse server clock.
  const cutoffMs = Date.now() - FLAP_WINDOW_HOURS * 3_600_000;
  try {
    const res = await clickhouse.query({
      query: `
        SELECT alert_type, toUnixTimestamp64Milli(timestamp) AS ts
        FROM alert_history
        WHERE server_id = {server_id:String}
          AND event_type = 'fired'
          AND toUnixTimestamp64Milli(timestamp) > {cutoff_ms:Int64}
        ORDER BY timestamp ASC
        LIMIT 2000`,
      query_params: { server_id: serverId, cutoff_ms: cutoffMs },
      format: "JSONEachRow",
    });
    rows = await res.json();
  } catch (err) {
    console.warn(`[trend-warnings] flapping query failed for ${serverId}:`, (err as Error).message);
    return [];
  }

  const byType = new Map<string, number[]>();
  for (const r of rows) {
    const ms = Number(r.ts);
    if (!Number.isFinite(ms)) continue;
    const list = byType.get(r.alert_type) ?? [];
    list.push(ms);
    byType.set(r.alert_type, list);
  }

  const findings: Finding[] = [];
  for (const [alertType, tsMs] of byType) {
    const stat = classifyFlapping(alertType, tsMs);
    if (stat) findings.push(flapStatToFinding(stat, hostname));
  }
  return findings;
}
