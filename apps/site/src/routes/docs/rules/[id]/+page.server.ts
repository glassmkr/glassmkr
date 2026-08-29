import type { PageServerLoad } from "./$types";
import { error } from "@sveltejs/kit";
import rulesData from "$lib/data/rules.json";

// /docs/rules/[id]: per-rule detail page rendering the YAML metadata.
// Data sourced from apps/site/src/lib/data/rules.json (generated at
// build time by apps/site/scripts/gen-rules.mjs from the canonical
// YAML library). Each request looks up the rule by id; 404 if not found.

interface RuleData {
  id: string;
  priority: string;
  title: string;
  summary: string;
  _category?: string;
}

export const load: PageServerLoad = async ({ params }) => {
  const id = params.id;
  const all = rulesData as unknown as RuleData[];
  const rule = all.find((r) => r.id === id);
  if (!rule) {
    throw error(404, `Rule "${id}" not found`);
  }
  // Build "related rules" list: other rules in the same category
  // (excluding this one), sorted alpha.
  const related = all
    .filter((r) => r._category === rule._category && r.id !== rule.id)
    .map((r) => ({ id: r.id, title: r.title }));
  return { rule, related };
};
