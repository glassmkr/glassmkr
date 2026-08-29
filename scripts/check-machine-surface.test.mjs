#!/usr/bin/env node
// Known-bad fixtures for the machine-surface gate.
//
// Written from the EXACT strings that shipped to production and passed. The
// audit's point was not that the gate was absent but that it was too narrow:
// its cadence regex wanted "60-second" or the phrase "every 60 seconds", and
// production said "pushing 60s health snapshots. The default snapshot interval
// is 60 seconds." Both claims were wrong, neither pattern matched, and the gate
// reported clean for months.
//
// The predicate below is kept identical to the one in the gate. A drift check
// at the bottom asserts the gate still contains each of these patterns, so the
// two cannot separate silently.
import fs from "node:fs";

const SRC = fs.readFileSync(new URL("./check-machine-surface.mjs", import.meta.url), "utf8");

let bad = 0;
const ok = (m) => console.log(`[machine-surface-test] ok   ${m}`);
const fail = (m) => { bad++; console.error(`[machine-surface-test] FAIL ${m}`); };
const check = (c, m) => (c ? ok(m) : fail(m));

const cadenceHit = (text) =>
  /\b60[- ]seconds?\b/i.test(text) ||
  /every 60 seconds/i.test(text) ||
  /\b60s\b(?=[^"']{0,40}(snapshot|interval|health|push))/i.test(text) ||
  /interval (?:is|of|default[s]?(?: to)?) 60\b/i.test(text);

// THE EXACT SHIPPED STRINGS, which the previous gate did not catch.
check(cadenceHit("Both end with the Crucible agent pushing 60s health snapshots."),
  'catches "pushing 60s health snapshots" (shipped, previously missed)');
check(cadenceHit("The default snapshot interval is 60 seconds."),
  'catches "interval is 60 seconds" (shipped, previously missed)');
check(cadenceHit("a 60-second cadence"), 'still catches "60-second"');
check(cadenceHit("every 60 seconds"), 'still catches "every 60 seconds"');

// Must NOT fire on correct copy, or on an unrelated figure that happens to be 60.
check(!cadenceHit("snapshots roughly every 5 minutes (collection.interval_seconds default 300, floor 60)"),
  "does not fire on the corrected sentence");
check(!cadenceHit("the dashboard accepts at most one ingest per server per 55s"),
  "does not fire on an unrelated seconds figure");
check(!cadenceHit("a 60s HTTP timeout"), "does not fire on an unrelated 60s value");

// The predicate here must still be the predicate there.
for (const [needle, label] of [
  ["60[- ]seconds?", "the widened seconds pattern"],
  ["every 60 seconds", "the exact-phrase pattern"],
  ["60s", "the bare 60s pattern"],
  ["interval (?:is|of|default", "the interval-declaration pattern"],
]) {
  check(SRC.includes(needle), `the gate still contains ${label}`);
}

// The gate must read BOTH origins. The app's own machine file was never
// scanned, which is why it could claim 30 rules against a catalogue of 70.
check(/apps\/dashboard\/static/.test(SRC) && /getApp\(/.test(SRC),
  "the gate reads the dashboard origin's machine file, not only the site's");
check(/app-machine-index/.test(SRC),
  "and reports on it as its own named check");

// --- RETIRED QUOTA LANGUAGE ---------------------------------------------
//
// "3 on Free" shipped in both site machine files and matched none of the four
// original retired-term patterns, so the node quota stayed wrong while this
// gate reported clean. The cadence fixtures above were added first and this
// one was not, which is the same gap one level down: a fixture file that
// covers one pattern family reads like coverage of all of them.
const retiredHit = (text) =>
  [
    /\$\d+ per node/i,
    /\d+ free nodes/i,
    /gated by Pro plan/i,
    /Pro plan; \d+-day/i,
    /\b\d+ on Free\b/i,
    /\bon Free\b[^.\n]{0,30}\bnodes?\b/i,
    /\bFree (?:tier|plan)\b[^.\n]{0,20}\b\d+ nodes?\b/i,
    /subscribed count on Pro/i,
  ].some((re) => re.test(text));

// THE EXACT SHIPPED STRINGS.
check(retiredHit("bounded only by the node quota (3 on Free) and rate limits."),
  'catches "3 on Free" (shipped in llms.txt and llms-full.txt, previously missed)');
check(retiredHit("each enrolled host consumes one node against your plan quota (3 on Free, your subscribed count on Pro)."),
  'catches "subscribed count on Pro" (shipped, previously missed)');
check(retiredHit("$3 per node"), "still catches retired per-node pricing");
check(retiredHit("gated by Pro plan"), "still catches retired Pro gating language");

// Must NOT fire on the corrected sentence or on the legitimate hosted cap.
check(!retiredHit("bounded only by the hosted node cap (10) and rate limits. Self-hosted has no node limit."),
  "does not fire on the corrected quota sentence");
check(!retiredHit("Optional hosted service, free up to 10 nodes."),
  "does not fire on the current hosted cap statement");

// And the patterns must still be the ones the gate holds.
for (const needle of ["\\d+ on Free", "subscribed count on Pro"]) {
  check(SRC.includes(needle), `the gate still contains the ${needle} pattern`);
}

// A staging origin must not silently read production's app index.
check(/APP_ORIGIN = process\.env\.APP_ORIGIN \|\| null/.test(SRC),
  "APP_ORIGIN is never defaulted to production");
check(/e\.skip/.test(SRC), "and an unset APP_ORIGIN skips rather than passes");
check(/INCOMPLETE.*SKIPPED|skipped[\s\S]{0,200}process\.exit\(2\)/.test(SRC),
  "and a run with skips exits 2 instead of announcing that all checks pass");

if (bad) { console.error(`[machine-surface-test] ${bad} failing`); process.exit(1); }
console.log("[machine-surface-test] all fixtures behave as specified");
