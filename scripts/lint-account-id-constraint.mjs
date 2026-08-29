#!/usr/bin/env node
//
// CI lint rule: every SQL query that reads or writes a customer-scoped
// table must constrain by customer_id (the BOLA defence from spec
// Part 4 — "single most important line of code in the system").
//
// Method: scan every .ts file under apps/dashboard/src/lib/server/ and
// apps/dashboard/src/routes/ for SQL string literals (template literals
// or quoted strings starting with SELECT/UPDATE/DELETE that mention
// one of the BOLA-sensitive tables). For each match, verify the
// query has at least one of:
//
//   - "customer_id = $" or "customer_id=" in WHERE/SET
//   - a JOIN that propagates customer_id (s.customer_id constraint)
//   - is exempt via an inline opt-out comment: `-- bola-exempt: <reason>`
//     (case-insensitive; `bola-safe`, `BOLA-exempt`, `BOLA-safe` and the
//     underscore-separator variants are accepted as readable aliases.)
//
// False positives are tolerable: better to require an explicit
// opt-out than to let a real BOLA bug ship.
//
// Run via `pnpm lint:bola`. Exits non-zero on any unexempted match
// missing customer_id.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(here, "..");

// Tables that are customer-scoped. Any SQL touching one of these MUST
// constrain by customer_id (or join through a row that does). When a
// new customer-scoped table is added, list it here.
const BOLA_TABLES = [
  "servers",
  "account_api_keys",
  "active_alerts",
  "alert_channels",
  "trend_warnings",
  "stripe_subscriptions",
  "disk_health_state",
  "rule_trend_snapshots",
];

// Exempt files (not customer-scoped: snapshot writes, watchdog scans,
// global indexes, schedulers). Path globs relative to repoRoot.
const EXEMPT_PATHS = [
  "apps/dashboard/src/routes/api/v1/ingest/+server.ts",
  "apps/dashboard/src/lib/server/watchdog.ts",
  "apps/dashboard/src/lib/server/watchdog-scheduler.ts",
  "apps/dashboard/src/lib/server/trend-warnings/scheduler.ts",
  "apps/dashboard/src/lib/server/trend-warnings/job.ts",
  "apps/dashboard/src/lib/server/disk-health.ts",
  "apps/dashboard/src/lib/server/billing/sync.ts",
  "apps/dashboard/src/lib/server/billing/stripe.ts",
  "apps/dashboard/src/routes/webhook/stripe/+server.ts",
];

// Audit log inserts include customer_id but the body of the row reads
// "INSERT INTO api_audit_log ..." which our naive matcher would flag.
// The audit-write helper is whitelisted because it always writes
// customer_id as a column.
const EXEMPT_FILE_BASENAMES = ["audit.ts"];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".svelte-kit" || entry === "dist") continue;
    if (entry === "__tests__") continue; // test fixtures aren't real SQL
    if (entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) walk(full, files);
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts") && !entry.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

function isExempt(rel) {
  if (EXEMPT_PATHS.includes(rel)) return true;
  for (const base of EXEMPT_FILE_BASENAMES) {
    if (rel.endsWith("/" + base)) return true;
  }
  return false;
}

function findSqlBlocks(source) {
  // For each BOLA-sensitive table, find every place the source
  // does `FROM <table>` / `UPDATE <table>` / `INTO <table>` /
  // `JOIN <table>`. For each hit, capture a 400-char window
  // starting at the SQL VERB before the table name. We don't try
  // to capture the full template literal because ${...}
  // interpolations break naive matching. The window is enough to
  // see the WHERE clause (or column list for INSERT) immediately
  // after.
  const blocks = [];
  for (const table of BOLA_TABLES) {
    // Match: VERB optional whitespace optional "public." table-name.
    // Capture group 1 is the verb so we can report it.
    const re = new RegExp(
      `\\b(SELECT[\\s\\S]{0,200}?FROM|UPDATE|INSERT[\\s\\S]{0,40}?INTO|DELETE[\\s\\S]{0,40}?FROM|JOIN)\\s+(?:public\\.)?${table}\\b`,
      "gi",
    );
    let m;
    while ((m = re.exec(source)) !== null) {
      // Window starts at the verb and runs for 400 chars OR until
      // the next backtick (whichever comes first), so we don't
      // run into the next adjacent SQL block.
      const start = m.index;
      // Fixed-width window. Backtick-aware truncation false-positived
      // when the SQL match was outside any literal (a verb in code or
      // adjacent comment); the window collapsed to zero and missed the
      // legitimate WHERE clause downstream. 400 chars is enough for
      // any single-statement query plus a few lines of context.
      const window = source.slice(start, start + 400);
      blocks.push({
        offset: start,
        verb: m[1].split(/\s+/)[0].toUpperCase(),
        table,
        text: window,
        lineNumber: source.slice(0, start).split("\n").length,
      });
    }
  }
  return blocks;
}

