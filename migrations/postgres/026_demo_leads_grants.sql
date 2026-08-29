-- Fix-up migration: grant the `agent` app role privileges on demo_leads
-- (and its sequence) that migration 025 forgot.
--
-- Symptom: POST /api/v1/demo/lead returned HTTP 500 with
-- `permission denied for table demo_leads` in the dashboard journal
-- (2026-05-31). Root cause: migration 025 ran as the postgres superuser
-- and created the table owned by postgres; the dashboard connects as
-- `agent`, which had no grant. Same shape as migration 019
-- (trend_warning_evaluations) and 009 (api_audit_log).
--
-- Idempotent: GRANTs are no-ops if already granted; schema_migrations
-- insert uses ON CONFLICT. Wrapped in BEGIN/COMMIT so the
-- self-registration row rolls back with the rest if the verification
-- block raises (Codex F4 pattern, enforced by migrate-postgres.mjs).
--
-- NO-COLUMN-DELTA: GRANT-only migration; it changes privileges, not the
-- public-schema column inventory, so the migrate runner's silent-no-op
-- guard would otherwise abort the deploy. The DO block below proves the
-- grant actually took effect (agent INSERT on demo_leads).

BEGIN;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.demo_leads
  TO agent;

GRANT USAGE, SELECT
  ON SEQUENCE public.demo_leads_id_seq
  TO agent;

INSERT INTO schema_migrations (version, name) VALUES
  (26, '026_demo_leads_grants')
ON CONFLICT (version) DO NOTHING;

DO $$
DECLARE
  agent_insert boolean;
BEGIN
  SELECT has_table_privilege('agent', 'public.demo_leads', 'INSERT')
    INTO agent_insert;
  RAISE NOTICE 'migration 026: agent INSERT=% on demo_leads', agent_insert;
  IF NOT agent_insert THEN
    RAISE EXCEPTION 'migration 026 FAILED: agent role still lacks INSERT on demo_leads after GRANT';
  END IF;
END$$;

COMMIT;
