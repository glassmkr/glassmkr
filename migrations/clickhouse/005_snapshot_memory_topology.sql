-- 005_snapshot_memory_topology.sql
--
-- Add memory_topology to the ClickHouse snapshots table. Crucible 0.13.19+
-- emits SMBIOS Type-17 DIMM topology (per-DIMM socket/channel/size/speed plus
-- the derived populated/available channel counts). The alert rule
-- (memory_channels_underpopulated) already evaluates it at ingest straight
-- off the request body; this column persists it so the server-detail Memory
-- tile can show "channels 8/16" and a downclock flag from /health.
--
-- Stored as a JSON string like disks/smart/raid (String columns, parsed back
-- in the health endpoint). Idempotent ADD COLUMN IF NOT EXISTS;
-- migrate-clickhouse runs before the new writer starts (scripts/deploy.sh
-- ordering), so no unknown-column ingest break. Backfill: none. Pre-0.13.19
-- agents and pre-deploy rows keep the '' default, which the UI treats as
-- "no topology" and hides the channels line.

ALTER TABLE snapshots
  ADD COLUMN IF NOT EXISTS memory_topology String DEFAULT '';