// Returns the table this SQL block is hitting, as identified at
// match time. Eliminates the previous per-block-secondary scan that
// caused false positives when one window happened to mention two
// table names.
function tablesReferenced(block) {
  return [block.table];
}

function hasCustomerIdConstraint(sqlText) {
  // Accept ANY of:
  //   - customer_id (the canonical column)
  //   - server_id   (servers are customer-scoped; a server_id
  //     constraint is a valid BOLA defence after the caller has
  //     already verified server ownership via requireServerOwnership)
  //   - account_id  (in case future tables use this naming)
  //
  // The lint is intentionally permissive: it flags queries that
  // ENTIRELY lack scoping (the most common bug), not queries with
  // weaker scoping. Reviewer judgement covers the gradient.
  return /\b(customer_id|server_id|account_id)\b/i.test(sqlText);
}

// Marker recogniser: accept `bola-exempt:` (canonical) plus the
// readable aliases `bola-safe:`, `BOLA-exempt:`, `BOLA-safe:`, and the
// underscore-separator variants. The friction shape that surfaced this
// (PR #73 → #74): humans writing security-adjacent code reach for
// "BOLA-safe" naturally; the pre-fix regex only accepted the magic
// string `bola-exempt:` and silently dropped the alternative phrasing,
// failing CI after merge.
//
// Separator is required (- or _) so `bolaexempt:` does NOT match — a
// missing separator is more likely a typo than an intentional marker.
// `bola-exempted:` is also rejected because the regex anchors the
// colon directly after `exempt` / `safe`, not after a longer suffix.
export const BOLA_EXEMPT_RE = /bola[-_](?:exempt|safe)\s*:/i;

function hasInlineExempt(source, offset) {
  // Look back up to 500 chars for a comment saying "bola-exempt".
  // 500 is generous: comments are typically immediately above the
  // SQL, but multi-line backtick literals + parameter arrays can
  // push the regex match position further from the comment.
  const start = Math.max(0, offset - 500);
  const window = source.slice(start, offset);
  return BOLA_EXEMPT_RE.test(window);
}

function lint() {
  const errors = [];
  const scanRoots = [
    join(repoRoot, "apps/dashboard/src/lib/server"),
    join(repoRoot, "apps/dashboard/src/routes"),
  ];
  const files = scanRoots.flatMap((root) => walk(root));

  for (const file of files) {
    const rel = relative(repoRoot, file);
    if (isExempt(rel)) continue;

    const source = readFileSync(file, "utf-8");
    const blocks = findSqlBlocks(source);

    for (const block of blocks) {
      // INSERTs must have customer_id in the column list.
      // SELECTs/UPDATEs/DELETEs must have it in WHERE (we check the
      // whole text; this is permissive but the BOLA hygiene rule is
      // simple: customer_id or server_id or account_id must appear).
      if (hasCustomerIdConstraint(block.text)) continue;

      if (hasInlineExempt(source, block.offset)) continue;

      errors.push({
        file: rel,
        line: block.lineNumber,
        verb: block.verb,
        tables: tablesReferenced(block),
        snippet: block.text.replace(/\s+/g, " ").slice(0, 120) + (block.text.length > 120 ? "..." : ""),
      });
    }
  }

  if (errors.length > 0) {
    console.error("BOLA lint failed: SQL queries against customer-scoped tables without customer_id constraint:\n");
    for (const e of errors) {
      console.error(`  ${e.file}:${e.line}  [${e.verb} on ${e.tables.join(", ")}]`);
      console.error(`    ${e.snippet}`);
      console.error();
    }
    console.error("If a query is intentionally non-customer-scoped (cross-account scan,");
    console.error("admin tool, ingest hot path with explicit ownership check), add an");
    console.error("inline comment immediately before the literal:");
    console.error("    // bola-exempt: <reason>");
    console.error("Accepted aliases (case-insensitive, hyphen or underscore separator):");
    console.error("    bola-exempt:  bola-safe:  bola_exempt:  bola_safe:");
    console.error("Or add the file to EXEMPT_PATHS in scripts/lint-account-id-constraint.mjs");
    console.error("if the entire file is intentionally cross-account.");
    process.exit(1);
  }

  console.log(`OK: ${files.length} files scanned, no BOLA-suspect queries.`);
}

// Only run the linter when invoked as a script. Importing the file
// (e.g. from the co-located test for BOLA_EXEMPT_RE) must not
// trigger a full scan.
if (import.meta.url === `file://${process.argv[1]}`) {
  lint();
}
