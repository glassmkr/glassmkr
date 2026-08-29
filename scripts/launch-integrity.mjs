#!/usr/bin/env node
// Launch-integrity check (round-2 s6, 2026-08-24). Run at the start of every
// working session and in CI; log the one-line result to the pivot ledger.
//
//   node scripts/launch-integrity.mjs
//
// FAILS (exit 1) on:
//   - NON-SHIPPING markers on deployable surfaces (a placeholder exhibit or
//     stub that must not survive to the flip),
//   - ground-truth drift (delegates to scripts/check-ground-truth.mjs),
//   - secret-shaped strings in the public-candidate tree.
// REPORTS (informational): TODO/FIXME census on public-candidate files.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;

function walk(dir, exts, skip = []) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (skip.some((s) => p.includes(s))) continue;
    if (e.isDirectory()) out.push(...walk(p, exts, skip));
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

const SKIP = ["node_modules", ".svelte-kit", "dist", "build", ".git"];
// The public-candidate tree: everything that reaches the squashed public repo
// or a deployed surface.
const PUBLIC_DIRS = ["apps/site/src", "apps/dashboard/src", "apps/status/src", "packages", "scripts", "docker", "migrations", "docs"];
const CODE_EXTS = [".ts", ".svelte", ".js", ".mjs", ".css", ".md", ".yml", ".yaml", ".sql", ".sh", ".json"];

// 1. NON-SHIPPING markers on deployable surfaces.
{
  const hits = [];
  for (const d of ["apps/site/src", "apps/dashboard/src", "apps/status/src", "apps/ops/src", "packages/ui/src"]) {
    for (const f of walk(path.join(ROOT, d), CODE_EXTS, SKIP)) {
      const text = fs.readFileSync(f, "utf8");
      if (text.includes("NON-SHIPPING")) hits.push(path.relative(ROOT, f));
    }
  }
  if (hits.length) {
    failures++;
    console.error(`[integrity] FAIL non-shipping: ${hits.length} deployable file(s) carry NON-SHIPPING markers (expected to fail until genuine evidence captures exist):`);
    for (const h of hits) console.error(`  ${h}`);
  } else {
    console.log("[integrity] ok   non-shipping: no markers on deployable surfaces");
  }
}

// 2. Ground-truth drift.
try {
  execFileSync("node", [path.join(ROOT, "scripts/check-ground-truth.mjs")], { stdio: "pipe" });
  console.log("[integrity] ok   ground-truth: no drift");
} catch (e) {
  failures++;
  console.error("[integrity] FAIL ground-truth drift:");
  console.error(String(e.stdout || ""), String(e.stderr || ""));
}

// 3. Secret-shape grep on the public-candidate tree.
{
  const patterns = [
    [/gmk_(acct|cru)_live_[A-Za-z0-9]{16,}/, "gmk live key body"],
    [/xox[bap]-[A-Za-z0-9-]{10,}/, "Slack token"],
    [/ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/, "GitHub token"],
    [/AKIA[0-9A-Z]{16}/, "AWS access key"],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
    [/re_[A-Za-z0-9]{20,}/, "Resend key"],
  ];
  const hits = [];
  for (const d of PUBLIC_DIRS) {
    for (const f of walk(path.join(ROOT, d), CODE_EXTS, SKIP)) {
      const text = fs.readFileSync(f, "utf8");
      for (const [rx, label] of patterns) {
        const m = text.match(rx);
        // Documentation placeholders (xxx..., REDACTED, example) are fine.
        if (m && !/x{6,}|REDACTED|EXAMPLE|example/i.test(m[0])) {
          hits.push(`${path.relative(ROOT, f)}: ${label}`);
        }
      }
    }
  }
  if (hits.length) {
    failures++;
    console.error(`[integrity] FAIL secrets: ${hits.length} secret-shaped string(s):`);
    for (const h of hits) console.error(`  ${h}`);
  } else {
    console.log("[integrity] ok   secrets: no secret-shaped strings in the public-candidate tree");
  }
}

