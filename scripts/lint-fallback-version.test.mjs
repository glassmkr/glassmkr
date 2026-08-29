#!/usr/bin/env node
//
// Test the fallback-version lockstep gate (per the standing rule that every new
// CI gate ships with a known-bad fixture proving it catches a real-world
// equivalent). Standalone, no test framework, like
// lint-clickhouse-params.test.mjs. Exits non-zero on mismatch.

import {
  extractVersion,
  checkLockstep,
  checkDerived,
  stripComments,
  discoverLiterals,
  checkUndeclared,
  SOURCES,
  MUST_STAY_DERIVED,
} from "./lint-fallback-version.mjs";

let pass = 0;
let fail = 0;

function check(label, got, want) {
  if (got === want) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${label}\n  expected ${want}, got ${got}`);
  }
}

// --- extractVersion: the three real shapes it has to read -------------------

check(
  "exported const with double quotes -> extracted",
  extractVersion('export const FALLBACK_LATEST = "0.14.8";', "FALLBACK_LATEST"),
  "0.14.8",
);

check(
  "plain const (gen-rules.mjs shape) -> extracted",
  extractVersion(
    'const FALLBACK_CRUCIBLE_VERSION = "0.14.8";',
    "FALLBACK_CRUCIBLE_VERSION",
  ),
  "0.14.8",
);

check(
  "type-annotated const, single quotes -> extracted",
  extractVersion(
    "export const FALLBACK_LATEST: string = '0.14.8';",
    "FALLBACK_LATEST",
  ),
  "0.14.8",
);

check(
  "derived re-export (not a literal) -> null, must not be read as a version",
  extractVersion(
    "export const FALLBACK_LATEST = FALLBACK_CRUCIBLE_VERSION;",
    "FALLBACK_LATEST",
  ),
  null,
);

check(
  "constant absent (renamed) -> null",
  extractVersion("export const SOMETHING_ELSE = \"0.14.8\";", "FALLBACK_LATEST"),
  null,
);

// --- checkLockstep ----------------------------------------------------------

check(
  "all three agree -> no violation",
  checkLockstep([
    { file: "a", name: "A", version: "0.14.8" },
    { file: "b", name: "B", version: "0.14.8" },
    { file: "c", name: "C", version: "0.14.8" },
  ]).length,
  0,
);

check(
  "THE REAL-WORLD BUG: dashboard bumped, site left behind -> FLAGGED",
  checkLockstep([
    { file: "apps/site/src/lib/crucible-version.ts", name: "A", version: "0.6.6" },
    { file: "apps/site/scripts/gen-rules.mjs", name: "B", version: "0.6.6" },
    { file: "apps/dashboard/.../version.ts", name: "C", version: "0.13.6" },
  ]).length > 0,
  true,
);

check(
  "one of the site pair missed (gen-rules forgotten) -> FLAGGED",
  checkLockstep([
    { file: "a", name: "A", version: "0.14.8" },
    { file: "b", name: "B", version: "0.14.7" },
    { file: "c", name: "C", version: "0.14.8" },
  ]).length > 0,
  true,
);

check(
  "a renamed constant -> FLAGGED, not silently skipped",
  checkLockstep([
    { file: "a", name: "A", version: "0.14.8" },
    { file: "b", name: "B", version: null },
    { file: "c", name: "C", version: "0.14.8" },
  ]).length > 0,
  true,
);

// --- checkDerived: re-export files must not grow a literal ------------------

check(
  "derived file still re-exporting -> no violation",
  checkDerived([
    { file: "a", name: "FALLBACK_LATEST", version: null, derivedFrom: "x" },
  ]).length,
  0,
);

check(
  "derived file hardcoded to a literal -> FLAGGED",
  checkDerived([
    { file: "a", name: "FALLBACK_LATEST", version: "0.14.7", derivedFrom: "x" },
  ]).length > 0,
  true,
);

// --- the gate must actually be pointed at every known literal ---------------

check(
  "SOURCES still covers all three literals",
  SOURCES.length,
  3,
);

check(
  "MUST_STAY_DERIVED still covers the site re-export",
  MUST_STAY_DERIVED.length,
  1,
);

// --- regressions for the two silent passes found in review, 2026-07-29 --------

// HOLE 1 REPRODUCTION. A commented 0.14.8 above a live 0.14.7 made this gate
// report "3 literals agree at 0.14.8" while the real value was 0.14.7.
check(
  "a commented-out assignment is ignored; the LIVE one is read",
  extractVersion(
    '// export const FALLBACK_CRUCIBLE_VERSION = "0.14.8";\n' +
      'export const FALLBACK_CRUCIBLE_VERSION = "0.14.7";\n',
    "FALLBACK_CRUCIBLE_VERSION",
  ),
  "0.14.7",
);

check(
  "an assignment inside a block comment is ignored",
  extractVersion(
    '/*\nexport const FALLBACK_LATEST = "9.9.9";\n*/\nexport const FALLBACK_LATEST = "0.14.8";\n',
    "FALLBACK_LATEST",
  ),
  "0.14.8",
);

// stripComments must not eat a URL: "https://" contains "//". Only whole-line
// comments are stripped, so a trailing comment after code is left alone (it
// cannot hide an assignment anyway).
check(
  "a URL containing // survives comment stripping",
  stripComments('const U = "https://glassmkr.com/x";').includes("https://glassmkr.com/x"),
  true,
);

check(
  "a trailing comment after a live assignment does not hide it",
  extractVersion('export const FALLBACK_LATEST = "0.14.8"; // bumped after publish', "FALLBACK_LATEST"),
  "0.14.8",
);

// HOLE 2 REPRODUCTION. A fourth divergent literal in a NEW file stayed green,
// because discovery was a hardcoded three-file list.
const declared = SOURCES.map((s) => s.file);
check(
  "a literal in an undeclared file is flagged",
  checkUndeclared(
    [{ file: "apps/dashboard/src/lib/server/rogue-version.ts", name: "FALLBACK_LATEST" }],
    declared,
  ).length,
  1,
);

check(
  "the flag names the rogue file",
  checkUndeclared(
    [{ file: "apps/dashboard/src/lib/server/rogue-version.ts", name: "FALLBACK_LATEST" }],
    declared,
  )[0].includes("rogue-version.ts"),
  true,
);

check(
  "literals in declared files are not flagged",
  checkUndeclared(declared.map((f) => ({ file: f, name: "FALLBACK_LATEST" })), declared).length,
  0,
);

check(
  "discoverLiterals finds a literal and skips a file without one",
  discoverLiterals([
    { file: "a.ts", src: 'export const FALLBACK_LATEST = "0.14.8";' },
    { file: "b.ts", src: "export const SOMETHING_ELSE = 1;" },
  ]).length,
  1,
);

console.log(`[lint:fallback-version:test] ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
