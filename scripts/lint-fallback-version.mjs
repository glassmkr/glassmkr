#!/usr/bin/env node
//
// Guard: the Crucible fallback-version literals must agree with each other.
//
// Why this gate exists: the version the site and dashboard advertise when npm
// is unreachable is duplicated as THREE independent string literals, across two
// apps, under two different names. Nothing tied them together, and they have
// drifted for real. The dashboard constant sat at 0.6.6 for seven minor
// releases before the 0.13.6 release caught it, and gen-rules.mjs carried a
// comment pointing at the wrong source of truth until #593. Until now the only
// protection was RELEASE.md step 10 plus a set of comments, which is exactly
// what was already in place when the 0.6.6 drift happened.
//
// Scope: equality BETWEEN the literals, nothing more. This gate deliberately
// does NOT compare them against npm's published `latest`. That would put the
// network inside CI, and it would fail during a mid-flight release: the
// documented rule is to leave the fallbacks on the last PUBLISHED version until
// the new one is live on npm, so a fallback legitimately trails the CHANGELOG
// for the length of a release.
//
// Missing constants fail LOUDLY rather than being skipped. A rename must break
// this gate, not quietly reduce it to comparing fewer literals than it claims.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(here, "..");

// The literals RELEASE.md step 10 requires bumping in lockstep.
//
// apps/site/src/lib/server/version.ts is deliberately NOT listed: it
// re-exports FALLBACK_CRUCIBLE_VERSION from crucible-version.ts and holds no
// literal of its own. If a literal is ever hardcoded there, add it here.
export const SOURCES = [
  {
    file: "apps/site/src/lib/crucible-version.ts",
    name: "FALLBACK_CRUCIBLE_VERSION",
  },
  {
    // Runs at prebuild, outside the module graph, so it cannot import the
    // constant above and keeps its own copy.
    file: "apps/site/scripts/gen-rules.mjs",
    name: "FALLBACK_CRUCIBLE_VERSION",
  },
  {
    file: "apps/dashboard/src/lib/server/version.ts",
    name: "FALLBACK_LATEST",
  },
];

// Pure: remove comments so a commented-out assignment cannot be read as live.
//
// Added 2026-07-29: review demonstrated that a commented `0.14.8` sitting above a
// live `0.14.7` made this gate report "3 literals agree at 0.14.8" while the real
// value was 0.14.7. A guard that reports green on real drift is worse than none.
//
// Only strips block comments and WHOLE-LINE `//` comments, deliberately not a
// trailing `//` after code: that would truncate a string containing "https://",
// and a trailing comment cannot hide an assignment anyway (the assignment is
// already matched before it).
export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

// Pure: pull the assigned string literal for `name` out of `src`.
// Returns null when there is no such assignment, so callers can fail loudly.
// Tolerates `export`, a `: string` annotation, and either quote style. Does NOT
// match an assignment from another identifier (that is a derived re-export, not
// a literal, and must not be treated as one). Comments are stripped first.
export function extractVersion(src, name) {
  const re = new RegExp(
    `(?:export\\s+)?const\\s+${name}\\s*(?::\\s*string\\s*)?=\\s*["']([^"']+)["']`,
  );
  const m = stripComments(src).match(re);
  return m ? m[1] : null;
}

// Directories searched for UNDECLARED fallback literals. Discovery exists because
// SOURCES is a hardcoded list: review showed that adding a fourth divergent
// literal in a NEW file left this gate green, since it only ever looked at the
// three files it already knew about. A gate that cannot see a new copy of the
// thing it guards is not guarding the invariant, only its own list.
export const SEARCH_ROOTS = ["apps/site/src", "apps/site/scripts", "apps/dashboard/src"];
export const LITERAL_NAMES = ["FALLBACK_CRUCIBLE_VERSION", "FALLBACK_LATEST"];

// Pure: given [{file, src}], return the files holding a literal assignment to one
// of LITERAL_NAMES. Used to compare discovered reality against the declared list.
export function discoverLiterals(files) {
  const found = [];
  for (const { file, src } of files) {
    for (const name of LITERAL_NAMES) {
      if (extractVersion(src, name) !== null) found.push({ file, name });
    }
  }
  return found;
}

