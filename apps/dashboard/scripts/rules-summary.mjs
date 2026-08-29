#!/usr/bin/env node
// FIX-workflow field-population summary. Walks every YAML file
// under src/lib/server/alerts/rules/, parses each, and reports
// per-field coverage so we can track deepening progress against
// the 37-rule registered-evaluator target (per pre-flight count).
//
// Per CC_FIX_WORKFLOW_DATA_MODEL_2026-05-14.md Phase 2 reporting
// shape: variants populated, prerequisites N/X, safe_mode N/X,
// validation N/X, etc.
//
// Run via `pnpm rules:summary`.
//
// Lightweight: parses YAML + checks structural required fields
// in plain JS. The rigorous Zod validation lives in
// fix-workflow/schema.ts and is exercised by the vitest test
// (which fails CI on any malformed YAML). This script is a
// coverage report, not a gate.
//
// Exit code: 0 if all YAML parses. 1 only on parse failure
// (structural problems don't fail since this is informational).

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_DIR = join(__dirname, "..", "src", "lib", "server", "alerts", "rules");

const yamlFiles = readdirSync(RULES_DIR).filter((f) => f.endsWith(".yaml"));

let parseOk = 0;
let parseFail = 0;
const pop = {
  prerequisites: 0,
  safe_mode: 0,
  variants_at_least_one: 0,
  variants_more_than_one: 0,
  validation: 0,
  rollback_documented: 0,
  impact_concrete: 0,
  provenance_real_test: 0,
};

for (const filename of yamlFiles.sort()) {
  const raw = readFileSync(join(RULES_DIR, filename), "utf8");
  let r;
  try {
    r = parseYaml(raw);
  } catch (err) {
    console.error(`✗ ${filename}: YAML parse error: ${err.message}`);
    parseFail++;
    continue;
  }
  parseOk++;
  const f = r?.fix ?? {};
  if (Array.isArray(f.prerequisites) && f.prerequisites.length > 0) pop.prerequisites++;
  if (f.safe_mode && typeof f.safe_mode === "object") pop.safe_mode++;
  if (Array.isArray(f.variants) && f.variants.length > 0) pop.variants_at_least_one++;
  if (Array.isArray(f.variants) && f.variants.length > 1) pop.variants_more_than_one++;
  if (f.validation && typeof f.validation === "object") pop.validation++;
  if (f.rollback && typeof f.rollback === "object") {
    if (f.rollback.available === true || (typeof f.rollback.note === "string" && f.rollback.note.length > 30)) {
      pop.rollback_documented++;
    }
  }
  if (f.impact && typeof f.impact === "object") {
    if (f.impact.blast_radius !== "TODO" && f.impact.estimated_duration !== "TODO") {
      pop.impact_concrete++;
    }
  }
  if (f.provenance && typeof f.provenance === "object") {
    const note = f.provenance.source_note ?? "";
    const tested = f.provenance.tested_on ?? [];
    if (!note.includes("Pending re-verification") && !(tested[0]?.startsWith?.("Inherited") ?? false)) {
      pop.provenance_real_test++;
    }
  }
}

const total = parseOk + parseFail;
console.log("");
console.log("FIX-workflow rule-library summary");
console.log("=================================");
console.log(`Total YAML files:      ${total}`);
console.log(`Parsed cleanly:        ${parseOk}/${total}`);
console.log(`Parse failures:        ${parseFail}/${total}`);
console.log("");
console.log(`Field population (of ${parseOk} parsed rules):`);
console.log(`  variants ≥ 1:                              ${pop.variants_at_least_one}/${parseOk}`);
console.log(`  variants > 1 (distro/vendor split):        ${pop.variants_more_than_one}/${parseOk}`);
console.log(`  prerequisites:                             ${pop.prerequisites}/${parseOk}`);
console.log(`  safe_mode:                                 ${pop.safe_mode}/${parseOk}`);
console.log(`  validation:                                ${pop.validation}/${parseOk}`);
console.log(`  rollback (available or documented):        ${pop.rollback_documented}/${parseOk}`);
console.log(`  impact (concrete, not TODO):               ${pop.impact_concrete}/${parseOk}`);
console.log(`  provenance (real test, not migration):     ${pop.provenance_real_test}/${parseOk}`);
console.log("");
console.log("Deepening target: bring every \"N/X\" line toward X/X over time.");
console.log("Migration-stamped rules count as parsed but un-deepened.");

process.exit(parseFail > 0 ? 1 : 0);
