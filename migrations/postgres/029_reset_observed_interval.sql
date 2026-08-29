-- 029_reset_observed_interval.sql
--
-- One-time data reset of servers.observed_interval_seconds (added in 028).
--
-- Incident (2026-06-11, ~17:19Z): rolling Crucible 0.13.10 onto the two
-- 300s-interval production hosts restarted the agent, and a restarted agent
-- collects immediately on startup. The short gap between the old agent's
-- last push and the new agent's startup push (15..90s) was recorded as the
-- host's observed cadence, the server_unreachable threshold collapsed from
-- 10 minutes to ~3, and the watchdog fired a false P0 on both hosts inside
-- their normal 300s quiet period (auto-resolved on the next regular push).
--
-- The companion ingest change clamps how far a single sample can move the
-- observed cadence (raise <= 1.5x, lower >= 0.75x per snapshot), which
-- prevents the poisoning going forward but converges slowly FROM an
-- already-poisoned value, with more false fires on the way up. Resetting to
-- NULL sidesteps that: the watchdog falls back to the safe pre-028 behavior
-- (config override or the 300s default) until ingest relearns the cadence
-- from the next snapshot gap, which takes one collection cycle.
--
-- NO-COLUMN-DELTA: data-only migration; the public-schema column inventory is
-- unchanged, so the runner's silent-no-op guard would otherwise abort the
-- deploy. The DO block below proves the reset took hold.

BEGIN;

UPDATE servers SET observed_interval_seconds = NULL;

INSERT INTO schema_migrations (version, name) VALUES
  (29, '029_reset_observed_interval')
ON CONFLICT (version) DO NOTHING;

DO $$
DECLARE
  remaining integer;
BEGIN
  SELECT COUNT(*) FROM servers WHERE observed_interval_seconds IS NOT NULL INTO remaining;
  RAISE NOTICE 'migration 029: servers with non-null observed_interval_seconds after reset = %', remaining;
  IF remaining > 0 THEN
    RAISE EXCEPTION 'migration 029 FAILED: % servers still carry an observed interval', remaining;
  END IF;
END$$;

COMMIT;