// 4. Flip-exclusion manifest: internal-only material must be inside a path
//    the flip removes, never loose in the public-candidate tree.
{
  const manifest = fs.readFileSync(path.join(ROOT, "PUBLIC_REPO_EXCLUDE.txt"), "utf8")
    .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const excluded = (rel) => manifest.some((m) => rel === m || rel.startsWith(m));
  // Markers of internal-only material. An operator Telegram chat id is a
  // personal identifier, not a credential, so the secret grep never catches
  // it: this check does. Deliberately pattern-based, never the literal id.
  // Embedding the value here would publish the very thing being detected,
  // which is exactly what the first staged-tree rehearsal caught.
  const internalMarkers = [
    /OPERATOR_TELEGRAM_CHAT_ID\s*=\s*\d/,
    /telegram chat \d{8,}/i,
    /chat[_ ]?id[\s:=]+\d{8,}/i,
  ];
  const loose = [];
  for (const d of PUBLIC_DIRS) {
    for (const f of walk(path.join(ROOT, d), CODE_EXTS, SKIP)) {
      const rel = path.relative(ROOT, f);
      if (excluded(rel)) continue;
      const text = fs.readFileSync(f, "utf8");
      for (const rx of internalMarkers) if (rx.test(text)) loose.push(rel);
    }
  }
  if (loose.length) {
    failures++;
    console.error(`[integrity] FAIL flip-exclusion: internal-only material outside the exclusion manifest:`);
    for (const l of [...new Set(loose)]) console.error(`  ${l}`);
  } else {
    console.log(`[integrity] ok   flip-exclusion: ${manifest.length} excluded path(s); no internal material loose`);
  }
}

// 5. TODO triage (round-3 item 9). Class (a) = an unaccounted marker in
//    shipping source, which must resolve or carry a tracking reference before
//    the flip; this check FAILS on those. Class (b) = tests, generated
//    worklists, and flip-excluded docs, which are reported but allowed.
{
  const SELF = path.join(ROOT, "scripts/launch-integrity.mjs");
  const manifest = fs.readFileSync(path.join(ROOT, "PUBLIC_REPO_EXCLUDE.txt"), "utf8")
    .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const isClassB = (rel) =>
    rel.includes("__tests__") || rel.includes(".test.") || rel.includes(".spec.") ||
    manifest.some((m) => rel === m || rel.startsWith(m));
  // Convention: a real marker is `TODO:` or `TODO(where-it-is-tracked):`.
  // Requiring the colon or parenthesis means prose that merely mentions the
  // word (a comment explaining a guard, a README describing generated stubs)
  // is not mistaken for an outstanding item.
  const TRACKED = /\b(TODO|FIXME|XXX|HACK)\(([^)]+)\)/;
  const BARE = /\b(TODO|FIXME|HACK)\s*:/;
  const classA = [];
  let classBCount = 0;
  for (const d of PUBLIC_DIRS) {
    for (const f of walk(path.join(ROOT, d), CODE_EXTS, SKIP)) {
      if (f === SELF) continue;
      const rel = path.relative(ROOT, f);
      const lines = fs.readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!BARE.test(line) && !TRACKED.test(line)) return;
        if (isClassB(rel)) { classBCount++; return; }
        // Tracked markers are accounted for; bare ones are not.
        if (BARE.test(line) && !TRACKED.test(line)) classA.push(`${rel}:${i + 1}: ${line.trim().slice(0, 90)}`);
      });
    }
  }
  console.log(`[integrity] info todo-triage: ${classBCount} class-(b) marker(s) (tests, worklists, flip-excluded docs)`);
  if (classA.length) {
    failures++;
    console.error(`[integrity] FAIL todo-class-a: ${classA.length} unaccounted marker(s) in shipping source (resolve, or add a tracking reference like TODO(fast-follow)):`);
    for (const t of classA) console.error(`  ${t}`);
  } else {
    console.log("[integrity] ok   todo-class-a: no unaccounted markers in shipping source");
  }
}

