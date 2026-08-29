// The capture route is DEVELOPMENT ONLY, and this file is what makes that true.
//
// The page has always described itself as dev-only while answering 200 in
// production, relying on a noindex meta tag and a robots.txt Disallow. Neither
// makes a route private: they ask well-behaved crawlers not to index it, and
// say nothing to anyone who requests it directly. Production served
// /__capture/alert, /__capture/overview and every other name, including names
// that do not exist, all with HTTP 200.
//
// What it served matters more than that it was reachable. The showcase
// components are hand-composed illustrations: fixed hostnames, RFC 5737
// documentation IPs, a hard-coded alert with invented evidence, commands and
// timestamps, and hard-coded SMART values. This project's evidence rule is that
// anything public is a genuine capture or a recorded-data render carrying
// provenance. An anonymous visitor could read invented telemetry on a
// glassmkr.com URL with no label saying it was illustrative.
//
// scripts/capture-screenshots.mjs spawns `vite dev`, so `dev` is true for the
// only caller that legitimately needs these routes. The env flag exists for a
// production-mode build being captured deliberately, which is not how the
// script works today but is cheap to allow explicitly rather than by accident.
import { dev } from "$app/environment";
import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

/** Every showcase this route can render. Anything else is a 404, even in dev. */
const CAPTURE_NAMES = new Set([
  "alert",
  "overview",
  "storage",
  "network",
  "security",
  "ipmi",
  "server-detail",
]);

export const prerender = false;

export const load: PageServerLoad = ({ params }) => {
  const enabled = dev || process.env.GLASSMKR_ENABLE_CAPTURE_ROUTES === "1";
  if (!enabled) {
    // Deliberately the same 404 an unknown route returns. A distinct response
    // would confirm the route exists, which is the thing being withheld.
    throw error(404, "Not found");
  }
  // An unknown name used to render an empty stage at 200. A capture script
  // asking for a showcase that no longer exists should fail loudly rather than
  // silently write a blank screenshot over a real asset.
  if (!CAPTURE_NAMES.has(params.name)) {
    throw error(404, `Unknown capture target "${params.name}". Known: ${[...CAPTURE_NAMES].join(", ")}.`);
  }
  return { name: params.name };
};
