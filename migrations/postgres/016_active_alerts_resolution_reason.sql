-- Adds a `resolution_reason` column to `active_alerts` so the system can
-- record WHY an alert was resolved (auto-decay, operator action, etc.) and
-- preserve that context in the resolved-alerts history view.
--
-- Apply with:
--   sudo -u postgres psql -d guardian -f migrations/postgres/016_active_alerts_resolution_reason.sql
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + ON CONFLICT DO NOTHING on the
-- schema_migrations row.
--
-- Motivation: workstream B PR A. The unexpected_reboot rule was short-
-- circuiting on `hasActiveRebootAlert` forever, so once an alert fired it
-- never resolved without operator action. This column lets the ingest
-- path auto-resolve stale reboot alerts after 24h of stable uptime (or a
-- per-server-overridden threshold) and tag the reason so operators can
-- distinguish auto-decay from manual resolution.

ALTER TABLE public.active_alerts
  ADD COLUMN IF NOT EXISTS resolution_reason text;

-- Record this migration as applied. The 015 migration backfilled the
-- earlier rows; new migrations append their own row here.
INSERT INTO schema_migrations (version, name) VALUES
  (16, '016_active_alerts_resolution_reason')
ON CONFLICT (version) DO NOTHING;

DO $$
DECLARE
  max_version int;
BEGIN
  SELECT MAX(version) INTO max_version FROM schema_migrations;
  RAISE NOTICE 'migration 016: resolution_reason column added; highest version = %', max_version;
END$$;
