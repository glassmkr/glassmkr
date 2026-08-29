import type { PageServerLoad } from "./$types";
import rules from "$lib/data/rules.json";

// /docs/rules: index page listing the rule catalog grouped by category.
// The data is generated at build time by apps/site/scripts/gen-rules.mjs
// from the canonical YAML library at apps/dashboard/src/lib/server/
// alerts/rules/. See CONTENT_TRANCHE_3 spec (2026-05-17).

export const load: PageServerLoad = async () => {
  return { rules };
};
