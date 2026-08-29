#!/usr/bin/env node
//
// CI lint rule: em-dashes (U+2014, "—") are not allowed in Glassmkr
// code, comments, or UI copy. The convention is documented in the
// project memory entry `feedback_no_emdash.md`.
//
// Why a lint instead of an eyeball pass:
//   We have rewritten 234 instances in a single sweep before
//   (`PR #145`, 2026-05-17) because em-dashes had crept back in across
//   svelte routes, YAML rule files, and TS doc comments. This script
//   prevents the regression.
//
// Scope (user-facing surfaces; dashboard internals are out of scope
// because comments and null-placeholders there don't render to
// customers):
//   - apps/site/src/**/*.{svelte,ts,md}                  (marketing
//                                                         surface)
//   - apps/dashboard/src/lib/server/alerts/rules/**/*.yaml (rule
//                                                         library:
//                                                         per-rule
//                                                         pages
//                                                         render
//                                                         these
//                                                         directly)
//
// Allowed exceptions:
//   - `node_modules`
//   - generated artifacts (static/llms*.txt; regenerated from sources)
//   - this file itself (the description references em-dashes)
//
// Failure mode: prints every offending line with its file path + line
// number and exits non-zero. Hook into `pnpm lint:emdash` via
// `package.json`; CI calls it next to `lint:bola` and friends.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(here, "..");

const SCAN_ROOTS = [
  "apps/site/src",
  // The whole alerts source, not just rules/: evaluator.ts and the
  // fix-workflow helpers build user-facing alert message text too, and an
  // em-dash there slipped past the old rules-only scope. __tests__ is skipped
  // (see SKIP_DIRS); test fixtures are not user-facing copy.
  "apps/dashboard/src/lib/server/alerts",
  // The site's build-time generators. These EMIT the artifacts that
  // ALLOWED_PATHS exempts (llms.txt, llms-full.txt) plus rules.json and the
  // per-doc .md twins, so their template strings are user-facing even though
  // the files themselves are tooling. Without this root, an em-dash in a
  // gen-rules.mjs template lands in public output with the source unscanned
  // and the artifact exempted, i.e. caught by nothing.
  "apps/site/scripts",
];

const ALLOWED_EXTENSIONS = new Set([
  ".svelte",
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".md",
  ".yaml",
  ".yml",
]);

// Files / dirs we never want to walk into.
const SKIP_DIRS = new Set([
  "node_modules",
  ".svelte-kit",
  "dist",
  "build",
  ".turbo",
  "__tests__",
]);

// Files we deliberately allow to contain "em-dash" text (the lint
// script itself, plus generated artifacts that re-derive from sources).
const SELF_PATH = relative(repoRoot, fileURLToPath(import.meta.url));
const ALLOWED_PATHS = new Set([
  SELF_PATH,
  "apps/site/static/llms.txt",
  "apps/site/static/llms-full.txt",
]);

const EM_DASH = "—"; // "—"

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      out.push(...walk(full));
    } else if (s.isFile()) {
      const ext = name.slice(name.lastIndexOf("."));
      if (ALLOWED_EXTENSIONS.has(ext)) {
        out.push(full);
      }
    }
  }
  return out;
}

const offenders = [];

for (const root of SCAN_ROOTS) {
  const abs = join(repoRoot, root);
  for (const file of walk(abs)) {
    const rel = relative(repoRoot, file);
    if (ALLOWED_PATHS.has(rel)) continue;
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!text.includes(EM_DASH)) continue;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].includes(EM_DASH)) {
        offenders.push({ file: rel, line: i + 1, text: lines[i].trim() });
      }
    }
  }
}

if (offenders.length === 0) {
  console.log("[lint:emdash] OK; no em-dashes found");
  process.exit(0);
}

console.error(`[lint:emdash] FAIL; ${offenders.length} em-dash occurrence(s):`);
console.error("");
for (const o of offenders) {
  console.error(`  ${o.file}:${o.line}: ${o.text}`);
}
console.error("");
console.error("Em-dashes (\\u2014, '—') are not allowed in Glassmkr code, comments,");
console.error("or UI copy. Replace with one of:");
console.error("  - ': ' (colon + space) in svelte/ts prose and comments");
console.error("  - '; ' (semicolon + space) inside YAML scalars (a bare colon");
console.error("    would re-introduce a nested-mapping parse trap)");
console.error("  - '-' (hyphen) in code identifiers or short inline pairs");
process.exit(1);
