// scope: read
// tier: free
//
// GET /api/v1/trend-warnings/evaluations
//
// Returns the "candidates evaluated" surface introduced in Phase 2 of
// the trend-warnings UI honesty workstream
// (~/Documents/Glassmkr/CC_TREND_WARNINGS_UI_HONESTY.md). One row per
// batch per customer is written by `runTrendWarningsBatch()`; this
// endpoint aggregates the last 90 days for the calling customer plus
// the timestamp of the most recent batch row.
//
// Pro-gated for programmatic callers, session callers bypass. Same
// shape as the existing trend-warnings endpoints from PR #77. The
// stats themselves are accurate at any tier (Free customers' rows
// also accumulate, they just rarely fire warnings).

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
    const days = Math.min(parseInt(event.url.searchParams.get("days") || "90") || 90, 365);

    const totals = await query(
      `SELECT
         COUNT(*) AS batches,
         COALESCE(SUM(candidates_considered), 0) AS candidates_considered,
         COALESCE(SUM(candidates_above_threshold), 0) AS candidates_above_threshold,
         COALESCE(SUM(candidates_passed_persistence), 0) AS candidates_passed_persistence,
         COALESCE(SUM(warnings_emitted), 0) AS warnings_emitted,
         COALESCE(SUM(servers_skipped_young), 0) AS servers_skipped_young,
         MAX(evaluated_at) AS last_evaluated_at
       FROM trend_warning_evaluations
       WHERE customer_id = $1
         AND evaluated_at >= NOW() - $2 * INTERVAL '1 day'`,
      [principal.customer_id, days],
    );

    const row = totals.rows[0] ?? {};
    return json({
      window_days: days,
      batches: parseInt(row.batches ?? "0", 10),
      candidates_considered: parseInt(row.candidates_considered ?? "0", 10),
      candidates_above_threshold: parseInt(row.candidates_above_threshold ?? "0", 10),
      candidates_passed_persistence: parseInt(row.candidates_passed_persistence ?? "0", 10),
      warnings_emitted: parseInt(row.warnings_emitted ?? "0", 10),
      servers_skipped_young: parseInt(row.servers_skipped_young ?? "0", 10),
      last_evaluated_at: row.last_evaluated_at ?? null,
    });
  } catch (err: any) {
    if (err?.status) throw err;
    console.error("[trend-warnings] evaluations error:", err?.message);
    return json({ error: "Failed to load evaluations" }, { status: 500 });
  }
};
