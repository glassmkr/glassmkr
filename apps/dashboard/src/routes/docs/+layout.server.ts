// Dashboard /docs/* is superseded by glassmkr.com/docs/* (the
// marketing site). The dashboard's per-topic .svelte pages were
// deleted in the Bench-retirement PR (2026-05-22); only this
// redirect remains so old bookmarks and indexed URLs that hit
// app.glassmkr.com/docs* keep working.
//
// The load throws a permanent (301) redirect, preserving the
// subpath (so /docs/configuration → glassmkr.com/docs/configuration,
// /docs/api/tier-gating → glassmkr.com/docs/api/tier-gating, etc).
// The hash fragment is dropped by browsers automatically; that's
// fine because the marketing site uses its own anchor IDs.

import { redirect } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ url }) => {
  throw redirect(301, `https://glassmkr.com${url.pathname}`);
};
