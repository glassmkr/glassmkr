-- 006_snapshot_chassis.sql
--
-- Add a chassis column to the ClickHouse snapshots table so chassis power
-- provenance is persisted rather than discarded at ingest.
--
-- Crucible 0.15.0+ sends snap.chassis: the decoded `Last Power Event` bit set,
-- `restart_cause` (numeric code plus the raw vendor string), the power-restore
-- policy, and the present-tense chassis fault booleans. It feeds the reboot
-- root-cause rollup, which needs a HISTORY of these values rather than only the
-- current one, because the question is always about a previous boot.
--
-- Why this migration is required and passthrough was not enough: the ingest
-- writer builds a NAMED-COLUMN row, so a new top-level snapshot object is
-- silently dropped no matter what the Zod schema allows. That was confirmed
-- empirically on 2026-08-01, where a canary agent pushed successfully and the
-- field was simply absent downstream.
--
-- Storage shape: String DEFAULT '{}' matches the existing complex-field pattern
-- used by gpu (002), thermal (003) and memory_topology (005). The whole object
-- is stored as a JSON string.
--
-- Backfill: none. History accrues forward from the deploy that applies this;
-- pre-existing rows keep the '{}' sentinel, meaning "no chassis data", exactly
-- as gpu and thermal behaved at 002 and 003.
--
-- NOT a constraint-only change: it adds a real column, so it does not trip the
-- migrate runner's NO-COLUMN-DELTA guard.

ALTER TABLE snapshots
  ADD COLUMN IF NOT EXISTS chassis String DEFAULT '{}';
