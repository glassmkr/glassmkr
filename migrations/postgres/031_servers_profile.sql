-- 031_servers_profile.sql
--
-- Host-type profile for context-aware alert suppression. A server can be
-- tagged with a profile (e.g. 'marketplace_gpu') whose expected-by-design
-- rules are suppressed at evaluation time, the same way muted_rules are but
-- sourced from the profile instead of a per-server manual list. The
-- profile -> suppressed-rules map lives in
-- apps/dashboard/src/lib/server/alerts/host-profiles.ts. The suppression
-- union happens in ingest; servers.muted_rules and the GET /mutes endpoint
-- are unchanged (they remain the manual list).
--
-- From the 20-box GPU fleet remediation report (rec #2): roughly half the
-- alert volume on a marketplace GPU host (no_firewall,
-- unattended_upgrades_disabled, gpu_power_cap_throttling) fires because of
-- required marketplace config, not a problem.
--
-- No backfill: every server starts with profile = NULL (unchanged behavior).

BEGIN;

ALTER TABLE servers
  ADD COLUMN IF NOT EXISTS profile TEXT;

COMMENT ON COLUMN servers.profile IS
  'Host-type profile (e.g. marketplace_gpu) whose expected-by-design rules are suppressed at evaluation time, sourced from host-profiles.ts. NULL = no profile (default).';

INSERT INTO schema_migrations (version, name) VALUES
  (31, '031_servers_profile')
ON CONFLICT (version) DO NOTHING;

COMMIT;
