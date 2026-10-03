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
import { appIndexRuleProblems } from "./lib/app-machine-index.mjs";

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

// --- THE APP INDEX'S RULE LISTING ---------------------------------------
//
// apps/dashboard/static/llms.txt shipped "## Alert Rules (70)" and "70 alert
// rules" against a catalogue of 72. The gate only compared the heading's
// number, so a hand bump to 72 would have passed and gone stale on the next
// rule. Under that heading it taught a P4 tier holding no_firewall (P1),
// kernel_needs_reboot (P2) and clock_drift (P2), while no rule is declared at
// P4; nothing compared the listing with the catalogue at all.
const RULES = JSON.parse(fs.readFileSync(new URL("../apps/site/src/lib/data/rules.json", import.meta.url), "utf8"));
const cat = [
  { id: "mce_uncorrected", priority: "P0" },
  { id: "no_firewall", priority: "P1" },
  { id: "clock_drift", priority: "P2" },
  { id: "load_high", priority: "P3" },
];
const listing = (rules) =>
  ["P0", "P1", "P2", "P3"]
    .map((p) => `Priority ${p} Label (meaning):\n- ${rules.filter((r) => r.priority === p).map((r) => r.id).join(", ")}`)
    .join("\n\n");
const has = (problems, needle) => problems.some((p) => p.includes(needle));

check(appIndexRuleProblems(listing(cat), cat).length === 0,
  "a complete listing with no stated count passes");
check(appIndexRuleProblems(listing(RULES), RULES).length === 0,
  "the real catalogue, listed in full under its declared priorities, passes");

// THE EXACT SHIPPED STRINGS.
check(has(appIndexRuleProblems(`## Alert Rules (70)\n\n${listing(cat)}`, cat), "Alert Rules (70)"),
  'catches "Alert Rules (70)" (shipped)');
check(has(appIndexRuleProblems(`self-hostable. 70 alert rules, per-core CPU, SMART\n\n${listing(cat)}`, cat), "70 alert rules"),
  'catches "70 alert rules" in the summary line (shipped, never checked)');
const shippedP4 = "Priority P4 Low (next maintenance):\n- no_firewall, kernel_needs_reboot, clock_drift";
// As shipped: each id listed once, under P4 only, so this is the wrong-priority
// path and not the duplicate one.
const p4 = appIndexRuleProblems(`${listing(cat.filter((r) => !shippedP4.includes(r.id)))}\n\n${shippedP4}`, cat);
check(has(p4, "no_firewall under P4, declared P1") && has(p4, "clock_drift under P4, declared P2"),
  "catches rules listed under a priority their definition does not declare (shipped P4 block)");
check(has(p4, "kernel_needs_reboot"),
  "catches a listed id the catalogue does not hold");

// A CORRECT number is still a pinned literal: the file is static and cannot
// follow the catalogue, so it would go stale on the next rule addition.
check(has(appIndexRuleProblems(`## Alert Rules (${RULES.length})\n\n${listing(RULES)}`, RULES), `Alert Rules (${RULES.length})`),
  "a count that is right today is still refused");
check(has(appIndexRuleProblems(`${RULES.length} alert rules\n\n${listing(RULES)}`, RULES), `${RULES.length} alert rules`),
  "and so is the same number in prose");

// The shared matcher was written for Svelte prose: two digits, then a
// lowercase noun. This file is hard-wrapped Markdown with title-case headings,
// and these forms all passed it.
for (const form of [
  `## ${RULES.length} Alert Rules`,
  `## Alert Rules: ${RULES.length}`,
  `self-hostable. ${RULES.length - 2}+ alert rules, per-core CPU`,
  "self-hostable. 100 alert rules, per-core CPU",
  `self-hostable. ${RULES.length}\nalert rules, per-core CPU`,
]) {
  check(has(appIndexRuleProblems(`${form}\n\n${listing(RULES)}`, RULES), "states a rule count"),
    `refuses ${JSON.stringify(form)}`);
}
check(appIndexRuleProblems(`5. Mute noisy rules via POST /servers/:id/mutes\n\n${listing(RULES)}`, RULES).length === 0,
  'does not fire on "5. Mute noisy rules" (shipped list item)');

// Drift in the other direction: a rule lands and nobody lists it.
check(has(appIndexRuleProblems(listing(cat.slice(1)), cat), "mce_uncorrected"),
  "catches a catalogue rule missing from the listing");

// Every rule PR fails here until the id is listed, so the failure must say
// where: the CI line names only the check, and the site's llms.txt files share
// the file name but are generated.
const listingProblems = [...appIndexRuleProblems(listing(cat.slice(1)), cat), ...p4];
check(["does not list", "does not hold", "wrong priority"].every((kind) =>
  listingProblems.some((p) => p.includes(kind) && p.includes("apps/dashboard/static/llms.txt"))),
  "each listing problem names the hand-maintained file to edit");

// A listing the parser cannot find must fail, not pass with nothing compared.
check(appIndexRuleProblems("## Alert Rules\n\nSee the catalogue.", cat).length > 0,
  "an index with no parseable listing fails instead of passing empty");

// One priority may wrap onto several "- " lines; prose about P4 is not a block.
const wrapCat = [{ id: "raid_degraded", priority: "P1" }, { id: "smart_failing", priority: "P1" }];
check(appIndexRuleProblems(
  "Priority P1 Urgent (act now):\n- raid_degraded,\n- smart_failing\n\nP4 Low is never a rule's declared priority.", wrapCat).length === 0,
  "parses a wrapped priority block and ignores P4 prose");

check(/import \{ appIndexRuleProblems \} from "\.\/lib\/app-machine-index\.mjs"/.test(SRC) &&
  /appIndexRuleProblems\(text, rules\)/.test(SRC),
  "the gate runs this predicate on the app index, not a copy of it");

// A staging origin must not silently read production's app index.
check(/APP_ORIGIN = process\.env\.APP_ORIGIN \|\| null/.test(SRC),
  "APP_ORIGIN is never defaulted to production");
check(/e\.skip/.test(SRC), "and an unset APP_ORIGIN skips rather than passes");
check(/INCOMPLETE.*SKIPPED|skipped[\s\S]{0,200}process\.exit\(2\)/.test(SRC),
  "and a run with skips exits 2 instead of announcing that all checks pass");

if (bad) { console.error(`[machine-surface-test] ${bad} failing`); process.exit(1); }
console.log("[machine-surface-test] all fixtures behave as specified");
