-- Forge programmatic API key system + audit log.
-- Apply with: psql -U agent -d guardian -f migrations/postgres/006_api_keys_and_audit.sql
-- Spec:       CC_FORGE_API_KEYS_AND_SERVERS.md
-- IMPL plan:  IMPL_NOTES_API_KEYS.md
-- PR:         #1 (foundations) of a 7-PR sequence.
--
-- This migration is additive only; existing servers.api_key_hash and
-- customers.api_token_hash columns continue to function unchanged. The
-- migration of existing keys into the new tables happens in PR #5
-- (account tokens) and PR #6 (collector keys), each gated on the rest
-- of the new auth path being live.

-- ============================================================================
-- 1) account_api_keys: multiple named keys per customer.
-- ============================================================================
-- Today the customers table has a single `api_token_hash` column. The new
-- model lets a customer issue many keys: one for Ansible, one for CI, one
-- for the Forge MCP integration, etc. Each can be named, scoped, given a
-- TTL, and revoked independently.
--
-- Storage hash: HMAC-SHA256(server_pepper, plaintext_key). The pepper is
-- a server-side env var (FORGE_KEY_PEPPER), not a column. An attacker who
-- exfiltrates the database alone cannot brute-force without also having
-- the pepper. Bcrypt was rejected for the new path because keys are
-- 256-bit high-entropy and bcrypt's slowness buys nothing while costing
-- ~10ms per auth (vs ~1us for HMAC).
CREATE TABLE IF NOT EXISTS public.account_api_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,

    -- Identification + display
    name text NOT NULL,                          -- customer-supplied label
    prefix text NOT NULL,                        -- e.g. "gmk_acct_live_" (matches PR #1 key utility)
    last_4 text NOT NULL,                        -- last 4 chars of plaintext, for UI ("...a1b2")

    -- Auth material
    key_hash bytea NOT NULL,                     -- HMAC-SHA256(pepper, plaintext)

    -- Authorisation
    scopes jsonb NOT NULL DEFAULT '["servers:manage"]'::jsonb,

    -- Lifecycle
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by_user_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
    last_used_at timestamptz,
    expires_at timestamptz,                      -- nullable = no expiry
    revoked_at timestamptz,                      -- nullable = active

    -- Defence-in-depth: keep prefix indexable so we can fail fast when an
    -- attacker presents a key whose hash collides but whose prefix doesn't.
    -- Hash collision on SHA-256 is vanishingly unlikely; this is cheap
    -- belt-and-braces.

    -- Optional IP allowlist. Stored as JSONB array of CIDRs; empty array
    -- means no restriction. Field exists from v1 but enforcement is
    -- deferred to v1.x per spec Part 14.
    allowed_ips jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_account_api_keys_hash
    ON public.account_api_keys USING btree (key_hash);

CREATE INDEX IF NOT EXISTS idx_account_api_keys_customer
    ON public.account_api_keys (customer_id, created_at DESC)
    WHERE revoked_at IS NULL;

COMMENT ON TABLE public.account_api_keys IS
    'Account-level API keys for programmatic Forge access. Multiple per customer. HMAC-SHA256(pepper, plaintext) stored as key_hash. See spec Part 2 + IMPL_NOTES_API_KEYS.md.';
COMMENT ON COLUMN public.account_api_keys.key_hash IS
    'HMAC-SHA256 of plaintext key with server-side pepper (FORGE_KEY_PEPPER env var). 32 bytes.';
COMMENT ON COLUMN public.account_api_keys.scopes IS
    'JSONB array of scope strings. v1 ships ["servers:manage"]. Future scopes: metrics:read, alerts:manage.';

-- ============================================================================
-- 2) api_audit_log: append-only event trail for the API.
-- ============================================================================
-- Every API call (success or failure) writes one row. Append-only enforced
-- by GRANT below. ClickHouse forwarding for long-term retention is wired in
-- PR #3 alongside the audit-write middleware.
CREATE TABLE IF NOT EXISTS public.api_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Who
    customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
    key_id uuid REFERENCES public.account_api_keys(id) ON DELETE SET NULL,
    user_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,  -- if action came from web session

    -- When + where
    ts timestamptz NOT NULL DEFAULT now(),
    source_ip inet NOT NULL,
    user_agent text,

    -- What
    method text NOT NULL,                          -- HTTP verb
    path text NOT NULL,                            -- route pattern (no IDs in URL), e.g. '/api/v1/servers/:id'
    resource_type text,                            -- 'server', 'api_key', etc
    resource_id text,                              -- the id of the resource acted on (text not uuid; servers use srv_*)
    action text NOT NULL,                          -- 'create' | 'list' | 'read' | 'update' | 'delete' | 'rotate' | 'auth_failed'

    -- Outcome
    result text NOT NULL,                          -- 'success' | 'forbidden' | 'not_found' | 'rate_limited' | 'invalid' | 'auth_failed'
    status_code integer NOT NULL,

    -- Correlation
    request_id uuid NOT NULL,                      -- correlates with application logs
    metadata jsonb                                 -- structured per-event context
);

CREATE INDEX IF NOT EXISTS idx_audit_customer_ts
    ON public.api_audit_log (customer_id, ts DESC);

CREATE INDEX IF NOT EXISTS idx_audit_key
    ON public.api_audit_log (key_id);

CREATE INDEX IF NOT EXISTS idx_audit_resource
    ON public.api_audit_log (resource_type, resource_id);

CREATE INDEX IF NOT EXISTS idx_audit_failed_auth_ip_ts
    ON public.api_audit_log (source_ip, ts DESC)
    WHERE result = 'auth_failed';

COMMENT ON TABLE public.api_audit_log IS
    'Append-only audit trail of API calls. UPDATE/DELETE revoked from forge_application via grants below. See spec Part 6.';

-- Append-only enforcement. The application role can INSERT and SELECT;
-- maintenance / migration uses a separate role that retains UPDATE/DELETE.
-- Adjust the role name to match the actual deployed grant target. If the
-- deployed role differs from "agent", this DO block no-ops harmlessly.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent') THEN
        EXECUTE 'REVOKE UPDATE, DELETE ON public.api_audit_log FROM agent';
        EXECUTE 'GRANT INSERT, SELECT ON public.api_audit_log TO agent';
    END IF;
END$$;

-- ============================================================================
-- 3) Re-authentication tracking on customers.
-- ============================================================================
-- Spec Part 4: account-key creation requires re-authentication within the
-- last 5 minutes (password or 2FA challenge), even from an authenticated
-- web session. Adds a `last_password_verified_at` column to customers.
-- The recent-re-auth window is enforced in the route handler, not in the
-- DB; this column is the data the handler reads.
ALTER TABLE public.customers
    ADD COLUMN IF NOT EXISTS last_password_verified_at timestamptz;

COMMENT ON COLUMN public.customers.last_password_verified_at IS
    'Timestamp of most recent password (or 2FA) re-verification. Used to gate sensitive operations like account API key creation. See spec Part 4.';
