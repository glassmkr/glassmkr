#!/usr/bin/env node
//
// ClickHouse migration runner for the Glassmkr dashboard's analytics DB.
//
// Why this exists: parallels scripts/migrate-postgres.mjs. The Postgres
// runner was added 2026-05-18 after PR #135's deploy shipped code that
// read columns added by an unapplied migration, causing a 15h fleet-wide
// ingest outage. Same shape of risk applies to ClickHouse: PR #177 adds
// a `gpu` column on snapshots that the new lifecycle.ts writes; without
// the ALTER applied, every snapshot insert fails because ClickHouse
// rejects unknown column names.
//
// Behavior:
//   1. List `migrations/clickhouse/*.sql` sorted by numeric prefix.
//   2. Apply every file in order via `clickhouse-client --queries-file`.
//      ClickHouse migrations are intentionally simpler than Postgres
//      ones — every statement uses `IF NOT EXISTS` / `IF EXISTS` and
//      is idempotent, so re-running on every deploy is a no-op.
//
// No schema_migrations table: ClickHouse's idempotent ALTERs make
// version tracking unnecessary at this scale. If a future migration
// can't be expressed idempotently, switch to a tracking table then.
//
// Environment:
//   GMK_CH_DATABASE     Database name. Defaults to "dashboard".
//   GMK_CH_HOST         Host. Defaults to "localhost".
//   GMK_CH_USER         User. Defaults to "default".
//   GMK_CH_PASSWORD     Password. Defaults empty.
//   GMK_MIGRATIONS_DIR  Path. Defaults to `migrations/clickhouse`
//                       relative to repo root.
//   GMK_CH_CLIENT       Optional override for the clickhouse-client
//                       binary path (e.g. running inside Docker).

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(here, "..");

// Accept the same env var names that the running dashboard service reads
// from /etc/glassmkr/dashboard.env (CLICKHOUSE_*), so deploy.sh can source
// that file and migrations land on the same DB the writer targets. The
// GMK_CH_* names take precedence for explicit overrides. The "dashboard"
// fallback exists for local-dev convenience only; prod sets these from
// dashboard.env (where CLICKHOUSE_DATABASE=glassmkr). Without this
// alignment the migration silently no-ops against the wrong DB, exactly
// the failure mode that hid PR #177 from prod for ~9h.
const DB =
  process.env.GMK_CH_DATABASE ?? process.env.CLICKHOUSE_DATABASE ?? "dashboard";
const HOST =
  process.env.GMK_CH_HOST ?? process.env.CLICKHOUSE_HOST ?? "localhost";
const USER = process.env.GMK_CH_USER ?? process.env.CLICKHOUSE_USER ?? "default";
const PASSWORD =
  process.env.GMK_CH_PASSWORD ?? process.env.CLICKHOUSE_PASSWORD ?? "";
const CLIENT = process.env.GMK_CH_CLIENT ?? "clickhouse-client";
const MIGRATIONS_DIR =
  process.env.GMK_MIGRATIONS_DIR ?? join(repoRoot, "migrations/clickhouse");

function clientArgs() {
  const args = ["--host", HOST, "--database", DB, "--user", USER];
  if (PASSWORD) args.push("--password", PASSWORD);
  return args;
}

function listMigrations() {
  if (!existsSync(MIGRATIONS_DIR)) {
    console.error(`[migrate-clickhouse] No migrations dir at ${MIGRATIONS_DIR}`);
    return [];
  }
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // numeric prefix sorts correctly
}

// Compact fingerprint of the configured ClickHouse database: every
// (table, column, type). Used by the silent-no-op detector below.
// Closes the failure mode that hid PR #177's `gpu` column landing for
// ~9h: the runner defaulted to DB=dashboard while prod's DB is named
// `glassmkr`, so every ALTER ran against an empty/different DB and
// the deploy's verification step had no signal that things were wrong.
function fetchSchemaFingerprint() {
  const out = execFileSync(
    CLIENT,
    [
      ...clientArgs(),
      "--query",
      `SELECT concat(table, '.', name, ':', type) FROM system.columns
       WHERE database = '${DB.replace(/'/g, "''")}' ORDER BY table, name FORMAT TabSeparated`,
    ],
    { encoding: "utf8" },
  );
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .sort()
    .join("\n");
}

// A migration .sql file may declare itself a deliberate no-op by
// including a `-- SAFE-NOOP: <reason>` comment anywhere in the file.
function isSafeNoopDeclared(file) {
  const path = join(MIGRATIONS_DIR, file);
  const sql = readFileSync(path, "utf8");
  const m = sql.match(/--\s*SAFE-NOOP:\s*(.+)$/im);
  return m ? m[1].trim() : null;
}

function applyMigration(file) {
  const path = join(MIGRATIONS_DIR, file);
  const sql = readFileSync(path, "utf8");
  // Pipe SQL via stdin to clickhouse-client. The --multiquery flag
  // lets a single file contain multiple statements; ClickHouse parses
  // them as a batch.
  try {
    execFileSync(CLIENT, [...clientArgs(), "--multiquery"], {
      input: sql,
      stdio: ["pipe", "inherit", "inherit"],
    });
    console.log(`[migrate-clickhouse] applied ${file}`);
  } catch (err) {
    console.error(`[migrate-clickhouse] FAILED ${file}: ${err.message}`);
    throw err;
  }
}

const files = listMigrations();
if (files.length === 0) {
  console.log("[migrate-clickhouse] no migrations to apply");
  process.exit(0);
}

// Schema-fingerprint check operates at the batch level, not per-
// migration. The per-migration variant shipped in PR #184 was
// incompatible with this runner's design intent: ClickHouse
// migrations are deliberately idempotent and re-run on every deploy
// (no tracking table, every statement uses IF NOT EXISTS / IF EXISTS).
// Every deploy after the first against an already-up-to-date prod
// would have every individual migration be a legitimate no-op, which
// the per-migration check incorrectly flagged as the silent-no-op
// bug class. That broke prod deploy on 2026-05-21 starting with the
// PR #184 merge; this revision moves the check to batch granularity.
//
// Batch-level signal: log whether anything changed. We don't fail on
// unchanged-fingerprint because that's the steady-state of an
// idempotent runner on a synced prod. The "wrong DB" defense for CH
// moves to the deploy.sh /api/v1/health post-restart probe.
//
// Proper future fix: introduce a `schema_migrations_clickhouse`
// tracking table mirroring the Postgres pattern. Then only genuinely-
// new CH migrations get applied + checked. Filed as follow-up to
// GLASSMKR_NEXT_UP_QUEUE_2026-05-21.md §1.
const before = fetchSchemaFingerprint();
console.log(`[migrate-clickhouse] ${files.length} migration(s) found`);
let anySafeNoop = false;
for (const f of files) {
  if (isSafeNoopDeclared(f)) anySafeNoop = true;
  applyMigration(f);
}
const after = fetchSchemaFingerprint();
if (before === after) {
  console.log(
    `[migrate-clickhouse] batch was a no-op against database '${DB}'; ` +
      (anySafeNoop
        ? `at least one migration declared SAFE-NOOP — expected.`
        : `expected when all migrations have already been applied (CH design intent is idempotent re-run).`),
  );
} else {
  console.log(`[migrate-clickhouse] schema changed during batch — at least one migration landed new state.`);
}
console.log(`[migrate-clickhouse] up to date (latest applied: ${files[files.length - 1]})`);
