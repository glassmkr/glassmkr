-- 023_servers_gpu_count.sql
--
-- Persist `gpu_count` from snapshot ingest onto the servers row so the
-- fleet view (`GET /api/v1/servers`) can render a `GPU` badge on each
-- card without an n+1 fetch into ClickHouse for the latest snapshot
-- blob. Parallel to the `ipmi_sensors_count` column added in migration
-- 012 — same denormalisation pattern, same write path.
--
-- 0 = no GPUs detected (snap.gpu.tier1.available was false or absent),
-- which is also the default for pre-Crucible-0.13.0 agents that don't
-- emit `snap.gpu` at all. Non-NULL > 0 means the most recent snapshot
-- saw `snap.gpu.tier1.gpus.length` GPUs.
--
-- No backfill written — natural snapshot ingest populates within one
-- collection cycle. NULL during the transition is treated as "no GPU
-- badge" by the dashboard which is the safe rendering default.
--
-- Indexes: none added. The column is SELECTed alongside the other
-- denormalised hardware fields; no filtering or joins on it.

BEGIN;

ALTER TABLE servers
  ADD COLUMN IF NOT EXISTS gpu_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN servers.gpu_count IS
  'Number of GPUs reported by the most recent snapshot (snap.gpu.tier1.gpus.length when available, else 0). Denormalised from the snapshot blob so the fleet list can render a GPU badge without an n+1 ClickHouse fetch.';

INSERT INTO schema_migrations (version, name) VALUES
  (23, '023_servers_gpu_count')
ON CONFLICT (version) DO NOTHING;

COMMIT;
