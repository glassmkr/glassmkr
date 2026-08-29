// Shared alert-lifecycle mutations, tenant-scoped by customer. One implementation
// behind both the REST routes (POST /api/v1/alerts/[id]/acknowledge|resolve) and
// the MCP write tools, so ownership + resolve-gate semantics can never drift
// between the two front doors.
import { query } from "@glassmkr/db/pg";
import { getRuleMetadata } from "$lib/server/alerts/fix-workflow/loader.js";

export const RESOLVE_NOTE_MAX_LEN = 200;
const RESOLVE_REASON_PREFIX = "manual-after-investigation; ";

/**
 * Acknowledge one alert the customer owns. Returns the updated row, or null when
 * no alert with that id belongs to the customer (the tenant check is the WHERE
 * ... server_id IN (customer's servers), so a cross-tenant id resolves to null).
 */
export async function acknowledgeAlertForCustomer(
  customerId: string,
  alertId: string,
): Promise<{ id: string; alert_type: string; acknowledged: boolean } | null> {
  const result = await query(
    `UPDATE active_alerts SET acknowledged = TRUE, acknowledged_at = NOW()
      WHERE id = $1 AND server_id IN (SELECT id FROM servers WHERE customer_id = $2)
    RETURNING id, alert_type, acknowledged`,
    [alertId, customerId],
  );
  return (result.rows[0] as { id: string; alert_type: string; acknowledged: boolean }) ?? null;
}

export type ResolveAlertResult =
  | { status: "not_found" }
  | { status: "not_manual_resolve"; alertType: string }
  | { status: "already_resolved" }
  | { status: "resolved"; alert: Record<string, unknown> };

/**
 * Manually resolve one owned alert. Mirrors the REST route's semantics exactly:
 * only rules carrying `manual_resolve: true` may be closed here (others auto-resolve
 * when their condition clears); already-resolved is an idempotent no-op; the note is
 * persisted with the audit-discriminating prefix. `note` is assumed pre-validated for
 * length by the caller (defensively capped here too).
 */
export async function resolveAlertForCustomer(
  customerId: string,
  alertId: string,
  note = "",
): Promise<ResolveAlertResult> {
  const lookup = await query(
    `SELECT alert_type, resolved_at
       FROM active_alerts
      WHERE id = $1 AND server_id IN (SELECT id FROM servers WHERE customer_id = $2)`,
    [alertId, customerId],
  );
  if (lookup.rows.length === 0) return { status: "not_found" };
  const row = lookup.rows[0] as { alert_type: string; resolved_at: Date | null };
  if (row.resolved_at !== null) return { status: "already_resolved" };

  const rule = getRuleMetadata(row.alert_type);
  if (!rule || rule.manual_resolve !== true) {
    return { status: "not_manual_resolve", alertType: row.alert_type };
  }

  const trimmed = note.trim().slice(0, RESOLVE_NOTE_MAX_LEN);
  const persistedReason = trimmed.length > 0
    ? RESOLVE_REASON_PREFIX + trimmed
    : RESOLVE_REASON_PREFIX.trimEnd();

  const result = await query(
    `UPDATE active_alerts
        SET resolved_at = NOW(), resolution_reason = $1
      WHERE id = $2 AND resolved_at IS NULL
        AND server_id IN (SELECT id FROM servers WHERE customer_id = $3)
    RETURNING id, alert_type, resolved_at, resolution_reason`,
    [persistedReason, alertId, customerId],
  );
  // Empty result = a concurrent writer resolved it between lookup and update;
  // that is the operator's intent, so treat as the idempotent already-resolved path.
  if (result.rows.length === 0) return { status: "already_resolved" };
  return { status: "resolved", alert: result.rows[0] as Record<string, unknown> };
}
