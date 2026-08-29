#!/bin/sh
# Fill in the secrets the self-hosted stack needs, in .env.
#
# env.selfhost.example ships every secret with the literal placeholder
# CHANGE_ME rather than an empty value. Compose interpolates variables for
# EVERY subcommand, not just `up`, so a file with missing values makes even
# `docker compose down` fail to parse before setup has ever run. Placeholders
# keep the file parseable; this script replaces them; the container entrypoint
# refuses to start while any of them survives.
#
# These are distinct secrets on purpose. Sharing one password between the
# Postgres superuser and the application role would make the append-only audit
# log decorative: a leaked application credential would authenticate as
# superuser, and a superuser can rewrite anything regardless of ownership or
# grants.
#
# Idempotent: a real value is never overwritten, so re-running after an upgrade
# only fills in newly required secrets. That matters most for
# GLASSMKR_KEY_PEPPER, which invalidates every issued key if it changes.
set -eu

cd "$(dirname "$0")/.."
ENV_FILE="${1:-.env}"
PLACEHOLDER=CHANGE_ME

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found. Run this first:" >&2
  echo "         cp env.selfhost.example .env" >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "ERROR: openssl is required to generate secrets and was not found." >&2
  exit 1
fi

ensure() {
  name="$1"
  current=$(sed -n "s/^${name}=//p" "$ENV_FILE" | head -n 1)
  if [ -n "$current" ] && [ "$current" != "$PLACEHOLDER" ]; then
    echo "  ${name}: already set, left alone"
    return
  fi
  value=$(openssl rand -hex 24)
  if grep -qE "^${name}=" "$ENV_FILE"; then
    # Rewrite the line in place, so the file keeps its comments and ordering.
    tmp=$(mktemp)
    awk -v n="$name" -v v="$value" '$0 ~ "^"n"=" { print n"="v; next } { print }' \
      "$ENV_FILE" > "$tmp"
    mv "$tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$name" "$value" >> "$ENV_FILE"
  fi
  echo "  ${name}: generated"
}

echo "Filling in secrets in $ENV_FILE:"
ensure POSTGRES_SUPERUSER_PASSWORD
ensure DB_PASSWORD
ensure CLICKHOUSE_PASSWORD
ensure JWT_SECRET
ensure GLASSMKR_KEY_PEPPER
chmod 600 "$ENV_FILE" 2>/dev/null || true

remaining=$(grep -c "=${PLACEHOLDER}\$" "$ENV_FILE" || true)
if [ "$remaining" != "0" ]; then
  echo "ERROR: ${remaining} placeholder value(s) still in $ENV_FILE." >&2
  exit 1
fi

# DASHBOARD_PUBLIC_URL and DASHBOARD_BIND have to agree, and nothing used to
# make them. PUBLIC_URL is the address this dashboard hands to every agent it
# enrols; BIND decides which address the port is actually published on, and it
# defaults to loopback on purpose, because Docker publishes straight past ufw
# and firewalld. Get them out of step and the failure is silent in both
# directions: advertise a public address that nothing serves and the agent logs
# "Push failed, will retry next cycle" forever; leave the default localhost on a
# multi-host install and every agent is told to push to its own loopback.
#
# So derive one from the other rather than guessing. BIND is the deliberate
# choice, so it wins.
bind=$(grep "^DASHBOARD_BIND=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"')
port=$(grep "^DASHBOARD_PORT=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"')
[ -n "$port" ] || port=3000
current_public_url=$(grep "^DASHBOARD_PUBLIC_URL=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-)

case "${bind:-127.0.0.1}" in
  ""|127.0.0.1|localhost)
    # Loopback: localhost IS the correct advertised address, because the only
    # agent that can reach this dashboard is one on this box.
    echo ""
    echo "  DASHBOARD_BIND is loopback, so DASHBOARD_PUBLIC_URL stays localhost."
    echo "    That is correct for agents running on THIS box. To monitor other"
    echo "    hosts, put a reverse proxy with TLS in front (the normal shape) or"
    echo "    set DASHBOARD_BIND to an address you intend to serve on, then"
    echo "    re-run this script so the advertised URL matches."
    ;;
  *)
    if [ "$current_public_url" = "http://localhost:${port}" ] || [ "$current_public_url" = "http://localhost:3000" ]; then
      sed -i.bak "s#^DASHBOARD_PUBLIC_URL=.*#DASHBOARD_PUBLIC_URL=http://${bind}:${port}#" "$ENV_FILE"
      rm -f "${ENV_FILE}.bak"
      echo ""
      echo "  DASHBOARD_PUBLIC_URL: http://${bind}:${port}  (derived from DASHBOARD_BIND)"
      echo "    This is what enrolled agents will be told to push to. If they"
      echo "    reach this dashboard by a DNS name or through a proxy, edit"
      echo "    $ENV_FILE now."
    fi
    ;;
esac

echo ""
echo "Done. Run: docker compose up -d"
