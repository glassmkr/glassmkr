-- 028_servers_observed_interval.sql
--
-- Persist the agent's MEASURED snapshot cadence onto the servers row so
-- the server_unreachable watchdog can scale its threshold to the host's
-- real reporting interval.
--
-- Why: the agent never tells the dashboard its configured interval (the
-- snapshot payload has no interval field), so the watchdog falls back to
-- `config_overrides.interval_seconds` (operator-set, rarely present) or
-- the 300s default. Found during the 2026-06 CentOS validation campaign:
-- a host reporting every 60s was only flagged unreachable after ~12
-- minutes (2 x 300s threshold + 2-minute scheduler tick) instead of the
-- ~2-4 minutes its real cadence justifies.
--
-- Ingest computes the value as the gap between consecutive snapshots,
-- bounded to [10 seconds, 1 hour] (the agent config allows 60..3600), so
-- outage gaps and burst re-posts do not poison it; a single in-window
-- outlier self-heals on the next snapshot. NULL = not yet measured
-- (fewer than two snapshots since this migration); the watchdog then
-- keeps today's behavior.
--
-- No backfill: natural ingest populates within two collection cycles.
-- Indexes: none; the column is SELECTed by the watchdog, never filtered.

BEGIN;

ALTER TABLE servers
  ADD COLUMN IF NOT EXISTS observed_interval_seconds INTEGER;

COMMENT ON COLUMN servers.observed_interval_seconds IS
  'Measured gap in seconds between the two most recent snapshots (bounded 10s..1h at ingest; NULL until two snapshots have arrived). The server_unreachable watchdog uses it as the effective cadence when no operator interval override is set.';

INSERT INTO schema_migrations (version, name) VALUES
  (28, '028_servers_observed_interval')
ON CONFLICT (version) DO NOTHING;

COMMIT;
