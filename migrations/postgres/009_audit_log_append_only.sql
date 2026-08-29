-- Append-only enforcement for api_audit_log.
--
-- NO-COLUMN-DELTA: changes ownership, grants, and a trigger only, so the column
-- inventory is unchanged by design. Declared because this migration was
-- historically applied by hand on the hosted deployment and never ran through
-- the runner; the first from-scratch run (self-hosting, 2026-08-25) aborted
-- here on the silent-no-op guard.
--
-- Apply with: sudo -u postgres psql -d guardian -f migrations/postgres/009_audit_log_append_only.sql
--
-- Why: migration 006 issued REVOKE UPDATE, DELETE ON api_audit_log FROM
-- agent, but if `agent` is the table owner, PostgreSQL grants the owner
-- full privileges regardless of REVOKE. The grant gymnastics did nothing.
-- Codex review (P1.5) flagged this. Spec Part 6 requires effective
-- append-only enforcement.
--
-- Fix: transfer ownership to postgres (the superuser already used for
-- migration 007/008 owner-only ALTERs), then re-apply the grant. Now
-- `agent` is just a grantee with INSERT, SELECT only; UPDATE/DELETE
-- attempts fail with permission denied.
--
-- This migration MUST run as postgres because ALTER TABLE ... OWNER TO
-- requires the new owner role membership. The `agent` role does not
-- have that.

-- ============================================================================
-- 1) Transfer ownership.
-- ============================================================================
ALTER TABLE public.api_audit_log OWNER TO postgres;

-- ============================================================================
-- 2) Re-grant only INSERT + SELECT to agent.
-- ============================================================================
-- These were granted in 006 but ownership-as-agent overrode the REVOKE.
-- After ownership transfer, they're authoritative.
REVOKE ALL ON public.api_audit_log FROM agent;
GRANT INSERT, SELECT ON public.api_audit_log TO agent;

-- ============================================================================
-- 3) Defence in depth: trigger that blocks UPDATE/DELETE for non-superuser.
-- ============================================================================
-- The grant model above is sufficient under normal operation. The trigger
-- is belt-and-braces in case a future migration accidentally re-grants
-- UPDATE/DELETE to agent or a new app role. Superusers can bypass via
-- the SET LOCAL trick documented in the runbook (used for retention
-- partition drops).
CREATE OR REPLACE FUNCTION public.api_audit_log_block_mutations()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF current_setting('audit.allow_mutation', true) = 'on' THEN
        -- Maintenance / retention path. Set in a SECURITY DEFINER
        -- function or via SET LOCAL audit.allow_mutation = 'on';
        RETURN COALESCE(NEW, OLD);
    END IF;
    RAISE EXCEPTION 'api_audit_log is append-only; UPDATE/DELETE not permitted (rule: %)', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_api_audit_log_append_only ON public.api_audit_log;
CREATE TRIGGER trg_api_audit_log_append_only
    BEFORE UPDATE OR DELETE ON public.api_audit_log
    FOR EACH ROW EXECUTE FUNCTION public.api_audit_log_block_mutations();

-- ============================================================================
-- 4) Verification.
-- ============================================================================
-- Smoke-test the configuration so a misapplied migration fails loudly
-- instead of silently breaking the contract. Inserts a synthetic row,
-- attempts to UPDATE it, expects a permission_denied or trigger
-- exception, then deletes via the maintenance path. All in one
-- transaction; rolled back at the end so no audit row leaks.
DO $$
DECLARE
    test_id uuid;
    err_caught boolean := false;
BEGIN
    INSERT INTO public.api_audit_log
        (customer_id, source_ip, method, path, action, result, status_code, request_id)
    VALUES
        (NULL, '127.0.0.1'::inet, 'GET', '/__migration_009_smoke__', 'list',
         'success', 200, gen_random_uuid())
    RETURNING id INTO test_id;

    -- Attempt UPDATE as the table owner (postgres). The trigger should
    -- raise unless audit.allow_mutation is set.
    BEGIN
        UPDATE public.api_audit_log SET status_code = 999 WHERE id = test_id;
    EXCEPTION
        WHEN OTHERS THEN
            err_caught := true;
    END;
    IF NOT err_caught THEN
        RAISE EXCEPTION 'api_audit_log trigger did not block UPDATE (migration 009 verification failed)';
    END IF;

    -- Maintenance path: clean up the smoke-test row.
    PERFORM set_config('audit.allow_mutation', 'on', true);
    DELETE FROM public.api_audit_log WHERE id = test_id;
END$$;

COMMENT ON TABLE public.api_audit_log IS
    'API audit log. Append-only: owned by postgres, agent has INSERT+SELECT only, BEFORE UPDATE/DELETE trigger blocks mutations unless session has audit.allow_mutation=on. Maintenance path is documented in docs/runbooks/audit-log-maintenance.md.';
