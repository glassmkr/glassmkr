// scope: read
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { requireAuth } from "$lib/server/auth/require";
import { requireScopeLevel } from "$lib/server/auth/plan";
import { getServerHealthForCustomer } from "$lib/server/services/fleet-read";

// GET /api/v1/servers/:id/health - Latest snapshot + active alerts
export const GET: RequestHandler = async (event) => {
  const principal = await requireAuth(event, { allow: ["session", "acct_key"] });
  requireScopeLevel(principal, "read");

  try {
    const health = await getServerHealthForCustomer(
      principal.customer_id,
      event.params.id ?? "",
    );
    if (!health) {
      return json({ error: "Server not found" }, { status: 404 });
    }
    return json(health);
  } catch (err: any) {
    console.error("Health summary error:", err.message);
    return json({ error: "Failed to get health summary" }, { status: 500 });
  }
};
