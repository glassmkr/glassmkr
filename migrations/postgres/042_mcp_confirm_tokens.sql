-- 042_mcp_confirm_tokens.sql
--
-- Make MCP confirmation tokens single-use.
--
-- WHY A TABLE, WHEN THE TOKEN IS A STATELESS HMAC
--
-- The token proves a prepare call happened and binds the action to one
-- customer, one action and one target. It cannot prove the token has not been
-- spent already, because nothing anywhere recorded that it was. Inside its
-- five-minute window the same token authorised the same destructive action
-- any number of times. The repository's own test suite asserted this as a
-- passing test titled "is not single-use", which is an honest way to record a
-- gap and no substitute for closing it.
--
-- Single-use needs server-side state. It cannot live in process memory: the
-- dashboard restarts on every deploy, and an in-memory set of spent tokens is
-- empty after a restart, so a restart would silently reopen the replay window
-- rather than close it. It has to be durable.
--
-- WHY THE ROW IS WRITTEN AT CONSUME AND NOT AT ISSUE
--
-- glassmkr.admin.prepare is declared read-only to MCP clients, and clients are
-- entitled to rely on that annotation: a tool that advertises readOnlyHint and
-- then writes is lying to the approval prompt. So issuing stays stateless, and
-- the first successful verification INSERTs the token id. A replay finds the
-- primary key already present, inserts nothing, and is refused. One statement,
-- atomic, no read-then-write race between two concurrent commits.
--
-- The stored value is a hash of the token, never the token. A dump of this
-- table cannot be replayed against the API.
--
-- Safe to re-run: IF NOT EXISTS throughout. Rolling the code back leaves an
-- unused table, which is harmless.

BEGIN;

CREATE TABLE IF NOT EXISTS public.mcp_confirm_tokens (
    -- HMAC of the token, not the token. 64 hex characters.
    jti character varying(64) NOT NULL,
    customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    action character varying(32) NOT NULL,
    -- A server id or, for enroll_server, the name being enrolled.
    target character varying(200) NOT NULL,
    consumed_at timestamp with time zone NOT NULL DEFAULT now(),
    -- The token's own expiry, used only to prune rows that can no longer be
    -- replayed even in principle.
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT mcp_confirm_tokens_pkey PRIMARY KEY (jti)
);

COMMENT ON TABLE public.mcp_confirm_tokens IS
  'Spent MCP confirmation tokens. A row means the token was already used; the INSERT is the single-use check. Rows older than their expiry are prunable.';

-- Pruning scans by expiry only.
CREATE INDEX IF NOT EXISTS idx_mcp_confirm_tokens_expires
  ON public.mcp_confirm_tokens (expires_at);

INSERT INTO schema_migrations (version, name) VALUES
  (42, '042_mcp_confirm_tokens')
ON CONFLICT (version) DO NOTHING;

COMMIT;
