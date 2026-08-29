-- Phase 4 (B.1+B.3+B.4): per-key 3-level scope, optional expiry,
-- and 48-hour rotation grace tracking.
-- Apply with: sudo -u postgres psql guardian -f migrations/postgres/013_account_keys_scopes_expiry.sql
-- Spec: CC_PHASE_4_KEYS_TOKENS_UI.md
--
-- Note on table name: the spec calls the table `account_keys`. The
-- actual table is `account_api_keys` (verified live via psql \d). All
-- new columns land on the real table. The legacy `scopes` jsonb
-- column ('["servers:manage"]') stays for backward compat with the
-- existing requireScope(principal, "servers:manage") check; the new
-- `scope` text column adds the 3-level hierarchical model on top.
--
-- Existing rows: backfilled to `scope='admin'` (no behaviour change
-- for current customers; their keys had full access before this
-- migration). New keys default to `write` per the spec.
--
-- expires_at already exists from migration 006 (nullable). We add
-- the rotation-grace columns alongside.

ALTER TABLE public.account_api_keys
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'admin',
  ADD COLUMN IF NOT EXISTS replaces_key_id UUID REFERENCES public.account_api_keys(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS replaced_by_key_id UUID REFERENCES public.account_api_keys(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS grace_period_ends_at TIMESTAMPTZ;

-- Constrain the new column to the hierarchical-scope vocabulary.
ALTER TABLE public.account_api_keys
  DROP CONSTRAINT IF EXISTS account_api_keys_scope_check;
ALTER TABLE public.account_api_keys
  ADD CONSTRAINT account_api_keys_scope_check
  CHECK (scope IN ('read', 'write', 'admin'));

-- Index for the daily expiry cron's "find keys expiring soon" query.
CREATE INDEX IF NOT EXISTS idx_account_api_keys_expires_at
    ON public.account_api_keys (expires_at)
    WHERE expires_at IS NOT NULL AND revoked_at IS NULL;

-- Index for the daily expiry cron's "find keys past grace period" query.
CREATE INDEX IF NOT EXISTS idx_account_api_keys_grace_period_ends_at
    ON public.account_api_keys (grace_period_ends_at)
    WHERE grace_period_ends_at IS NOT NULL AND revoked_at IS NULL;
