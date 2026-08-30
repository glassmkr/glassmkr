#!/usr/bin/env node
// Drift check for ground-truth.yaml (monorepo root): fails when an active
// consumer disagrees with a canonical source. Deterministic, read-only,
// CI-usable. Run from the monorepo root:
//
//   node scripts/check-ground-truth.mjs [--only quickstart]
//
// Checks:
//   1. quickstart     The Compose quickstart is byte-identical across
//                     SELF_HOSTING.md (canonical),
//                     and /docs/self-hosting.
//   2. rulecount      No hardcoded global rule-count literal on active site
//                     surfaces (rules.json .length is the only source).
//   3. pricing        No retired per-node pricing copy on active surfaces
//                     (historical blog posts excluded deliberately).
//   4. nodecap        Every "N-node cap" literal equals product-facts.json
//                     hostedNodeCap.
//   5. facts          ground-truth.yaml parses; product-facts.json license
//                     labels match locked decisions.
//   6. licence        No hardcoded AGPL label other than the locked SPDX value
//                     (AGPL-3.0-only) on any site surface.
//   7. collectd       The parity tally quoted by the site and the announcement
//                     matches docs/COLLECTD_PARITY.md in the crucible repo.
//                     Skipped when that repo is not checked out alongside.
//   8. openapi        The generated contract and its hand-written descriptions
//                     carry no invented retention, plan, pricing, rule-count or
//                     licence claim. Added after a fabricated audit-retention
//                     policy shipped in a surface no check was reading.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.join(ROOT, "apps/site");
const req = createRequire(path.join(SITE, "package.json"));

// Every directory that can put copy in front of a user. packages/ui is here
// because the shared Footer renders a licence line on every page and was the
// exact surface these checks missed: they walked apps/site/src only.
const COPY_DIRS = [
  path.join(SITE, "src"),
  path.join(ROOT, "packages/ui/src"),
];
const copyFiles = (skip) => COPY_DIRS.flatMap((d) => (fs.existsSync(d) ? walk(d, [".svelte", ".ts", ".css"], skip) : []));

const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
let failures = 0;
const fail = (check, msg) => { failures++; console.error(`[ground-truth] FAIL ${check}: ${msg}`); };
const ok = (check, msg) => console.log(`[ground-truth] ok   ${check}: ${msg}`);

function walk(dir, exts, skip = []) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (skip.some((s) => p.includes(s))) continue;
    if (e.isDirectory()) out.push(...walk(p, exts, skip));
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

