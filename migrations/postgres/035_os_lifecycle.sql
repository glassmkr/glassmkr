-- 035_os_lifecycle.sql
--
-- Backing store for the os_end_of_life alert rule (currency-monitoring
-- milestone, CC_CURRENCY_BUILD_DECISION_2026-07-15). A server-side cron
-- (apps/dashboard/src/lib/server/endoflife/) syncs OS lifecycle dates from the
-- endoflife.date v1 API into this table daily; the dashboard loads it into an
-- in-memory cache on startup so the synchronous evaluator can look up a host's
-- OS EOL date at ingest time without a DB round-trip.
--
-- We chose server-side sync over a build-time bundled snapshot because the v1
-- API is self-described Beta and the data changes continuously (one place to
-- fix on drift), and because keeping the data in our own store rather than
-- committing it in-repo keeps the CC-BY-SA (endoflife.date data license)
-- posture clean. Only lifecycle dates (facts) are stored, not descriptive prose.
--
-- Keyed by (product slug, cycle). eol_from = standard security-support end;
-- eoes_from = extended-support end (Ubuntu ESM / RHEL ELS), nullable.

BEGIN;

CREATE TABLE IF NOT EXISTS os_lifecycle (
  product    TEXT        NOT NULL,
  cycle      TEXT        NOT NULL,
  label      TEXT,
  eol_from   DATE,
  eoes_from  DATE,
  is_lts     BOOLEAN     NOT NULL DEFAULT false,
  synced_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (product, cycle)
);

COMMENT ON TABLE os_lifecycle IS
  'OS lifecycle dates synced from endoflife.date (CC BY-SA). Backs the os_end_of_life rule. Refreshed daily by apps/dashboard/src/lib/server/endoflife/.';

INSERT INTO schema_migrations (version, name) VALUES
  (35, '035_os_lifecycle')
ON CONFLICT (version) DO NOTHING;

COMMIT;
