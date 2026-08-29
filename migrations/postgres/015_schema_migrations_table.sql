-- Adds a `schema_migrations` table to track which migrations have been
-- applied to the `guardian` database, so an operator can answer "what
-- schema version is this DB at" with one query instead of inspecting
-- columns. Phase A spillover from the pre-launch inventory pass.
--
-- Apply with:
--   sudo -u postgres psql -d guardian -f migrations/postgres/015_schema_migrations_table.sql
--
-- Idempotent: re-running is a no-op because of CREATE TABLE IF NOT
-- EXISTS plus the ON CONFLICT DO NOTHING on the backfill.
--
-- Backfill: every migration file currently in
-- migrations/postgres/ is recorded as applied at this migration's
-- run time. This is the cheapest correct shape — the prior
-- "no tracking" state means we don't have authoritative per-migration
-- application timestamps anyway, and any new migration ships with
-- its own INSERT to the table going forward.

CREATE TABLE IF NOT EXISTS schema_migrations (
  -- Numeric prefix from the filename, e.g. 14 from 014_ecc_*.
  version       int  PRIMARY KEY,
  -- Filename without extension, e.g. "014_ecc_rate_based_overrides".
  name          text NOT NULL,
  applied_at    timestamptz NOT NULL DEFAULT NOW()
);

-- Backfill the 15 existing migrations (001 through 015 — this row is
-- the migration recording itself). Filenames hard-coded so future
-- file renames don't silently re-backfill or leave gaps.
INSERT INTO schema_migrations (version, name) VALUES
  (1,  '001_initial'),
  (2,  '002_trend_warnings'),
  (3,  '003_disk_health_state'),
  (4,  '004_stripe_state'),
  (5,  '005_disk_health_missed_observations'),
  (6,  '006_api_keys_and_audit'),
  (7,  '007_servers_tags'),
  (8,  '008_collector_keys_to_account_keys'),
  (9,  '009_audit_log_append_only'),
  (10, '010_servers_suspended_audit'),
  (11, '011_customers_billing_enforcement_exempt'),
  (12, '012_servers_dmi_ipmi_summary'),
  (13, '013_account_keys_scopes_expiry'),
  (14, '014_ecc_rate_based_overrides'),
  (15, '015_schema_migrations_table')
ON CONFLICT (version) DO NOTHING;

-- Sanity probe: print the highest version after backfill.
DO $$
DECLARE
  max_version int;
BEGIN
  SELECT MAX(version) INTO max_version FROM schema_migrations;
  RAISE NOTICE 'migration 015: schema_migrations table populated; highest version = %', max_version;
END$$;
