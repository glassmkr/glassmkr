-- NO-COLUMN-DELTA: grants table privileges only, so the column inventory is
-- unchanged by design. Declared after the first from-scratch run
-- (self-hosting, 2026-08-25) stopped here.
--
-- Fix-up migration: grants the `agent` role the table privileges that
-- migration 018 forgot, so the Forge process (which connects as
-- `agent`) can SELECT/INSERT/UPDATE on `trend_warning_evaluations`.
--
-- Symptom that surfaced this: `/api/v1/trend-warnings/evaluations`
-- returned HTTP 500 with `permission denied for table
-- trend_warning_evaluations` in the Forge journal (2026-05-14 09:38
-- UTC, CC_VERIFY_OVERNIGHT_2026-05-14.md section 2 + follow-up
-- diagnosis).
--
-- Root cause: migration 018 ran as the postgres superuser and created
-- the table owned by postgres. Sibling tables in this database
-- (`servers`, `active_alerts`, `trend_warnings`,
-- `trend_warning_metrics_snapshot`) all have either agent ownership or
-- an explicit grant; the privilege probe via
-- `has_table_privilege('agent', '<table>', 'SELECT')` returned `t` for
-- the siblings and `f` for `trend_warning_evaluations`.
--
-- Apply with:
--   sudo -u postgres psql -d guardian -f migrations/postgres/019_trend_warning_evaluations_grants.sql
--
-- Idempotent: GRANTs are no-ops if already granted. ON CONFLICT on the
-- schema_migrations insert. Safe to re-run.
--
-- After apply, the next call to /api/v1/trend-warnings/evaluations
-- returns 200 with the aggregated counters (empty until the next batch
-- runs at 12:00 / 18:00 UTC and writes the first row).
--
-- Codex F4 fix (2026-05-22): wrapped in BEGIN/COMMIT so the
-- self-registration row in schema_migrations rolls back together with
-- the rest of the migration if the verification block raises.
-- Previously, the INSERT INTO schema_migrations committed before the
-- DO-block ran; a failed RAISE EXCEPTION left a phantom-registered
-- row and the runner skipped retrying on next deploy. Now the runner
-- also enforces this pattern (scripts/migrate-postgres.mjs).

BEGIN;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.trend_warning_evaluations
  TO agent;

GRANT USAGE, SELECT
  ON SEQUENCE public.trend_warning_evaluations_id_seq
  TO agent;

INSERT INTO schema_migrations (version, name) VALUES
  (19, '019_trend_warning_evaluations_grants')
ON CONFLICT (version) DO NOTHING;

DO $$
DECLARE
  agent_select boolean;
  agent_insert boolean;
BEGIN
  SELECT
    has_table_privilege('agent', 'public.trend_warning_evaluations', 'SELECT'),
    has_table_privilege('agent', 'public.trend_warning_evaluations', 'INSERT')
  INTO agent_select, agent_insert;

  RAISE NOTICE 'migration 019: agent SELECT=%, INSERT=% on trend_warning_evaluations',
    agent_select, agent_insert;

  IF NOT agent_select OR NOT agent_insert THEN
    RAISE EXCEPTION 'migration 019 FAILED: agent role still lacks SELECT/INSERT after GRANT';
  END IF;
END$$;

COMMIT;
