#!/usr/bin/env node
//
// Test the rule-CATEGORY coverage gate (per the standing rule that every new CI
// gate ships with a known-bad fixture proving it catches the real-world
// equivalent). Standalone, no test framework, like lint-fallback-version.test.mjs.
// Exits non-zero on mismatch.
//
// The extractCategoryKeys tests that used to live here are GONE on purpose: the
// guard no longer parses JavaScript source text, it imports the data. Those tests
// covered a mechanism that had an unfixable class of holes (a key inside a
// multi-line /* */ block defeated it, which is how review broke the first
// version). Deleting the mechanism deletes the holes; there is nothing left to
// test there.

import {
  extractRuleId,
  checkCategoryCoverage,
} from "./lint-rule-category.mjs";

let pass = 0;
let fail = 0;

function check(label, got, want) {
  if (got === want) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${label}\n  expected ${want}, got ${got}`);
  }
}

const ORDER = ["Storage", "Hardware (BMC/IPMI)"];

// --- extractRuleId ----------------------------------------------------------

check(
  "reads a plain top-level id",
  extractRuleId("# comment\nid: ipmi_monitoring_unavailable\npriority: P3\n"),
  "ipmi_monitoring_unavailable",
);

check("reads a quoted id", extractRuleId(`id: "smart_failing"\n`), "smart_failing");

// Must not match a nested/indented key that merely ends in id.
check(
  "ignores an indented id inside a nested block",
  extractRuleId("fix:\n  id: not_the_rule_id\n"),
  null,
);

check("missing id yields null", extractRuleId("priority: P3\n"), null);

// --- checkCategoryCoverage: fully mapped ------------------------------------

check(
  "fully mapped rules produce no violations",
  checkCategoryCoverage(
    [{ file: "a.yaml", id: "alpha" }, { file: "b.yaml", id: "beta" }],
    { alpha: "Storage", beta: "Storage" },
    ORDER,
  ).length,
  0,
);

// --- check 1: missing entry (the #596 reproduction) -------------------------

const missing = checkCategoryCoverage(
  [{ file: "a.yaml", id: "alpha" }, { file: "new.yaml", id: "ipmi_monitoring_unavailable" }],
  { alpha: "Storage" },
  ORDER,
);
check("#596 reproduction: unmapped rule yields exactly 1 violation", missing.length, 1);
check(
  "#596 reproduction: violation names the rule",
  missing[0].includes("ipmi_monitoring_unavailable"),
  true,
);
check(
  "#596 reproduction: violation says it breaks the deploy, not CI",
  missing[0].includes("PROD DEPLOY"),
  true,
);

// --- check 2: dead entry ----------------------------------------------------

const stale = checkCategoryCoverage(
  [{ file: "a.yaml", id: "alpha" }],
  { alpha: "Storage", smart_risk: "Storage" },
  ORDER,
);
check("stale CATEGORY entry yields exactly 1 violation", stale.length, 1);
check("stale violation names the dead key", stale[0].includes("smart_risk"), true);

// --- check 3: category not in CATEGORY_ORDER (NEW) -------------------------
//
// The silent-drop case nothing guarded before. A typo in a category VALUE (as
// opposed to a missing key) produced no build error at all: the rule fell into a
// category the catalog never renders and vanished from llms-full.txt and
// /docs/rules. This is the original #505 bug shape.

const unordered = checkCategoryCoverage(
  [{ file: "a.yaml", id: "alpha" }],
  { alpha: "Storag" }, // typo: not in CATEGORY_ORDER
  ORDER,
);
check("category typo yields exactly 1 violation", unordered.length, 1);
check("category-typo violation names the bad value", unordered[0].includes("Storag"), true);
check(
  "category-typo violation says it is silently dropped",
  unordered[0].includes("SILENTLY DROPPED"),
  true,
);

// --- combinations -----------------------------------------------------------

// A rename produces BOTH directions at once, which is the useful diagnostic:
// the new id is unmapped and the old key is dead.
check(
  "a rename reports both the unmapped new id and the dead old key",
  checkCategoryCoverage([{ file: "a.yaml", id: "new_name" }], { old_name: "Storage" }, ORDER).length,
  2,
);

// A rule YAML with no id is a violation too: gen-rules throws on it.
check(
  "rule YAML with no id yields a violation",
  checkCategoryCoverage([{ file: "broken.yaml", id: null }], {}, ORDER).length,
  1,
);

// An empty CATEGORY_ORDER must flag every category rather than passing.
check(
  "empty CATEGORY_ORDER flags every mapped category",
  checkCategoryCoverage(
    [{ file: "a.yaml", id: "alpha" }, { file: "b.yaml", id: "beta" }],
    { alpha: "Storage", beta: "Storage" },
    [],
  ).length,
  2,
);

console.log(`[lint:rule-category:test] ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
