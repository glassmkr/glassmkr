-- Per-customer exemption from the billing-enforcement workstream.
-- Apply with: sudo -u postgres psql guardian -f migrations/postgres/011_customers_billing_enforcement_exempt.sql
-- Spec: CC_STRIPE_ENFORCEMENT_COMPLETE.md (PR D)
--
-- Use case: staff / internal accounts that we want to keep on Pro
-- features without Stripe billing semantics applying. With
-- billing_enforcement_exempt=TRUE, the customer is invisible to the
-- enforcement cron's candidate set, and the restore endpoint skips
-- the live Stripe card-check and clears suspension directly.
--
-- Reasons (free-form text in `exempt_reason`): currently expected
-- values are 'staff', 'internal-test', 'comp', 'partner'. Not
-- enum-constrained so future reasons land without schema change.
-- A NULL exempt_reason on an exempt=TRUE row is allowed but
-- discouraged (operational hygiene only, not enforced).
--
-- No UI for setting this column ships in PR D — exemption is applied
-- via SQL: UPDATE customers SET billing_enforcement_exempt=TRUE,
-- exempt_reason='staff' WHERE id='<uuid>';. Future Phase 7 P3 ticket
-- to add an admin UI.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS billing_enforcement_exempt BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS exempt_reason TEXT;

-- Partial index so the cron's `WHERE NOT billing_enforcement_exempt`
-- predicate stays cheap. Most customers will have the default value
-- (false), so the index targets the small population that's exempt.
CREATE INDEX IF NOT EXISTS idx_customers_billing_enforcement_exempt
    ON public.customers (id)
    WHERE billing_enforcement_exempt = TRUE;
