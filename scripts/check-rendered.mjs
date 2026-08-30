#!/usr/bin/env node
// Rendered-output checks. The static checks in check-ground-truth.mjs grep
// source files, which makes them blind to anything a component RENDERS from a
// value rather than writing as a literal. That blindness shipped twice:
//
//   - the homepage eyebrow read "GLASSMKR AGPL" because the label came from
//     product-facts.json, so no source literal was ever wrong;
//   - the site-wide OG card advertised "38 alert rules" and "$3 / node / month"
//     because those live inside a PNG, which no grep can read.
//
// So these assertions ask the served page what it actually says.
//
// Usage:
//   node scripts/check-rendered.mjs [baseUrl]
//
// With no argument it BUILDS NOTHING but starts its own server from
// apps/site/build, checks it, and stops it. That is deliberate. It used to
// default to http://localhost:3001 and grade whatever happened to be there,
// which on this machine was a dev server left running for hours. That server
// reported AGPL-3.0-ONLY from a text-transform its CSS state had drifted into,
// while the actual build rendered the canonical label correctly. So the check
// written to close the grep-versus-rendered blindness spent that run reporting
// on a server nobody meant to test.
//
// Worse, the failure mode is silent in the other direction too: had the drift
// gone the other way, six checks would have printed "ok" about code that is not
// what ships. A checker that accepts an arbitrary listening port is measuring
// the port, not the product.
//
// Pass an explicit base URL to check a deployed origin on purpose.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.join(ROOT, "apps/site");
const req = createRequire(path.join(SITE, "package.json"));
const EXPLICIT = process.argv[2] || process.env.BASE_URL || "";

// Start our own server from the build unless an origin was named on purpose.
let child = null;
let BASE;
if (EXPLICIT) {
  BASE = EXPLICIT.replace(/\/+$/, "");
} else {
  const entry = path.join(SITE, "build/index.js");
  if (!fs.existsSync(entry)) {
    console.error("[rendered] FAIL setup: apps/site/build/index.js is missing. Build the site first, or pass a base URL to check a deployed origin.");
    process.exit(1);
  }
  // A port nothing else is likely to hold, so we cannot inherit a stray server.
  const port = 31847;
  BASE = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [entry], {
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
    stdio: "ignore",
  });
  const deadline = Date.now() + 30000;
  let up = false;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(BASE + "/", { redirect: "manual" });
      if (r.status) { up = true; break; }
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  if (!up) {
    child.kill();
    console.error(`[rendered] FAIL setup: the site build did not start on ${BASE} within 30s.`);
    process.exit(1);
  }
}

function readFlagFromSource() {
  const src = fs.readFileSync("./apps/site/src/lib/repo-state.ts", "utf8");
  return /DASHBOARD_REPO_PUBLIC\s*=\s*true/.test(src);
}

let failures = 0;
const fail = (check, msg) => { failures++; console.error(`[rendered] FAIL ${check}: ${msg}`); };
// Ran but could not verify (network unreachable, external dependency down).
// Distinct from ok: an unreachable oracle used to be logged as "ok ...
// skipped", so an outage concealed exactly the drift the check exists to
// block (Codex 2026-08-29 #11). Exit 2 = incomplete, same convention as
// check-machine-surface and check-exhibits.
let incomplete = 0;
const unresolved = (check, msg) => { incomplete++; console.error(`[rendered] INCOMPLETE ${check}: ${msg}`); };
const ok = (check, msg) => console.log(`[rendered] ok   ${check}: ${msg}`);

const { chromium } = req("playwright");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

async function textOf(route) {
  const page = await ctx.newPage();
  await page.goto(BASE + route, { waitUntil: "networkidle" });
  const out = await page.evaluate(() => {
    const head = [];
    for (const el of document.head.querySelectorAll("meta[content], script[type='application/ld+json'], title")) {
      head.push(el.getAttribute("content") || el.textContent || "");
    }
    const prov = document.querySelector(".provenance");
    return {
      body: document.body.innerText,
      head: head.join("\n"),
      html: document.body.innerHTML,
      provenance: prov ? prov.textContent.replace(/\s+/g, " ").trim() : null,
        canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
        description: document.querySelector('meta[name="description"]')?.getAttribute("content") ?? null,
    };
  });
  await page.close();
  return out;
}

