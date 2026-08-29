import type { PageServerLoad } from "./$types";
import { loadCrucibleVersion } from "$lib/server/version";

// Homepage server load. Pulls the latest Crucible version from npm
// (10-min cache, falls back to FALLBACK_LATEST) so Hero +
// InstallBlock + ShowcaseServerDetail render the same installable-
// right-now version.
//
// fxRates / Frankfurter loader removed 2026-05-17 (revision commit 3):
// the pricing currency toggle was dropped in favor of USD-only
// display.
export const load: PageServerLoad = async () => loadCrucibleVersion();