// 1. quickstart byte-identity
if (!only || only === "quickstart") {
  const selfHosting = fs.readFileSync(path.join(ROOT, "SELF_HOSTING.md"), "utf8");
  const m = selfHosting.match(/## Quickstart\s*\n+```\n([\s\S]*?)\n```/);
  if (!m) fail("quickstart", "cannot find the fenced Quickstart block in SELF_HOSTING.md");
  else {
    const canonical = m[1];
    // ComposeQuickstart.svelte was retired with the Axiom-led homepage: the
    // deployment command left the hero (visual spec 10.1) and the quickstart
    // now renders only on /docs/self-hosting, which stays byte-identical to
    // SELF_HOSTING.md below. check-rendered.mjs asserts the rendered page too.
    const docsPage = fs.readFileSync(path.join(SITE, "src/routes/docs/self-hosting/+page.svelte"), "utf8");
    if (!docsPage.includes(canonical)) fail("quickstart", "/docs/self-hosting quickstart differs from SELF_HOSTING.md");
    else ok("quickstart", "/docs/self-hosting matches SELF_HOSTING.md");
  }
}

const ACTIVE_SKIP = ["node_modules", `routes${path.sep}blog`, "__capture"];

// 2. hardcoded global rule count
if (!only || only === "rulecount") {
  const rules = req("./src/lib/data/rules.json");
  const needles = [`${rules.length} alert rule`, `${rules.length} rules`, `all ${rules.length}`, "70 alert rule", "70 rules", "all 70"];
  const hits = [];
  for (const f of copyFiles(ACTIVE_SKIP)) {
    const text = fs.readFileSync(f, "utf8");
    for (const n of new Set(needles)) {
      // Template-driven counts render via {...}; a literal in source is drift.
      if (text.includes(n)) hits.push(`${path.relative(ROOT, f)}: "${n}"`);
    }
  }
  if (hits.length) fail("rulecount", `hardcoded rule-count literal(s):\n  ${hits.join("\n  ")}`);
  else ok("rulecount", `no hardcoded global count (catalog: ${rules.length})`);
}

// 3. retired pricing copy on active surfaces
if (!only || only === "pricing") {
  const patterns = ["$3 per node", "$3/node", "first 3 free", "first three nodes", "3 nodes free", "first 3 nodes"];
  const hits = [];
  for (const f of copyFiles(ACTIVE_SKIP)) {
    const text = fs.readFileSync(f, "utf8");
    for (const p of patterns) if (text.includes(p)) hits.push(`${path.relative(ROOT, f)}: "${p}"`);
  }
  if (hits.length) fail("pricing", `retired pricing copy on active surface(s):\n  ${hits.join("\n  ")}`);
  else ok("pricing", "no retired per-node pricing copy on active surfaces");
}

// 3b. retention claims that contradict the schema TTL.
if (!only || only === "retention") {
  const schema = fs.readFileSync(path.join(ROOT, "migrations/clickhouse/001_initial.sql"), "utf8");
  const ttl = schema.match(/glassmkr\.snapshots[\s\S]*?TTL toDateTime\(timestamp\) \+ toIntervalDay\((\d+)\)/);
  if (!ttl) fail("retention", "cannot find the snapshots TTL clause in migrations/clickhouse/001_initial.sql");
  else {
    // A table TTL applies to every deployment, so disk-bound retention claims
    // are false wherever they appear. This exact drift shipped once.
    const banned = ["what your disk holds", "whatever your disk holds", "retention is under your control", "unlimited retention"];
    const hits = [];
    for (const f of copyFiles(ACTIVE_SKIP)) {
      const text = fs.readFileSync(f, "utf8").toLowerCase();
      for (const b of banned) if (text.includes(b)) hits.push(`${path.relative(ROOT, f)}: "${b}"`);
    }
    if (hits.length) fail("retention", `claim(s) contradict the ${ttl[1]}-day schema TTL:\n  ${hits.join("\n  ")}`);
    else ok("retention", `no disk-bound retention claims (schema TTL: ${ttl[1]} days)`);
  }
}

// 4. node-cap literals agree with the configured value
if (!only || only === "nodecap") {
  const facts = req("./src/lib/data/product-facts.json");
  const cap = facts.hostedNodeCap;
  const rx = /(\d+)[- ]node cap/g;
  const bad = [];
  let count = 0;
  for (const f of copyFiles(ACTIVE_SKIP)) {
    if (f.endsWith("product-facts.json")) continue;
    const text = fs.readFileSync(f, "utf8");
    for (const m2 of text.matchAll(rx)) {
      count++;
      if (Number(m2[1]) !== cap) bad.push(`${path.relative(ROOT, f)}: "${m2[0]}" != configured ${cap}`);
    }
  }
  if (bad.length) fail("nodecap", `cap literal(s) disagree with product-facts.json:\n  ${bad.join("\n  ")}`);
  else ok("nodecap", `${count} cap literal(s) all equal configured ${cap}`);
}

// 5. facts files parse and locked values hold
if (!only || only === "facts") {
  try {
    const yaml = req("yaml");
    yaml.parse(fs.readFileSync(path.join(ROOT, "ground-truth.yaml"), "utf8"));
    ok("facts", "ground-truth.yaml parses");
  } catch (e) {
    fail("facts", `ground-truth.yaml does not parse: ${e.message}`);
  }
  const facts = req("./src/lib/data/product-facts.json");
  // Locked decision moved 2026-08-29 (Simon): the agent is AGPL-3.0-only from
  // crucible v1.1.0 onward. v1.0.1 and earlier were PUBLISHED under MIT and
  // remain MIT irrevocably; copy must never claim old artifacts changed
  // license. ground-truth.yaml crucible_license carries the full rule.
  if (facts.crucibleLicense !== "AGPL-3.0-only") fail("facts", `crucibleLicense is "${facts.crucibleLicense}", locked decision is AGPL-3.0-only (from v1.1.0; decided 2026-08-29)`);
  else ok("facts", "crucibleLicense = AGPL-3.0-only");
}

// 6. Licence label. Three spellings were live at once (AGPL, AGPL-3.0 and
// AGPL-3.0-only) across nav, footer, pricing, trust, about, docs and JSON-LD.
// The locked value is AGPL-3.0-only, and "AGPL-3.0" is not a synonym: it is
// ambiguous about the "or later" grant, which is the whole point of choosing
// -only. Structured surfaces read it from product-facts; prose is guarded here.
if (!only || only === "licence") {
  const spdx = req("./src/lib/data/product-facts.json").dashboardLicenseSpdx;
  if (spdx !== "AGPL-3.0-only") {
    fail("licence", `product-facts dashboardLicenseSpdx is "${spdx}", locked value is AGPL-3.0-only`);
  }
  // Both the SPDX field and the short label must be the locked value. The
  // label used to be "AGPL", which fed the homepage eyebrow: a value, not a
  // literal, so grepping source for a bad string could never have caught it.
  const label = req("./src/lib/data/product-facts.json").dashboardLicenseLabel;
  if (label !== "AGPL-3.0-only") {
    fail("licence", `product-facts dashboardLicenseLabel is "${label}", locked value is AGPL-3.0-only`);
  }
  // packages/ui too: the shared Footer renders a licence line on every page and
  // sits outside apps/site, which is exactly how it was missed the first time.
  const files = copyFiles(["node_modules"]);
  const offenders = [];
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    // any AGPL mention not immediately followed by -3.0-only
    const bad = [...text.matchAll(/AGPL(?!-3\.0-only)/g)];
    if (bad.length) offenders.push(`${path.relative(ROOT, f)} (${bad.length})`);
  }
  if (offenders.length) {
    fail("licence", `non-canonical AGPL label on ${offenders.length} surface(s): ${offenders.slice(0, 5).join(", ")}`);
  } else {
    ok("licence", `every AGPL mention is the locked ${spdx}`);
  }
}

