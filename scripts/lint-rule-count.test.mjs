#!/usr/bin/env node
//
// Test the advertised-rule-count gate (per the standing rule that every new CI gate
// ships with a known-bad fixture proving it catches the real-world equivalent).
// Standalone, no test framework, like lint-fallback-version.test.mjs.
//
// The load-bearing cases are the two phrasings that a tighter matcher silently
// skipped while this task was being done: "68 built-in rules" (an intervening word)
// and "62 Glassmkr alert rules" (an intervening CAPITALIZED word). Both were live on
// the site and both would have survived the reconcile.

import { findClaims, checkClaims, isDated } from "./lint-rule-count.mjs";

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

// --- findClaims: the phrasings that actually occur ---------------------------

check("plain 'N alert rules'", findClaims("SMART, IPMI. 70 alert rules with fixes.")[0]?.num, 70);
check("hyphenated 'N-rule catalog'", findClaims("the full 70-rule catalog")[0]?.num, 70);
check("'N rules'", findClaims("all 70 rules, 7-day retention")[0]?.num, 70);
check("'N opinionated rules'", findClaims("70 opinionated rules")[0]?.num, 70);
check("'N alerts'", findClaims("70 alerts shipped")[0]?.num, 70);

// One intervening word. This phrasing was live on /vs/librenms and /vs/prometheus
// and was skipped by the first matcher.
check("one intervening word: 'N built-in rules'", findClaims("70 built-in rules")[0]?.num, 70);

// Two intervening words.
check(
  "two intervening words: 'N opinionated bare-metal rules'",
  findClaims("70 opinionated bare-metal rules")[0]?.num,
  70,
);

// Intervening CAPITALIZED word. This was live on /docs/rules and was skipped even by
// the second matcher, which required a lowercase first letter.
check(
  "intervening capitalized word: 'N Glassmkr alert rules'",
  findClaims("All 70 Glassmkr alert rules grouped by category")[0]?.num,
  70,
);

// --- findClaims: things that must NOT match ---------------------------------

// A duration reads exactly like a count. This is live copy on the blog.
check("duration is not a claim: '60 minutes of stale alerting'", findClaims("60 minutes of stale alerting").length, 0);
check("duration: '24 hours of alerts'", findClaims("24 hours of alerts").length, 0);
check("duration: '7 day alert retention'", findClaims("90 day alert retention").length, 0);

// Unrelated numbers near unrelated words.
check("no claim in plain prose", findClaims("Runs on kernel 4.18 or newer.").length, 0);

// --- checkClaims -------------------------------------------------------------

check(
  "matching count produces no violations",
  checkClaims([{ file: "a.svelte", claims: [{ num: 70, text: "70 rules" }] }], 70).length,
  0,
);

// THE REPRODUCTION: the state this whole task existed to fix.
const stale = checkClaims(
  [
    { file: "routes/+page.svelte", claims: [{ num: 68, text: "68 alert rules" }] },
    { file: "routes/about/+page.svelte", claims: [{ num: 65, text: "65 alerts" }] },
    { file: "routes/docs/rules/+page.svelte", claims: [{ num: 62, text: "62 Glassmkr alert rules" }] },
  ],
  70,
);
check("reproduction: three stale counts yield three violations", stale.length, 3);
check("violation names the file", stale[0].includes("routes/+page.svelte"), true);
check("violation quotes the offending text", stale[1].includes("65 alerts"), true);
check("violation states the real count", stale[2].includes("70"), true);

// --- isDated: the deliberate exclusions --------------------------------------

check("blog post is dated", isDated("apps/site/src/routes/blog/introducing-glassmkr/+page.svelte"), true);
check("blog index is dated", isDated("apps/site/src/routes/blog/+page.svelte"), true);
check("changelog is dated", isDated("apps/site/src/routes/docs/changelog/+page.svelte"), true);
check("homepage is NOT dated", isDated("apps/site/src/routes/+page.svelte"), false);
check("a vs page is NOT dated", isDated("apps/site/src/routes/vs/datadog/+page.svelte"), false);
// /docs/rules must stay in scope: it is where a "62" survived two prior reconciles.
check("docs/rules is NOT dated", isDated("apps/site/src/routes/docs/rules/+page.svelte"), false);

console.log(`[lint:rule-count:test] ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
