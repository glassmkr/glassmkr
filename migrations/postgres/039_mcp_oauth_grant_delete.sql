-- 039_mcp_oauth_grant_delete.sql
--
-- Grant DELETE on the reaped MCP OAuth tables to the app role.
--
-- 036 granted the `agent` role SELECT/INSERT/UPDATE on the mcp_oauth_* tables
-- but not DELETE. The retention cron (reapExpiredMcpOAuthRows) DELETEs expired
-- rows from four of them, so it has been failing on prod with
-- "permission denied for table mcp_oauth_authorization_requests" and expired
-- authorization requests, codes, and tokens never get cleaned up. Grant DELETE
-- on exactly the four tables the reap touches.
--
-- NO-COLUMN-DELTA: grant-only change (no column add/drop), so the migrate runner's
-- column-inventory fingerprint is unchanged by design. Not a silent IF-guard
-- match.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent') THEN
    GRANT DELETE ON
      mcp_oauth_authorization_requests,
      mcp_oauth_authorization_codes,
      mcp_oauth_access_tokens,
      mcp_oauth_refresh_tokens
    TO agent;
  END IF;
END$$;

INSERT INTO schema_migrations (version, name) VALUES
  (39, '039_mcp_oauth_grant_delete')
ON CONFLICT (version) DO NOTHING;

COMMIT;
