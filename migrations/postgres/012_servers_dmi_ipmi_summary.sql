-- Hardware-summary columns on servers, sourced from each ingest's
-- snap.dmi and snap.ipmi blocks.
-- Apply with: sudo -u postgres psql guardian -f migrations/postgres/012_servers_dmi_ipmi_summary.sql
-- Spec: CC_PHASE_3_A5_A6_KICKOFF.md (Phase 3 A.5 vendor/product display, A.6 IPMI badge).
--
-- Why on PG and not just the latest ClickHouse snapshot:
-- the dashboard tile is rendered from the /api/v1/servers list
-- response, which only joins PG. Per-tile n+1 /health calls would
-- need either ClickHouse SELECTs at list time (expensive) or a
-- denormalised summary on the PG row. DMI is effectively static
-- (a server's vendor and product never change without a hardware
-- swap) and IPMI sensor count changes on the order of "rarely",
-- so one cheap UPDATE per ingest is the right shape.
--
-- Field sourcing on the ingest path:
--   dmi_vendor          := snap.dmi.raw_vendor   (the verbatim
--                          /sys/class/dmi/id/sys_vendor string;
--                          normalisation to "GIGABYTE" /
--                          "Supermicro" / etc. happens at render time
--                          via lib/utils/vendor.ts so we can adjust
--                          the canonical-name table without a backfill)
--   dmi_product         := snap.dmi.product_name
--   ipmi_sensors_count  := snap.ipmi.sensors.length
--
-- dmi_serial is intentionally not added: Crucible's DmiInfo type
-- doesn't currently expose product_serial. If a future Crucible
-- release exports it, a follow-up migration adds the column.

ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS dmi_vendor TEXT,
  ADD COLUMN IF NOT EXISTS dmi_product TEXT,
  ADD COLUMN IF NOT EXISTS ipmi_sensors_count INTEGER NOT NULL DEFAULT 0;
