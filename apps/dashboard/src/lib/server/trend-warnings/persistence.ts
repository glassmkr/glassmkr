// Persistence gate and urgency tier assignment (Stage 3 continued + urgency).
//
// A finding must persist across 2 consecutive batches before being notified.
// Exceptions: SMART 187 first appearance and NVMe critical_warning fire
// immediately (per Backblaze and NVMe spec operational guidance).
//
// Urgency tiers determine notification behavior:
//   imminent (<=7d or high+critical pattern) -> push immediately, P2
//   soon     (<=30d or high)                 -> push once, P3
//   scheduled(<=90d or medium)               -> dashboard only, P4
//   watch    (>90d or low confidence)         -> dashboard collapsed, no push
//
// Spec: 07-trend-warnings-spec-v2.md, Stage 3

import { query } from "@glassmkr/db/pg";
import type { Finding, UrgencyTier, Narration } from "./types";

// Findings that skip the 2-batch persistence requirement
const IMMEDIATE_TYPES = new Set([
  "smart_187_first_appearance",
  "nvme_critical_warning",
]);

/**
 * Compute the urgency tier from severity and projected timeline.
 */
export function computeUrgencyTier(finding: Finding): UrgencyTier {
  const timeline = finding.projected_timeline?.toLowerCase() ?? "";
  const daysMatch = timeline.match(/(\d+)\s*day/);
  const projectedDays = daysMatch ? parseInt(daysMatch[1], 10) : null;

  if (finding.severity === "high" && (timeline.includes("immediate") || (projectedDays != null && projectedDays <= 7))) {
    return "imminent";
  }
  if (finding.severity === "high" || (projectedDays != null && projectedDays <= 30)) {
    return "soon";
  }
  if (finding.severity === "medium" || (projectedDays != null && projectedDays <= 90)) {
    return "scheduled";
  }
  return "watch";
}

/**
 * Upsert a finding into the trend_warnings table. Returns whether the finding
 * has passed the persistence gate (2+ consecutive batches, or is an immediate type).
 */
export async function upsertAndCheckPersistence(
  serverId: string,
  finding: Finding,
  urgencyTier: UrgencyTier,
  narration: Narration | null,
): Promise<{ warningId: number; shouldNotify: boolean; isNew: boolean }> {
  const resourceId = `${finding.resource.kind}:${finding.resource.serial ?? finding.resource.name}`;

  // Drive / NVMe identity falls back to the device path when the serial is
  // unknown; once the serial resolves, the key flips from e.g. `drive:/dev/sdb`
  // to `drive:<serial>`. Supersede any active warning still keyed on the path
  // so the same disk does not surface as two warnings. (Orphans created before
  // this fix are cleared once by migration 030.)
  if (finding.resource.serial && finding.resource.name) {
    const pathKey = `${finding.resource.kind}:${finding.resource.name}`;
    if (pathKey !== resourceId) {
      await query(
        `UPDATE trend_warnings SET resolved_at = now(), resolution_reason = 'superseded_by_serial'
         WHERE server_id = $1 AND warning_type = $2 AND resource_identifier = $3 AND resolved_at IS NULL`,
        [serverId, finding.type, pathKey],
      );
    }
  }

  // Check if an active warning already exists for this (server, type, resource)
  const existing = await query(
    `SELECT id, consecutive_batches_seen, notified_at FROM trend_warnings
     WHERE server_id = $1 AND warning_type = $2 AND resource_identifier = $3
     AND resolved_at IS NULL`,
    [serverId, finding.type, resourceId]
  );

  if (existing.rows.length > 0) {
    // Update existing warning
    const row = existing.rows[0];
    const newBatchCount = row.consecutive_batches_seen + 1;

    // bola-exempt: row.id was loaded by the server-scoped SELECT above
    // (server_id = $1). Caller already verified server ownership.
    await query(
      `UPDATE trend_warnings SET
        severity = $1, urgency_tier = $2, correlation_match = $3,
        tree_ranker_score = $4, contributing_metrics = $5,
        evidence_summary = $6, narration = $7, projected_timeline = $8,
        last_updated_at = now(), consecutive_batches_seen = $9
       WHERE id = $10`,
      [
        finding.severity, urgencyTier, finding.correlation_match,
        finding.tree_ranker_score, JSON.stringify(finding.contributing_metrics),
        finding.evidence_summary, narration ? JSON.stringify(narration) : null,
        finding.projected_timeline, newBatchCount, row.id,
      ]
    );

    const passedPersistence = newBatchCount >= 2 || IMMEDIATE_TYPES.has(finding.type);
    const alreadyNotified = !!row.notified_at;

    return {
      warningId: row.id,
      shouldNotify: passedPersistence && !alreadyNotified && (urgencyTier === "imminent" || urgencyTier === "soon"),
      isNew: false,
    };
  }

  // Insert new warning
  const result = await query(
    `INSERT INTO trend_warnings
      (server_id, warning_type, resource_identifier, severity, urgency_tier,
       correlation_match, tree_ranker_score, contributing_metrics,
       evidence_summary, narration, projected_timeline)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      serverId, finding.type, resourceId, finding.severity, urgencyTier,
      finding.correlation_match, finding.tree_ranker_score,
      JSON.stringify(finding.contributing_metrics), finding.evidence_summary,
      narration ? JSON.stringify(narration) : null, finding.projected_timeline,
    ]
  );

  const warningId = result.rows[0].id;
  const isImmediate = IMMEDIATE_TYPES.has(finding.type);

  return {
    warningId,
    shouldNotify: isImmediate && (urgencyTier === "imminent" || urgencyTier === "soon"),
    isNew: true,
  };
}

/**
 * Mark warnings that were NOT seen in this batch as resolved. A warning that
 * stops appearing means the condition cleared.
 *
 * Resolution reason (since migration 017): distinguishes "the system
 * reconsidered before this candidate ever reached notification"
 * (`persistence_gate_reconsidered`) from "this was a real, notified
 * warning whose signal then recovered" (`signal_recovered`). The
 * `notified_at` column is the discriminator: null means never reached
 * the 2-batch persistence threshold for human notification.
 */
export async function resolveStaleWarnings(
  serverId: string,
  seenWarningIds: number[],
): Promise<void> {
  const reasonExpr = `CASE WHEN notified_at IS NULL
    THEN 'persistence_gate_reconsidered'
    ELSE 'signal_recovered'
  END`;

  if (seenWarningIds.length === 0) {
    // No warnings this batch; resolve all active warnings for this server
    await query(
      `UPDATE trend_warnings
       SET resolved_at = now(),
           resolution_reason = ${reasonExpr}
       WHERE server_id = $1 AND resolved_at IS NULL`,
      [serverId]
    );
    return;
  }

  await query(
    `UPDATE trend_warnings
     SET resolved_at = now(),
         resolution_reason = ${reasonExpr}
     WHERE server_id = $1 AND resolved_at IS NULL AND id != ALL($2::bigint[])`,
    [serverId, seenWarningIds]
  );
}

/**
 * Mark a warning as notified (so we don't re-send).
 */
export async function markNotified(warningId: number): Promise<void> {
  // bola-exempt: warningId was returned by upsertAndCheckPersistence
  // which already constrained by server_id and verified the warning's
  // ownership transitively.
  await query(
    `UPDATE trend_warnings SET notified_at = now() WHERE id = $1`,
    [warningId]
  );
}
