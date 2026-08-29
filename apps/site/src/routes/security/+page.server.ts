// 301 redirect /security -> /trust per CONTENT_TRANCHE_3 spec
// (2026-05-17). The /security page was renamed + restructured into
// the new /trust route with six anchor sections. This redirect
// preserves inbound links and search ranking.
//
// Permanent (301) so crawlers update their indexes; the new URL is
// canonical. The page.svelte file under /security is no longer
// rendered: the load function throws redirect before it would run.

import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
  throw redirect(301, "/trust");
};
