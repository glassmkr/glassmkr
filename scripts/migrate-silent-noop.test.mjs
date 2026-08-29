#!/usr/bin/env node
//
// Tests for the silent-no-op defense in migrate-postgres.mjs +
// migrate-clickhouse.mjs. Standalone — no test-framework dependency,
// matches the pattern in lint-account-id-constraint.test.mjs.
//
// What's tested:
//   - NO-COLUMN-DELTA marker recognition (line + block comments, varying
//     case + whitespace).
//   - looksLikeFieldRenameError heuristic (parser-side defense).
//
// Run via `node scripts/migrate-silent-noop.test.mjs` or pnpm test.
//
// Why this matters: four bugs in the past 48h had the shape "script
// returns success per its own definition but did nothing measurable."
// The post-checks in the migration runners + the runDetailed() helper
// in Crucible add positive-affirmation logic. These tests pin the
// recognition rules so a future refactor doesn't silently weaken
// them.

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Inline copies of the two pure functions under test (extracted from
// the runners so we don't have to spin up real Postgres / ClickHouse
// for a lint-style test). Keep these byte-identical with the runner
// versions; the post-check in CI compares them.
function safeNoopRegex() {
  return /--\s*NO-COLUMN-DELTA:\s*(.+)$/im;
}
function isSafeNoopDeclared(sql) {
  const m = sql.match(safeNoopRegex());
  return m ? m[1].trim() : null;
}
function looksLikeFieldRenameError(stderr) {
  if (!stderr) return false;
  const lower = stderr.toLowerCase();
  return (
    lower.includes("is not a valid field") ||
    lower.includes("unknown field") ||
    lower.includes("invalid field") ||
    lower.includes("no such field") ||
    lower.includes("not recognized") ||
    /<[a-z_]+>.*not found/.test(lower)
  );
}

let failures = 0;
function assert(cond, label) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    failures++;
  }
}

// === NO-COLUMN-DELTA recogniser ===
const safeNoopCases = [
  { sql: "-- NO-COLUMN-DELTA: data-only INSERT\nINSERT ...", expected: "data-only INSERT", label: "canonical line comment" },
  { sql: "-- no-column-delta: lowercase reason", expected: "lowercase reason", label: "lowercase variant" },
  { sql: "-- No-Column-Delta: mixed case", expected: "mixed case", label: "mixed case" },
  { sql: "BEGIN;\n-- NO-COLUMN-DELTA: re-running 021 (already in prod)\nCOMMIT;", expected: "re-running 021 (already in prod)", label: "mid-file marker with parens" },
  { sql: "-- NO-COLUMN-DELTA:   trailing-space reason   ", expected: "trailing-space reason", label: "extra whitespace" },
  { sql: "/* NO-COLUMN-DELTA: block-style */", expected: null, label: "block comment intentionally NOT matched — line `--` only" },
  { sql: "ALTER TABLE foo ADD COLUMN bar text;", expected: null, label: "DDL only — no marker" },
  { sql: "-- normal comment\nINSERT INTO x VALUES (1);", expected: null, label: "comment without marker" },
  { sql: "-- NO-COLUMN-DELTAED: typo prefix", expected: null, label: "typo'd prefix should NOT match" },
  { sql: "-- safe noop: missing hyphen", expected: null, label: "no hyphen should NOT match" },
];
for (const c of safeNoopCases) {
  const got = isSafeNoopDeclared(c.sql);
  assert(got === c.expected, `NO-COLUMN-DELTA "${c.label}" — expected ${JSON.stringify(c.expected)} got ${JSON.stringify(got)}`);
}

// === Field-rename-error heuristic ===
const renameCases = [
  // Real-world fixtures from the two Crucible bugs found this week.
  { stderr: 'Field "clocks_event_reasons.hw_power_brake" is not a valid field to query.', expected: true, label: "v0.13.2 driver-550 power-brake rename (real)" },
  { stderr: 'Field "retired_pages.double_bit_ecc.count" is not a valid field to query.', expected: true, label: "v0.13.0 retired_pages typo (real)" },
  { stderr: "ERROR: unknown field 'foo_bar'", expected: true, label: "generic unknown field" },
  { stderr: "invalid field name provided", expected: true, label: "invalid field" },
  { stderr: "no such field: bar", expected: true, label: "no such field" },
  { stderr: "Option not recognized: --query-foo", expected: true, label: "not recognized" },
  { stderr: "<clocks_throttle_reasons>: not found in driver 550 output", expected: true, label: "XML tag not found" },
  // Genuinely unrelated stderr should NOT match.
  { stderr: "", expected: false, label: "empty stderr" },
  { stderr: "Permission denied", expected: false, label: "permission failure" },
  { stderr: "Timed out waiting for nvidia-smi", expected: false, label: "timeout" },
  { stderr: "Unable to determine the device handle for GPU 0000:00:00.0: GPU is lost.", expected: false, label: "GPU lost (real fault, not a rename)" },
];
for (const c of renameCases) {
  const got = looksLikeFieldRenameError(c.stderr);
  assert(got === c.expected, `rename heuristic "${c.label}" — expected ${c.expected} got ${got}`);
}