// Pure: flag any literal that exists on disk but is not in the declared list.
export function checkUndeclared(discovered, declaredFiles) {
  return discovered
    .filter((d) => !declaredFiles.includes(d.file))
    .map(
      (d) =>
        `${d.file}: holds a literal ${d.name} but is not in SOURCES; ` +
        `add it (or make the file derive the value) so the lockstep check covers it`,
    );
}

// Files that must stay DERIVED, holding no literal of their own. RELEASE.md
// step 10 says this file needs no edit and must not hardcode a version; without
// this assertion, hardcoding one here would drift from crucible-version.ts with
// nothing to catch it, since the file is (correctly) absent from SOURCES.
export const MUST_STAY_DERIVED = [
  {
    file: "apps/site/src/lib/server/version.ts",
    name: "FALLBACK_LATEST",
    derivedFrom: "FALLBACK_CRUCIBLE_VERSION in apps/site/src/lib/crucible-version.ts",
  },
];

// Pure: flag any file that should re-export but has grown a string literal.
export function checkDerived(entries) {
  return entries
    .filter((e) => e.version !== null)
    .map(
      (e) =>
        `${e.file}: ${e.name} is hardcoded to "${e.version}" but must stay ` +
        `derived from ${e.derivedFrom}`,
    );
}

// Pure: given [{file, name, version}], return a list of violation strings.
export function checkLockstep(found) {
  const violations = [];

  for (const f of found.filter((x) => x.version === null)) {
    violations.push(
      `${f.file}: no string literal found for ${f.name} ` +
        `(renamed, removed, or now derived from another value?)`,
    );
  }

  const present = found.filter((x) => x.version !== null);
  const distinct = [...new Set(present.map((x) => x.version))];
  if (distinct.length > 1) {
    violations.push(
      "fallback versions disagree: " +
        present.map((x) => `${x.file} = ${x.version}`).join(", "),
    );
  }

  return violations;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const found = SOURCES.map((s) => {
    let src;
    try {
      src = readFileSync(join(repoRoot, s.file), "utf8");
    } catch {
      return { ...s, version: null, unreadable: true };
    }
    return { ...s, version: extractVersion(src, s.name) };
  });

  const derived = MUST_STAY_DERIVED.map((d) => {
    let src;
    try {
      src = readFileSync(join(repoRoot, d.file), "utf8");
    } catch {
      return { ...d, version: null, unreadable: true };
    }
    return { ...d, version: extractVersion(src, d.name) };
  });

  // Walk the search roots and compare reality against the declared list, so a
  // fourth literal in a file nobody added to SOURCES cannot hide.
  const scanned = [];
  const walk = (rel) => {
    let entries;
    try {
      entries = readdirSync(join(repoRoot, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "__tests__" || e.name === ".svelte-kit") continue;
        walk(child);
      } else if (/\.(ts|mjs|js)$/.test(e.name)) {
        try {
          scanned.push({ file: child, src: readFileSync(join(repoRoot, child), "utf8") });
        } catch { /* unreadable file is not this gate's business */ }
      }
    }
  };
  for (const root of SEARCH_ROOTS) walk(root);

  const declaredFiles = [...SOURCES.map((s) => s.file), ...MUST_STAY_DERIVED.map((d) => d.file)];
  const undeclared = checkUndeclared(discoverLiterals(scanned), declaredFiles);

  const violations = [
    ...checkLockstep(found),
    ...checkDerived(derived),
    ...undeclared,
  ];

  for (const f of [...found, ...derived].filter((x) => x.unreadable)) {
    violations.push(`${f.file}: file not readable (moved or deleted?)`);
  }

  if (violations.length > 0) {
    console.error("[lint:fallback-version] violations:");
    for (const v of violations) console.error("  " + v);
    console.error(
      `\nAll ${SOURCES.length} Crucible fallback-version literals must match, ` +
        `and the derived re-export(s) must stay derived. RELEASE.md step 10 ` +
        `lists them and bumps them in lockstep, only after npm shows the ` +
        `version.`,
    );
    process.exit(1);
  }

  console.log(
    `[lint:fallback-version] OK; ${SOURCES.length} literals agree at ` +
      `${found[0].version}; ${MUST_STAY_DERIVED.length} derived re-export(s) ` +
      `hold no literal.`,
  );
}
