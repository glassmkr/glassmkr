-- 003_snapshot_thermal.sql
--
-- Add thermal column to the ClickHouse snapshots table so the dashboard
-- can chart CPU temperature over time. Crucible has sent snap.thermal
-- (hwmon-derived CPU temps; Crucible 0.8.0+) all along, and the evaluator
-- uses it for the cpu_temperature_high rule, but the ingest writer never
-- persisted it, so there was no time-series to chart. Stores the whole
-- snap.thermal object (available + source + max_cpu_celsius + readings) as
-- a JSON string, mirroring how gpu / ipmi / zfs / other complex fields are
-- stored.
--
-- Storage shape: String DEFAULT '{}' matches the existing complex-field
-- pattern. The metrics endpoint argMax()es the latest blob per time bucket
-- and JSON.parse()s out max_cpu_celsius for the chart.
--
-- Backfill: none. History accrues forward from the deploy that applies
-- this; pre-existing rows keep the '{}' sentinel (treated as "no thermal
-- data"), identical to how the gpu column behaved at 002.

ALTER TABLE snapshots
  ADD COLUMN IF NOT EXISTS thermal String DEFAULT '{}';