// Every page the checks below grade. The legal pages and the rest of the
// comparison set were absent, which is how two pages shipped with no
// description or canonical at all and eight comparison tables shipped able to
// push the document sideways on a phone: nothing looked at them.
// Every canonical non-blog public route. Two of these shipped with no
// description or canonical at all and eight comparison tables could push the
// document sideways on a phone, because the graded set was nine pages while the
// site had thirty-six. Blog posts are excluded on purpose: they are dated
// records with their own template, checked once when written.
const PAGES = [
  "/", "/pricing", "/trust", "/about", "/docs", "/blog",
  "/privacy", "/terms", "/billing-policy",
  "/docs/self-hosting", "/docs/getting-started", "/docs/configuration",
  "/docs/channels", "/docs/api", "/docs/faq",
  "/docs/mcp", "/docs/programmatic-api", "/docs/automated-onboarding",
  "/docs/rules", "/docs/troubleshooting", "/docs/troubleshooting/ipmi",
  "/docs/api/errors",
  "/docs/changelog",
  "/for-compute", "/for-gpu", "/for-providers", "/for-storage",
  "/vs", "/vs/collectd", "/vs/datadog", "/vs/prometheus", "/vs/zabbix",
  "/vs/netdata", "/vs/checkmk", "/vs/librenms", "/vs/cloudwatch", "/vs/newrelic",
];
const rendered = {};
for (const r of PAGES) rendered[r] = await textOf(r);

// 0. discovery metadata: a page a search result cannot describe is a page
// nobody arrives at. /privacy and /terms shipped with a title and nothing else.
{
  const bad = [];
  for (const r of PAGES) {
    const { canonical, description } = rendered[r];
    if (!description || description.trim().length < 40) bad.push(`${r} (description ${description ? description.trim().length + " chars" : "missing"})`);
    else if (!canonical) bad.push(`${r} (no canonical)`);
    else if (new URL(canonical).pathname.replace(/\/$/, "") !== r.replace(/\/$/, "")) bad.push(`${r} (canonical points at ${new URL(canonical).pathname})`);
  }
  if (bad.length) fail("metadata", `missing or wrong discovery metadata: ${bad.join("; ")}`);
  else ok("metadata", `all ${PAGES.length} pages carry a description and a self-referencing canonical`);
}

// 0aa2. discovery relations. The site published an LLM index and an OpenAPI
// document and advertised neither, so an agent could only find them by knowing
// the paths in advance. `describedby` and `service-desc` are the registered
// relations for exactly this.
{
  const bad = [];
  const dp = await ctx.newPage();
  for (const r of PAGES) {
    await dp.goto(BASE + r, { waitUntil: "networkidle" });
    const rels = await dp.evaluate(() =>
      [...document.querySelectorAll("link[rel]")].map((l) => ({
        rel: l.getAttribute("rel"),
        href: l.getAttribute("href"),
        type: l.getAttribute("type"),
      })),
    );
    for (const want of ["describedby", "service-desc", "alternate"]) {
      if (!rels.some((l) => l.rel === want)) bad.push(`${r}: no rel="${want}"`);
    }
    const svc = rels.find((l) => l.rel === "service-desc");
    if (svc && !/openapi/.test(svc.href ?? "")) bad.push(`${r}: service-desc does not point at an OpenAPI document`);
  }
  await dp.close();
  if (bad.length) fail("discovery-relations", bad.slice(0, 6).join("; "));
  else ok("discovery-relations", `all ${PAGES.length} pages advertise their Markdown twin, the LLM index and the API contract`);
}