// === NO-COLUMN-DELTA detector reads from a real file (matches runner code path) ===
const tmp = mkdtempSync(join(tmpdir(), "noop-test-"));
try {
  const safeNoopFile = join(tmp, "024_data_only.sql");
  writeFileSync(safeNoopFile, "-- NO-COLUMN-DELTA: pure INSERT, no DDL\nINSERT INTO x VALUES (1);\n");
  const sql1 = (await import("node:fs")).readFileSync(safeNoopFile, "utf8");
  assert(isSafeNoopDeclared(sql1) === "pure INSERT, no DDL", "file-roundtrip NO-COLUMN-DELTA detected");

  const ddlFile = join(tmp, "025_alter.sql");
  writeFileSync(ddlFile, "ALTER TABLE x ADD COLUMN y INT;\n");
  const sql2 = (await import("node:fs")).readFileSync(ddlFile, "utf8");
  assert(isSafeNoopDeclared(sql2) === null, "file-roundtrip DDL has no marker");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// === Tx-wrapping detector (Codex F4 2026-05-22) ===
// Mirror of assertWrappedInTransaction() in migrate-postgres.mjs. Pinned so a
// future refactor of the runner can't silently drop the check.
function isWrappedInTransaction(sql) {
  const stripped = sql
    .split("\n")
    .filter((line) => !/^\s*--/.test(line))
    .filter((line) => line.trim().length > 0)
    .join("\n");
  const begins = /^BEGIN\s*;/.test(stripped.trim());
  const ends = /COMMIT\s*;\s*$/.test(stripped.trim());
  return begins && ends;
}

const txCases = [
  {
    sql: "BEGIN;\nCREATE TABLE x (id int);\nCOMMIT;\n",
    expected: true,
    label: "simple BEGIN/COMMIT around a DDL",
  },
  {
    sql: "-- header comment\n-- with two lines\n\nBEGIN;\nCREATE TABLE x (id int);\nINSERT INTO schema_migrations (version, name) VALUES (99, '099_x') ON CONFLICT DO NOTHING;\nCOMMIT;\n",
    expected: true,
    label: "header comments + blank lines before BEGIN ignored",
  },
  {
    sql: "BEGIN;\nDO $$\nDECLARE v boolean;\nBEGIN\n  SELECT TRUE INTO v;\nEND$$;\nCOMMIT;\n",
    expected: true,
    label: "nested PL-pgSQL BEGIN inside DO block is not confused with outer tx",
  },
  {
    sql: "CREATE TABLE x (id int);\n",
    expected: false,
    label: "naked DDL with no tx wrapper fails",
  },
  {
    sql: "BEGIN;\nCREATE TABLE x (id int);\n",
    expected: false,
    label: "BEGIN with no COMMIT fails",
  },
  {
    sql: "CREATE TABLE x (id int);\nCOMMIT;\n",
    expected: false,
    label: "COMMIT with no leading BEGIN fails",
  },
  {
    sql: "BEGIN;\nCREATE TABLE x (id int);\nCOMMIT;\n\n-- trailing comment\n",
    expected: true,
    label: "trailing comment after COMMIT is OK",
  },
  {
    sql: "DO $$ BEGIN SELECT 1; END $$;\n",
    expected: false,
    label: "PL-pgSQL BEGIN keyword alone (no outer tx) does not pass",
  },
];
for (const c of txCases) {
  const got = isWrappedInTransaction(c.sql);
  assert(got === c.expected, `tx-wrap "${c.label}" — expected ${c.expected} got ${got}`);
}

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("OK: all silent-noop defense + tx-wrap tests passed");
