-- NO-COLUMN-DELTA: rewrites override keys inside existing configuration rows, so
-- it changes data rather than the column inventory. Declared after the first
-- from-scratch run (self-hosting, 2026-08-25) stopped here; on the hosted
-- deployment this migration was applied by hand and never met the guard.
--
-- Phase 7 P1: rename existing per-server ECC override field from the
-- cumulative-threshold semantic (legacy) to the rate-window semantic
-- (glassmkr#24). The rule was redesigned to evaluate over a rolling
-- window (default 24h) instead of against a cumulative counter; this
-- migration renames the override key so existing customer
-- configuration carries forward without manual intervention.
--
-- Apply with: sudo -u postgres psql -d guardian -f migrations/postgres/014_ecc_rate_based_overrides.sql
--
-- Backward compatibility: even after this migration, the evaluator
-- still reads `ecc_correctable_warning` as a fallback if no new key
-- is present (see evaluator.ts evaluateEccErrors). The migration
-- moves every customer to the new key proactively so the legacy
-- fallback is purely a safety net.
--
-- Idempotent: re-running the migration is a no-op because the
-- predicate `config_overrides ? 'ecc_correctable_warning'` is false
-- after the first run. Safe to apply repeatedly.

UPDATE servers
SET config_overrides = jsonb_set(
  config_overrides - 'ecc_correctable_warning',
  '{ecc_correctable_rate_warning}',
  config_overrides->'ecc_correctable_warning'
)
WHERE config_overrides ? 'ecc_correctable_warning';

-- Sanity probe: this row count tells the operator running the
-- migration how many overrides got renamed. Zero is expected on a
-- fresh installation or any deployment where the prior cumulative-
-- threshold workaround was never used (which matches Glassmkr prod
-- at 2026-05-12 deploy time).
DO $$
DECLARE
  renamed_count int;
BEGIN
  SELECT COUNT(*) INTO renamed_count
    FROM servers
    WHERE config_overrides ? 'ecc_correctable_rate_warning';
  RAISE NOTICE 'migration 014: % server(s) now have ecc_correctable_rate_warning set', renamed_count;
END$$;
