// scope: public
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

// GET /api/v1/health
//
// Stack-wide liveness probe with no-cache semantics. Returns
// { ok: true } and 200 if the SvelteKit handler runs at all.
//
// Why this exists, given /api/v1/version is also public:
// nginx caches /api/v1/version (Phase C performance baseline found
// localhost-through-nginx is ~6x faster than localhost-to-node,
// which means nginx is serving a cached response without ever
// hitting the app). That makes /version useful for "what build is
// running" but useless as a latency or liveness probe — a cached
// 200 will keep flowing for the cache TTL even if the node process
// is dead.
//
// /api/v1/health sets `Cache-Control: no-store, no-cache,
// must-revalidate` so nginx (and any upstream proxy) is obligated
// to forward each request to the node app. Use this for:
//   - external uptime monitoring (e.g., UptimeRobot, Healthchecks.io)
//   - the Phase C performance baseline as a true round-trip probe
//   - the upcoming dashboard → ops dashboard tile that confirms the app
//     is reachable and responding
//
// Intentionally returns a minimal JSON payload. No DB queries, no
// external network calls, no auth. The "did the node process
// answer at all" signal is the entire value of this endpoint;
// adding dependencies would weaken that.
export const GET: RequestHandler = async () => {
  return json(
    { ok: true },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
        Expires: "0",
      },
    },
  );
};