// 0aaa. accessibility floor: heading outline, alternative text, focus
// visibility. An external audit asked for each of these and each was checked
// once, by hand, which is the same as not checked.
{
  const hBad = [], altBad = [];
  const ap = await ctx.newPage();
  for (const r of PAGES) {
    await ap.goto(BASE + r, { waitUntil: "networkidle" });
    const m = await ap.evaluate(() => {
      const hs = [...document.querySelectorAll("main h1, main h2, main h3, main h4, main h5, main h6")].map((h) => +h.tagName[1]);
      let skip = null;
      for (let i = 1; i < hs.length; i++) if (hs[i] > hs[i - 1] + 1) { skip = `h${hs[i - 1]} then h${hs[i]}`; break; }
      return {
        h1: document.querySelectorAll("main h1").length,
        skip,
        imgsNoAlt: [...document.querySelectorAll("main img")].filter((i) => i.getAttribute("alt") === null).length,
        figsNoCaption: [...document.querySelectorAll("main figure")].filter((f) => !f.querySelector("figcaption")).length,
      };
    });
    if (m.h1 !== 1) hBad.push(`${r}: ${m.h1} h1`);
    if (m.skip) hBad.push(`${r}: skips ${m.skip}`);
    if (m.imgsNoAlt) altBad.push(`${r}: ${m.imgsNoAlt} img without alt`);
    if (m.figsNoCaption) altBad.push(`${r}: ${m.figsNoCaption} figure without a caption`);
  }
  // Focus has to be measured with something actually focused.
  await ap.goto(BASE + "/", { waitUntil: "networkidle" });
  const noFocus = await ap.evaluate(() => {
    const bad = [];
    for (const el of [...document.querySelectorAll("main a[href], main button, main [tabindex='0']")].slice(0, 40)) {
      el.focus();
      const cs = getComputedStyle(el);
      const visible = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) ||
        cs.boxShadow !== "none" || cs.textDecorationLine.includes("underline");
      if (!visible) bad.push(el.tagName.toLowerCase() + "." + (el.className || "").toString().split(" ")[0]);
    }
    return [...new Set(bad)];
  });
  await ap.close();
  if (hBad.length) fail("headings", `heading outline: ${hBad.join("; ")}`);
  else ok("headings", `one h1 and no skipped level on all ${PAGES.length} pages`);
  if (altBad.length) fail("alt-text", altBad.join("; "));
  else ok("alt-text", "every image carries alt and every figure a caption");
  if (noFocus.length) fail("focus", `no visible focus state: ${noFocus.slice(0, 5).join(", ")}`);
  else ok("focus", "every focusable element in main shows a focus state");
}

// 0aaab. Homepage first-fold contract (redesign spec 10.1 / 25). These grade
// the RENDERED page at 1280x720, independent of how the components compute
// their sizes: the H1 lands in the 150-190px band and holds at most two
// lines, at most two buttons share the hero action row, and the product
// stage starts by 540px with at least 160px of it visible in the viewport.
{
  const fCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const fp = await fCtx.newPage();
  await fp.goto(BASE + "/", { waitUntil: "networkidle" });
  const m = await fp.evaluate(() => {
    const h1 = document.querySelector("main h1");
    const stage = document.querySelector(".stage");
    const btns = document.querySelectorAll(".cta-row .btn").length;
    if (!h1) return { missing: "h1" };
    if (!stage) return { missing: ".stage (product stage)" };
    const h1r = h1.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(h1).lineHeight);
    return {
      h1Top: Math.round(h1r.top),
      h1Lines: Math.round(h1r.height / lh),
      stageTop: Math.round(sr.top),
      stageVisible: Math.round(Math.min(720, sr.bottom) - Math.max(0, sr.top)),
      btns,
      docW: document.documentElement.scrollWidth,
    };
  });
  await fCtx.close();
  const bad = [];
  if (m.missing) bad.push(`homepage is missing ${m.missing}`);
  else {
    if (m.h1Top < 140 || m.h1Top > 200) bad.push(`h1 starts at ${m.h1Top}px (target 150-190)`);
    if (m.h1Lines > 2) bad.push(`h1 renders ${m.h1Lines} lines (max 2)`);
    if (m.btns > 2) bad.push(`${m.btns} buttons in the hero action row (max 2)`);
    if (m.stageTop > 540) bad.push(`product stage starts at ${m.stageTop}px (max 540)`);
    if (m.stageVisible < 160) bad.push(`only ${m.stageVisible}px of the stage is visible in the first viewport (min 160)`);
    if (m.docW > 1280) bad.push(`horizontal overflow: document is ${m.docW}px wide at 1280`);
  }
  if (bad.length) fail("first-fold", bad.join("; "));
  else ok("first-fold", `h1 at ${m.h1Top}px in ${m.h1Lines} lines, ${m.btns} hero buttons, stage at ${m.stageTop}px with ${m.stageVisible}px visible`);
}

// 0aaaa. prefers-reduced-motion must actually be honoured.
{
  const rmCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const rp = await rmCtx.newPage();
  await rp.goto(BASE + "/", { waitUntil: "networkidle" });
  const moving = await rp.evaluate(() =>
    [...new Set([...document.querySelectorAll("body *")].filter((el) => {
      const cs = getComputedStyle(el);
      return (cs.animationName !== "none" && parseFloat(cs.animationDuration) > 0.1) ||
        (cs.transitionDuration && parseFloat(cs.transitionDuration) > 0.3);
    }).map((el) => el.tagName.toLowerCase() + "." + (el.className || "").toString().split(" ")[0]))],
  );
  await rmCtx.close();
  if (moving.length) fail("reduced-motion", `animation over 0.1s under prefers-reduced-motion: ${moving.slice(0, 5).join(", ")}`);
  else ok("reduced-motion", "nothing animates beyond 0.1s under prefers-reduced-motion");
}

