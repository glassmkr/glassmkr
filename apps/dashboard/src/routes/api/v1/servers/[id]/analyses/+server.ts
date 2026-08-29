// scope: read
// tier: free
//
// GET /api/v1/servers/:id/analyses — history of AI analyses for a
// server. Session callers bypass the Pro gate (Free dashboard can
// show prior trial-analysis output); programmatic callers must be
// on Pro.

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { query } from "@glassmkr/db/pg";
import { getRecentAnalyses } from "$lib/server/analysis/analyzer";
import { requireProGatedAuth, ProGatedAuthFailed } from "$lib/server/auth/gate";

export const GET: RequestHandler = async (event) => {
  let principal;
  try {
    principal = await requireProGatedAuth(event, {
      action: "list",
      resource_type: "analysis",
      resource_id: event.params.id,
      scopeLevel: "read",
    });
  } catch (e) {
    if (e instanceof ProGatedAuthFailed) return e.response;
    throw e;
  }

  try {
    const serverResult = await query(
      `SELECT id FROM servers WHERE id = $1 AND customer_id = $2`,
      [String(event.params.id), principal.customer_id]
    );
    if (serverResult.rows.length === 0) {
      return json({ error: "Server not found" }, { status: 404 });
    }

    const limit = Math.min(parseInt(event.url.searchParams.get("limit") || "10") || 10, 50);
    const analyses = await getRecentAnalyses(String(event.params.id), limit);

    return json({ analyses });
  } catch (err: any) {
    console.error("Get analyses error:", err.message);
    return json({ error: "Failed to get analyses" }, { status: 500 });
  }
};
