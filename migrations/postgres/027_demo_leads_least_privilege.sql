-- 027_demo_leads_least_privilege.sql
-- Tighten the `agent` app role's demo_leads grants to least privilege.
--
-- Migration 026 granted SELECT, INSERT, UPDATE, DELETE to fix a missing-grant
-- 500, but the only consumer is POST /api/v1/demo/lead, which performs a single
-- INSERT (no SELECT / UPDATE / DELETE on demo_leads anywhere in the app). Revoke
-- the unused privileges so a future SQL bug or a compromised handler cannot
-- read, mutate, or delete captured leads through the agent role.
-- (Codex review 2026-06-06, finding C.)
--
-- Sequence: nextval() needs only USAGE, so drop the SELECT (currval/lastval)
-- granted in 026 while keeping USAGE for the BIGSERIAL insert.
--
-- Idempotent: REVOKE is a no-op if the privilege is not held. Wrapped in
-- BEGIN/COMMIT so the self-registration row rolls back with the rest if the
-- verification block raises (Codex F4 pattern, enforced by migrate-postgres.mjs).
--
-- NO-COLUMN-DELTA: privilege-only migration; it changes grants, not the public-schema
-- column inventory, so the migrate runner's silent-no-op guard would otherwise
-- abort the deploy. The DO block below proves INSERT survives, and that SELECT
-- is gone for a non-owner grantee (the prod shape; see the ownership note below).
--
-- Ownership note: a table OWNER keeps every privilege implicitly, so REVOKE only
-- bites a non-owner grantee. On prod demo_leads is postgres-owned (025 ran as
-- the superuser) and agent is a grantee, so the REVOKE strips agent's SELECT. In
-- CI the table is created by the connecting `agent` role, so agent owns it and
-- the REVOKE is a harmless no-op; the verification only asserts SELECT-gone when
-- agent is not the owner.

BEGIN;

REVOKE SELECT, UPDATE, DELETE ON public.demo_leads FROM agent;
REVOKE SELECT ON SEQUENCE public.demo_leads_id_seq FROM agent;

INSERT INTO schema_migrations (version, name) VALUES
  (27, '027_demo_leads_least_privilege')
ON CONFLICT (version) DO NOTHING;

DO $$
DECLARE
  can_insert boolean;
  can_select boolean;
  agent_owns boolean;
BEGIN
  SELECT has_table_privilege('agent', 'public.demo_leads', 'INSERT') INTO can_insert;
  SELECT has_table_privilege('agent', 'public.demo_leads', 'SELECT') INTO can_select;
  SELECT pg_get_userbyid(relowner) = 'agent'
    FROM pg_class WHERE oid = 'public.demo_leads'::regclass INTO agent_owns;
  RAISE NOTICE 'migration 027: agent demo_leads INSERT=% SELECT=% owner=%', can_insert, can_select, agent_owns;
  IF NOT can_insert THEN
    RAISE EXCEPTION 'migration 027 FAILED: agent lost INSERT on demo_leads';
  END IF;
  -- Only a non-owner grantee can lose SELECT via REVOKE (an owner keeps it
  -- implicitly). On prod agent is a grantee, so assert the revoke took hold; in
  -- CI agent owns the table, so the REVOKE is a no-op and the check is skipped.
  IF NOT agent_owns AND can_select THEN
    RAISE EXCEPTION 'migration 027 FAILED: non-owner agent still has SELECT on demo_leads after REVOKE';
  END IF;
END$$;

COMMIT;
