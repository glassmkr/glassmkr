-- 038_mcp_oauth_scopes_phase2.sql
--
-- Widen the MCP OAuth scopes CHECK constraints to the full Phase 2 scope set.
--
-- 036 shipped mcp_oauth_authorization_requests.scopes and mcp_oauth_grants.scopes
-- constrained to a subset of {glassmkr:read} (the read-only foundation). Phase 2
-- added write and admin scopes everywhere else (feature flags, discovery
-- metadata, the consent screen, the tools), but this data-layer check was never
-- widened. Any authorization request or grant that includes glassmkr:write or
-- glassmkr:admin therefore violates the check constraint, and the authorize
-- endpoint returns 500. A client that requests the full advertised scope set
-- (for example Claude Code's native MCP client) cannot connect at all.
--
-- This drops the narrow read-only-only CHECK on both columns and replaces it
-- with one that permits read, write, and admin. The cardinality (1..3) check is
-- already correct and is left in place. The application layer continues to
-- flag-gate which scopes are actually grantable, so this widened check is a
-- safe superset, not a policy change.
--
-- The narrow constraint is dropped by discovered name (Postgres auto-named the
-- two anonymous CHECKs on each column), so this does not depend on a specific
-- generated name.
--
-- NO-COLUMN-DELTA: alters CHECK constraints only (no column add/drop), so the migrate
-- runner's column-inventory fingerprint is unchanged by design. This is a real
-- schema change the column-only fingerprint cannot observe, not a silent
-- IF-guard match.

BEGIN;

DO $$
DECLARE
  narrow_name text;
BEGIN
  -- mcp_oauth_authorization_requests: drop the narrow read-only-only CHECK
  SELECT conname INTO narrow_name
  FROM pg_constraint
  WHERE conrelid = 'mcp_oauth_authorization_requests'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%glassmkr:read%'
    AND pg_get_constraintdef(oid) NOT ILIKE '%glassmkr:write%';
  IF narrow_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE mcp_oauth_authorization_requests DROP CONSTRAINT %I', narrow_name);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'mcp_oauth_authorization_requests'::regclass
      AND conname = 'mcp_oauth_authorization_requests_scopes_allowed'
  ) THEN
    ALTER TABLE mcp_oauth_authorization_requests
      ADD CONSTRAINT mcp_oauth_authorization_requests_scopes_allowed
      CHECK (scopes <@ ARRAY['glassmkr:read', 'glassmkr:write', 'glassmkr:admin']::text[]);
  END IF;

  -- mcp_oauth_grants: same widening
  SELECT conname INTO narrow_name
  FROM pg_constraint
  WHERE conrelid = 'mcp_oauth_grants'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%glassmkr:read%'
    AND pg_get_constraintdef(oid) NOT ILIKE '%glassmkr:write%';
  IF narrow_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE mcp_oauth_grants DROP CONSTRAINT %I', narrow_name);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'mcp_oauth_grants'::regclass
      AND conname = 'mcp_oauth_grants_scopes_allowed'
  ) THEN
    ALTER TABLE mcp_oauth_grants
      ADD CONSTRAINT mcp_oauth_grants_scopes_allowed
      CHECK (scopes <@ ARRAY['glassmkr:read', 'glassmkr:write', 'glassmkr:admin']::text[]);
  END IF;
END$$;

INSERT INTO schema_migrations (version, name) VALUES
  (38, '038_mcp_oauth_scopes_phase2')
ON CONFLICT (version) DO NOTHING;

COMMIT;