// Standing rule (2026-08-26): a file whose PURPOSE is to describe sensitive or
// excluded content must itself survive the sweep, and must reference things by
// path rather than restating what makes them sensitive. This has now failed
// twice: an integrity script embedded the identifier it was written to detect,
// and the exclusion manifest restated the attack techniques it exists to keep
// out. Both shipped in the public candidate tree.
{
  const meta = [
    "PUBLIC_REPO_EXCLUDE.txt",
    "scripts/launch-integrity.mjs",
    "scripts/check-ground-truth.mjs",
    "scripts/check-rendered.mjs",
    "scripts/check-exhibits.mjs",
  ].filter((f) => fs.existsSync(path.join(ROOT, f)));
  // Shapes that must never appear in a file that describes exclusions. Built
  // from fragments so this list does not itself become the thing it forbids.
  const shapes = [
    ["real fleet address", /\b(95\.173\.207|89\.187\.174|143\.244)\.\d+/],
    ["live key body", /gmk_(acct|cru)_live_[A-Za-z0-9]{20,}/],
    ["staged artifact URL", /[a-z-]+\.[a-z]+\/[0-9a-f]{24,}\//],
  ];
  const hits = [];
  for (const f of meta) {
    const text = fs.readFileSync(path.join(ROOT, f), "utf8");
    for (const [label, re] of shapes) if (re.test(text)) hits.push(`${f}: ${label}`);
  }
  if (hits.length) {
    failures++;
    console.error(`[integrity] FAIL meta-hygiene: ${hits.length} descriptor file(s) contain what they describe:`);
    for (const h of hits) console.error(`  ${h}`);
  } else {
    console.log(`[integrity] ok   meta-hygiene: ${meta.length} descriptor file(s) reference by path only`);
  }
}

// Self-referential URL check. The site told the world a GPG signing key was
// published at /.well-known/gpg-key.asc, on the page called Trust, to an
// audience that checks. It returned 404 and had never existed, and the install
// script it credited with verifying the signature contains no signature code at
// all. Nothing caught it because every check read our own copy, and our own copy
// was internally consistent. So: every glassmkr.com URL our copy points at must
// correspond to a real static file or a real route.
//
// It covers the DASHBOARD SOURCE too, not only site copy, because the worst
// instance of this was not in copy at all: the API emitted a documentation_url
// on docs.glassmkr.com, a hostname that has never resolved, to real callers
// being rate-limited or hitting an idempotency conflict. A scan of marketing
// pages would never have seen it. Any host under glassmkr.com must therefore be
// on the known list below, so inventing a subdomain is a deliberate act rather
// than a typo that ships.
{
  const claimed = new Map();
  // Hosts we actually operate. A URL on any other glassmkr.com subdomain is a
  // typo or an aspiration; either way it must not reach a user.
  const KNOWN_HOSTS = new Set(["glassmkr.com", "www.glassmkr.com", "app.glassmkr.com", "status.glassmkr.com"]);
  const files = [
    ...walk(path.join(ROOT, "apps/site/src"), [".svelte", ".ts", ".md", ".json"], SKIP),
    ...walk(path.join(ROOT, "packages/ui/src"), [".svelte", ".ts"], SKIP),
    ...walk(path.join(ROOT, "apps/dashboard/src"), [".ts", ".svelte"], [...SKIP, "__tests__", ".test."]),
  ];
  const badHosts = [];
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    for (const m of text.matchAll(/https?:\/\/([A-Za-z0-9.-]*glassmkr\.com)(\/[A-Za-z0-9._~/-]*)?/g)) {
      const host = m[1];
      const rel = path.relative(ROOT, f);
      if (!KNOWN_HOSTS.has(host)) {
        badHosts.push(`${host}  (in ${rel})`);
        continue;
      }
      // Only the marketing origin can be resolved against this repo's routes.
      if (host !== "glassmkr.com") continue;
      const claim = (m[2] || "").replace(/[.,)]+$/, "");
      if (!claim || claim === "/") continue;
      if (!claimed.has(claim)) claimed.set(claim, rel);
    }
  }
  if (badHosts.length) {
    failures++;
    console.error(`[integrity] FAIL unknown glassmkr.com host(s): ${badHosts.length}`);
    for (const b of badHosts) console.error(`  ${b}`);
  }
  const missing = [];
  for (const [claim, src] of claimed) {
    if (fs.existsSync(path.join(ROOT, "apps/site/static", claim))) continue;
    const routeDir = path.join(ROOT, "apps/site/src/routes", claim);
    if (fs.existsSync(path.join(routeDir, "+page.svelte")) || fs.existsSync(path.join(routeDir, "+server.ts"))) continue;
    missing.push(`${claim}  (claimed in ${src})`);
  }
  if (missing.length) {
    failures++;
    console.error(`[integrity] FAIL self-referential URLs: ${missing.length} glassmkr.com URL(s) our copy promises do not exist:`);
    for (const m of missing) console.error(`  ${m}`);
  } else if (!badHosts.length) {
    console.log(`[integrity] ok   self-referential URLs: ${claimed.size} glassmkr.com path(s) resolve; all hosts known (site copy + dashboard source)`);
  } else {
    console.log(`[integrity] ok   self-referential URLs: ${claimed.size} path(s) resolve, but see the unknown-host failure above`);
  }
}

