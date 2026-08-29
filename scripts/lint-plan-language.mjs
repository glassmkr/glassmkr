#!/usr/bin/env node
// Active surfaces must not sell a plan that does not exist.
//
// ground-truth.yaml records hosted_pricing_state as RESOLVED: "free (hosted);
// free forever (self-hosted, AGPL)", and /docs/api/tier-gating has publicly
// said "the Free/Pro split was retired" since the pivot. Meanwhile the
// dashboard kept an "Upgrade to Pro" button on settings, a "Pro plan required"
// card on the audit log, a one-free-analysis meter, and a trend-warnings
// upsell. Users were being sold an upgrade the docs said did not exist.
//
// This gate fails on upsell language in ACTIVE dashboard and site source.
// Deliberately narrow:
//   - Comments are stripped first. History and negative statements ("purge is
//     NOT a Pro feature") live in comments and are welcome there.
//   - "Pro (legacy)" and the legacy-subscriber cancel flow are allowed: a
//     residual paying customer must be able to see and end what they pay for.
//   - Blog posts are excluded: dated posts record the era they shipped in.
//   - The dormant billing routes are excluded by path; they are out of the
//     OpenAPI contract and unreachable from active UI.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN = [
  "apps/dashboard/src",
  "apps/site/src",
];
const EXCLUDE = [
  "__tests__",
  "/blog/",              // dated record
  "docs/changelog",      // dated record
  // /billing/ is NOT excluded any more. The exclusion hid the biggest way in:
  // the checkout route was still creating Stripe customers and subscriptions
  // while this gate reported the tree clean. The legacy-management surfaces
  // (portal, downgrade, resume) survive the patterns below because managing or
  // cancelling an existing subscription is not an invitation to start one.
];

// Upsell phrasing: an invitation IN. Descriptions of the retired split
// ("used to require the paid Pro plan") do not match.
const PATTERNS = [
  /Upgrade to Pro/,
  /Pro plan required/,
  /\bupgrade at app\.glassmkr\.com/i,
  /\b(?:is|are) a Pro(?:-only)? feature\b/,
  /\bPro[- ]only\b(?![^.]*\bnot\b)/,
  /\bRequires? (?:the )?Pro plan\b/,
  // Everything below was LIVE while the first version of this gate passed:
  // it recognised six phrasings and the contradictions used others.
  // Product-attached "paid tier" only: the shipped strings were "unlimited on
  // the paid tier", "hosted: paid tier" and "are the paid tier". A bare
  // "Paid tier" row label on a /vs/ page describes the COMPETITOR's pricing
  // and is exactly the distinction the audit demanded this gate make.
  /(?<!no )(?<!not a )\b(?:the|our|its|hosted:?)\s+paid tier\b(?! and no)/i,
  /\?plan=pro\b/,                                    // a link carrying the parameter
  // The register page never contained the literal "?plan=pro": it READ the
  // parameter. The behaviour, not the string, is what must not return.
  /searchParams\.get\(["']plan["']\)\s*===\s*["']pro["']/,
  // A LINK INTO checkout, not a mention of it: the demo blocklist and the API
  // docs both legitimately name the route while blocking or describing it.
  /(?:href="|goto\(")[^"']*billing\/checkout/,
  /\bBy subscribing\b/,                              // the pre-subscription notice
  /\bunlimited on (?:the )?(?:Pro|paid)/i,
  // The response field every upsell body carried. Phrase patterns miss a
  // split-string message ("Upgrade for " + "unlimited analysis", Codex
  // 2026-08-29 #16); the field name survives any rewording. Comments are
  // already stripped, so prose naming the field stays allowed.
  /\bupgrade_url\b/,
];

// A `// tier: pro` marker IS a comment, so it can only be checked against the
// RAW source. The first version put it in PATTERNS, which run after comments
// are stripped, so the one thing that pattern existed to catch was the one
// thing it could never see, and its fixture explicitly blessed the blind spot.
const RAW_PATTERNS = [/^\s*\/\/ tier: pro\b/m];

/** Exported for the fixture test. */
export function findUpsells(src) {
  const code = src
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  const hits = [];
  for (const re of PATTERNS) {
    const m = code.match(re);
    if (m) hits.push(m[0]);
  }
  for (const re of RAW_PATTERNS) {
    const m = src.match(re);
    if (m) hits.push(m[0].trim());
  }
  return hits;
}

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (EXCLUDE.some((x) => p.includes(x))) continue;
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(svelte|ts|txt|md)$/.test(e.name)) out.push(p);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = [];
  for (const dir of SCAN) {
    for (const f of walk(path.join(ROOT, dir))) {
      for (const hit of findUpsells(fs.readFileSync(f, "utf8"))) {
        problems.push(`${path.relative(ROOT, f)}: "${hit}"`);
      }
    }
  }
  if (problems.length) {
    console.error(`[lint:plan-language] ${problems.length} active surface(s) sell a plan that does not exist:`);
    for (const p of problems) console.error("  " + p);
    console.error(
      "\nground-truth.yaml hosted_pricing_state is resolved: hosted is free. If that\n" +
      "decision changes, change the registry FIRST, then this gate, then the copy.",
    );
    process.exit(1);
  }
  console.log("[lint:plan-language] OK; no active surface sells a retired plan");
}
