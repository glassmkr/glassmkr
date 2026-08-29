// scope: read
// tier: free
//
// GET /api/v1/servers/:id/trend-warnings?status=active|resolved
//
// Trend warnings are free on every account (P0-03 resolution, 2026-08-29;
// the gate helper below has been a pass-through since 2026-06-21 anyway).
// Session callers bypass the gate
// (UI may render visible-but-not-actionable warnings for Free); the
// programmatic API requires Pro.

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
      resource_id: event.params.id,
      scopeLevel: "read",
    });
  } catch (e) {
    if (e instanceof ProGatedAuthFailed) return e.response;
    throw e;
  }

  const serverResult = await query(
    `SELECT id FROM servers WHERE id = $1 AND customer_id = $2`,
    [event.params.id, principal.customer_id]
  );
  if (serverResult.rows.length === 0) {
    return json({ error: "Server not found" }, { status: 404 });
  }

  const status = event.url.searchParams.get("status") || "active";
  const limit = Math.min(parseInt(event.url.searchParams.get("limit") || "50") || 50, 200);

  try {
    let rows;
    if (status === "resolved") {
      const r = await query(
        `SELECT * FROM trend_warnings
         WHERE server_id = $1 AND resolved_at IS NOT NULL
         ORDER BY resolved_at DESC
         LIMIT $2`,
        [event.params.id, limit]
      );
      rows = r.rows;
    } else {
      // "Active" excludes both resolved (system auto-resolution) and
      // dismissed (customer clicked Dismiss). The DELETE handler on
      // /api/v1/trend-warnings/{id}/feedback sets dismissed_at but
      // pre-fix this query only filtered resolved_at, so a dismissed
      // warning reloaded right back into the UI. Codex 2026-05-12 P1.
      const r = await query(
        `SELECT * FROM trend_warnings
         WHERE server_id = $1
           AND resolved_at IS NULL
           AND dismissed_at IS NULL
         ORDER BY
           CASE urgency_tier WHEN 'imminent' THEN 0 WHEN 'soon' THEN 1 WHEN 'scheduled' THEN 2 ELSE 3 END,
           first_detected_at DESC
         LIMIT $2`,
        [event.params.id, limit]
      );
      rows = r.rows;
    }
    return json({ warnings: rows });
  } catch (err: any) {
    console.error("[trend-warnings] list error:", err?.message);
    return json({ error: "Failed to list trend warnings" }, { status: 500 });
  }
};