// Machine surface: llms files, advertised Markdown twins, rule twins. Runs the
// dedicated script so both can be used independently, and so a live origin can
// be passed to it at flip time.
{
  try {
    execFileSync("node", [path.join(ROOT, "scripts/check-machine-surface.mjs")], { stdio: "pipe" });
    console.log("[integrity] ok   machine-surface: llms files and every advertised twin resolve");
  } catch (err) {
    failures++;
    console.error("[integrity] FAIL machine-surface:");
    console.error(String(err.stdout || err.message).trim().split("\n").map((l) => "  " + l).join("\n"));
  }
}

// A rule count written as a literal passes every rendered check on the day it
// is written and fails silently on the day a rule lands. /docs/rules carried
// "All 70 ... rules" in its meta description while the same file interpolated
// rules.length four lines below. Catch the literal, not just the mismatch.
{
  const count = JSON.parse(fs.readFileSync("apps/site/src/lib/data/rules.json", "utf8")).length;
  const bad = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(svelte|ts)$/.test(entry.name)) continue;
      const text = fs.readFileSync(full, "utf8");
      text.split("\n").forEach((line, i) => {
        if (line.trim().startsWith("//") || line.trim().startsWith("*")) return;
        if (!new RegExp(`\\b${count}\\b`).test(line)) return;
        if (!/\b(rule|alert)/i.test(line)) return;
        if (/rules\.length|ruleCount|RULE_COUNT/.test(line)) return;
        bad.push(`${full}:${i + 1}`);
      });
    }
  };
  walk("apps/site/src");

  // Root markdown too. README.md said "the 70 alert rules" and the walk above
  // never looked outside apps/site, so the first file a coding agent opens was
  // the one place the count could rot unchecked.
  for (const f of ["README.md", "AGENTS.md", "CONTRIBUTING.md", "SECURITY.md", "SELF_HOSTING.md"]) {
    if (!fs.existsSync(f)) continue;
    fs.readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      if (!new RegExp(`\\b${count}\\b`).test(line)) return;
      if (!/\b(rule|alert)/i.test(line)) return;
      bad.push(`${f}:${i + 1}`);
    });
  }

  // Spelled-out counts slipped past the digit check entirely. The vertical
  // pages each stated one in words ("Sixteen rules for the storage layer",
  // "Forty-five rules apply", "Nine rules read the GPUs. The other
  // sixty-one"), all correct on the day they were written and all literals.
  const WORDS = ["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
  const TENS = ["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];
  const word = (n) => n < 20 ? WORDS[n] : (n % 10 ? `${TENS[Math.floor(n / 10)]}-${WORDS[n % 10]}` : TENS[Math.floor(n / 10)]);
  // Only the numbers a page would state as a SUMMARY: the whole catalogue, each
  // vertical's aggregate, and the catalogue minus a vertical. Guarding every
  // per-category count instead flagged "these three rules read the kernel's
  // Pressure Stall Information", which enumerates three named rules in the same
  // sentence and is not a count of anything. A guard that cries wolf gets
  // switched off, so it only watches the claims that can actually go stale.
  const VERTICALS = {
    storage: ["Storage", "Filesystem", "ZFS"],
    compute: ["Network", "Hardware (BMC/IPMI)", "Security & Patching", "Memory & CPU", "Time & Services"],
    gpu: ["GPU"],
  };
  const catCounts = (() => {
    const rules = JSON.parse(fs.readFileSync("apps/site/src/lib/data/rules.json", "utf8"));
    const totals = new Set([rules.length]);
    for (const cats of Object.values(VERTICALS)) {
      const n = rules.filter((r) => cats.includes(r._category ?? "")).length;
      if (n > 0) { totals.add(n); totals.add(rules.length - n); }
    }
    return [...totals].filter((n) => n > 0 && n < 100);
  })();
  const spelled = new Map(catCounts.map((n) => [word(n), n]));
  const walkWords = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walkWords(full); continue; }
      if (!/\.svelte$/.test(entry.name)) continue;
      // Blog posts are dated records, not current-state claims.
      if (full.includes("/routes/blog/")) continue;
      const text = fs.readFileSync(full, "utf8");
      text.split("\n").forEach((line, i) => {
        if (line.trim().startsWith("//") || line.trim().startsWith("*")) return;
        for (const [w, n] of spelled) {
          const re = new RegExp(`\\b${w}\\b[^.<]{0,24}\\brules?\\b`, "i");
          if (re.test(line)) bad.push(`${full}:${i + 1} ("${w}" = ${n})`);
        }
      });
    }
  };
  walkWords("apps/site/src");

  if (bad.length) {
    failures++;
    console.error(`[integrity] FAIL rule-count-literal: rule count written as a literal instead of read from the catalogue: ${bad.join(", ")}`);
  } else {
    console.log(`[integrity] ok   rule-count-literal: no page hardcodes the rule count (catalogue holds ${count})`);
  }
}