// 6b. Current-Crucible-MIT claims (post-redesign review P0-1, 2026-08-30).
// Crucible is AGPL-3.0-only from v1.1.0; v1.0.1 and earlier remain MIT. The
// existing licence check enforces the SPELLING of AGPL claims, so an active
// surface flatly calling the current agent MIT sailed through it: README,
// AGENTS.md, three comparison pages, and the retired design spec all did.
// This check fails any ACTIVE surface that describes OUR agent as MIT unless
// the same line carries an explicit retrospective marker. Blog posts are
// dated canon: they pass if the post carries the editorial license note (and
// their absolute claims were version-scoped when the note was added).
if (!only || only === "licence-mit") {
  const RETRO = /through v?1\.0\.1|1\.0\.1 and earlier|v?1\.0\.[01] (was|were|remains?)|was MIT|were MIT|remains? MIT|then-MIT|at the time|as of this entry|Superseded by/i;
  // Third-party agents legitimately described as MIT on comparison pages.
  const THIRD_PARTY = /CloudWatch Agent|collectd|amazon-cloudwatch/i;
  const EDITORIAL_NOTE = /Crucible versions through 1\.0\.1 were MIT/;
  const OURS = /Crucible|MIT[- ]licensed agent|MIT agent|agent is MIT|MIT-licensed project/i;

  const targets = [
    ...copyFiles(["node_modules", "__capture"]),
    path.resolve(ROOT, "README.md"),
    path.resolve(ROOT, "AGENTS.md"),
    ...(fs.existsSync(path.resolve(ROOT, "docs/design"))
      ? walk(path.resolve(ROOT, "docs/design"), [".md"], [])
      : []),
  ];
  const hits = [];
  for (const f of targets) {
    const text = fs.readFileSync(f, "utf8");
    if (!/MIT/.test(text)) continue;
    const rel = path.relative(ROOT, f);
    const isBlog = rel.includes(`routes${path.sep}blog${path.sep}`);
    const isHistoricalDoc = /SUPERSEDED|Historical design input/i.test(text.slice(0, 600));
    if (isHistoricalDoc) continue;
    if (isBlog && EDITORIAL_NOTE.test(text)) continue;
    for (const [i, line] of text.split("\n").entries()) {
      if (!/MIT/.test(line)) continue;
      if (!OURS.test(line)) continue;
      if (RETRO.test(line)) continue;
      if (/AGPL-3\.0-only \(Crucible\)/.test(line)) continue;
      if (THIRD_PARTY.test(line) && !/Crucible[^.]{0,60}MIT|MIT[^.]{0,60}Crucible/i.test(line)) continue;
      hits.push(`${rel}:${i + 1}`);
    }
  }
  if (hits.length) {
    fail("licence-mit", `active surface describes current Crucible as MIT on ${hits.length} line(s): ${hits.slice(0, 8).join(", ")}`);
  } else {
    ok("licence-mit", "no active surface calls the current agent MIT; historical claims are version-scoped");
  }
}