// 0. link labels must name the destination they open. All 70 rule pages
// carried an anchor whose href went to the agent repository's issues and whose
// visible text read as the dashboard repository's discussions. Two different
// repositories, one of which does not exist.
{
  const bad = [];
  const lp = await ctx.newPage();
  const sampleRule = `/docs/rules/${req("./src/lib/data/rules.json")[0].id}`;
  for (const r of [...PAGES, sampleRule]) {
    await lp.goto(BASE + r, { waitUntil: "networkidle" });
    const mismatched = await lp.evaluate(() =>
      [...document.querySelectorAll("a[href]")]
        .map((a) => ({ href: a.href, text: (a.textContent || "").trim() }))
        // Only judge anchors whose label is itself a URL-shaped string: those
        // are making a claim about where they go.
        .filter((a) => /^(https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}\/\S*$/i.test(a.text))
        .filter((a) => {
          // Dropping a "www." in the visible label is a normal convention, not
          // a claim about a different destination.
          const norm = (v) => v.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
          const href = norm(a.href);
          const label = norm(a.text);
          // An explicit elision ("host/documentation/.../ipmi") is an honest
          // abbreviation of a long path. Hold it to the host and to whatever
          // it does spell out.
          if (/\.\.\.|…/.test(label)) {
            const parts = label.split(/\/?(?:\.\.\.|…)\/?/).filter(Boolean);
            return !parts.every((part) => href.includes(part));
          }
          return !href.startsWith(label);
        })
        .map((a) => `"${a.text}" -> ${a.href}`),
    );
    for (const m of mismatched) bad.push(`${r}: ${m}`);
  }
  await lp.close();
  if (bad.length) fail("link-labels", `anchor text names a different destination than its href:\n  ${bad.join("\n  ")}`);
  else ok("link-labels", "every URL-shaped link label matches the destination it opens");
}

// 0aa. the dashboard repository's real state must match what the site assumes.
// The flip deploys the site before the repository goes public, so there is a
// window where the self-hosting quickstart documents a clone that 404s. This
// fails in BOTH directions: a flag that lies about a private repo, and a flag
// left false after the repo opened.
{
  const { DASHBOARD_REPO_PUBLIC, DASHBOARD_REPO_URL } = await import("../apps/site/src/lib/repo-state.ts").catch(() => ({}));
  const flag = DASHBOARD_REPO_PUBLIC ?? readFlagFromSource();
  const url = DASHBOARD_REPO_URL ?? "https://github.com/glassmkr/glassmkr";
  let live = null;
  try {
    live = (await fetch(url, { redirect: "follow" })).status === 200;
  } catch { live = null; }
  if (live === null) unresolved("repo-state", "could not reach GitHub, so the public-repo claim is UNVERIFIED this run");
  else if (flag && !live) fail("repo-state", `repo-state says the dashboard repository is public, but ${url} does not resolve`);
  else if (!flag && live) fail("repo-state", `${url} is public now; flip DASHBOARD_REPO_PUBLIC and drop the pending notice on /docs/self-hosting`);
  else if (!flag) {
    const notice = rendered["/docs/self-hosting"] ?? (await textOf("/docs/self-hosting"));
    if (!/repository is not public yet/i.test(notice.body)) fail("repo-state", "the dashboard repository is private and /docs/self-hosting does not say so above the clone command");
    else ok("repo-state", "repository is private, and the self-hosting guide says so before the clone");
    // /trust used to claim both ends were readable while glassmkr/glassmkr
    // 404ed (prelaunch spec 2026-08-29 A1). Its pending wording must be
    // present now and must DISAPPEAR at the flip, so both directions are
    // asserted rather than left to a checklist memory.
    const trust = rendered["/trust"] ?? (await textOf("/trust"));
    if (!/not public yet/i.test(trust.body)) fail("repo-state", "the dashboard repository is private and /trust does not say so in its source section");
    else ok("repo-state", "trust page states the dashboard repository is not public yet");
  } else {
    const trust = rendered["/trust"] ?? (await textOf("/trust"));
    if (/not public yet|opens shortly|repository opens/i.test(trust.body)) fail("repo-state", "the dashboard repository is public but /trust still carries pre-flip pending wording");
    else ok("repo-state", "dashboard repository is public and the site says so, /trust included");
  }
}

