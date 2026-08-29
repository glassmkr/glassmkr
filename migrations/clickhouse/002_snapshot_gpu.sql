-- 002_snapshot_gpu.sql
--
-- Add gpu column to the ClickHouse snapshots table so the dashboard
-- ingest writer can persist Crucible v0.13.0+'s snap.gpu block. The
-- column stores the whole snap.gpu object (capabilities + tier1 +
-- tier2 + tier3) as a JSON string, mirroring how ipmi / zfs / systemd
-- / other-complex-fields are stored.
--
-- Gap context: the C19 GPU collector shipped in Crucible v0.13.0
-- (2026-05-19) and the dashboard GPU panel shipped in PR #169 the
-- same day, but the dashboard ingest writer (apps/dashboard/src/lib/
-- server/ingest/lifecycle.ts) was never updated to persist snap.gpu
-- to ClickHouse. Snapshots have been arriving with the GPU block;
-- the writer silently dropped it; the server detail page's GpuPanel
-- has had no data to render.
--
-- Storage shape: String DEFAULT '{}' matches the existing
-- complex-field pattern (ipmi, zfs, systemd, etc.). The dashboard
-- /health endpoint JSON.parse()s these back to objects before
-- returning to the SPA.
--
-- Backfill: none. snap.gpu is forward-looking; pre-0.13.0 agents
-- have nothing to backfill. Hosts upgraded to 0.13.0+ will populate
-- the column on the next ingest cycle.

ALTER TABLE snapshots
  ADD COLUMN IF NOT EXISTS gpu String DEFAULT '{}';
