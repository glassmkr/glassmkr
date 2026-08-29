#!/bin/sh
# End-to-end smoke test for a self-hosted stack: the flow a stranger actually
# performs after `docker compose up -d`.
#
# Why this exists. Gates 3 and 12 both certified the self-hosted stack by
# checking that GET / returned a redirect. It does, whether or not the product
# works: JWT_SECRET was never set by the compose file, so every install could
# register an account and then failed every login with 500 Missing JWT_SECRET.
# A liveness check is not a functional check. This walks the real path and
# fails loudly on any step.
#
# Usage (from a repo checkout on the box running the stack):
#   ./scripts/selfhost-smoke.sh [base-url]
# Default base URL is http://127.0.0.1:3000
set -u

BASE="${1:-http://127.0.0.1:3000}"
# Registration and login hash passwords with a deliberately slow KDF, which on
# a small box takes many seconds. Generous timeouts, or the test reports a
# product failure that is really a client timeout.
CURL="curl -s --max-time 90"
EMAIL="smoke-$(date +%s)@example.invalid"
PW="smoke-test-password"
FAILURES=0

step() { printf '  %-46s ' "$1"; }
ok()   { echo "ok${1:+ ($1)}"; }
bad()  { FAILURES=$((FAILURES + 1)); echo "FAIL${1:+: $1}"; }

step "dashboard responds"
CODE=$($CURL -o /dev/null -w '%{http_code}' "$BASE/")
case "$CODE" in 200|302|303) ok "http $CODE";; *) bad "http $CODE";; esac

step "register a new account"
REG=$($CURL -o /dev/null -w '%{http_code}' -X POST "$BASE/api/v1/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\",\"display_name\":\"smoke\"}")
case "$REG" in 200|201) ok "http $REG";; *) bad "http $REG";; esac

step "log in and receive a session cookie"
HDRS=$($CURL -i -X POST "$BASE/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}")
LOGIN_CODE=$(echo "$HDRS" | head -1 | tr -d '\r' | awk '{print $2}')
TOKEN=$(echo "$HDRS" | grep -i '^set-cookie: guardian_token=' | head -1 | sed 's/.*guardian_token=\([^;]*\).*/\1/')
if [ "$LOGIN_CODE" != "200" ]; then
  bad "http $LOGIN_CODE"
elif [ -z "$TOKEN" ]; then
  bad "logged in but no guardian_token cookie was set"
else
  ok "http 200, session set"
fi

# The cookie a browser would actually keep. A Domain attribute that does not
# match the host the operator is using is silently dropped by every browser,
# which would make a self-hosted install impossible to log into even though
# curl is perfectly happy.
step "session cookie is usable on this host"
DOMAIN=$(echo "$HDRS" | grep -i '^set-cookie: guardian_token=' | head -1 | sed -n 's/.*[Dd]omain=\([^;]*\).*/\1/p')
HOST=$(echo "$BASE" | sed 's|https\{0,1\}://||; s|[:/].*||')
if [ -z "${TOKEN:-}" ]; then
  bad "skipped, no cookie was set at all"
elif [ -z "$DOMAIN" ]; then
  ok "no Domain attribute, so it is host-only"
else
  case "$HOST" in
    *"${DOMAIN#.}") ok "Domain=$DOMAIN matches $HOST";;
    *) bad "Domain=$DOMAIN will be dropped by a browser on $HOST";;
  esac
fi

step "authenticated read works"
if [ -n "${TOKEN:-}" ]; then
  CODE=$($CURL -o /dev/null -w '%{http_code}' -H "Cookie: guardian_token=$TOKEN" "$BASE/api/v1/servers")
  case "$CODE" in 200) ok "http 200";; *) bad "http $CODE";; esac
else
  bad "skipped, no session"
fi

step "create a server and get an ingest key"
if [ -n "${TOKEN:-}" ]; then
  BODY=$($CURL -X POST "$BASE/api/v1/servers" -H 'Content-Type: application/json' \
    -H "Cookie: guardian_token=$TOKEN" \
    -d '{"name":"smoke","hostname":"smoke.invalid"}')
  SID=$(echo "$BODY" | sed -n 's/.*"id" *: *"\([^"]*\)".*/\1/p' | head -1)
  if echo "$BODY" | grep -q "gmk_cru_live_" && [ -n "$SID" ]; then
    ok "server created, key issued"
  else
    bad "no server id or ingest key in the response"
  fi
else
  bad "skipped, no session"
fi

# The enrollment response tells the operator where to point the agent. It used
# to be the hosted URL, hardcoded, so a self-hosted dashboard issued a key and
# then directed the telemetry to somebody else's instance.
step "enrollment points the agent at THIS instance"
if [ -n "${BODY:-}" ]; then
  INGEST=$(echo "$BODY" | sed -n 's/.*"ingest_url" *: *"\([^"]*\)".*/\1/p' | head -1)
  if [ -z "$INGEST" ]; then
    bad "no ingest_url in the enrollment response"
  else
    # "This instance" is not the same as "the URL I happened to dial". The
    # smoke test talks to loopback, but the correct ingest_url for a multi-host
    # install is an address OTHER hosts can reach, so matching $BASE would have
    # demanded the one value that does not work. What actually matters is that
    # the dashboard does not point the agent at somebody else's instance, so
    # accept the base, loopback, or any address this host owns, and reject the
    # rest by name.
    INGEST_HOST=$(echo "$INGEST" | sed -n 's#^[a-z]*://\([^/:]*\).*#\1#p')
    LOCAL_ADDRS=$(ip -4 -o addr show 2>/dev/null | awk '{print $4}' | cut -d/ -f1)
    BASE_HOST=$(echo "$BASE" | sed -n 's#^[a-z]*://\([^/:]*\).*#\1#p')
    matched=no
    for a in $LOCAL_ADDRS localhost 127.0.0.1 "$BASE_HOST"; do
      [ "$INGEST_HOST" = "$a" ] && matched=yes
    done
    case "$INGEST" in
      */api/v1/ingest) ;;
      *) matched=no;;
    esac
    if [ "$matched" = yes ]; then
      ok "$INGEST"
    else
      bad "points elsewhere: $INGEST"
    fi
  fi
else
  bad "skipped, no enrollment response"
fi

step "telemetry read path answers"
if [ -n "${TOKEN:-}" ] && [ -n "${SID:-}" ]; then
  CODE=$($CURL -o /dev/null -w '%{http_code}' -H "Cookie: guardian_token=$TOKEN" \
    "$BASE/api/v1/servers/$SID/history?hours=24")
  case "$CODE" in 200) ok "http 200";; *) bad "http $CODE";; esac
else
  bad "skipped, no server"
fi

echo
if [ "$FAILURES" = "0" ]; then
  echo "SELF-HOST SMOKE: PASS"
  exit 0
fi
echo "SELF-HOST SMOKE: $FAILURES failure(s)"
exit 1
