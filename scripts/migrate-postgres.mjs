#!/usr/bin/env node
//
// Postgres migration runner for the Glassmkr dashboard DB.
//
// Why this exists: the May 17 PR #135 deploy shipped code that read
// `servers.os_id` while migration 021 was never applied on prod, causing
// a ~15h fleet-wide ingest outage (every snapshot rejected with
// "column \"os_id\" does not exist"). The historical workflow was
// "operator runs `psql -f` manually during a deploy that needs a
// schema change" — which the deploy of PR #135 skipped. There was no
// guard. This runner is the guard.
//
// Behavior:
//   1. List `migrations/postgres/*.sql` sorted by numeric prefix.
//   2. Read applied versions from `schema_migrations` (created by 015).
//   3. Apply every unapplied .sql file in order via `psql -f`.
//   4. Each .sql is responsible for its own `INSERT INTO
//      schema_migrations` (canonical pattern documented in 020). The
//      runner does NOT auto-insert because some migrations rewrite
//      table layout in ways where the insert column count could
//      change; keeping the convention inside each .sql is the safer
//      shape and matches existing migrations 016-020.
//   5. ON_ERROR_STOP=1: any SQL error aborts the deploy. Because the
//      runner runs BEFORE the binary swap in deploy.sh, the old
//      (working) binary keeps serving until a human fixes it.
//
// Idempotency: re-running this script is a no-op. Every migration's
// schema mutations should be guarded with `IF NOT EXISTS` / `IF EXISTS`
// (see 020 + 021); the bookkeeping INSERT uses `ON CONFLICT DO NOTHING`.
//
// Chicken-and-egg: migration 015 creates `schema_migrations` itself.
// Before 015 runs, `SELECT version FROM schema_migrations` errors.
// We detect that and treat "table does not exist" as "applied versions
// is empty" so the bootstrap path works on a fresh DB.
//
// Environment:
//   GMK_PG_DATABASE    Database name. Defaults to "dashboard".
//   GMK_PG_USER        psql -U. Defaults to "postgres" via sudo.
//   GMK_PG_HOST        psql -h. Empty = unix socket.
//   GMK_MIGRATIONS_DIR Path to migrations. Defaults to
//                      `migrations/postgres` relative to repo root.
//
// Local dev: pass an explicit DATABASE_URL via env if needed; the
// default invocation pattern targets prod via sudo.

import { execFileSync } from "node:child_process";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(here, "..");

const DB = process.env.GMK_PG_DATABASE ?? "dashboard";
const USER = process.env.GMK_PG_USER ?? "postgres";
const HOST = process.env.GMK_PG_HOST ?? "";
const MIGRATIONS_DIR =
  process.env.GMK_MIGRATIONS_DIR ?? join(repoRoot, "migrations/postgres");

function psqlArgs(extra) {
  // We invoke psql via `sudo -u <user>` for the prod path (peer auth
  // to the postgres role). If GMK_PG_HOST is set, switch to TCP and
  // drop the sudo wrapper (intended for non-prod environments).
  const isUnixSocket = HOST === "";
  if (isUnixSocket) {
    return ["sudo", "-u", USER, "psql", "-d", DB, "-v", "ON_ERROR_STOP=1", ...extra];
  }
  return ["psql", "-h", HOST, "-U", USER, "-d", DB, "-v", "ON_ERROR_STOP=1", ...extra];
}

function runPsql(extra) {
  const [cmd, ...args] = psqlArgs(extra);
  return execFileSync(cmd, args, { encoding: "utf8" });
}

function listMigrationFiles() {
  let entries;
  try {
    entries = readdirSync(MIGRATIONS_DIR);
  } catch (err) {
    throw new Error(`[migrate] cannot read migrations dir ${MIGRATIONS_DIR}: ${err.message}`);
  }
  const files = [];
  for (const name of entries) {
    const m = name.match(/^(\d{3})_.*\.sql$/);
    if (!m) continue;
    const version = parseInt(m[1], 10);
    files.push({ version, name, path: join(MIGRATIONS_DIR, name) });
  }
  files.sort((a, b) => a.version - b.version);
  return files;
}

