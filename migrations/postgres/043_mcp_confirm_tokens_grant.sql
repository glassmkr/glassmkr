-- 043_mcp_confirm_tokens_grant.sql
--
-- Grant the app role access to mcp_confirm_tokens.
--
-- 042 created public.mcp_confirm_tokens but granted the `agent` app role
-- nothing on it. On the prod two-role model the app connects as `agent`, which
-- holds only privileges granted explicitly per table, so every
-- consumeConfirmTokenOn INSERT failed with "permission denied for table
-- mcp_confirm_tokens". That broke every MCP destructive action's single-use
-- check at consume time: glassmkr.admin.enroll_server (and delete/rotate)
-- returned a generic INTERNAL_ERROR while glassmkr.admin.prepare, which never
-- writes, succeeded. The test suite used an in-memory fake with no role model,
-- so it never saw the missing grant.
--
-- consumeConfirmTokenOn does INSERT ... ON CONFLICT DO NOTHING RETURNING (the
-- single-use check) and a periodic DELETE of expired rows. Grant INSERT and
-- DELETE; SELECT is included so ad-hoc operator inspection and any future read
-- path work without a second grant migration. Same role-guarded shape as 039,
-- so it is a no-op on a single-role self-hosted database where `agent` does
-- not exist.
--
-- NO-COLUMN-DELTA: grant-only change (no column add/drop), so the migrate
-- runner's column-inventory fingerprint is unchanged by design. Not a silent
-- IF-guard match.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent') THEN
    GRANT SELECT, INSERT, DELETE ON public.mcp_confirm_tokens TO agent;
  END IF;
END$$;

INSERT INTO schema_migrations (version, name) VALUES
  (43, '043_mcp_confirm_tokens_grant')
ON CONFLICT (version) DO NOTHING;

COMMIT;
