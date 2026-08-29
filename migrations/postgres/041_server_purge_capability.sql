-- 041_server_purge_capability.sql
--
-- Add an opt-in capability list to account API keys, and its first member:
-- servers:purge.
--
-- WHY A NEW COLUMN RATHER THAN A NEW SCOPE LEVEL
--
-- The existing `scope` column is hierarchical: read < write < admin. Adding
-- purge to that ladder would grant it to every existing admin key the moment
-- this deploys, which is exactly what must not happen. Permanently destroying a
-- server and its metrics is not "more admin", it is a different kind of
-- authority, and it has to be granted deliberately rather than inherited by
-- anyone who already holds the top tier.
--
-- So capabilities is a separate, additive list that defaults to empty. Every
-- key that exists today gets '[]' and therefore cannot purge. A key can only
-- hold servers:purge if someone asked for it at creation.
--
-- (A `scopes` jsonb array existed in early v1 carrying ["servers:manage"] and
-- was dropped by migration 020. This is not that column coming back: that one
-- was set on every key automatically, which is the property that made it
-- useless. This one is opt-in and empty by default.)
--
-- Safe to re-run: every statement is IF NOT EXISTS or DROP-then-ADD, so a second
-- pass is a no-op. Nothing is dropped or retyped, so a rollback of the code
-- leaves a harmless unused column rather than a broken table.
--
-- ORDERING NOTE: the code that SELECTs this column ships in the same change.
-- deploy.sh applies migrations before restarting services, which is why that is
-- safe; it is the ordering added after the 2026-05-18 incident, where code
-- reading columns from an unapplied migration caused a 15h ingest outage.

BEGIN;

ALTER TABLE public.account_api_keys
  ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.account_api_keys.capabilities IS
  'Opt-in capability list, additive to the hierarchical `scope` column and NOT implied by it. Defaults to [] so existing keys inherit nothing. First member: servers:purge, required by DELETE /api/v1/trashed-servers/{id}.';

-- A key cannot hold a capability without at least write level. Purge is a
-- destructive write; a read key holding it would be incoherent. Enforced in the
-- database so it cannot be bypassed by a future code path that forgets.
ALTER TABLE public.account_api_keys
  DROP CONSTRAINT IF EXISTS account_api_keys_capabilities_need_write;

ALTER TABLE public.account_api_keys
  ADD CONSTRAINT account_api_keys_capabilities_need_write
  CHECK (capabilities = '[]'::jsonb OR scope IN ('write', 'admin'))
  NOT VALID;

ALTER TABLE public.account_api_keys
  VALIDATE CONSTRAINT account_api_keys_capabilities_need_write;

INSERT INTO schema_migrations (version, name) VALUES
  (41, '041_server_purge_capability')
ON CONFLICT (version) DO NOTHING;

COMMIT;