// 0ab. maintainer identity. "We are a small team" survived on the GPU,
// provider, datadog and zabbix pages after the one-operator fix landed on
// /trust and /about: the fix was applied where it was noticed, not everywhere
// it existed (the same walk-scope gap that hid the licence label in
// packages/ui). Every legitimate use of "team" in copy is the READER's team
// ("your team", "teams weigh it against"), so the self-referential phrase can
// be banned outright (prelaunch spec 2026-08-29 A4).
{
  const bad = [];
  for (const r of PAGES) {
    if (/small team/i.test(rendered[r].body)) bad.push(r);
  }
  if (bad.length) fail("maintainer-identity", `"small team" renders on ${bad.join(", ")}; the maintainer identity is one operator`);
  else ok("maintainer-identity", "no page renders a team-sized maintainer identity");
}

// 0a. retired product name. The final spec renamed the hosted service and
// forbade resurrecting "Glassmkr Cloud"; it survived in the homepage's
// structured data and og:description, which are the surfaces a machine quotes
// back without the page around them.
{
  const bad = [];
  for (const r of PAGES) {
    if (/Glassmkr Cloud/i.test(rendered[r].body + "\n" + rendered[r].head)) bad.push(r);
  }
  if (bad.length) fail("hosted-name", `retired product name "Glassmkr Cloud" rendered on ${bad.join(", ")}`);
  else ok("hosted-name", "no retired product name in rendered copy or metadata");
}

// 0b. robots.txt must not pin a rule count. It said 62 while the catalogue
// held 70, and being a static file nothing regenerated it.
{
  const robots = fs.readFileSync("./apps/site/static/robots.txt", "utf8");
  const m = robots.match(/(\d+)[- ]rule/i);
  if (m) fail("robots", `robots.txt pins a rule count (${m[0]}); the catalogue is generated and a literal drifts`);
  else ok("robots", "robots.txt states no rule count");
}

// 1. licence label: canonical everywhere it is visible, including values
{
  const bad = [];
  for (const r of PAGES) {
    const hits = [...(rendered[r].body + "\n" + rendered[r].head).matchAll(/AGPL(?!-3\.0-only)[^\s"]{0,10}/g)];
    if (hits.length) bad.push(`${r} (${[...new Set(hits.map((h) => h[0]))].join(", ")})`);
  }
  if (bad.length) fail("licence", `non-canonical rendered label on ${bad.join("; ")}`);
  else ok("licence", `canonical on all ${PAGES.length} pages, in visible text and metadata`);
}

// 2. rule count: what the page SAYS must equal the generated catalog
{
  const expected = req("./src/lib/data/rules.json").length;
  const bad = [];
  for (const r of PAGES) {
    for (const m of rendered[r].body.matchAll(/(\d+)\s+(?:opinionated\s+)?(?:hardware\s+)?alert rules|(\d+)\s+opinionated hardware rules/gi)) {
      const n = Number(m[1] || m[2]);
      if (n && n !== expected) bad.push(`${r}: says ${n}`);
    }
  }
  if (bad.length) fail("rulecount", `rendered count disagrees with the catalog (${expected}): ${bad.join(", ")}`);
  else ok("rulecount", `every rendered count is ${expected}, matching the generated catalog`);
}

// 2b. node cap: what the pages SAY must equal ground-truth, and production must
// enforce that same number. The rule count already had this treatment; the node
// cap did not, and it spent the whole pivot at 10 in copy while production
// refused the fourth node. A rendered check is the half that can be automated:
// the production half is verified by hitting the API, which no build step can do.
{
  const expected = req("./src/lib/data/product-facts.json").hostedNodeCap;
  const bad = [];
  for (const r of PAGES) {
    for (const m of rendered[r].body.matchAll(/(?:[Uu]p to |cap of |free up to )(\d+)\s+nodes?/g)) {
      const n = Number(m[1]);
      if (n !== expected) bad.push(`${r}: says ${n}`);
    }
  }
  if (bad.length) fail("nodecap", `rendered node cap disagrees with product-facts (${expected}): ${bad.join(", ")}`);
  else ok("nodecap", `every rendered node cap is ${expected}, matching product-facts`);
}

// 2c. every GitHub link we render must actually resolve. Three separate times
// now, a link was repointed by a pattern that matched what its author
// remembered: a bare repo URL was fixed while an /issues link, and later a
// /blob/main deep link, were missed and stayed broken on the live site. A
// pattern cannot be trusted to enumerate its own exceptions, so check the
// rendered hrefs themselves. Only runs against an explicit origin, since the
// point is what a visitor's browser would load.
if (EXPLICIT) {
  const seen = new Map();
  for (const r of PAGES) {
    for (const m of rendered[r].html.matchAll(/href="(https:\/\/github\.com\/glassmkr\/[^"]*)"/g)) {
      if (!seen.has(m[1])) seen.set(m[1], r);
    }
  }
  const broken = [];
  for (const [url, page] of seen) {
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) broken.push(`${url} -> ${res.status} (on ${page})`);
    } catch (err) {
      broken.push(`${url} -> ${err?.message ?? err} (on ${page})`);
    }
  }
  if (broken.length) fail("githublinks", `rendered GitHub links that do not resolve:\n  ${broken.join("\n  ")}`);
  else ok("githublinks", `all ${seen.size} rendered GitHub link(s) resolve`);
}

