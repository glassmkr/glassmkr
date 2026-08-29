#!/usr/bin/env node
// Every URL we advertise to machines must resolve, and the facts in those files
// must match the generated catalogue.
//
// Why this exists: an external audit found that llms.txt promised a Markdown
// twin for every page while 71 of them returned 404, that llms-full.txt stated
// retired per-node pricing as current fact, and that the app's llms.txt claimed
// 38 alert rules against a catalogue of 70. None of that was visible to the
// rendered-HTML checks, which look at pages and not at machine files. This is
// the surface AI agents actually read, so it gets its own gate.
//
//   node scripts/check-machine-surface.mjs [origin]
//
// With no origin it checks the built files on disk. With one it fetches live.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.join(ROOT, "apps/site");
const ORIGIN = (process.argv[2] || "").replace(/\/+$/, "");

let failures = 0;
const fail = (c, m) => { failures++; console.error(`[machine] FAIL ${c}: ${m}`); };
const ok = (c, m) => console.log(`[machine] ok   ${c}: ${m}`);
// A skipped check is not a passed check, and says so in its own line.
let skipped = 0;
const skip = (c, m) => { skipped++; console.log(`[machine] skip ${c}: ${m}`); };

const ruleCount = JSON.parse(
  fs.readFileSync(path.join(SITE, "src/lib/data/rules.json"), "utf8"),
).length;

const readLocal = (rel) => fs.readFileSync(path.join(SITE, "static", rel), "utf8");

