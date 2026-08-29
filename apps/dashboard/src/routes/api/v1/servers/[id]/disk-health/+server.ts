// scope: read
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { query } from "@glassmkr/db/pg";
import { requireServerOwnership } from "$lib/server/authz";
import { requireAuth } from "$lib/server/auth/require";
import { requireScopeLevel } from "$lib/server/auth/plan";

// GET /api/v1/servers/:id/disk-health
//
// Returns the per-drive disk health rollup for this server. Ownership is
// enforced via requireServerOwnership (404 on foreign/missing servers so
// existence isn't leaked; see BOLA audit).
//
// Response:
// {
//   drives: [
//     { device_id, state, signals, model,
//       entered_state_at, first_observed_at, last_updated_at },
//     ...
//   ],
//   rollup: "healthy" | "declining" | "failing" | "broken"  // max across drives
// }
export const GET: RequestHandler = async (event) => {
  const principal = await requireAuth(event, { allow: ["session", "acct_key"] });
  requireScopeLevel(principal, "read");
  await requireServerOwnership(event.params.id!, principal.customer_id);

  const res = await query(
    `SELECT device_id, state, signals, model,
            entered_state_at, first_observed_at, last_updated_at
     FROM disk_health_state
     WHERE server_id = $1
     ORDER BY device_id`,
    [event.params.id],
  );
  const drives = res.rows;
  const rank: Record<string, number> = { healthy: 0, declining: 1, failing: 2, broken: 3 };
  let rollup = "healthy";
  for (const d of drives) {
    if ((rank[d.state] ?? 0) > (rank[rollup] ?? 0)) rollup = d.state;
  }
  return json({ drives, rollup });
};