// 2d. the binary install path must be documented. A blind onboarding round on
// AlmaLinux found that the README and the docs both advertise "any
// distribution", install.sh refuses everything except Ubuntu and Debian, and the
// binary we point those users at had no install commands anywhere on the live
// site: zero occurrences of releases/download across every docs page. Five of
// the seven distributions we advertise were stranded at the first step.
{
  const gs = rendered["/docs/getting-started"];
  if (gs) {
    const problems = [];
    if (!/releases\/download/.test(gs.html)) {
      problems.push("no binary install command (releases/download) on /docs/getting-started");
    }
    if (!/only|Ubuntu and Debian/i.test(gs.body)) {
      problems.push("the installer's Ubuntu and Debian limit is not stated");
    }
    if (problems.length) fail("binarypath", problems.join("; "));
    else ok("binarypath", "binary install documented and the installer's distro limit is stated");
  }
}

// 2e. no page may widen the document at phone width. An external audit measured
// /vs/collectd forcing the document to 466px and Privacy to 463px at a 390px
// viewport, which drags the whole page sideways while someone is reading body
// text. Wide tables must scroll inside their own container instead.
{
  const bad = [];
  const mobile = await ctx.browser().newContext({ viewport: { width: 390, height: 844 } });
  const mp = await mobile.newPage();
  for (const r of PAGES) {
    await mp.goto(BASE + r, { waitUntil: "networkidle" });
    const m = await mp.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
    if (m.doc > m.win + 1) bad.push(`${r}: ${m.doc}px in a ${m.win}px viewport`);
  }
  await mobile.close();
  if (bad.length) fail("mobile-overflow", `document-level horizontal overflow at 390px: ${bad.join("; ")}`);
  else ok("mobile-overflow", `no document overflow at 390px on any of the ${PAGES.length} pages`);
}

