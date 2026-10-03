// The rule listing in the dashboard's machine index (apps/dashboard/static/llms.txt).
//
// That file is hand-maintained and static, so it cannot interpolate the
// catalogue the way the site does. It shipped "Alert Rules (70)" and "70 alert
// rules" against a catalogue of 72, and under that heading taught a P4 tier of
// rules that are declared P1 to P3 (no rule is declared P4). The gate only
// compared the heading's number, so bumping it by hand would have passed and
// gone stale again on the next rule. Two things are asserted instead:
//
//   1. No rule count at all. A number that is right today is still a pinned
//      literal in a file that cannot follow the catalogue.
//   2. The listing IS the catalogue: every rule under the priority its YAML
//      declares, nothing missing, nothing extra. A new rule fails this until it
//      is listed, which is the drift the count used to hide.
//
// Pure, so check-machine-surface.test.mjs can import the predicate the gate
// runs instead of keeping a copy of it.
import { findClaims } from "../lint-rule-count.mjs";

// "Priority P1 Urgent (act now):" followed by one or more "- a, b, c" lines.
const BLOCK = /^Priority (P\d)\b[^\n]*:\n((?:- [^\n]*(?:\n|$))+)/gm;

// findClaims was written for Svelte prose: two digits, then a lowercase noun.
// This file is hard-wrapped Markdown with title-case headings, so a count also
// arrives as "## 72 Alert Rules", "Alert Rules: 72", "70+ alert rules", a
// three-digit number, or split across a wrap, and findClaims passes all five.
const COUNT = /\b\d+\+?[\s-]+(?:[a-z][a-z-]*\s+){0,2}rules?\b|\balert rules?[ \t]*(?:\([ \t]*\d+\+?[ \t]*\)|:[ \t]*\d+)/gi;

// Named in every listing problem. A rule PR fails until its id is listed here,
// the CI line names only the check, and the site's generated llms.txt files
// share the file name.
const FILE = "apps/dashboard/static/llms.txt";

/**
 * Problems with the rule listing in the app index.
 * `rules` is the generated catalogue (apps/site/src/lib/data/rules.json),
 * itself generated from the rule YAMLs: [{ id, priority }].
 */
export function appIndexRuleProblems(text, rules) {
  const problems = [];

  const pinned = [...new Set([
    ...[...text.matchAll(COUNT)].map((m) => m[0]),
    ...findClaims(text).map((c) => c.text),
  ])];
  if (pinned.length) {
    problems.push(
      `states a rule count (${pinned.map((p) => `"${p}"`).join(", ")}); the catalogue holds ` +
        `${rules.length} and this static file cannot follow it, so it must not state one`,
    );
  }

  const listed = new Map();
  for (const m of text.matchAll(BLOCK)) {
    const ids = m[2].split("\n").map((l) => l.replace(/^- /, "")).join(",")
      .split(",").map((s) => s.trim()).filter(Boolean);
    for (const id of ids) {
      if (listed.has(id)) problems.push(`lists ${id} more than once`);
      else listed.set(id, m[1]);
    }
  }
  if (listed.size === 0) {
    problems.push('lists no rules: no "Priority Pn ...:" block followed by "- id, id" lines was found');
    return problems;
  }

  const declared = new Map(rules.map((r) => [r.id, r.priority]));
  const missing = rules.filter((r) => !listed.has(r.id)).map((r) => `${r.id} (${r.priority})`);
  const unknown = [...listed.keys()].filter((id) => !declared.has(id));
  const moved = [...listed].filter(([id, p]) => declared.has(id) && declared.get(id) !== p)
    .map(([id, p]) => `${id} under ${p}, declared ${declared.get(id)}`);
  if (missing.length) {
    problems.push(`does not list ${missing.length} catalogue rule(s): ${missing.join(", ")}; ` +
      `add each id, alphabetically, to its "Priority Pn" line in ${FILE} (hand-maintained, no generator)`);
  }
  if (unknown.length) {
    problems.push(`lists ${unknown.length} id(s) the catalogue does not hold: ${unknown.join(", ")}; ` +
      `remove or rename each in ${FILE}`);
  }
  if (moved.length) {
    problems.push(`lists ${moved.length} rule(s) under the wrong priority: ${moved.join("; ")}; ` +
      `move each to its declared "Priority Pn" line in ${FILE}`);
  }
  return problems;
}
