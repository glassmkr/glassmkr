-- 025_demo_leads.sql
--
-- Leads captured from the public demo's soft CTA ("Leave your email" /
-- "Book a call"). Written by the unauthenticated, rate-limited
-- POST /api/v1/demo/lead endpoint, which also emails simon.rybisar.
--
-- Intentionally minimal: email, whether they want a call, and a little
-- provenance. No PII beyond the email the visitor volunteered. No FK to
-- customers (these are prospects, not customers).

BEGIN;

CREATE TABLE IF NOT EXISTS demo_leads (
  id          BIGSERIAL PRIMARY KEY,
  email       TEXT NOT NULL,
  wants_call  BOOLEAN NOT NULL DEFAULT FALSE,
  source      TEXT NOT NULL DEFAULT 'demo',
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_demo_leads_created_at ON demo_leads (created_at DESC);

INSERT INTO schema_migrations (version, name) VALUES
  (25, '025_demo_leads')
ON CONFLICT (version) DO NOTHING;

COMMIT;
