-- Stripe webhook idempotency + subscription audit trail.
-- Apply with: psql -U agent -d guardian -f migrations/postgres/004_stripe_state.sql
-- Spec: CC_STRIPE_WEBHOOK.md

-- 1) Idempotency table for webhook events. Stripe retries failed deliveries
--    and the same event_id can arrive multiple times. We insert with
--    ON CONFLICT DO NOTHING and gate processing on whether the insert
--    actually wrote a row.
CREATE TABLE IF NOT EXISTS public.stripe_events_processed (
    event_id text PRIMARY KEY,
    event_type text NOT NULL,
    processed_at timestamptz NOT NULL DEFAULT now(),
    payload jsonb NOT NULL
);

-- 2) Subscription state mirror. The customers table already carries
--    stripe_customer_id + stripe_subscription_id + plan_* fields, but
--    that's flat: there's no audit trail when someone cancels and
--    re-subscribes, no record of period boundaries, no per-status history.
--    This table is append-/upsert-only on (subscription_id) so that the
--    most recent webhook for a given Stripe sub is reflected here, and
--    cancelled subs stay in the table indefinitely for forensics.
CREATE TABLE IF NOT EXISTS public.stripe_subscriptions (
    id text PRIMARY KEY,                                  -- Stripe sub id (sub_xxx)
    customer_id text NOT NULL,                            -- Stripe customer id (cus_xxx)
    glassmkr_customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
    status text NOT NULL,                                 -- active, past_due, canceled, ...
    plan_id text NOT NULL,                                -- Stripe price id
    quantity integer NOT NULL DEFAULT 0,
    current_period_end timestamptz,
    cancel_at_period_end boolean NOT NULL DEFAULT false,
    cancelled_at timestamptz,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stripe_subscriptions_customer
    ON public.stripe_subscriptions (customer_id);
CREATE INDEX IF NOT EXISTS idx_stripe_subscriptions_glassmkr
    ON public.stripe_subscriptions (glassmkr_customer_id);