// The dashboard publishes its own machine index at app.glassmkr.com/llms.txt,
// and nothing checked it. It claimed "Alert Rules (30)" against a catalogue of
// 70, pointed every documentation link at app-origin /docs/* URLs that all
// return 404, and taught P1 through P4 with no P0. The gate could not see any
// of it because it only ever read apps/site/static.
const DASHBOARD_STATIC = path.join(ROOT, "apps/dashboard/static");
// Deliberately NOT defaulted to production. Checking a staging or self-hosted
// site while silently reading production's app index would report a pass that
// says nothing about the deployment under test, which is the class of false
// pass this whole file exists to prevent. With an ORIGIN but no APP_ORIGIN the
// app checks are reported as skipped.
const APP_ORIGIN = process.env.APP_ORIGIN || null;
const APP_SOURCE = APP_ORIGIN ?? (ORIGIN ? null : "local file");
const getApp = async (rel) => {
  if (!APP_ORIGIN) {
    if (ORIGIN) {
      const e = new Error("no APP_ORIGIN given");
      e.skip = true;
      throw e;
    }
    return fs.readFileSync(path.join(DASHBOARD_STATIC, rel), "utf8");
  }
  const res = await fetch(`${APP_ORIGIN}/${rel}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
};
const get = async (rel) => {
  if (!ORIGIN) return readLocal(rel);
  const res = await fetch(`${ORIGIN}/${rel}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
};

// A .md URL can be satisfied two ways: a real file under static/, or a SvelteKit
// route that renders Markdown (which is how /index.md, /pricing.md and the
// vertical pages are served). Checking only for files reported nine false
// misses on the first run, so check both. Against a live origin this is moot,
// and a live origin is the authoritative mode.
const localHas = (rel) => {
  // Two mechanisms serve a .md twin, and they split on /docs/. Static files
  // under static/docs/ are served directly; every other <path>.md is rendered
  // on the fly by the hook in hooks.server.ts from the page it twins. Checking
  // only for files reported nine false misses on the first run.
  if (rel.startsWith("/docs/")) {
    return fs.existsSync(path.join(SITE, "static", rel));
  }
  const routeBase = rel === "/index.md" ? "/" : rel.replace(/\.md$/, "");
  return fs.existsSync(path.join(SITE, "src/routes", routeBase, "+page.svelte"));
};


// 1. Retired commercial language must not appear in either machine file.
{
  // "3 on Free" shipped in llms.txt and llms-full.txt and matched none of the
  // original four patterns, which is how the node quota stayed wrong in the
  // machine files while this check reported clean. The quota patterns below are
  // fixture-tested in check-machine-surface.test.mjs against that exact string.
  const retired = [
    /\$\d+ per node/i,
    /\d+ free nodes/i,
    /gated by Pro plan/i,
    /Pro plan; \d+-day/i,
    /\b\d+ on Free\b/i,              // "node quota (3 on Free)"
    /\bon Free\b[^.\n]{0,30}\bnodes?\b/i,
    /\bFree (?:tier|plan)\b[^.\n]{0,20}\b\d+ nodes?\b/i,
    /subscribed count on Pro/i,
  ];
  const bad = [];
  const surfaces = [
    ["llms.txt", get], ["llms-full.txt", get],
    ["app:llms.txt", getApp],
  ];
  let skippedApp = false;
  for (const [f, reader] of surfaces) {
    let text;
    try { text = await reader(f.replace(/^app:/, "")); }
    catch (e) { if (e.skip) { skippedApp = true; continue; } throw e; }
    for (const re of retired) if (re.test(text)) bad.push(`${f}: ${re}`);
  }
  if (skippedApp) skip("retired-terms-app", "no APP_ORIGIN given; the app machine file was NOT checked");
  if (bad.length) fail("retired-terms", bad.join("; "));
  else ok("retired-terms", "no retired pricing or plan language in llms.txt or llms-full.txt");
}

// 2. The rule count stated to machines must equal the generated catalogue.
{
  const text = await get("llms.txt");
  const stated = [...text.matchAll(/(\d+)\s+alert rules/gi)].map((m) => Number(m[1]));
  const wrong = stated.filter((n) => n !== ruleCount);
  if (wrong.length) fail("rulecount", `llms.txt states ${wrong.join(", ")} against a catalogue of ${ruleCount}`);
  else ok("rulecount", `llms.txt agrees with the catalogue (${ruleCount})`);
}

// 3. Every Markdown twin advertised in llms.txt must exist.
{
  const text = await get("llms.txt");
  const urls = [...text.matchAll(/https:\/\/glassmkr\.com(\/[A-Za-z0-9._/-]+\.md)/g)].map((m) => m[1]);
  const missing = [];
  for (const u of [...new Set(urls)]) {
    if (ORIGIN) {
      const res = await fetch(`${ORIGIN}${u}`);
      if (!res.ok) missing.push(`${u} -> ${res.status}`);
    } else if (!localHas(u)) {
      missing.push(u);
    }
  }
  if (missing.length) fail("twins", `${missing.length} advertised Markdown twin(s) missing: ${missing.slice(0, 5).join(", ")}`);
  else ok("twins", `all ${new Set(urls).size} advertised Markdown twin(s) resolve`);
}

// 4. Rule twins: the catalogue promises one per rule plus an index.
{
  const missing = [];
  const rules = JSON.parse(fs.readFileSync(path.join(SITE, "src/lib/data/rules.json"), "utf8"));
  for (const r of rules) {
    const rel = `/docs/rules/${r.id}.md`;
    if (ORIGIN) {
      const res = await fetch(`${ORIGIN}${rel}`);
      if (!res.ok) missing.push(rel);
    } else if (!fs.existsSync(path.join(SITE, "static", rel))) {
      missing.push(rel);
    }
  }
  if (missing.length) fail("rule-twins", `${missing.length} of ${rules.length} rule twins missing`);
  else ok("rule-twins", `all ${rules.length} rule twins present, plus the index`);
}

// 5. Collection cadence. An external audit reported the docs and the app
// disagreeing, 60 seconds against five minutes. The agent's schema has said
// default(300) since its first commit, so the 60-second figure was never true:
// it was published on nine pages and in the README anyway. Assert the number
// nobody can check by reading two documents against each other.
{
  const CADENCE_SECONDS = 300;
  const bad = [];
  for (const f of ["llms.txt", "llms-full.txt"]) {
    const text = await get(f);
    // The shipped text was "pushing 60s health snapshots. The default snapshot
    // interval is 60 seconds." Neither of the two original patterns matched it:
    // one wanted "60-second" or "60 second", the other the exact phrase "every
    // 60 seconds". The gate passed for months while the file was wrong.
    if (
      /\b60[- ]seconds?\b/i.test(text) ||
      /every 60 seconds/i.test(text) ||
      /\b60s\b(?=[^"']{0,40}(snapshot|interval|health|push))/i.test(text) ||
      /interval (?:is|of|default[s]?(?: to)?) 60\b/i.test(text)
    ) bad.push(f);
  }
  if (bad.length) fail("cadence", `${bad.join(", ")} still states a 60-second interval; the schema default is ${CADENCE_SECONDS}s`);
  else ok("cadence", `no stale 60-second cadence claim (schema default is ${CADENCE_SECONDS}s)`);
}


// 5b. The dashboard's machine index, which nothing used to read.
{
  const problems = [];
  let text = "";
  let skipped = false;
  try {
    text = await getApp("llms.txt");
  } catch (e) {
    if (e.skip) skipped = true;
    else problems.push(`could not read the app machine index: ${e.message}`);
  }
  if (skipped) {
    skip("app-machine-index", "no APP_ORIGIN given; pass APP_ORIGIN=https://app.glassmkr.com to check it");
  } else if (text) {
    // Rule count must equal the catalogue, exactly as the site index must.
    for (const m of text.matchAll(/Alert Rules \((\d+)\)/g)) {
      if (Number(m[1]) !== ruleCount) {
        problems.push(`states "Alert Rules (${m[1]})" but the catalogue holds ${ruleCount}`);
      }
    }
    // Documentation lives on the marketing origin. An app-origin /docs/ link is
    // a 404 by construction, and there were eight of them.
    const appDocs = [...text.matchAll(/https:\/\/app\.glassmkr\.com\/docs\/[a-z-]+/g)].map((m) => m[0]);
    if (appDocs.length) {
      problems.push(`${appDocs.length} documentation link(s) point at the app origin, where /docs/* does not exist: ${appDocs.slice(0, 3).join(", ")}`);
    }
    // The priority legend must include P0, which three rules use.
    if (/P1 Urgent/.test(text) && !/P0/.test(text)) {
      problems.push("teaches a priority legend with no P0, but the catalogue has P0 rules");
    }
  }

  if (!skipped) {
    if (problems.length) fail("app-machine-index", `${problems.length} problem(s): ${problems.join("; ")}`);
    else ok("app-machine-index", `the dashboard machine index agrees with the catalogue (${ruleCount} rules) and links no dead docs`);
  }
}

// Scoped LLM indexes. The site had a 9KB index and a 145KB corpus and nothing
// between, so an agent with a narrow question had to pick between too shallow
// and mostly irrelevant. Each scoped map must resolve, must carry the header
// block an agent needs before trusting it, and must state the trust boundary.
{
  const SCOPED = ["docs/llms.txt", "docs/rules/llms.txt", "docs/api/llms.txt", "docs/mcp/llms.txt"];
  const bad = [];
  // Same shape as the checks above: read from disk when no origin is given, so
  // this works both in CI against the built tree and at flip time against the
  // deployed site.
  const load = async (rel) => {
    if (!ORIGIN) return readLocal(rel);
    const res = await fetch(`${ORIGIN}/${rel}`);
    if (!res.ok) throw new Error(`${res.status}`);
    return res.text();
  };
  for (const rel of SCOPED) {
    let text;
    try {
      text = await load(rel);
    } catch (e) {
      bad.push(`/${rel}: ${e.message}`);
      continue;
    }
    if (!/Generated: \d{4}-/.test(text)) bad.push(`/${rel}: no generation timestamp`);
    if (!/AGPL-3\.0-only/.test(text)) bad.push(`/${rel}: no licence statement`);
    if (!/untrusted/i.test(text)) bad.push(`/${rel}: no trust boundary statement`);
    if (!/llms-full\.txt/.test(text)) bad.push(`/${rel}: does not point at the full corpus`);
  }
  // The root index must advertise them, or nothing finds them.
  try {
    const root = await load("llms.txt");
    for (const rel of SCOPED) if (!root.includes(`/${rel}`)) bad.push(`/llms.txt does not link /${rel}`);
  } catch (e) {
    bad.push(`/llms.txt: ${e.message}`);
  }
  if (bad.length) fail("scoped-llms", bad.slice(0, 6).join("; "));
  else ok("scoped-llms", `all ${SCOPED.length} scoped maps resolve, carry provenance and state the trust boundary`);
}

if (failures) {
  console.error(`[machine] ${failures} failing check(s)`);
  process.exit(1);
}
if (skipped) {
  // A skipped required surface is not a passed one. This used to print "all
  // machine-surface checks pass" and exit 0 after skipping the entire app
  // origin, which is the same fail-open shape as the old verify-public-clone:
  // a caller doing `if check; then publish; fi` would read "we did not look at
  // half the deployment" as "half the deployment is fine".
  console.error(`[machine] INCOMPLETE: ${skipped} check(s) were SKIPPED and their surfaces are UNVERIFIED.`);
  console.error("[machine] Exit 2 = not a pass. Pass APP_ORIGIN to check the app surface too.");
  process.exit(2);
}
console.log("[machine] all machine-surface checks pass");
