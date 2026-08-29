#!/usr/bin/env node
//
// Guard: every alert rule must have an entry in the site generator's CATEGORY map.
//
// Why this gate exists: apps/site/scripts/gen-rules.mjs hard-fails the build on
// any rule id missing from its CATEGORY map, but CI's Build + Check never runs
// the site prebuild. So a PR adding a rule without a CATEGORY entry passes ALL
// CI checks, merges to main, and then the PRODUCTION DEPLOY aborts at
// @glassmkr/site:build. It fails closed ("Services unchanged; deployment
// aborted") so prod is never damaged, but main cannot deploy for anyone until a
// follow-up lands. That happened twice: #548 and #596 -> hotfix #597.
//
// IMPLEMENTATION NOTE, and the reason this file was rewritten on 2026-07-29.
// The first version regex-parsed the CATEGORY object out of gen-rules.mjs source
// text. An adversarial review broke it in one move: a key inside a multi-line
// /* */ block comment still matched the regex, so this guard reported
// "70 rules all mapped" while the real generator failed on that exact rule. A
// guard that reports green while the thing it stands in for fails is worse than
// no guard.
//
// Text parsing has a whole class of that hole (block comments, a "};" inside a
// string, a nested object literal, a renamed const). So the data moved to
// apps/site/scripts/rule-categories.mjs and BOTH gen-rules and this guard now
// import it. There is one source of truth and no parsing, so the guard cannot
// drift from the generator. Do not reintroduce source-text parsing here.
//
// Three checks, all of which map to a real silent failure:
//   1. a rule id with no CATEGORY entry   -> gen-rules hard-fails, deploy breaks
//   2. a CATEGORY entry with no rule      -> dead config left by a rename
//   3. a CATEGORY value not in CATEGORY_ORDER -> the rule lands in a category the
//      catalog never renders, so it is SILENTLY DROPPED from llms-full.txt and
//      /docs/rules with no error anywhere. This is the original #505 bug shape
//      (header said 65, body listed 61) and nothing guarded it until now: a typo
//      in a category VALUE, as opposed to a missing key, produced no failure.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { CATEGORY, CATEGORY_ORDER } from "../apps/site/scripts/rule-categories.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(here, "..");

export const RULES_DIR = "apps/dashboard/src/lib/server/alerts/rules";
export const CATEGORY_SOURCE = "apps/site/scripts/rule-categories.mjs";

/**
 * Pure: read the `id:` field out of a rule YAML. Returns null when absent.
 * gen-rules throws on a rule YAML with no id, so null is a violation here too.
 * Deliberately regex rather than a YAML parse: the sibling root validators take
 * no `yaml` dependency, and `id:` is always a plain top-level scalar. Anchored to
 * column 0 so a nested `id:` (e.g. under `fix:`) is not mistaken for the rule id.
 */
export function extractRuleId(yamlSrc) {
  const m = yamlSrc.match(/^id:\s*["']?([A-Za-z0-9_]+)["']?\s*$/m);
  return m ? m[1] : null;
}

/**
 * Pure: given rule entries [{file, id}], the category map and the render order,
 * return a list of violation strings. Empty list means the deploy will not fail
 * on this and nothing is silently dropped.
 */
export function checkCategoryCoverage(rules, category, categoryOrder) {
  const violations = [];
  const categoryKeys = Object.keys(category);

  for (const r of rules.filter((x) => x.id === null)) {
    violations.push(`${r.file}: no top-level \`id:\` field found`);
  }

  const ids = rules.filter((x) => x.id !== null).map((x) => x.id);

  // 1. Missing entry: breaks the prod deploy.
  for (const id of ids.filter((i) => !categoryKeys.includes(i))) {
    violations.push(
      `${id}: no CATEGORY entry in ${CATEGORY_SOURCE} ` +
        `(this breaks the PROD DEPLOY, not CI)`,
    );
  }

  // 2. Dead entry: config left behind by a rename or removal.
  for (const key of categoryKeys.filter((k) => !ids.includes(k))) {
    violations.push(
      `${key}: CATEGORY entry in ${CATEGORY_SOURCE} has no rule YAML ` +
        `(dead config from a rename or removal)`,
    );
  }

  // 3. Unrenderable category: silently dropped from the public catalog.
  for (const key of categoryKeys) {
    const value = category[key];
    if (!categoryOrder.includes(value)) {
      violations.push(
        `${key}: category "${value}" is not in CATEGORY_ORDER, so the rule is ` +
          `SILENTLY DROPPED from llms-full.txt and /docs/rules (no build error)`,
      );
    }
  }

  return violations;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  // Importing the data makes most of the old failure modes impossible, but a
  // shape change still has to fail loudly rather than silently pass.
  if (!CATEGORY || typeof CATEGORY !== "object" || Object.keys(CATEGORY).length === 0) {
    console.error(
      `[lint:rule-category] CATEGORY imported from ${CATEGORY_SOURCE} is missing or empty. ` +
        `It was renamed or restructured; update this gate to match rather than deleting it.`,
    );
    process.exit(1);
  }
  if (!Array.isArray(CATEGORY_ORDER) || CATEGORY_ORDER.length === 0) {
    console.error(
      `[lint:rule-category] CATEGORY_ORDER imported from ${CATEGORY_SOURCE} is missing or empty.`,
    );
    process.exit(1);
  }

  let files;
  try {
    files = readdirSync(join(repoRoot, RULES_DIR))
      .filter((f) => f.endsWith(".yaml"))
      .sort();
  } catch {
    console.error(`[lint:rule-category] cannot read ${RULES_DIR} (moved or deleted?)`);
    process.exit(1);
  }

  const rules = files.map((f) => ({
    file: f,
    id: extractRuleId(readFileSync(join(repoRoot, RULES_DIR, f), "utf8")),
  }));

  const violations = checkCategoryCoverage(rules, CATEGORY, CATEGORY_ORDER);

  if (violations.length > 0) {
    console.error("[lint:rule-category] violations:");
    for (const v of violations) console.error("  " + v);
    console.error(
      `\nEvery rule id must appear in the CATEGORY map in ${CATEGORY_SOURCE}, with a ` +
        `category that exists in CATEGORY_ORDER. An unmapped rule makes gen-rules ` +
        `hard-fail the site build, which surfaces as a FAILED PROD DEPLOY because CI ` +
        `does not run the site prebuild. A rule in an unordered category is worse: it ` +
        `is dropped from the public catalog with no error at all. See checklist item 8 ` +
        `of the glassmkr-rule-change skill.`,
    );
    process.exit(1);
  }

  console.log(
    `[lint:rule-category] OK; ${rules.length} rules all mapped, ` +
      `${Object.keys(CATEGORY).length} CATEGORY entries all used, ` +
      `all categories in CATEGORY_ORDER.`,
  );
}
