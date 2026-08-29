-- Per-server suspension audit columns to support billing enforcement.
-- Apply with: sudo -u postgres psql guardian -f migrations/postgres/010_servers_suspended_audit.sql
-- Spec: apps/forge/docs/billing-enforcement-discovery.md (PR #31)
-- Carve-out reminder: this migration is part of the broader billing
-- enforcement workstream; the application logic is gated on the
-- BILLING_ENFORCEMENT_ENABLED env var (default false), so this migration
-- is safe to apply ahead of the flag flip.
--
-- The columns piggyback on the existing `servers.status` enum that
-- already has `'active'` and `'suspended'` as in-use values (the
-- customer.subscription.deleted Stripe webhook handler suspends excess
-- servers on full cancellation today). Adding `suspended_at` and
-- `suspended_reason` is purely additive: existing rows are NULL on
-- both columns regardless of their `status` value, and code that
-- already filters on `status = 'active'` continues unchanged.
--
-- Backfill: set suspended_at and suspended_reason on rows that are
-- already in the suspended state. We don't know historically why they
-- were suspended, so the reason is `'unknown'`. Future suspensions set
-- a real reason (`'subscription_cancelled'`, `'no_card_on_file'`, etc).

ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_reason TEXT;

UPDATE public.servers
   SET suspended_at = COALESCE(suspended_at, NOW()),
       suspended_reason = COALESCE(suspended_reason, 'unknown')
 WHERE status = 'suspended'
   AND suspended_at IS NULL;

-- Partial indexes so the dispatcher gate (`status='suspended'`) and
-- enforcement cron (`suspended_at IS NOT NULL`) stay cheap as the
-- table grows. The first index is also useful for the existing
-- billable-count queries that already filter status='active' (the
-- index serves both directions when used on a status equality check).
CREATE INDEX IF NOT EXISTS idx_servers_suspended_status
    ON public.servers (status)
    WHERE status = 'suspended';

CREATE INDEX IF NOT EXISTS idx_servers_suspended_at
    ON public.servers (suspended_at)
    WHERE suspended_at IS NOT NULL;
