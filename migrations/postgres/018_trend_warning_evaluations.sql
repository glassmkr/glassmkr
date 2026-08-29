-- Adds a `trend_warning_evaluations` table so the system can surface
-- the work it does even when no warnings fire. The track-record card
-- currently shows "0 0 0 0" for healthy fleets and reads as
-- brokenness; this table is the input for a "we evaluated N
-- candidates across M batches" narrative line that's honest about
-- the system's continuous evaluation.
--
-- One row per batch per customer. The batch loop in
-- `runTrendWarningsBatch()` aggregates per-customer counters as it
-- iterates servers and writes one row at the end.
--
-- Counters:
-- - `candidates_considered`: total servers evaluated for this
--   customer in this batch, INCLUDING young servers skipped per the
--   ≥7-day-age guard (Phase 3 of the UI honesty spec).
-- - `candidates_above_threshold`: servers that produced ≥1 finding
--   from `runDeterministicTriggers` (Pro) or `diskSpaceTriggers`
--   (Free).
-- - `candidates_passed_persistence`: findings that reached the
--   2-batch persistence threshold this batch.
-- - `warnings_emitted`: warnings actually notified to customer
--   channels this batch.
--
-- Apply with:
--   sudo -u postgres psql -d guardian -f migrations/postgres/018_trend_warning_evaluations.sql
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + ON CONFLICT DO NOTHING.

CREATE TABLE IF NOT EXISTS public.trend_warning_evaluations (
  id                            bigserial PRIMARY KEY,
  customer_id                   uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  evaluated_at                  timestamptz NOT NULL DEFAULT now(),
  candidates_considered         int NOT NULL DEFAULT 0,
  candidates_above_threshold    int NOT NULL DEFAULT 0,
  candidates_passed_persistence int NOT NULL DEFAULT 0,
  warnings_emitted              int NOT NULL DEFAULT 0,
  servers_skipped_young         int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_twe_customer_evaluated
  ON public.trend_warning_evaluations (customer_id, evaluated_at DESC);

-- Retention: the application reads at most 90 days. Older rows are
-- pruned by a periodic job (out of scope for this migration; if
-- table size becomes a concern, add a cron-side DELETE WHERE
-- evaluated_at < now() - INTERVAL '90 days' alongside the existing
-- pgbackrest backup cycle).

INSERT INTO schema_migrations (version, name) VALUES
  (18, '018_trend_warning_evaluations')
ON CONFLICT (version) DO NOTHING;

DO $$
DECLARE
  max_version int;
BEGIN
  SELECT MAX(version) INTO max_version FROM schema_migrations;
  RAISE NOTICE 'migration 018: trend_warning_evaluations table created; highest version = %', max_version;
END$$;