// .env.example is a generated copy of env.selfhost.example (two conventional
// names for one file; see scripts/gen-env-example.mjs). Copying is only safe
// with a check.
{
  const src = fs.readFileSync("env.selfhost.example", "utf8");
  const copy = fs.existsSync(".env.example") ? fs.readFileSync(".env.example", "utf8") : null;
  if (copy === null) {
    failures++;
    console.error("[integrity] FAIL env-example: .env.example is missing; run node scripts/gen-env-example.mjs");
  } else if (!copy.endsWith(src)) {
    failures++;
    console.error("[integrity] FAIL env-example: .env.example has drifted from env.selfhost.example; run node scripts/gen-env-example.mjs");
  } else {
    console.log("[integrity] ok   env-example: .env.example matches env.selfhost.example");
  }
}

// The root files a coding agent reads first. AGENTS.md is canonical; any
// vendor-specific file must point at it rather than carry its own copy, because
// two instruction files are one forgotten edit away from disagreeing.
{
  const required = ["AGENTS.md", "README.md", "CONTRIBUTING.md", "SECURITY.md", "LICENSE", ".env.example"];
  const missing = required.filter((f) => !fs.existsSync(f));
  if (missing.length) {
    failures++;
    console.error(`[integrity] FAIL root-files: missing ${missing.join(", ")}`);
  } else {
    const claude = fs.existsSync("CLAUDE.md") ? fs.readFileSync("CLAUDE.md", "utf8") : "";
    if (claude && !/AGENTS\.md/.test(claude)) {
      failures++;
      console.error("[integrity] FAIL root-files: CLAUDE.md exists but does not point at AGENTS.md");
    } else if (claude.split("\n").filter((l) => l.trim()).length > 12) {
      failures++;
      console.error("[integrity] FAIL root-files: CLAUDE.md is long enough to be a second copy of AGENTS.md rather than a pointer");
    } else {
      console.log(`[integrity] ok   root-files: all ${required.length} present, AGENTS.md canonical`);
    }
  }
}

if (failures) {
  console.error(`[integrity] ${failures} failing check(s)`);
  process.exit(1);
}
console.log("[integrity] all launch-integrity checks pass");