// 2f. contrast. The muted token measured 4.24:1 on the base background and worse
// on panels, below the 4.5:1 needed for normal text, and it is the token used for
// metadata, captions and table labels everywhere. Measure the rendered pixels
// rather than trusting the token, because what matters is the pair that actually
// composites: text color against the surface behind it.
{
  const bad = [];
  const cp = await ctx.newPage();
  for (const r of PAGES) {
    await cp.goto(BASE + r, { waitUntil: "networkidle" });
    const worst = await cp.evaluate(() => {
      const lum = (rgb) => {
        const [r, g, b] = rgb.map((v) => {
          const x = v / 255;
          return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const parse = (c) => (c.match(/\d+/g) || []).slice(0, 3).map(Number);
      // Composite the background stack instead of taking the first non-transparent
      // layer at face value. Table headers here sit on rgba(255,255,255,0.02), a
      // 2 percent white tint over a near-black page. Reading that as solid white
      // reported 1.14:1 on perfectly legible text and buried the real failures.
      const bgOf = (el) => {
        const layers = [];
        for (let n = el; n; n = n.parentElement) {
          const c = getComputedStyle(n).backgroundColor;
          const p = (c.match(/[\d.]+/g) || []).map(Number);
          if (p.length < 3) continue;
          const a = p.length === 4 ? p[3] : 1;
          if (a === 0) continue;
          layers.push({ rgb: p.slice(0, 3), a });
          if (a === 1) break;
        }
        let out = [10, 10, 9];
        for (let i = layers.length - 1; i >= 0; i--) {
          const { rgb, a } = layers[i];
          out = out.map((base, k) => rgb[k] * a + base * (1 - a));
        }
        return out;
      };
      let min = 99, sample = "";
      for (const el of document.querySelectorAll("p, li, td, th, span, dd, dt, figcaption, small")) {
        const t = (el.innerText || "").trim();
        if (!t || el.children.length) continue;
        const cs = getComputedStyle(el);
        // Skip anything a reader cannot see. The first run reported 1.14:1 on a
        // table header, which is not a contrast failure but decorative or
        // transparent text: heading anchor markers, visually-hidden labels, and
        // elements faded to zero. Measuring those tells you nothing about
        // readability and hides the real failures behind noise.
        if (cs.visibility === "hidden" || cs.display === "none") continue;
        if (Number(cs.opacity) < 0.95) continue;
        const alpha = (cs.color.match(/rgba?\(([^)]+)\)/) || [])[1];
        if (alpha && alpha.split(",").length === 4 && parseFloat(alpha.split(",")[3]) < 0.95) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) continue;
        const size = parseFloat(cs.fontSize);
        const weight = Number(cs.fontWeight) || 400;
        const isLarge = size >= 24 || (size >= 18.66 && weight >= 700);
        if (isLarge) continue;
        const fg = parse(cs.color), bg = bgOf(el);
        const lf = lum(fg), lb = lum(bg);
        const ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
        if (ratio < min) { min = ratio; sample = t.slice(0, 40); }
      }
      return { min, sample };
    });
    if (worst.min < 4.5) bad.push(`${r}: ${worst.min.toFixed(2)}:1 ("${worst.sample}")`);
  }
  await cp.close();
  if (bad.length) fail("contrast", `normal text below 4.5:1: ${bad.join("; ")}`);
  else ok("contrast", `all normal text meets 4.5:1 on the ${PAGES.length} checked pages`);
}

// 2g. minimum readable size at phone width. An audit counted 35 sub-12px
// elements on one vertical page, 18 of them at 10px, and 70 priority labels at
// 10.5px in the rule catalogue. Density is a layout problem; shrinking type is
// not a solution to it.
{
  const bad = [];
  const mob = await ctx.browser().newContext({ viewport: { width: 390, height: 844 } });
  const sp = await mob.newPage();
  for (const r of PAGES) {
    await sp.goto(BASE + r, { waitUntil: "networkidle" });
    const n = await sp.evaluate(() => {
      let count = 0;
      for (const el of document.querySelectorAll("*")) {
        if (el.children.length) continue;
        const t = (el.innerText || "").trim();
        if (!t) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none") continue;
        // Superscript footnote markers are smaller by definition: the browser
        // applies font-size: smaller to sup and sub. That is a typographic
        // convention, not a density decision, and raising them would break the
        // thing they are for.
        if (el.closest("sup, sub")) continue;
        if (parseFloat(cs.fontSize) < 12) count++;
      }
      return count;
    });
    if (n > 0) bad.push(`${r}: ${n}`);
  }
  await mob.close();
  if (bad.length) fail("min-text", `text below 12px at 390px: ${bad.join(", ")}`);
  else ok("min-text", `no visible text below 12px at 390px on any of the ${PAGES.length} pages`);
}

// 3. retired pricing must not appear in rendered copy
{
  const bad = [];
  for (const r of PAGES) {
    if (/\$\s?3\s*\/\s*node|\$3 per node|3 servers free/i.test(rendered[r].body)) bad.push(r);
  }
  if (bad.length) fail("pricing", `retired per-node pricing rendered on ${bad.join(", ")}`);
  else ok("pricing", "no retired per-node pricing in rendered copy");
}

// 4. retention: the rendered claim must match the schema TTL
{
  const bad = [];
  for (const r of PAGES) {
    if (/retention is whatever your disk|as long as your disk/i.test(rendered[r].body)) bad.push(r);
  }
  if (bad.length) fail("retention", `disk-bound retention claim rendered on ${bad.join(", ")}`);
  else ok("retention", "no disk-bound retention claims in rendered copy");
}

// 5. quickstart: the served page must show the canonical block, not just the
// source file. Byte-identity in source proves nothing if the page renders a
// different component.
{
  // The quickstart is not the first fenced block in the guide (the Docker
  // install comes first), so find the block that starts the clone, the same
  // way the static byte-identity check locates it.
  const fences = fs.readFileSync(path.join(ROOT, "SELF_HOSTING.md"), "utf8").split("```");
  const block = fences.find((b) => b.trim().startsWith("git clone https://github.com/glassmkr/glassmkr.git"));
  const canonical = (block || "").trim();
  if (!block) fail("quickstart", "no quickstart block found in SELF_HOSTING.md");
  const page = rendered["/docs/self-hosting"].body.replace(/\r/g, "");
  const firstLine = canonical.split("\n")[0].trim();
  const missing = canonical.split("\n").map((l) => l.trim()).filter((l) => l && !page.includes(l));
  if (!page.includes(firstLine)) fail("quickstart", "the docs page does not render the canonical quickstart at all");
  else if (missing.length) fail("quickstart", `rendered quickstart is missing: ${missing.slice(0, 2).join(" | ")}`);
  else ok("quickstart", `all ${canonical.split("\n").length} lines render on /docs/self-hosting`);
}

// 6. NON-SHIPPING must not reach a served page
{
  const bad = PAGES.filter((r) => /NON-SHIPPING/i.test(rendered[r].body + rendered[r].html));
  if (bad.length) fail("non-shipping", `marker rendered on ${bad.join(", ")}`);
  else ok("non-shipping", "no placeholder markers on any served page");
}

// 7. exhibit provenance: the caption a reader sees must match the manifest,
// not merely the fixture on disk
{
  const yaml = req("yaml");
  const mPath = path.join(SITE, "src/lib/data/exhibits/manifest.yaml");
  if (!fs.existsSync(mPath)) ok("exhibit", "no manifest, nothing to check");
  else {
    const entry = (yaml.parse(fs.readFileSync(mPath, "utf8")).exhibits || [])[0];
    // Assert against the CAPTION, not the page. Checking that the host name
    // appears somewhere on the homepage passed even when the caption was
    // pointed at a different host, because the exhibit's own host row still
    // said the right thing.
    const caption = rendered["/"].provenance;
    const problems = [];
    if (!caption) problems.push("no provenance line rendered at all");
    else if (entry) {
      if (!caption.includes(entry.host_alias)) problems.push(`caption host is not ${entry.host_alias}: "${caption}"`);
      if (!caption.includes(entry.crucible_version)) problems.push(`caption version is not ${entry.crucible_version}`);
    }
    if (problems.length) fail("exhibit", `provenance line does not render: ${problems.join(", ")}`);
    else ok("exhibit", `provenance renders with the manifest's host and version`);
  }
}

// Content column has usable width, at both sizes.
//
// P0-01: /docs/changelog rendered every entry one character per line down the
// right edge, because a comment that quoted its own close marker leaked 974
// characters of prose into .docs-layout as a text node, which a flex container
// turned into an anonymous item taking 684 of 864 pixels. .docs-content, being
// flex: 1 1 0% with min-width: 0, collapsed to ZERO width.
//
// The document did not overflow while that happened, so the mobile-overflow
// check above was silent, and the page had no visible h1 so a heading check
// would also have missed the cause. The property that was actually violated is
// simply that the column a reader reads has a width. That is what this asserts,
// on every docs page rather than only the one that broke.
{
  const DOCS = PAGES.filter((p2) => p2.startsWith("/docs"));
  const bad = [];
  for (const [label, width] of [["desktop", 1440], ["mobile", 390]]) {
    const c = await ctx.browser().newContext({ viewport: { width, height: 900 } });
    const pg = await c.newPage();
    for (const route of DOCS) {
      await pg.goto(BASE + route, { waitUntil: "domcontentloaded" });
      const m = await pg.evaluate(() => {
        const el = document.querySelector(".docs-content") || document.querySelector("article");
        if (!el) return { missing: true };
        const r = el.getBoundingClientRect();
        // Any non-blank text sitting directly in the layout container is the
        // leak signature: comment prose that escaped into the page.
        const layout = document.querySelector(".docs-layout");
        const stray = layout
          ? [...layout.childNodes]
              .filter((n) => n.nodeType === 3 && n.textContent.trim().length > 40)
              .map((n) => n.textContent.trim().slice(0, 60))
          : [];
        return { w: Math.round(r.width), stray };
      });
      if (m.missing) { bad.push(`${route} @${label}: no content column found`); continue; }
      // 240px is far below any real column and far above a collapse.
      if (m.w < 240) bad.push(`${route} @${label}: content column is ${m.w}px wide`);
      if (m.stray?.length) bad.push(`${route} @${label}: leaked text in the layout container: "${m.stray[0]}..."`);
    }
    await c.close();
  }
  if (bad.length) fail("content-width", `${bad.length} problem(s): ${bad.slice(0, 4).join("; ")}`);
  else ok("content-width", `all ${DOCS.length} docs page(s) have a usable content column at 1440px and 390px, with no leaked prose in the layout container`);
}

await browser.close();
if (child) child.kill();

if (failures) { console.error(`[rendered] ${failures} failure(s)`); process.exit(1); }
if (incomplete) {
  console.error(`[rendered] INCOMPLETE: ${incomplete} check(s) could not verify. Exit 2 = not a pass; re-run when the dependency is reachable.`);
  process.exit(2);
}
console.log("[rendered] all rendered checks passed");
