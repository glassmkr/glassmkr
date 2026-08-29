-- 021_servers_os_id.sql
--
-- Persist `os_id` / `os_id_like` / `os_version_id` from snapshot ingest
-- onto the servers row. These are the fields the deepened FIX-workflow
-- YAML library's `distro_match` patterns key on (`debian-*`, `ubuntu-*`,
-- `rhel-*`, `rocky-*`, `almalinux-*`, etc.). Without them persisted, the
-- alert card cannot select the right variant at fetch time.
--
-- Pre-this-migration, only `os_type` (varchar 20) and `os_version` (the
-- pretty-printed combo string like "Debian 12.5") were persisted; the
-- separate ID / version-ID / id-like fields needed for glob matching
-- were thrown away after ingest.
--
-- No backfill written — natural snapshot ingest cycles will populate
-- the columns within one collection interval (~5 minutes per host).
-- Servers that haven't ingested since this migration get NULL, which
-- the FIX resolver treats as "no distro constraint" and falls through
-- to each rule's `["*"]` wildcard fallback variant. Safe degradation.
--
-- Indexes: none added. These columns are SELECTed by id only (no
-- filtering, no joins). The existing `servers_pkey` covers all reads.

-- 2026-05-18 follow-up: this file was originally checked in WITHOUT
-- the `INSERT INTO schema_migrations` row that the convention since
-- migration 015 requires. Combined with no automated runner, the
-- deploy of PR #135 (which reads these columns) shipped against a
-- prod DB still at version 20; every snapshot ingest then failed
-- with `column "os_id" does not exist` for ~15 hours until the
-- incident was caught. The INSERT below is the convention fix; the
-- broader fix is the new `scripts/migrate-postgres.mjs` runner wired
-- into `scripts/deploy.sh` so future migrations can't be skipped at
-- deploy time.

BEGIN;

ALTER TABLE servers
  ADD COLUMN IF NOT EXISTS os_id TEXT,
  ADD COLUMN IF NOT EXISTS os_id_like TEXT,
  ADD COLUMN IF NOT EXISTS os_version_id TEXT;

COMMENT ON COLUMN servers.os_id IS
  '/etc/os-release ID field (e.g. "debian", "ubuntu", "rocky"). Persisted from snap.system.os_id at ingest time. Used by FIX-workflow variant selection.';
COMMENT ON COLUMN servers.os_id_like IS
  '/etc/os-release ID_LIKE field (e.g. "debian", "rhel fedora"). Persisted from snap.system.os_id_like at ingest time.';
COMMENT ON COLUMN servers.os_version_id IS
  '/etc/os-release VERSION_ID field (e.g. "12", "24.04", "9.6"). Persisted from snap.system.os_version_id at ingest time.';

INSERT INTO schema_migrations (version, name) VALUES
  (21, '021_servers_os_id')
ON CONFLICT (version) DO NOTHING;

COMMIT;
