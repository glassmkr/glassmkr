#!/usr/bin/env node
//
// CI lint rule: every HTTP handler in /api/v1 must declare its tier so
// future endpoints don't silently bypass the Position B Pro-gate
// (`~/Documents/Glassmkr/Reference/POLICY_TIER_GATING.md`).
//
// For each handler (`export const GET|POST|PUT|PATCH|DELETE: ... =>`),
// the script accepts either:
//
//   1. An inline marker comment within ~10 lines above the export:
//        // tier: free
//        // tier: pro
//      (whitespace flexible; case insensitive on `tier`).
//
//   2. An entry in `scripts/tier-gating-allowlist.json` matching
//      `{path, method, tier}`. The allowlist is the seed for endpoints
//      that pre-date the lint; new endpoints should prefer inline
//      markers.
//
// Failure mode: any handler with neither marker nor allowlist row
// causes a non-zero exit with the file path, method, and the exact
// recommended marker text. CI fails before merge.
//
// Hooked into `package.json` as `pnpm lint:tier-gating`. Add a new
// step in `.github/workflows/ci.yml` after `lint:bola`.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(here, "..");

const ROUTE_ROOT = "apps/dashboard/src/routes/api/v1";
const ALLOWLIST_PATH = "scripts/tier-gating-allowlist.json";
const POLICY_DOC = "~/Documents/Glassmkr/Reference/POLICY_TIER_GATING.md";

const VALID_TIERS = new Set(["free", "pro"]);
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) {
      out.push(...walk(full));
    } else if (s.isFile() && full.endsWith("+server.ts")) {
      out.push(full);
    }
  }
  return out;
}

function loadAllowlist() {
  try {
    const raw = readFileSync(join(repoRoot, ALLOWLIST_PATH), "utf8");
    const parsed = JSON.parse(raw);
    const map = new Map();
    for (const e of parsed.endpoints ?? []) {
      if (!e.path || !e.method || !e.tier) continue;
      if (!VALID_TIERS.has(e.tier)) {
        throw new Error(`allowlist entry has invalid tier '${e.tier}' for ${e.method} ${e.path}`);
      }
      map.set(`${e.path}::${e.method}`, e.tier);
    }
    return map;
  } catch (err) {
    if (err.code === "ENOENT") return new Map();
    throw err;
  }
}

// Marker scanner: each `// tier: <free|pro>` marker applies to the next
// handler export below it in the same file. For a given export, look
// back from its line to either the previous export (which "owns" any
// markers above it) or the start of file, whichever comes first, and
// pick the most recent marker in that window.
const MARKER_RE = /\/\/\s*tier\s*:\s*(free|pro)\b/i;
const EXPORT_RE = /export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*:/;

function findInlineMarker(lines, exportLineIdx) {
  let found = null;
  for (let i = exportLineIdx - 1; i >= 0; i--) {
    if (EXPORT_RE.test(lines[i])) break;
    const m = lines[i].match(MARKER_RE);
    if (m) {
      found = m[1].toLowerCase();
      // Keep walking only to ensure we found the closest; but the
      // first one we hit going up IS the closest, so break.
      break;
    }
  }
  return found;
}

function scanFile(file, allowlist) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  const rel = relative(repoRoot, file);
  const findings = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // export const METHOD: RequestHandler = ...
    const m = line.match(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*:/);
    if (!m) continue;
    const method = m[1];
    const inline = findInlineMarker(lines, i);
    if (inline) {
      findings.push({ file: rel, method, line: i + 1, source: "marker", tier: inline });
      continue;
    }
    const key = `${rel}::${method}`;
    if (allowlist.has(key)) {
      findings.push({ file: rel, method, line: i + 1, source: "allowlist", tier: allowlist.get(key) });
      continue;
    }
    findings.push({ file: rel, method, line: i + 1, source: "missing", tier: null });
  }
  return findings;
}

function main() {
  const allowlist = loadAllowlist();
  const root = join(repoRoot, ROUTE_ROOT);
  const files = walk(root);
  let total = 0;
  const missing = [];
  for (const f of files) {
    for (const finding of scanFile(f, allowlist)) {
      total++;
      if (finding.source === "missing") missing.push(finding);
    }
  }

  if (missing.length === 0) {
    console.log(`OK: ${total} handlers scanned, all declare tier (marker or allowlist).`);
    process.exit(0);
  }

  console.error(`Tier-gating lint failed: ${missing.length} handler(s) with no tier declaration:`);
  console.error("");
  for (const m of missing) {
    console.error(`  ${m.file}:${m.line}  ${m.method}`);
  }
  console.error("");
  console.error("Each handler needs either:");
  console.error("  (a) Inline marker comment within ~10 lines above the export:");
  console.error("        // tier: free        (no Pro-gate; Free customers can call)");
  console.error("        // tier: pro         (Pro-gated; programmatic callers on Free get 402)");
  console.error("");
  console.error(`  (b) An entry in ${ALLOWLIST_PATH} with explicit tier.`);
  console.error("");
  console.error(`Policy: ${POLICY_DOC}`);
  process.exit(1);
}

main();
