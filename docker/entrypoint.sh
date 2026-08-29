#!/bin/sh
# Dashboard container entrypoint: wait for Postgres, apply Postgres migrations,
# then start the app. ClickHouse migrations are applied by the one-shot
# clickhouse-migrate service in docker-compose.yml, which runs before this
# container is allowed to start (service_completed_successfully).
set -eu

: "${DB_HOST:=postgres}"
: "${DB_PORT:=5432}"
: "${DB_USER:=agent}"
: "${DB_NAME:=dashboard}"
# Migrations need a superuser: several transfer table ownership so the
# application role cannot rewrite its own audit log. The app itself then
# connects as the far less privileged DB_USER.
: "${DB_ADMIN_USER:=postgres}"
: "${DB_ADMIN_PASSWORD:=${DB_PASSWORD:-}}"

# env.selfhost.example ships every secret as the literal CHANGE_ME so that
# Compose can interpolate (and therefore so `docker compose down` parses)
# before setup has run. Refuse to start while any placeholder survives, or a
# stack would come up with a password that is printed in a public repository.
for _var in POSTGRES_SUPERUSER_PASSWORD DB_PASSWORD CLICKHOUSE_PASSWORD JWT_SECRET GLASSMKR_KEY_PEPPER DB_ADMIN_PASSWORD; do
  eval "_val=\${${_var}:-}"
  if [ "${_val:-}" = "CHANGE_ME" ]; then
    echo "[entrypoint] ${_var} is still the placeholder CHANGE_ME." >&2
    echo "[entrypoint] Run ./scripts/selfhost-setup.sh to generate the secrets," >&2
    echo "[entrypoint] then bring the stack up again." >&2
    exit 1
  fi
done

echo "[entrypoint] waiting for postgres at ${DB_HOST}:${DB_PORT}..."
i=0
until pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -ge 60 ] && { echo "[entrypoint] postgres not ready after 120s"; exit 1; }
  sleep 2
done

echo "[entrypoint] applying postgres migrations..."
# migrate-postgres.mjs applies unapplied migrations/postgres/*.sql via psql -f.
GMK_PG_HOST="$DB_HOST" \
GMK_PG_USER="$DB_ADMIN_USER" \
GMK_PG_DATABASE="$DB_NAME" \
PGPASSWORD="$DB_ADMIN_PASSWORD" \
GMK_MIGRATIONS_DIR=/app/migrations/postgres \
node /app/scripts/migrate-postgres.mjs

# Grant the application role exactly what it needs, table by table. The audit
# log gets SELECT and INSERT only and never receives UPDATE or DELETE, so the
# append-only property does not depend on a REVOKE landing after a broader
# GRANT. Re-applied every boot so tables added by a later migration are
# covered too.
echo "[entrypoint] granting application privileges to ${DB_USER}..."
PGPASSWORD="$DB_ADMIN_PASSWORD" psql -h "$DB_HOST" -U "$DB_ADMIN_USER" -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 -q -v app_role="$DB_USER" <<'SQL'
SELECT format('GRANT SELECT, INSERT%s ON public.%I TO %I;',
              CASE WHEN tablename = 'api_audit_log' THEN '' ELSE ', UPDATE, DELETE' END,
              tablename, :'app_role')
  FROM pg_tables WHERE schemaname = 'public';
\gexec
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app_role";
SQL

# Assert the invariant rather than trusting the grants above to be right.
# has_table_privilege accounts for ownership too, so this also catches the case
# where the application role somehow owns the table. A dashboard that has
# quietly lost its append-only audit log is worse than one that refuses to
# start, so this exits rather than warns.
echo "[entrypoint] verifying the audit log is append-only for ${DB_USER}..."
# NOTE: psql does not interpolate :variables in a -c string, only on stdin,
# so the role name is substituted by the shell here. DB_USER comes from the
# compose file, not from user input.
VIOLATED=$(PGPASSWORD="$DB_ADMIN_PASSWORD" psql -h "$DB_HOST" -U "$DB_ADMIN_USER" -d "$DB_NAME" \
  -tA -v ON_ERROR_STOP=1 -c \
  "SELECT (has_table_privilege('${DB_USER}','public.api_audit_log','UPDATE')
        OR has_table_privilege('${DB_USER}','public.api_audit_log','DELETE'))::int")
if [ "$VIOLATED" != "0" ]; then
  echo "[entrypoint] FATAL: append-only invariant violated: role ${DB_USER} can UPDATE or DELETE public.api_audit_log." >&2
  echo "[entrypoint] Refusing to start. The audit log must not be rewritable by the application role." >&2
  exit 1
fi
echo "[entrypoint] append-only invariant holds."

# Verify the APPLICATION credentials before starting the app.
#
# Found by launch gate 10, case 1. Everything above this point connects as the
# admin role, so a wrong DB_PASSWORD used to sail through: the container came
# up, served HTTP 302, and looked healthy, while every query failed. The only
# evidence was "password authentication failed for user agent" buried in a
# background job's log lines. An operator who mistypes one value in .env
# deserves to be told, not handed a dashboard that renders a login page and
# then fails at everything behind it.
echo "[entrypoint] verifying the application role can connect..."
if ! PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
     -tA -v ON_ERROR_STOP=1 -c "SELECT 1" >/dev/null 2>&1; then
  echo "[entrypoint] FATAL: role ${DB_USER} cannot connect to ${DB_NAME} with DB_PASSWORD." >&2
  echo "[entrypoint] The admin connection above worked, so the database is reachable" >&2
  echo "[entrypoint] and migrated; it is this credential that is wrong." >&2
  echo "[entrypoint] If you changed DB_PASSWORD after the data volume was created," >&2
  echo "[entrypoint] the volume still holds the old password: either restore the old" >&2
  echo "[entrypoint] value in .env, or ALTER ROLE ${DB_USER} WITH PASSWORD to match." >&2
  exit 1
fi
echo "[entrypoint] application role connects."

echo "[entrypoint] starting dashboard..."
exec node /app/build/index.js