// 7. collectd parity. The site and the announcement quote a row tally from the
// audit that lives in the crucible repo. 26 gap rows exceed 21 covered, so
// collectd reads MORE distinct things than Crucible: a surface that drifted
// into implying breadth superiority would be false, and a stale tally is the
// easiest way to get there. Recompute from the matrix and compare.
if (!only || only === "collectd") {
  const parityPath = path.resolve(ROOT, "../crucible/docs/COLLECTD_PARITY.md");
  if (!fs.existsSync(parityPath)) {
    ok("collectd", "crucible repo not checked out alongside, tally not rechecked");
  } else {
    const matrix = fs.readFileSync(parityPath, "utf8");
    const tally = { covered: 0, partial: 0, gap: 0 };
    for (const m of matrix.matchAll(/\|\s*(covered|partial|gap)\s*\|/gi)) {
      tally[m[1].toLowerCase()] += 1;
    }
    const total = tally.covered + tally.partial + tally.gap;
    const surfaces = [
      "apps/site/src/routes/vs/collectd/+page.svelte",
      "docs/internal/launch/ANNOUNCEMENT_DRAFT.md",
    ].filter((f) => fs.existsSync(path.join(ROOT, f)));
    let bad = 0;
    for (const f of surfaces) {
      // Match the CLAIM PHRASES, not bare numbers. The first version of this
      // check looked for the digits alone and passed happily against a wrong
      // gap count, because "26" already occurs in every 2026 date on the page.
      const text = fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\s+/g, " ");
      const claims = [
        [`Of ${total} rows`, "row total"],
        [`covers ${tally.covered}`, "covered count"],
        [`partially covers ${tally.partial}`, "partial count"],
        [`does not read ${tally.gap}`, "gap count"],
      ];
      const missing = claims.filter(([needle]) => !text.includes(needle));
      if (missing.length) {
        fail("collectd", `${f} is missing or contradicts: ${missing.map(([, l]) => l).join(", ")} (matrix: ${tally.covered} covered, ${tally.partial} partial, ${tally.gap} gap, ${total} rows)`);
        bad++;
      }
    }
    if (!bad) ok("collectd", `${surfaces.length} surface(s) match the matrix (${tally.covered}/${tally.partial}/${tally.gap} of ${total})`);
  }
}

// The announcement's numbers, once filled, are literals in a file no build step
// regenerates. The draft carries its own warning about this: an earlier version
// had the rule count typed in and went stale. Filling the tokens removed the
// warning's protection, so replace it with a check.
{
  const draft = "docs/internal/launch/ANNOUNCEMENT_DRAFT.md";
  const full = path.join(ROOT, draft);
  if (fs.existsSync(full)) {
    const text = fs.readFileSync(full, "utf8");
    const ruleCount = JSON.parse(fs.readFileSync(path.join(ROOT, "RULES.json"), "utf8")).rules.length;
    const nodeCap = JSON.parse(fs.readFileSync(path.join(ROOT, "apps/site/src/lib/data/product-facts.json"), "utf8")).hostedNodeCap;
    const problems = [];
    if (!text.includes(`evaluates ${ruleCount} alert rules`)) {
      problems.push(`rule count: draft does not say "evaluates ${ruleCount} alert rules"`);
    }
    // Match the NUMBER in a node-cap context, not one exact phrasing. The first
    // version demanded the literal "cap of N nodes" and failed the moment the
    // copy was legitimately reworded to "Free up to N nodes per account". A
    // drift check that breaks on rewording trains people to edit the check
    // instead of reading it, so it now accepts any phrasing that states the
    // right figure and still fails on a wrong one.
    const capMentions = [...text.matchAll(/(\d+)\s+nodes?\b/g)].map((m) => Number(m[1]));
    if (!capMentions.includes(nodeCap)) {
      problems.push(`node cap: draft never states ${nodeCap} nodes (found: ${capMentions.join(", ") || "no node figure"})`);
    }
    const wrongCaps = capMentions.filter((n) => n !== nodeCap);
    if (wrongCaps.length) {
      problems.push(`node cap: draft also states ${wrongCaps.join(", ")} nodes, which is not the cap`);
    }
    if (/\{[A-Z_]+\}/.test(text)) {
      problems.push("unfilled {TOKEN} placeholders remain");
    }
    if (problems.length) {
      failures++;
      console.error(`[ground-truth] FAIL announcement: ${problems.length} drift(s):`);
      for (const p of problems) console.error(`  ${p}`);
    } else {
      console.log(`[ground-truth] ok   announcement: ${ruleCount} rules, cap ${nodeCap}, no unfilled tokens`);
    }
  }
}


