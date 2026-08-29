-- Move new-format collector keys (gmk_cru_live_*) into the
-- account_api_keys table, alongside account API keys. One unified
-- key store, prefix discriminates kind. Legacy col_* keys stay in
-- servers.api_key_hash until each agent's operator rotates.
--
-- Apply with: psql -U agent -d guardian -f migrations/postgres/008_collector_keys_to_account_keys.sql
-- Spec:       CC_FORGE_API_KEYS_AND_SERVERS.md (Parts 2 + 9)
-- IMPL plan:  IMPL_NOTES_API_KEYS.md
-- PR:         #6 (col_->cru_ cutover) of the 7-PR sequence.
--
-- After this migration:
--   - New servers have NO row in servers.api_key_hash; they have a row
--     in account_api_keys with prefix='gmk_cru_live_' and server_id set.
--   - Existing servers still have servers.api_key_hash (bcrypt'd col_*)
--     until their operator rotates via POST /servers/{id}/rotate-key.
--     Both auth paths run; the agent works either way.
--   - rotate-key writes a new account_api_keys row + clears
--     servers.api_key_hash to NULL.

-- Allow servers.api_key_hash to become NULL once the legacy key is
-- replaced. Existing rows are unaffected.
ALTER TABLE public.servers
    ALTER COLUMN api_key_hash DROP NOT NULL;

-- Link account_api_keys to a server (only set for kind=cru rows).
-- ON DELETE CASCADE: deleting a server tears down any cru key it
-- owned. Safe because cru keys are scoped below the customer level
-- and have no value once the server is gone.
ALTER TABLE public.account_api_keys
    ADD COLUMN IF NOT EXISTS server_id character varying(32);

ALTER TABLE public.account_api_keys
    ADD CONSTRAINT account_api_keys_server_id_fkey
        FOREIGN KEY (server_id) REFERENCES public.servers(id) ON DELETE CASCADE
    NOT VALID;
ALTER TABLE public.account_api_keys VALIDATE CONSTRAINT account_api_keys_server_id_fkey;

-- Lookup index: ingest auth resolves a server_id from the cru key's
-- HMAC, then needs the server's customer_id for downstream BOLA. The
-- combined index on (key_hash) is already there from migration 006;
-- this adds the reverse direction (find a server's cru key).
CREATE INDEX IF NOT EXISTS idx_account_api_keys_server_id
    ON public.account_api_keys (server_id)
    WHERE server_id IS NOT NULL AND revoked_at IS NULL;

-- Enforce the kind-vs-server_id invariant: prefix='gmk_cru_*' rows MUST
-- have server_id set; prefix='gmk_acct_*' rows MUST have it null.
-- Application-layer code does this correctly; the constraint is
-- defence-in-depth against a future bug.
ALTER TABLE public.account_api_keys
    ADD CONSTRAINT account_api_keys_kind_server_consistent
        CHECK (
            (prefix LIKE 'gmk_cru_%' AND server_id IS NOT NULL)
            OR (prefix LIKE 'gmk_acct_%' AND server_id IS NULL)
        )
    NOT VALID;
ALTER TABLE public.account_api_keys VALIDATE CONSTRAINT account_api_keys_kind_server_consistent;

COMMENT ON COLUMN public.account_api_keys.server_id IS
    'Set for cru keys (gmk_cru_*), null for account keys (gmk_acct_*). Enforced by check constraint.';