function fetchAppliedVersions() {
  let out;
  try {
    out = runPsql([
      "-tA", // tuples only, unaligned -> one row per line
      "-c",
      "SELECT version FROM schema_migrations ORDER BY version",
    ]);
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : "";
    if (stderr.includes('relation "schema_migrations" does not exist')) {
      console.log("[migrate] schema_migrations does not exist yet (fresh DB); applying from scratch");
      return new Set();
    }
    throw err;
  }
  return new Set(
    out
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => parseInt(s, 10)),
  );
}

// Compact fingerprint of the public schema: every (table, column, type).
// Used by the silent-no-op detector: if a migration runs to completion
// without changing this set AND the .sql file does not declare itself
// NO-COLUMN-DELTA, the runner aborts the deploy. Cheap (single round-trip to
// information_schema), good enough to catch the class of bug where a
// migration silently no-ops because its IF-NOT-EXISTS guards were
// already-true (e.g. ALTER TABLE ADD COLUMN IF NOT EXISTS against a
// schema that was created with the column out-of-band).
function fetchSchemaFingerprint() {
  const out = runPsql([
    "-tA",
    "-F",
    "\t",
    "-c",
    `SELECT table_schema || '.' || table_name || '.' || column_name || ':' || data_type
     FROM information_schema.columns
     WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
     ORDER BY table_schema, table_name, column_name`,
  ]);
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .sort()
    .join("\n");
}

// A migration .sql file may declare itself a deliberate no-op by
// including a `-- NO-COLUMN-DELTA: <reason>` comment anywhere in the file.
// Used for the rare case where a migration is intentionally idempotent
// against the current schema state (e.g. re-running a hotfix). The
// reason text is logged so future reviewers can audit.
function isSafeNoopDeclared(file) {
  const sql = readFileSync(file.path, "utf8");
  const m = sql.match(/--\s*NO-COLUMN-DELTA:\s*(.+)$/im);
  return m ? m[1].trim() : null;
}

// Codex F4 (2026-05-22): require BEGIN/COMMIT wrapping in every migration
// from version 019 onward, so the self-registration row in schema_migrations
// rolls back atomically when the migration's body fails. Without this, a
// migration that INSERTs into schema_migrations early then RAISEs in a
// verification block leaves the registration row committed; the runner sees
// the version applied and skips on next deploy.
//
// Versions 001-018 predate the self-register-then-verify pattern (they use
// autocommit-per-statement and don't carry the anti-pattern); they're
// exempt to avoid retroactive churn. The leading BEGIN must be at file
// scope (not the `BEGIN` keyword inside a DO/PL-pgSQL block). The matching
// COMMIT must be at the end of file. Comments before BEGIN and after COMMIT
// are OK.
const TX_WRAPPING_REQUIRED_FROM_VERSION = 19;

// Self-registration is only possible from the migration that CREATES
// schema_migrations onward. 015 creates the table and backfills 001-015;
// everything below it ran before the table existed and physically cannot
// insert a row into it.
//
// Found by the first clean-machine compose run (2026-08-25): on a genuinely
// fresh database the runner applied 001_initial.sql successfully and then
// aborted with "applied without inserting into schema_migrations", so the
// self-hosted stack could never complete its very first migration. Existing
// deployments never saw it because their schema_migrations was populated long
// ago, which is exactly why a from-nothing install is its own launch gate.
const SELF_REGISTRATION_REQUIRED_FROM_VERSION = 15;

