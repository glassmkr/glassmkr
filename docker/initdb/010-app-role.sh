#!/bin/bash
# Create the non-superuser application role at cluster initialisation.
#
# WHY. The dashboard's audit log is append-only, and that property comes from
# ownership rather than convention: migration 009 leaves api_audit_log owned by
# a superuser and grants the application role INSERT and SELECT only, so the
# application cannot rewrite its own audit trail. A single-role deployment
# cannot express this, because PostgreSQL always grants a table's owner full
# rights no matter what you REVOKE. Without this file the self-hosted stack
# would run fine while quietly lacking a security property the hosted
# deployment has.
#
# Found by the first clean-machine compose run (2026-08-25), where migration
# 009 aborted with: role "agent" does not exist.
#
# Runs once, as the POSTGRES_USER superuser, before any migration.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<EOSQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent') THEN
    CREATE ROLE agent LOGIN PASSWORD '${APP_DB_PASSWORD}';
  END IF;
END
\$\$;

GRANT CONNECT ON DATABASE "$POSTGRES_DB" TO agent;
GRANT USAGE ON SCHEMA public TO agent;
EOSQL

echo "[initdb] application role 'agent' created (non-superuser)"
