// Cross-snapshot rule correlation. Queries the Postgres active_alerts
// table for matching rule types on the same host within a sliding
// window.
//
// CC_SPEC_CROSS_SNAPSHOT_LIBRARY_2026-05-19.md §1.6 + locked decision 3.
// The trend-warnings job's same-batch sibling-finding logic (
// trend-warnings/correlation.ts applyCorrelationRules) is a different
// thing and is NOT unified with this primitive.
//
// Schema note: the actual active_alerts columns are server_id +
// alert_type + first_seen + resolved_at (NOT host_id/rule_id/
// first_seen_at as the original spec draft assumed). Verified against
// subordination.ts and migration 022.

import type { CorrelationResult } from "./types.js";

/**
 * Minimal structural type matching the pg query helper exported by
 * packages/db/src/pg.ts. Same pattern subordination.ts uses; avoids
 * pulling @types/pg into the dashboard.
 */
export type QueryExec = (
  sql: string,
  params?: unknown[],
) => Promise<{ rows: any[] }>;

/**
 * For each host, returns the set of supplied rule types that
 * currently have UNRESOLVED active alerts whose first_seen is within
 * the window. Used by classifier rules (e.g. accept_backlog_or_syn_
 * flood) to decide whether to consolidate.
 *
 * Returns { matched: [], oldest_first_seen_ms: null } when ruleTypes
 * is empty or no rows match — never throws on no-match.
 */
export async function correlatedRulesActive(
  exec: QueryExec,
  hostId: string,
  ruleTypes: string[],
  windowSeconds: number,
): Promise<CorrelationResult> {
  if (ruleTypes.length === 0) {
    return { matched: [], oldest_first_seen_ms: null };
  }

  const cutoffMs = Date.now() - windowSeconds * 1000;

  // bola-exempt: server_id is the ownership boundary and is supplied
  // by the caller; this primitive is server-scoped by construction.
  // Callers in the alert evaluator already enforce ownership before
  // dispatching per-host rule evaluation.
  const { rows } = await exec(
    `SELECT alert_type,
            EXTRACT(EPOCH FROM first_seen) * 1000 AS first_seen_ms
       FROM active_alerts
      WHERE server_id = $1
        AND alert_type = ANY($2::text[])
        AND first_seen >= to_timestamp($3 / 1000.0)
        AND resolved_at IS NULL`,
    [hostId, ruleTypes, cutoffMs],
  );

  if (rows.length === 0) {
    return { matched: [], oldest_first_seen_ms: null };
  }

  // De-duplicate alert_type (same rule could in theory have multiple
  // active rows on the same host for distinct evidence keys; the
  // primitive cares whether the rule is matched at all).
  const matched = Array.from(new Set(rows.map((r) => String(r.alert_type))));
  const firstSeenMs = rows
    .map((r) => Number(r.first_seen_ms))
    .filter((n) => Number.isFinite(n));
  const oldest = firstSeenMs.length > 0 ? Math.min(...firstSeenMs) : null;

  return { matched, oldest_first_seen_ms: oldest };
}