function assertWrappedInTransaction(file) {
  if (file.version < TX_WRAPPING_REQUIRED_FROM_VERSION) return;
  const text = readFileSync(file.path, "utf8");
  const stripped = text
    .split("\n")
    .filter((line) => !/^\s*--/.test(line)) // drop comment lines
    .filter((line) => line.trim().length > 0) // drop blank lines
    .join("\n");
  // File-scope BEGIN: `BEGIN` followed by `;` (a transaction). PL/pgSQL
  // BEGIN keyword is followed by other syntax (`BEGIN <variable decls> END`
  // or used inside DO $$ ... $$). We accept `BEGIN;` or `BEGIN ;` or `BEGIN`
  // at start-of-line followed by a statement-terminator-only line.
  const beginsWithTx = /^BEGIN\s*;/.test(stripped.trim());
  const endsWithTx = /COMMIT\s*;\s*$/.test(stripped.trim());
  if (!beginsWithTx || !endsWithTx) {
    console.error(
      `[migrate] FAILED: ${file.name} is not wrapped in a top-level BEGIN/COMMIT transaction.\n` +
        `Wrap the migration body so the self-registration row in schema_migrations rolls back\n` +
        `together with the migration if any later statement raises. See migration 020+ for the\n` +
        `canonical pattern, or migrations/postgres/019_trend_warning_evaluations_grants.sql for\n` +
        `the retroactive fix. Codex F4 (2026-05-22).`,
    );
    process.exit(4);
  }
}

function applyMigration(file) {
  console.log(`[migrate] applying ${file.name}`);
  assertWrappedInTransaction(file);
  const before = fetchSchemaFingerprint();
  try {
    runPsql(["-f", file.path]);
  } catch (err) {
    console.error(`[migrate] FAILED applying ${file.name}`);
    if (err.stderr) console.error(err.stderr.toString());
    if (err.stdout) console.error(err.stdout.toString());
    throw err;
  }
  const after = fetchSchemaFingerprint();
  if (before === after) {
    const safeNoopReason = isSafeNoopDeclared(file);
    if (safeNoopReason) {
      console.log(
        `[migrate] ${file.name} declared NO-COLUMN-DELTA (${safeNoopReason}); schema unchanged is expected.`,
      );
    } else {
      console.error(
        `[migrate] FAILED: ${file.name} ran without exception but the public-schema column inventory is unchanged. ` +
          `This is the silent-no-op pattern that caused PR #150 (Postgres) and PR #182 (ClickHouse) outages.\n` +
          `The marker asserts only that the COLUMN INVENTORY is unchanged, not that the migration does nothing: ` +
          `a data rewrite, a grant change, or a constraint change is a real change with no column delta. ` +
          `If that is the case here, say what this migration does do:\n\n  -- NO-COLUMN-DELTA: <what it changes instead>\n\n` +
          `Otherwise the migration's DDL guards (IF NOT EXISTS / IF EXISTS) likely matched a schema state created ` +
          `out-of-band, which means the deploy will ship code against a schema that doesn't have what it expects.`,
      );
      process.exit(3);
    }
  }
}

function main() {
  const files = listMigrationFiles();
  if (files.length === 0) {
    console.log("[migrate] no migration files found; nothing to do");
    return;
  }
  const applied = fetchAppliedVersions();
  const pending = files.filter((f) => !applied.has(f.version));

  if (pending.length === 0) {
    console.log(`[migrate] up to date (latest applied: ${Math.max(...applied, 0)})`);
    return;
  }

  console.log(
    `[migrate] ${pending.length} pending migration(s): ${pending.map((p) => p.version).join(", ")}`,
  );

  for (const file of pending) {
    applyMigration(file);
    // Verify the migration recorded itself. If a future migration
    // forgets the INSERT, the deploy aborts here with a clear message
    // rather than silently leaving prod in a half-migrated state.
    const stillUnapplied =
      file.version >= SELF_REGISTRATION_REQUIRED_FROM_VERSION &&
      !fetchAppliedVersions().has(file.version);
    if (stillUnapplied) {
      console.error(
        `[migrate] FAILED: ${file.name} applied without inserting into schema_migrations. ` +
          `Add the canonical INSERT row and re-run: migrations/README.md explains the pattern, and why re-running is expected to be safe.`,
      );
      process.exit(2);
    }
  }

  console.log("[migrate] done");
}

main();
