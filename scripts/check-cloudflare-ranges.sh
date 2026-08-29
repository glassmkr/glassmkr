#!/bin/sh
# Compare the set_real_ip_from ranges deployed on the edge host against the
# lists Cloudflare currently publishes.
#
# Why this is recurring rather than a one-off. nginx only believes
# CF-Connecting-IP from addresses in its allowlist. If Cloudflare adds a range
# and we do not, requests arriving through those edges silently fall back to
# recording the CDN address instead of the visitor: the rate limiters start
# collapsing real users into one bucket again, and the audit log stops
# attributing actions. It fails quietly and looks exactly like normal
# operation, which is why it needs a check rather than a memory.
#
# A range being REMOVED upstream is not urgent (we would merely trust an
# address Cloudflare no longer uses), so that is reported as informational.
# A range being ADDED upstream and missing locally is the actionable case.
#
# Usage:
#   ./scripts/check-cloudflare-ranges.sh                  # check the live host
#   ./scripts/check-cloudflare-ranges.sh /path/to/conf    # check a local file
set -eu

CONF="${1:-}"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

if [ -n "$CONF" ]; then
  cp "$CONF" "$TMP/deployed.conf"
else
  ssh -o ConnectTimeout=20 the production host \
    'sudo -n cat /etc/nginx/conf.d/cloudflare-realip.conf' > "$TMP/deployed.conf" 2>/dev/null || {
      echo "FAIL: could not read the deployed config from the production host" >&2
      exit 1
    }
fi

curl -fsSL --max-time 20 https://www.cloudflare.com/ips-v4 -o "$TMP/v4" 
curl -fsSL --max-time 20 https://www.cloudflare.com/ips-v6 -o "$TMP/v6"

# awk, not `while read`: these files have no trailing newline, and a read loop
# silently drops the final range. That happened while first writing this config
# and cost two ranges before it was caught.
awk 'NF' "$TMP/v4" "$TMP/v6" | sort -u > "$TMP/published"
grep '^set_real_ip_from' "$TMP/deployed.conf" | sed 's/^set_real_ip_from //; s/;$//' | sort -u > "$TMP/deployed"

MISSING=$(comm -23 "$TMP/published" "$TMP/deployed")
EXTRA=$(comm -13 "$TMP/published" "$TMP/deployed")

echo "published ranges: $(wc -l < "$TMP/published" | tr -d ' ')"
echo "deployed ranges:  $(wc -l < "$TMP/deployed" | tr -d ' ')"

if [ -n "$EXTRA" ]; then
  echo
  echo "INFO: deployed but no longer published (harmless, tidy up when convenient):"
  echo "$EXTRA" | sed 's/^/  /'
fi

if [ -n "$MISSING" ]; then
  echo
  echo "ACTION NEEDED: published by Cloudflare but NOT deployed:" >&2
  echo "$MISSING" | sed 's/^/  /' >&2
  echo >&2
  echo "Requests through those edges are recording the CDN address, not the" >&2
  echo "visitor. Regenerate /etc/nginx/conf.d/cloudflare-realip.conf, nginx -t," >&2
  echo "reload, then re-run this check." >&2
  exit 1
fi

echo
echo "OK: every published Cloudflare range is trusted."
