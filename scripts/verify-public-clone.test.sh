#!/bin/bash
# Known-bad fixtures for verify-public-clone.sh.
#
# Written before the fail-closed rework and run against the previous script
# first, where it failed six of nine cases. That is the point: three gates in
# this repository have shipped broken while reporting success, so a guard is
# not trusted here until its own broken case has been watched to fail.
#
# Each fixture is a real git repository in a temporary directory, cloned over a
# file path exactly as the real run clones over https. `pnpm` is removed from
# PATH for every case, because whether a missing toolchain is a failure or a
# waived override is one of the properties under test.
#
# Usage: ./scripts/verify-public-clone.test.sh [path-to-script]
set -uo pipefail

SCRIPT="${1:-$(cd "$(dirname "$0")" && pwd)/verify-public-clone.sh}"
REAL_LICENSE="$(cd "$(dirname "$0")/.." && pwd)/LICENSE"
WORK="$(mktemp -d)"
FAILURES=0

# git must stay reachable, pnpm must not. This is what makes the
# missing-toolchain case reproducible on a machine that has pnpm installed.
NO_PNPM_PATH="/usr/bin:/bin:/usr/sbin:/sbin"
# An origin that refuses connections, so deployed-SHA discovery fails without
# reaching the network or depending on the live site being up.
DEAD_ORIGIN="http://127.0.0.1:9"

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

mkfixture() {
  local name="$1"; shift
  local dir="$WORK/$name"
  mkdir -p "$dir"
  cat > "$dir/README.md" <<'EOF'
# Glassmkr

The dashboard and everything in this repository is AGPL-3.0-only.
EOF
  cp "$REAL_LICENSE" "$dir/LICENSE"
  printf '# Agents\n' > "$dir/AGENTS.md"
  printf 'See AGENTS.md.\n' > "$dir/CLAUDE.md"
  printf '# Contributing\n' > "$dir/CONTRIBUTING.md"
  printf '# Security\n' > "$dir/SECURITY.md"
  printf 'GLASSMKR_API_KEY=\n' > "$dir/.env.example"
  printf '{\n  "name": "fixture",\n  "license": "AGPL-3.0-only"\n}\n' > "$dir/package.json"
  # Per-fixture damage is applied by the caller before the commit.
  "$@" "$dir"
  ( cd "$dir" && git init --quiet -b main \
      && git -c user.email=t@t -c user.name=t add -A \
      && git -c user.email=t@t -c user.name=t commit --quiet -m "fixture" ) >/dev/null
  echo "$dir"
}

undamaged() { :; }
break_readme()      { rm -f "$1/README.md"; }
# The key-shaped string is ASSEMBLED at runtime and never appears contiguously
# in this file. A fixture that tests a secret detector is itself secret-shaped,
# and writing it as one literal makes this file fail launch-integrity and the
# gitleaks scan. The value is fabricated and has never been a credential.
leak_key() {
  local head="gmk_acct" tail="live_9f3a2b7c1d8e4a6b5c0f"
  printf 'const k = "%s_%s";\n' "$head" "$tail" > "$1/src.js"
}
later_version()     { printf '{\n  "name": "fixture",\n  "license": "AGPL-3.0-or-later"\n}\n' > "$1/package.json"; }
break_claude_md()   { printf 'Nothing useful here.\n' > "$1/CLAUDE.md"; }

# run <expected-exit> <label> <fixture-dir> [extra args...]
run() {
  local want="$1" label="$2" dir="$3"; shift 3
  local out; local rc
  out="$(PATH="$NO_PNPM_PATH" "$SCRIPT" "$dir" "$@" 2>&1)"; rc=$?
  if [ "$rc" -eq "$want" ]; then
    echo "[fixtures] ok   $label (exit $rc)"
  else
    FAILURES=$((FAILURES + 1))
    echo "[fixtures] FAIL $label: expected exit $want, got $rc" >&2
    echo "$out" | sed 's/^/           | /' | tail -12 >&2
  fi
}

GOOD="$(mkfixture good undamaged)"
GOOD_SHA="$(cd "$GOOD" && git rev-parse HEAD)"

echo "[fixtures] script under test: $SCRIPT"
echo

# The reference case: everything correct, both known gaps waived on purpose.
# Exit 2, not 0: a waived check is an incomplete verification, and a caller
# that treats it as a pass is exactly what the exit code exists to prevent.
run 2 "a correct tree with a waived check reports INCOMPLETE, not pass" \
  "$GOOD" "$GOOD_SHA" --allow-missing-pnpm

# The three fail-open paths. Each of these previously printed "all checks
# passed" while proving nothing.
run 1 "missing pnpm is a failure, not a skip" \
  "$GOOD" "$GOOD_SHA"
run 1 "an undeterminable deployed SHA is a failure, not a skip" \
  "$GOOD" --allow-missing-pnpm --origin "$DEAD_ORIGIN"
run 1 "a deployed-SHA mismatch is a failure, not a skip" \
  "$GOOD" 0000000000000000000000000000000000000000 --allow-missing-pnpm

# The same mismatch, deliberately accepted. A squashed public tree is the real
# reason this override exists.
run 2 "a SHA mismatch is accepted only as a waiver, and still not a pass" \
  "$GOOD" 0000000000000000000000000000000000000000 --allow-missing-pnpm --allow-sha-mismatch

# The documented short SHA must compare as a prefix. Comparing it as a whole
# string made every documented invocation report a mismatch.
run 2 "a short SHA matches by prefix (still incomplete: pnpm was waived)" \
  "$GOOD" "${GOOD_SHA:0:12}" --allow-missing-pnpm
run 1 "a short SHA that does not prefix-match still fails" \
  "$GOOD" "000000000000" --allow-missing-pnpm
run 1 "a SHA too short to be meaningful is rejected" \
  "$GOOD" "0000" --allow-missing-pnpm

# Content failures that must survive the rework.
run 1 "a missing README fails" \
  "$(mkfixture no-readme break_readme)" "$GOOD_SHA" --allow-missing-pnpm
run 1 "a live-looking key in the tree fails" \
  "$(mkfixture leaked leak_key)" "$GOOD_SHA" --allow-missing-pnpm
run 1 "a declared licence that contradicts the README fails" \
  "$(mkfixture or-later later_version)" "$GOOD_SHA" --allow-missing-pnpm
run 1 "a CLAUDE.md that does not point at AGENTS.md fails" \
  "$(mkfixture stray-claude break_claude_md)" "$GOOD_SHA" --allow-missing-pnpm

echo
if [ "$FAILURES" -gt 0 ]; then
  echo "[fixtures] $FAILURES fixture(s) behaved wrongly"
  exit 1
fi
echo "[fixtures] all fixtures behaved as specified"
