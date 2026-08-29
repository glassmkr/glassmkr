-- 033_servers_machine_id.sql
--
-- Fleet auto-onboard: a stable, machine-derived identity so that re-running a
-- provisioning script (Ansible / cloud-init / post-install) self-heals to the
-- SAME server row instead of minting a duplicate that burns the node quota.
--
-- machine_id is the agent's chosen canonical identity, in preference order:
--   1. DMI product UUID (/sys/class/dmi/id/product_uuid) - survives an OS
--      reinstall on bare metal, which is our primary target.
--   2. /etc/machine-id - systemd's stable per-install id; regenerated on a
--      proper clone, so it also disambiguates VMs when a product UUID is
--      absent or vendor-duplicated.
-- The agent validates/rejects known-bogus firmware UUIDs before sending.
--
-- Written only by the enroll path (POST /api/v1/servers). Ingest does NOT
-- write this column, so a duplicate/bogus machine_id can never break telemetry
-- for an already-registered host.
--
-- No backfill: existing rows keep machine_id = NULL and behave exactly as
-- before (the create path still works without a machine_id; it just isn't
-- re-run-idempotent, same as today).

BEGIN;

ALTER TABLE servers
  ADD COLUMN IF NOT EXISTS machine_id TEXT;

COMMENT ON COLUMN servers.machine_id IS
  'Stable machine-derived identity (DMI product_uuid or /etc/machine-id) used to make fleet re-provisioning idempotent. Written by the enroll path only; NULL for pre-enroll / manually-created rows.';

-- One live server per (customer, machine). DELETE is a hard delete, so there
-- is no soft-deleted row to collide with; the predicate only excludes the
-- NULL-machine_id rows (pre-enroll / UI-created servers) from the constraint.
CREATE UNIQUE INDEX IF NOT EXISTS servers_customer_machine_id_uniq
  ON servers (customer_id, machine_id)
  WHERE machine_id IS NOT NULL;

INSERT INTO schema_migrations (version, name) VALUES
  (33, '033_servers_machine_id')
ON CONFLICT (version) DO NOTHING;

COMMIT;
