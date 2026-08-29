-- 004_snapshot_ram_free.sql
--
-- Add ram_free_mb to the ClickHouse snapshots table. Crucible 0.13.12+ emits
-- memory.free_mb (MemFree from /proc/meminfo): genuinely-unused RAM, distinct
-- from MemAvailable (which counts reclaimable page cache). With total / used
-- (= total - available) / available / free, the dashboard's memory tile can
-- show a Used / Cache / Free breakdown where cache = available - free.
--
-- Idempotent ADD COLUMN IF NOT EXISTS; migrate-clickhouse runs before the new
-- writer starts (scripts/deploy.sh ordering), so no unknown-column ingest
-- break. Backfill: none. Pre-0.13.12 agents and pre-deploy rows keep the 0
-- default, which the UI treats as "no free figure" and falls back to the
-- Used / Available bar.

ALTER TABLE snapshots
  ADD COLUMN IF NOT EXISTS ram_free_mb UInt32 DEFAULT 0;
