-- 036_mcp_oauth_foundation.sql
--
-- OAuth 2.1 authorization-code + PKCE storage for the remote MCP endpoint.
-- The current customers row is both login identity and account tenant, so this
-- first slice binds every grant to exactly one customer. A later additive
-- users/accounts/memberships migration can split the two references without
-- changing token or client identifiers.

BEGIN;

CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
  client_id                  TEXT PRIMARY KEY,
  client_name                TEXT NOT NULL CHECK (char_length(client_name) BETWEEN 1 AND 100),
  redirect_uris              TEXT[] NOT NULL CHECK (cardinality(redirect_uris) BETWEEN 1 AND 5),
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none'
    CHECK (token_endpoint_auth_method = 'none'),
  is_verified                BOOLEAN NOT NULL DEFAULT false,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at               TIMESTAMPTZ,
  disabled_at                TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS mcp_oauth_authorization_requests (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id                UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  client_id                  TEXT NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri               TEXT NOT NULL,
  scopes                     TEXT[] NOT NULL
    CHECK (cardinality(scopes) BETWEEN 1 AND 3)
    CHECK (scopes <@ ARRAY['glassmkr:read']::TEXT[]),
  state                      TEXT,
  resource                   TEXT NOT NULL,
  code_challenge             TEXT NOT NULL,
  csrf_hash                  BYTEA NOT NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at                 TIMESTAMPTZ NOT NULL,
  consumed_at                TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_authorization_requests_expiry
  ON mcp_oauth_authorization_requests (expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS mcp_oauth_grants (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id                UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  client_id                  TEXT NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
  scopes                     TEXT[] NOT NULL
    CHECK (cardinality(scopes) BETWEEN 1 AND 3)
    CHECK (scopes <@ ARRAY['glassmkr:read']::TEXT[]),
  resource                   TEXT NOT NULL,
  session_epoch_at_issue     TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at                 TIMESTAMPTZ NOT NULL,
  last_used_at               TIMESTAMPTZ,
  revoked_at                 TIMESTAMPTZ,
  revoke_reason              TEXT
);

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_grants_customer
  ON mcp_oauth_grants (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_grants_client
  ON mcp_oauth_grants (client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mcp_oauth_authorization_codes (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash                  BYTEA NOT NULL UNIQUE,
  grant_id                   UUID NOT NULL REFERENCES mcp_oauth_grants(id) ON DELETE CASCADE,
  redirect_uri               TEXT NOT NULL,
  resource                   TEXT NOT NULL,
  code_challenge             TEXT NOT NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at                 TIMESTAMPTZ NOT NULL,
  consumed_at                TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS mcp_oauth_access_tokens (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash                 BYTEA NOT NULL UNIQUE,
  grant_id                   UUID NOT NULL REFERENCES mcp_oauth_grants(id) ON DELETE CASCADE,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at                 TIMESTAMPTZ NOT NULL,
  last_used_at               TIMESTAMPTZ,
  revoked_at                 TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_access_tokens_grant
  ON mcp_oauth_access_tokens (grant_id);

CREATE TABLE IF NOT EXISTS mcp_oauth_refresh_tokens (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash                 BYTEA NOT NULL UNIQUE,
  grant_id                   UUID NOT NULL REFERENCES mcp_oauth_grants(id) ON DELETE CASCADE,
  family_id                  UUID NOT NULL,
  parent_token_id            UUID REFERENCES mcp_oauth_refresh_tokens(id) ON DELETE SET NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at                 TIMESTAMPTZ NOT NULL,
  idle_expires_at            TIMESTAMPTZ NOT NULL,
  consumed_at                TIMESTAMPTZ,
  revoked_at                 TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_refresh_tokens_grant
  ON mcp_oauth_refresh_tokens (grant_id);

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_refresh_tokens_family
  ON mcp_oauth_refresh_tokens (family_id);

ALTER TABLE api_audit_log
  ADD COLUMN IF NOT EXISTS oauth_client_id TEXT,
  ADD COLUMN IF NOT EXISTS oauth_grant_id UUID,
  ADD COLUMN IF NOT EXISTS mcp_tool TEXT,
  ADD COLUMN IF NOT EXISTS mcp_session_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_api_audit_log_oauth_grant
  ON api_audit_log (oauth_grant_id, ts DESC)
  WHERE oauth_grant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_api_audit_log_mcp_tool
  ON api_audit_log (customer_id, mcp_tool, ts DESC)
  WHERE mcp_tool IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent') THEN
    GRANT SELECT, INSERT, UPDATE ON
      mcp_oauth_clients,
      mcp_oauth_authorization_requests,
      mcp_oauth_grants,
      mcp_oauth_authorization_codes,
      mcp_oauth_access_tokens,
      mcp_oauth_refresh_tokens
    TO agent;
  END IF;
END$$;

INSERT INTO schema_migrations (version, name) VALUES
  (36, '036_mcp_oauth_foundation')
ON CONFLICT (version) DO NOTHING;

COMMIT;
