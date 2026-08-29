-- unify-auth Spec D: atomic drop of three legacy auth columns.
--
-- Closes the schema cleanup tail of CC_UNIFY_API_AUTH_2026-05-15.md.
-- After Phase B (PR #109, hierarchical-scope free-tier restriction) +
-- the Phase-B follow-up (PR #110, 11-route Principal refactor) +
-- Phase C (PR #111, frontend reflects the capability change), three
-- columns remain in the schema with no live consumers:
--
--   customers.api_token_hash
--     The legacy "Dashboard API Token" feature wrote a single bcrypt
--     hash per customer here. PR #104 removed the UI + endpoints
--     (audit retrospective F5); no auth path has read this column
--     since A4 of the 2026-05-15 rename cutover removed the legacy
--     `forge_*` token validator. One stale row remains in prod
--     (simon@glassmkr.com, audit run 2026-05-16) — DROP discards it.
--
--   account_api_keys.scopes
--     The legacy jsonb v1-scope array (`["servers:manage"]`).
--     Superseded by the hierarchical `scope` text column added in
--     migration 013. No code path that read `scopes` survived
--     PR #109's `requireScopeLevel` rollout; PR #110 finished the
--     last 11 routes. POST/INSERT writes the column today only
--     because the DEFAULT clause lets us delay the handler edit;
--     PR #114 (this PR) removes the handler-side writes
--     simultaneously.
--
--   account_api_keys.allowed_ips
--     Defined by migration 006 with `DEFAULT '[]'::jsonb` and never
--     referenced anywhere else in the codebase. Confirmed vestigial
--     via repo-wide grep on 2026-05-16: zero read paths, zero write
--     paths. Pre-migration audit returned 12/12 rows = '[]'.
--
-- Pre-condition assumptions (verified 2026-05-16 audit):
--   customers.api_token_hash:    1 of 4 rows non-NULL (stale; discarded)
--   account_api_keys.scopes:     [] for cru_keys, ["servers:manage"] for acct_keys
--   account_api_keys.allowed_ips: '[]' for all 12 rows
--
-- Deploy ordering (rolling-safe):
--   1. PR #114 merges + deploys. New code stops writing `scopes` /
--      `allowed_ips`; old `api_token_hash` paths were already
--      removed in PR #104. The DB still has all three columns;
--      INSERTs succeed via DEFAULTs.
--   2. THIS migration runs (manually, post-deploy):
--        ssh the dashboard host \
--          'sudo -u postgres psql -d guardian \
--             -f migrations/postgres/020_drop_legacy_auth_columns.sql'
--   3. Smoke test: POST /api/v1/account/keys with a session cookie,
--      confirm 201 + GET /api/v1/account/keys shows the new key.
--
-- Rollback: DROP COLUMN is irreversible without a backup-restore.
-- Pre-deploy verification (CC's 4-check audit 2026-05-16) showed no
-- unknown write paths; the only "non-vestigial" data is the one
-- stale api_token_hash hash, which is itself dead. If something does
-- break, restore the previous-day pg_dump and roll back the deploy
-- to the pre-PR-#114 SHA.
--
-- Idempotency: each DROP uses `IF EXISTS` so a partial-apply
-- recovery (re-running this file after some columns already dropped)
-- is safe. The schema_migrations INSERT uses ON CONFLICT DO NOTHING.

BEGIN;

ALTER TABLE public.customers
  DROP COLUMN IF EXISTS api_token_hash;

ALTER TABLE public.account_api_keys
  DROP COLUMN IF EXISTS scopes;

ALTER TABLE public.account_api_keys
  DROP COLUMN IF EXISTS allowed_ips;

INSERT INTO schema_migrations (version, name) VALUES
  (20, '020_drop_legacy_auth_columns')
ON CONFLICT (version) DO NOTHING;

-- Post-condition verification. Codex F4 fix (2026-05-22): moved inside
-- the BEGIN/COMMIT so a RAISE EXCEPTION rolls back the migration AND
-- the schema_migrations registration row together. Previous shape
-- (verification after COMMIT) was the same anti-pattern as 019:
-- registration committed first, then the verification raised, leaving
-- a phantom-registered version that the runner would skip on retry.
-- Uses information_schema rather than pg_attribute so the check works
-- on any role with USAGE on information_schema.
DO $$
DECLARE
  customers_has_token boolean;
  keys_has_scopes boolean;
  keys_has_ips boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'customers'
      AND column_name = 'api_token_hash'
  ) INTO customers_has_token;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'account_api_keys'
      AND column_name = 'scopes'
  ) INTO keys_has_scopes;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'account_api_keys'
      AND column_name = 'allowed_ips'
  ) INTO keys_has_ips;

  RAISE NOTICE 'migration 020: post-drop customers.api_token_hash=% account_api_keys.scopes=% account_api_keys.allowed_ips=%',
    customers_has_token, keys_has_scopes, keys_has_ips;

  IF customers_has_token OR keys_has_scopes OR keys_has_ips THEN
    RAISE EXCEPTION 'migration 020 FAILED: at least one column still exists after DROP';
  END IF;
END$$;

COMMIT;
