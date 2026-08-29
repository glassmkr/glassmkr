// scope: read
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { requireAuth } from "$lib/server/auth/require";
import { requireScopeLevel } from "$lib/server/auth/plan";
import { getServerHistoryForCustomer } from "$lib/server/services/fleet-read";
import { take, TIER_CH_READ, TIER_CH_READ_DEMO } from "$lib/server/auth/rate-limit";
import { resolveRangeHours, assertPointBudget, bucketMinutesFor, QueryCeilingError } from "$lib/server/query-ceilings";

// GET /api/v1/servers/:id/history?hours=24
export const GET: RequestHandler = async (event) => {
  const principal = await requireAuth(event, { allow: ["session", "acct_key"] });
  requireScopeLevel(principal, "read");

  // G5 (launch gate): this endpoint runs a ClickHouse time-range scan and had
  // no limiter at all. Per-account budget, tighter for the shared demo.
  const tier = event.locals.customer?.isDemo ? TIER_CH_READ_DEMO : TIER_CH_READ;
  const budget = await take(tier, principal.customer_id);
  if (!budget.allowed) {
    return json(
      { error: "Query budget exceeded.", retry_after_seconds: budget.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(budget.retryAfterSeconds) } },
    );
  }

  try {
    // Refuse an over-ceiling window with a clean 400 stating the limit;
    // never silently clamp, which returns a truncated series that looks
    // complete.
    let hours: number;
    let bucketMinutes: 5 | 30 | 60 | 180;
    try {
      hours = resolveRangeHours(event.url);
      bucketMinutes = bucketMinutesFor(hours);
      assertPointBudget(hours, bucketMinutes);
    } catch (e) {
      if (e instanceof QueryCeilingError) {
        return json({ error: e.message, limit: e.limit, requested: e.requested }, { status: 400 });
      }
      throw e;
    }
    const history = await getServerHistoryForCustomer(
      principal.customer_id,
      event.params.id ?? "",
      hours,
      bucketMinutes,
    );
    if (!history) {
      return json({ error: "Server not found" }, { status: 404 });
    }
    return json({ hours: history.hours, data: history.data });
  } catch (err: any) {
    console.error("History error:", err.message);
    return json({ error: "Failed to get history" }, { status: 500 });
  }
};