// 8. The OpenAPI document.
//
// Added because a fabricated retention policy shipped in it and no drift check
// looked there. The generated spec is the contract an agent reads before it
// reads any page on the site, so its prose deserves the same scrutiny as site
// copy, and it had none: every check above walks apps/site/src and
// packages/ui/src only.
//
// The specific claim that shipped: "Plan-based retention: 365 days for Pro, 30
// days for Free" on GET /account/audit. api_audit_log is append-only. Migration
// 009 installs a trigger that raises on UPDATE and DELETE, the table has no
// TTL, and no job prunes it. That was not a stale number, it described a
// mechanism that has never existed.
if (!only || only === "openapi") {
  const specPath = path.join(ROOT, "apps/dashboard/static/api/openapi.json");
  const descPath = path.join(ROOT, "scripts/openapi-descriptions.json");
  if (!fs.existsSync(specPath)) {
    fail("openapi", `${path.relative(ROOT, specPath)} is missing; run node scripts/gen-openapi.mjs`);
  } else {
    // Both the hand-written source and the generated output, because fixing
    // one and not regenerating the other is its own drift.
    const strings = [];
    const collect = (node, where) => {
      if (typeof node === "string") { strings.push([where, node]); return; }
      if (Array.isArray(node)) { node.forEach((v, i) => collect(v, `${where}[${i}]`)); return; }
      if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) collect(v, `${where}.${k}`);
    };
    collect(JSON.parse(fs.readFileSync(specPath, "utf8")), "openapi.json");
    collect(JSON.parse(fs.readFileSync(descPath, "utf8")), "openapi-descriptions.json");

    const problems = [];

    // 8a. Retention claims about the audit log, in any wording. The invariant
    // is checked against the migration rather than against a remembered value.
    const appendOnly = fs.readFileSync(path.join(ROOT, "migrations/postgres/009_audit_log_append_only.sql"), "utf8")
      .includes("append-only; UPDATE/DELETE not permitted");
    if (!appendOnly) {
      problems.push("migration 009 no longer makes api_audit_log append-only; this check's premise is stale, re-derive it before editing the wording");
    } else {
      // An AFFIRMATIVE claim only: audit context plus a stated period. A
      // sentence that denies a retention policy is the correct sentence and
      // must not trip the check that exists to demand it.
      const period = /\b\d+\s*(?:day|days|month|months|year|years)\b|\bplan[- ]based retention\b/i;
      for (const [where, text] of strings) {
        if (/audit/i.test(text) && period.test(text)) {
          problems.push(`${where}: states an audit-log retention period ("${text.match(period)[0]}"), but api_audit_log is append-only and nothing removes rows`);
        }
      }
    }

    // 8b. Plan-gated claims. The tier model gates node count, metric retention
    // and AI analysis. An operation description that gates anything else is
    // inventing a paywall.
    for (const [where, text] of strings) {
      const m = text.match(/\b(?:Pro|Free)(?:[ -]tier| plan)?\b[^.]{0,60}\b(\d+)\s*days?/i);
      if (m) problems.push(`${where}: states a plan-based day figure ("${m[0].trim()}"); confirm it against the schema TTL or remove it`);
    }

    // 8c. The same literals the site surfaces are guarded against.
    const rules = req("./src/lib/data/rules.json");
    const facts = req("./src/lib/data/product-facts.json");
    for (const [where, text] of strings) {
      for (const n of [`${rules.length} alert rule`, `${rules.length} rules`, "70 alert rule", "70 rules"]) {
        if (text.includes(n)) problems.push(`${where}: hardcoded rule-count literal "${n}"`);
      }
      for (const pat of ["$3 per node", "$3/node", "first 3 free", "3 nodes free", "first 3 nodes"]) {
        if (text.includes(pat)) problems.push(`${where}: retired pricing copy "${pat}"`);
      }
      for (const m of text.matchAll(/(\d+)[- ]node cap/g)) {
        if (Number(m[1]) !== facts.hostedNodeCap) problems.push(`${where}: "${m[0]}" != configured ${facts.hostedNodeCap}`);
      }
      for (const m of text.matchAll(/AGPL(?:-3\.0(?:-only|-or-later)?)?/g)) {
        if (m[0] !== "AGPL-3.0-only") problems.push(`${where}: licence label "${m[0]}", locked value is AGPL-3.0-only`);
      }
    }

    if (problems.length) {
      failures++;
      console.error(`[ground-truth] FAIL openapi: ${problems.length} drift(s):`);
      for (const pr of problems.slice(0, 10)) console.error(`  ${pr}`);
    } else {
      console.log(`[ground-truth] ok   openapi: ${strings.length} description string(s) carry no invented retention, plan, pricing, count or licence claim`);
    }
  }
}


