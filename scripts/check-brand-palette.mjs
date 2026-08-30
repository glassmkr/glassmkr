#!/usr/bin/env node
// Design-system integrity guard (Axiom-led redesign, spec section 25).
//
// The redesign replaced the muted amber (#e1843b, and the older #f5a623) with
// the molten-orange brand and decoupled brand from health/priority semantics.
// This guard keeps that from regressing. It fails when:
//   1. A retired brand literal (#e1843b / #f5a623, or their rgba forms) appears
//      in shipping CSS/Svelte/TS. Brand must read a token so the value lives in
//      one place. Comments are stripped first: history may name the old value.
//   2. A priority/severity color is painted with the brand token. Priority
//      reads --g-priority-* (mapped to health), never --g-brand or --accent.
//   3. `transition: all` is introduced (spec section 7).
//
// Exported functions are unit-tested with a known-bad fixture so a broken
// matcher cannot pass silently.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN = ["packages/ui/src", "apps/site/src", "apps/dashboard/src"];
const EXT = new Set([".css", ".svelte", ".ts"]);

export function stripComments(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const RETIRED = [
  /#e1843b/i,
  /#f5a623/i,
  /#d4820a/i,
  /rgba\(\s*225\s*,\s*132\s*,\s*59/i,
  /rgba\(\s*245\s*,\s*166\s*,\s*35/i,
  /(?<![.\w])245\s*,\s*166\s*,\s*35/i,
];

export function retiredBrandHits(src) {
  const code = stripComments(src);
  const hits = [];
  for (const re of RETIRED) { const m = code.match(re); if (m) hits.push(m[0]); }
  return hits;
}

export function priorityBrandHits(src) {
  const code = stripComments(src);
  const hits = [];
  // A line that mentions priority/severity AND paints with the brand token.
  for (const line of code.split("\n")) {
    if (/(priority|severity)/i.test(line) && /var\(--(?:g-brand|accent)\b/.test(line)) hits.push(line.trim());
  }
  // priority.ts maps a tier's color field to the brand token.
  for (const m of code.matchAll(/color:\s*"var\(--(?:accent|g-brand)/g)) hits.push(m[0]);
  return hits;
}

export function transitionAllHits(src) {
  const code = stripComments(src);
  return [...code.matchAll(/transition:\s*all\b/g)].map((m) => m[0]);
}

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.name === "node_modules" || e.name === "__tests__") continue;
    if (e.isDirectory()) out.push(...walk(p));
    else if (EXT.has(path.extname(e.name))) out.push(p);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = [];
  for (const dir of SCAN) {
    for (const f of walk(path.join(ROOT, dir))) {
      const src = fs.readFileSync(f, "utf8");
      const rel = path.relative(ROOT, f);
      for (const h of retiredBrandHits(src)) problems.push(`${rel}: retired brand literal "${h}" (read a --g-brand* token instead)`);
      for (const h of priorityBrandHits(src)) problems.push(`${rel}: priority/severity painted with the brand token: "${h}" (use --g-priority-*)`);
      for (const h of transitionAllHits(src)) problems.push(`${rel}: "${h}" (spec 7: no blanket transition)`);
    }
  }
  if (problems.length) {
    console.error(`[brand-palette] ${problems.length} design-system violation(s):`);
    for (const p of problems) console.error("  " + p);
    console.error("\nThe redesign brand is --g-brand (#ff6b35); priority reads --g-priority-*.");
    process.exit(1);
  }
  console.log("[brand-palette] OK; no retired brand literals, no brand-painted priority, no transition:all");
}
