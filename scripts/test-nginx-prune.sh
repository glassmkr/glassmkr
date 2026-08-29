#!/bin/bash
# Self-test for nginx_link_should_prune. Builds a real symlink tree in a temp dir and
# asserts the verdict for each shape, including the KNOWN-BAD cases that the first
# implementation got wrong.
#
# Case 3 is the regression that matters: with raw-readlink matching, the relative
# sites-enabled link was classified as not-ours and skipped while the absolute
# sites-available link WAS pruned, so the prune manufactured the exact dangling
# sites-enabled link it exists to remove.

set -euo pipefail

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/nginx-prune.sh"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

REPO="$TMP/repo/sites"
AVAIL="$TMP/available"
ENABLED="$TMP/enabled"
mkdir -p "$REPO" "$AVAIL" "$ENABLED" "$TMP/elsewhere"

pass=0
fail=0

expect() {
  local want="$1" link="$2" desc="$3"
  local got="keep"
  if nginx_link_should_prune "$link" "$REPO" "$AVAIL"; then got="prune"; fi
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    echo "FAIL: $desc"
    echo "      link=$link  want=$want  got=$got"
  fi
}

# --- live site, present in the repo: must never be touched -------------------
echo "server{}" > "$REPO/live"
ln -s "$REPO/live" "$AVAIL/live"
ln -s "$AVAIL/live" "$ENABLED/live"
expect keep "$AVAIL/live"   "1a. live absolute sites-available link"
expect keep "$ENABLED/live" "1b. live absolute sites-enabled link"

# --- decommissioned site, ABSOLUTE links (what deploy.sh itself creates) ------
ln -s "$REPO/gone-abs" "$AVAIL/gone-abs"
ln -s "$AVAIL/gone-abs" "$ENABLED/gone-abs"
expect prune "$AVAIL/gone-abs"   "2a. dangling absolute sites-available link"
expect prune "$ENABLED/gone-abs" "2b. dangling absolute sites-enabled link"

# --- decommissioned site, RELATIVE enabled link (the Debian convention) -------
# KNOWN-BAD for the original implementation: it kept 3b while pruning 3a, which
# left a dangling sites-enabled link behind and broke `nginx -t`.
ln -s "$REPO/gone-rel" "$AVAIL/gone-rel"
ln -s "../available/gone-rel" "$ENABLED/gone-rel"
expect prune "$AVAIL/gone-rel"   "3a. dangling sites-available link (relative pair)"
expect prune "$ENABLED/gone-rel" "3b. dangling RELATIVE sites-enabled link"

# --- orphaned enabled link: sites-available entry already removed ------------
# Cannot be traced back to the repo any more, but a dangling link in sites-enabled
# is never load-bearing and is exactly what stops nginx starting.
ln -s "$AVAIL/orphan" "$ENABLED/orphan"
expect prune "$ENABLED/orphan" "4. orphaned sites-enabled link, no available entry"

# --- foreign vhosts: hand-managed, never repo-tracked ------------------------
echo "server{}" > "$TMP/elsewhere/foreign"
ln -s "$TMP/elsewhere/foreign" "$ENABLED/foreign-live"
ln -s "$TMP/elsewhere/missing" "$ENABLED/foreign-dangling"
expect keep "$ENABLED/foreign-live"     "5a. live foreign link outside our dirs"
expect keep "$ENABLED/foreign-dangling" "5b. DANGLING foreign link outside our dirs"

# --- a real file, not a symlink: out of scope --------------------------------
echo "server{}" > "$ENABLED/regular-file"
expect keep "$ENABLED/regular-file" "6. regular file, not a symlink"

# --- self-referential loop: unresolvable, leave for a human ------------------
ln -s "$ENABLED/loop" "$ENABLED/loop"
expect keep "$ENABLED/loop" "7. symlink loop"

echo "[test:nginx-prune] $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
