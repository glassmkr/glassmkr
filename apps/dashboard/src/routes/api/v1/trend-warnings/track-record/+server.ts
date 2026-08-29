// scope: read
// tier: free
//
// GET /api/v1/trend-warnings/track-record
//
// Aggregated precision + feedback stats for this customer's servers
// over the last 90 days. Pro-gated for programmatic callers; sessions
// bypass per Position B (Free dashboards may still load this; trend
// warnings don't generate for Free, so the stats return zeros).

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { query } from "@glassmkr/db/pg";
import { requireProGatedAuth, ProGatedAuthFailed } from "$lib/server/auth/gate";

export const GET: RequestHandler = async (event) => {
  let principal;
  try {
    principal = await requireProGatedAuth(event, {
      action: "read",
      resource_type: "trend_warning",
      scopeLevel: "read",
    });
  } catch (e) {
    if (e instanceof ProGatedAuthFailed) return e.response;
    throw e;
  }

  try {
    const stats = await query(
      `SELECT
         COUNT(*) FILTER (WHERE tw.notified_at IS NOT NULL) AS warnings_sent,
         COUNT(*) FILTER (WHERE tw.user_feedback = 'valuable') AS warnings_confirmed,
         COUNT(*) FILTER (WHERE tw.user_feedback = 'false_positive') AS warnings_dismissed,
         COUNT(*) FILTER (WHERE tw.notified_at IS NOT NULL AND tw.user_feedback IS NULL) AS warnings_pending,
         -- Split pending into live + stale so settings can prioritise
         -- live unrated warnings (operator can still see + act on
         -- them) and de-emphasise stale ones (already auto-resolved;
         -- rating is optional). Issue raised 2026-05-21 when stale
         -- pending rows inflated the "N pending your feedback" count
         -- visibly even though the underlying state had cleared.
         COUNT(*) FILTER (WHERE tw.notified_at IS NOT NULL AND tw.user_feedback IS NULL AND tw.resolved_at IS NULL) AS warnings_pending_live,
         COUNT(*) FILTER (WHERE tw.notified_at IS NOT NULL AND tw.user_feedback IS NULL AND tw.resolved_at IS NOT NULL) AS warnings_pending_stale
       FROM trend_warnings tw
       JOIN servers s ON s.id = tw.server_id
       WHERE s.customer_id = $1
         AND tw.first_detected_at >= NOW() - INTERVAL '90 days'`,
      [principal.customer_id]
    );
    const s = stats.rows[0];
    const sent = parseInt(s.warnings_sent, 10);
    const confirmed = parseInt(s.warnings_confirmed, 10);
    const dismissed = parseInt(s.warnings_dismissed, 10);
    const pending = parseInt(s.warnings_pending, 10);
    const pendingLive = parseInt(s.warnings_pending_live, 10);
    const pendingStale = parseInt(s.warnings_pending_stale, 10);
    const precision = confirmed + dismissed > 0
      ? confirmed / (confirmed + dismissed)
      : null;

    // "Preceded a matching hardware alert": require the alert's type to
    // share a root token with the trend-warning type (e.g. "smart_5_growing"
    // preceded "smart_failing"). Without this, any unrelated alert near the
    // warning counts, which inflates the number.
    const preceded = await query(
      `SELECT COUNT(DISTINCT tw.id) AS n
       FROM trend_warnings tw
       JOIN servers s ON s.id = tw.server_id
       JOIN active_alerts aa ON aa.server_id = tw.server_id
         AND aa.first_seen BETWEEN tw.first_detected_at AND tw.first_detected_at + INTERVAL '30 days'
         AND aa.alert_type LIKE '%' || SPLIT_PART(tw.warning_type, '_', 1) || '%'
       WHERE s.customer_id = $1
         AND tw.first_detected_at >= NOW() - INTERVAL '90 days'
         AND tw.notified_at IS NOT NULL`,
      [principal.customer_id]
    );

    return json({
      window_days: 90,
      warnings_sent: sent,
      warnings_confirmed: confirmed,
      warnings_dismissed: dismissed,
      warnings_pending: pending,
      warnings_pending_live: pendingLive,
      warnings_pending_stale: pendingStale,
      precision_estimate: precision,
      warnings_that_preceded_alert: parseInt(preceded.rows[0].n, 10),
    });
  } catch (err: any) {
    console.error("[trend-warnings] track-record error:", err?.message);
    return json({ error: "Failed to load track record" }, { status: 500 });
  }
};
