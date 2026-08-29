-- Adds a `resolution_reason` column to `trend_warnings` so the system
-- can distinguish "system reconsidered before notification"
-- (persistence-gate transient) from "real warning, then the signal
-- improved" (real warning, recovered) on the auto-resolve path.
-- Mirrors the migration 016 pattern for `active_alerts.resolution_reason`.
--
-- Apply with:
--   sudo -u postgres psql -d guardian -f migrations/postgres/017_trend_warnings_resolution_reason.sql
--
-- Motivation: TREND_WARNINGS_INVESTIGATION_2026-05-13.md surfaced that
-- the only existing trend_warnings row (gpu-1 disk_fill_imminent,
-- single-batch transient) ended up with `resolved_at` set but no
-- distinguishing reason, so "resolved" reads as "the issue was fixed"
-- when in fact "the system reconsidered." The column lets the
-- track-record card and any future resolved-warnings view surface
-- the difference honestly.
--
-- Backfill rule:
--   notified_at IS NULL → 'persistence_gate_reconsidered'
--   notified_at IS NOT NULL → 'signal_recovered'
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + UPDATE only where the new
-- column is null.

ALTER TABLE public.trend_warnings
  ADD COLUMN IF NOT EXISTS resolution_reason text;

-- Backfill existing resolved rows. The discriminator is
-- `notified_at`: a warning that never reached the 2-batch
-- notification threshold was a transient candidate; one that DID
-- reach it but later auto-resolved was a real signal that recovered.
UPDATE public.trend_warnings
SET resolution_reason = CASE
  WHEN notified_at IS NULL THEN 'persistence_gate_reconsidered'
  ELSE 'signal_recovered'
END
WHERE resolved_at IS NOT NULL
  AND resolution_reason IS NULL;

-- Record this migration as applied.
INSERT INTO schema_migrations (version, name) VALUES
  (17, '017_trend_warnings_resolution_reason')
ON CONFLICT (version) DO NOTHING;

DO $$
DECLARE
  max_version int;
  backfilled int;
BEGIN
  SELECT MAX(version) INTO max_version FROM schema_migrations;
  SELECT COUNT(*) INTO backfilled FROM public.trend_warnings
    WHERE resolved_at IS NOT NULL AND resolution_reason IS NOT NULL;
  RAISE NOTICE 'migration 017: trend_warnings.resolution_reason added; backfilled % resolved rows; highest version = %',
    backfilled, max_version;
END$$;
