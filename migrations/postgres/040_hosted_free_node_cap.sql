-- 040_hosted_free_node_cap.sql
--
-- Raise the hosted free-plan node cap from 3 to 10.
--
-- The open-source pivot settled on 10 as the hosted free cap, and every public
-- surface (pricing, FAQ, the announcement, ground-truth.yaml) states 10.
-- Production has been enforcing 3 the whole time, through the column default and
-- through effectiveServerLimit()'s fallback. Publishing the copy while the
-- product refuses the fourth node would have been a launch-day falsehood, so the
-- two are reconciled here.
--
-- The UPDATE deliberately matches only rows at 3, which is the old free default.
-- No account was ever deliberately restricted BELOW the free cap, so 3 means
-- "never customised". Accounts with any other value were set by hand (one is at
-- 50) and must keep what they were given: matching on the old default rather
-- than on "not 10" is what protects them.
--
-- RE-RUN SAFETY. The first deploy of this migration omitted the
-- schema_migrations row above, so the runner refused to record it and aborted
-- the deploy. The migration's own transaction had already committed, which is
-- the documented behaviour: a failed deploy can leave the change applied. It
-- did, so on production the default is already 10 and the six free accounts are
-- already at 10. Both statements are safe to re-run: SET DEFAULT is idempotent,
-- and the UPDATE now matches no rows because none are left at 3. That is by
-- design, not luck; a migration that had to run exactly once would have needed
-- a manual repair instead.
--
-- NO-COLUMN-DELTA: default and data change only (no column add/drop), so the
-- migrate runner's column-inventory fingerprint is unchanged by design. Not a
-- silent IF-guard match.

BEGIN;

ALTER TABLE customers ALTER COLUMN plan_server_limit SET DEFAULT 10;

UPDATE customers
   SET plan_server_limit = 10
 WHERE plan_server_limit = 3;

INSERT INTO schema_migrations (version, name) VALUES
  (40, '040_hosted_free_node_cap')
ON CONFLICT (version) DO NOTHING;

COMMIT;
