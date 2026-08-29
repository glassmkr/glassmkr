-- Disk health: don't delete a row on a single missing observation.
-- Crucible's per-device smartctl probe can fail transiently; under the
-- pre-existing logic that kicked in at the first miss, an existing
-- failing/broken row would disappear on one bad probe and the dashboard
-- rollup would clear. Codex review 2026-05-05 flagged this.
--
-- Track consecutive missed observations and only delete after a
-- threshold is reached (3 misses, ~15 min at 5-min cadence).
--
-- Apply with: psql -U agent -d guardian -f migrations/postgres/005_disk_health_missed_observations.sql

ALTER TABLE public.disk_health_state
  ADD COLUMN IF NOT EXISTS missed_observations integer NOT NULL DEFAULT 0;
