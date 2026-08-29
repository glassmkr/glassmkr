// scope: public
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { listHostProfiles } from "$lib/server/services/fleet-read";

// GET /api/v1/host-profiles - Public catalog of host-type profiles and the
// rules each one suppresses by design. Used by the dashboard's per-server
// profile selector and by API clients that set `profile` via PATCH
// /servers/:id. Static product metadata (no tenant data), so it is public
// like /api/v1/version.
// tier: free
export const GET: RequestHandler = async () => {
  return json({
    profiles: listHostProfiles(),
  });
};
