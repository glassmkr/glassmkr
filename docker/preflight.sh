#!/bin/sh
# Refuse to start the stack while .env still holds placeholder secrets.
#
# env.selfhost.example ships every secret as the literal CHANGE_ME so the file
# parses from the moment it is copied: Compose interpolates variables for EVERY
# subcommand, so empty required values used to make even `docker compose down`
# fail before setup had ever run. The cost of placeholders is that `up` would
# otherwise proceed, and Postgres would initialise its data volume using the
# placeholder as the superuser password. Setup would then generate a real one
# and every later boot would fail authentication against a volume nobody
# remembers creating. Every service waits on this check, so that cannot happen.
#
# This lives in a file rather than inline in docker-compose.yml on purpose:
# Compose interpolates $VAR inside inline command blocks, so the first version
# of this check printed empty variable names and exited 0 while reporting
# success. A file is not interpolated, and can be tested directly.
set -u

fail=0
for name in POSTGRES_SUPERUSER_PASSWORD DB_PASSWORD CLICKHOUSE_PASSWORD JWT_SECRET GLASSMKR_KEY_PEPPER; do
  eval "value=\${$name:-}"
  if [ -z "$value" ] || [ "$value" = "CHANGE_ME" ]; then
    echo "  $name is not set yet"
    fail=1
  fi
done

if [ "$fail" != "0" ]; then
  echo ""
  echo "Run ./scripts/selfhost-setup.sh to generate the secrets,"
  echo "then bring the stack up again."
  exit 1
fi

echo "preflight: all secrets present"
