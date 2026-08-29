-- 024_customers_is_demo.sql
--
-- Flag the public read-only demo tenant. Exactly one customer row is
-- expected to carry is_demo = true (seeded by scripts/seed-demo.mjs).
--
-- This column is the single source of truth for "read-only": the auth
-- hook (apps/dashboard/src/hooks.server.ts) resolves it onto
-- locals.customer.isDemo, and a method-level guard rejects every
-- non-GET request from a demo principal. Background schedulers
-- (billing enforcement, watchdog, trend-warnings, key-expiry) exclude
-- is_demo tenants so the seeded demo never emails anyone, never gets
-- billed, and never churns server_unreachable on its static snapshots.
--
-- Default false; real customers are unaffected. No backfill needed.

BEGIN;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN customers.is_demo IS
  'True for the public read-only demo tenant. Drives the hooks-level mutation guard and excludes the tenant from billing/watchdog/trend/key-expiry schedulers.';

-- Partial index: the only lookups are "is this tenant the demo" (per
-- request, already by id) and the scheduler exclusions; a partial index
-- on the rare true rows keeps the scheduler NOT-filters cheap.
CREATE INDEX IF NOT EXISTS idx_customers_is_demo ON customers (is_demo) WHERE is_demo;

INSERT INTO schema_migrations (version, name) VALUES
  (24, '024_customers_is_demo')
ON CONFLICT (version) DO NOTHING;

COMMIT;