// 9. Timing arithmetic on public surfaces.
//
// The FAQ and the Docs index both said server_unreachable fires "after the
// server misses 2 consecutive check-ins, about 2 minutes at the default
// five-minute interval". Two five-minute intervals is ten minutes. The same
// paragraph said 60 buffered snapshots is "about 1 hour at the default
// interval"; it is five hours. The canonical rule summary had it right all
// along ("2x the configured collection interval (default 10 minutes)"), so
// this was prose drifting away from the rule it describes.
//
// Checked by COMPUTING the figure, not by matching the old string. A string
// check passes the moment someone writes a different wrong number.
if (!only || only === "timing") {
  const INTERVAL_MIN = 5;      // documented default collection interval
  const MISSED = 2;            // consecutive misses before server_unreachable
  const BUFFER = 60;           // snapshots Crucible buffers in memory
  const problems = [];

  const expectUnreachable = INTERVAL_MIN * MISSED;               // 10 minutes
  const expectBufferHours = (INTERVAL_MIN * BUFFER) / 60;        // 5 hours

  // The rule catalogue is the authority for the unreachable figure.
  const rules = req("./src/lib/data/rules.json");
  const rule = rules.find((r) => r.id === "server_unreachable");
  if (!rule) problems.push("server_unreachable is not in the rule catalogue");
  else {
    const m = String(rule.summary).match(/default (\d+) minutes/);
    if (!m) problems.push("server_unreachable summary no longer states a default in minutes");
    else if (Number(m[1]) !== expectUnreachable) {
      problems.push(`rule summary says ${m[1]} minutes; ${MISSED} x ${INTERVAL_MIN}min = ${expectUnreachable}`);
    }
  }

  // Prose must agree with the arithmetic wherever it states one.
  for (const f of copyFiles(ACTIVE_SKIP)) {
    const text = fs.readFileSync(f, "utf8");
    if (!text.includes("server_unreachable") && !text.includes("buffers up to")) continue;
    for (const m of text.matchAll(/misses (\d+) consecutive check-ins[^.)]{0,60}?about (\d+) minutes/gi)) {
      const got = Number(m[2]), want = Number(m[1]) * INTERVAL_MIN;
      if (got !== want) problems.push(`${path.relative(ROOT, f)}: "${m[1]} missed check-ins ... about ${got} minutes" should be ${want}`);
    }
    for (const m of text.matchAll(/buffers up to (\d+) snapshots[^.)]{0,60}?about (?:(\d+) hours?|(1) hour)/gi)) {
      const snaps = Number(m[1]);
      const got = Number(m[2] ?? m[3]);
      const want = (snaps * INTERVAL_MIN) / 60;
      if (got !== want) problems.push(`${path.relative(ROOT, f)}: "${snaps} snapshots ... about ${got} hour(s)" should be ${want}`);
    }
  }

  if (problems.length) {
    failures++;
    console.error(`[ground-truth] FAIL timing: ${problems.length} arithmetic error(s):`);
    for (const pr of problems) console.error("  " + pr);
  } else {
    console.log(`[ground-truth] ok   timing: unreachable ${expectUnreachable}min and buffer ${expectBufferHours}h agree with a ${INTERVAL_MIN}min interval`);
  }
}

if (failures) {
  console.error(`[ground-truth] ${failures} failure(s)`);
  process.exit(1);
}
console.log("[ground-truth] all checks passed");
