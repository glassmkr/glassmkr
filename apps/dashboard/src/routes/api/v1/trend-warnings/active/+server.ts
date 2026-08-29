// scope: read
// tier: free
//
// GET /api/v1/trend-warnings/active?status=active|acknowledged|resolved
//
// Customer-wide trend warnings list. Mirrors the per-server endpoint
// at /api/v1/servers/[id]/trend-warnings but constrains by the
// principal's customer_id instead of a single server_id, so the
// standalone /trend-warnings page (CC_SPEC_3) can show fleet-wide
// active warnings.
//
// status=active:           not resolved AND not dismissed (default).
// status=acknowledged:     dismissed (operator acknowledged) but not yet
//                          resolved by the daily evaluator. Added 2026-
//                          05-20 alongside the UI rename Dismiss ->
//                          Acknowledge so operators can review previously
//                          acknowledged warnings.
// status=resolved:         resolved_at IS NOT NULL.
// status=pending_feedback: notified to the customer but user_feedback
//                          IS NULL. May overlap with active / resolved /
//                          acknowledged; the point is to surface warnings
//                          where Simon's track-record stat says "N pending
//                          your feedback" but the operator can't see them
//                          anywhere else (issue raised 2026-05-21).
//
// Pro-gated for programmatic callers; sessions bypass (UI may render
// visible-but-not-actionable warnings for Free users to surface the
// upsell, same pattern as the per-server view).

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { query } from "@glassmkr/db/pg";
import { requireProGatedAuth, ProGatedAuthFailed } from "$lib/server/auth/gate";

export const GET: RequestHandler = async (event) => {
  let principal;
  try {
    principal = await requireProGatedAuth(event, {
      action: "list",
      resource_type: "trend_warning",
      scopeLevel: "read",
    });
  } catch (e) {
    if (e instanceof ProGatedAuthFailed) return e.response;
    throw e;
  }

  const status = event.url.searchParams.get("status") || "active";
  const limit = Math.min(
    parseInt(event.url.searchParams.get("limit") || "100") || 100,
    500,
  );

  try {
    // JOIN servers so we can constrain by customer_id without trusting
    // a body-supplied filter (BOLA discipline). The JOIN also gives us
    // server name + hostname to render in the cross-server table.
    let rows;
    if (status === "resolved") {
      const r = await query(
        `SELECT tw.*, s.name AS server_name, s.hostname AS server_hostname
           FROM trend_warnings tw
           JOIN servers s ON s.id = tw.server_id
          WHERE s.customer_id = $1
            AND s.status != 'deleted'
            AND tw.resolved_at IS NOT NULL
          ORDER BY tw.resolved_at DESC
          LIMIT $2`,
        [principal.customer_id, limit],
      );
      rows = r.rows;
    } else if (status === "pending_feedback") {
      // Notified-but-not-yet-rated. Includes resolved AND dismissed
      // AND still-active rows so the operator can confirm precision
      // after the fact. Order: live rows (not yet resolved) first,
      // then stale (already auto-resolved) rows. Within each group
      // by notified_at DESC. The dashboard renders these as two
      // sub-sections; stale collapsed-by-default to reduce noise
      // (Decision (c) 2026-05-21).
      const r = await query(
        `SELECT tw.*, s.name AS server_name, s.hostname AS server_hostname
           FROM trend_warnings tw
           JOIN servers s ON s.id = tw.server_id
          WHERE s.customer_id = $1
            AND s.status != 'deleted'
            AND tw.notified_at IS NOT NULL
            AND tw.user_feedback IS NULL
          ORDER BY
            (tw.resolved_at IS NOT NULL) ASC,
            tw.notified_at DESC
          LIMIT $2`,
        [principal.customer_id, limit],
      );
      rows = r.rows;
    } else if (status === "acknowledged") {
      // Acknowledged = operator-dismissed but not yet auto-resolved.
      // Ordered by most-recently-acknowledged so the page reads like
      // an activity log.
      const r = await query(
        `SELECT tw.*, s.name AS server_name, s.hostname AS server_hostname
           FROM trend_warnings tw
           JOIN servers s ON s.id = tw.server_id
          WHERE s.customer_id = $1
            AND s.status != 'deleted'
            AND tw.dismissed_at IS NOT NULL
            AND tw.resolved_at IS NULL
          ORDER BY tw.dismissed_at DESC
          LIMIT $2`,
        [principal.customer_id, limit],
      );
      rows = r.rows;
    } else {
      // "Active" excludes both resolved (auto) and dismissed (operator).
      // Order by urgency_tier first (imminent > soon > scheduled),
      // then by first_detected_at to surface the newest critical issues.
      const r = await query(
        `SELECT tw.*, s.name AS server_name, s.hostname AS server_hostname
           FROM trend_warnings tw
           JOIN servers s ON s.id = tw.server_id
          WHERE s.customer_id = $1
            AND s.status != 'deleted'
            AND tw.resolved_at IS NULL
            AND tw.dismissed_at IS NULL
          ORDER BY
            CASE tw.urgency_tier
              WHEN 'imminent'  THEN 0
              WHEN 'soon'      THEN 1
              WHEN 'scheduled' THEN 2
              ELSE 3
            END,
            tw.first_detected_at DESC
          LIMIT $2`,
        [principal.customer_id, limit],
      );
      rows = r.rows;
    }

    return json({ warnings: rows });
  } catch (err: any) {
    console.error("[trend-warnings:active] list error:", err?.message);
    return json({ error: "Failed to list trend warnings" }, { status: 500 });
  }
};
