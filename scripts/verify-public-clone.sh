#!/bin/bash
# Post-flip verification: prove the published repository is actually usable.
#
# Run this AFTER the repository is made public and BEFORE announcing it. It does
# what a stranger does, from outside: clone anonymously, bootstrap, run the
# tests, read the licence, and check that what was published matches what is
# deployed.
#
# It deliberately uses a clean temporary directory and unsets any credential
# helper, because the failure this exists to catch is a repository that works
# for the person who owns it and 404s for everyone else. Testing it with your
# own credentials in the environment proves nothing.
#
# EXIT CODES: 0 every check ran and passed. 1 something failed. 2 nothing
# failed but a check was WAIVED by a flag, so the verification is incomplete and
# a person must read the WAIVED lines. 2 exists so that `if verify; then
# announce; fi` cannot treat a waiver as a pass.
#
# FAIL CLOSED. Every check either passes, fails, or is waived by a flag the
# operator typed. There is no third state that prints nothing and lets the run
# report success: a check that cannot run is a check that did not pass, and an
# earlier version of this script announced "all checks passed" after silently
# skipping the toolchain, the licence, and the deployed-revision comparison.
#
# Usage:
#   ./scripts/verify-public-clone.sh [repo-url] [deployed-sha] [flags]
#
# Flags, each of which waives exactly one check and is reported in the summary:
#   --allow-missing-pnpm   the bootstrap and test run cannot happen here
#   --allow-sha-mismatch   the published tree is not required to match the
#                          deployed revision, which is the expected case while
#                          the public repository is a fresh squashed tree
#   --origin <url>         where to read the deployed revision from
#                          (default https://app.glassmkr.com)
#
# With no deployed SHA the script reads one from <origin>/api/v1/version, which
# publishes dashboard.git_sha. If that cannot be read, the comparison fails
# rather than being skipped.
set -uo pipefail

REPO_URL=""
EXPECTED_SHA=""
ORIGIN="https://app.glassmkr.com"
ALLOW_MISSING_PNPM=0
ALLOW_SHA_MISMATCH=0

while [ $# -gt 0 ]; do
  case "$1" in
    --allow-missing-pnpm) ALLOW_MISSING_PNPM=1; shift ;;
    --allow-sha-mismatch) ALLOW_SHA_MISMATCH=1; shift ;;
    --origin) ORIGIN="${2:-}"; shift 2 ;;
    --*) echo "[verify] unknown flag: $1" >&2; exit 2 ;;
    *)
      if [ -z "$REPO_URL" ]; then REPO_URL="$1"
      elif [ -z "$EXPECTED_SHA" ]; then EXPECTED_SHA="$1"
      else echo "[verify] unexpected argument: $1" >&2; exit 2
      fi
      shift ;;
  esac
done
REPO_URL="${REPO_URL:-https://github.com/glassmkr/glassmkr.git}"

WORK="$(mktemp -d)"
FAILURES=0
OVERRIDES=0

pass()     { echo "[verify] ok       $1"; }
fail()     { FAILURES=$((FAILURES + 1)); echo "[verify] FAIL     $1" >&2; }
override() { OVERRIDES=$((OVERRIDES + 1)); echo "[verify] WAIVED   $1"; }

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

echo "[verify] working in $WORK"
echo "[verify] repository: $REPO_URL"
echo

# 1. Anonymous clone. GIT_TERMINAL_PROMPT=0 turns a credential prompt into a
#    failure rather than a hang, and the cleared helper list stops the
#    operator's own keychain from silently supplying a token a stranger would
#    not have.
echo "[verify] --- clone ---"
# `-c credential.helper=` with an empty value CLEARS the helper list, including
# helpers configured in system config, which GIT_CONFIG_GLOBAL alone does not
# reach. Without it this "anonymous" clone succeeds against a PRIVATE repository
# using the operator's own keychain, which is precisely the false pass this
# script exists to avoid: verified 2026-08-28, when it cloned the private repo
# and reported success.
# No GIT_ASKPASS: its path differs across platforms (/bin/true on Linux,
# /usr/bin/true on macOS) and a wrong one adds an exec error to the message.
# GIT_TERMINAL_PROMPT=0 with the helpers cleared is sufficient and portable.
if GIT_TERMINAL_PROMPT=0 GIT_CONFIG_GLOBAL=/dev/null \
   GIT_CONFIG_SYSTEM=/dev/null GIT_CONFIG_NOSYSTEM=1 SSH_AUTH_SOCK= \
   git -c credential.helper= -c credential.helper="" \
       clone --quiet "$REPO_URL" "$WORK/repo" 2>"$WORK/clone.err"; then
  pass "anonymous clone succeeded"
else
  fail "anonymous clone failed: $(tr -d '\n' < "$WORK/clone.err" | head -c 200)"
  echo "[verify] cannot continue without a clone"
  exit 1
fi

cd "$WORK/repo" || exit 1
CLONED_SHA="$(git rev-parse HEAD)"
echo "[verify] cloned HEAD: $CLONED_SHA"
echo

# 2. The files a coding agent reads first.
echo "[verify] --- root files ---"
for f in README.md AGENTS.md CONTRIBUTING.md SECURITY.md LICENSE .env.example; do
  if [ -f "$f" ]; then pass "$f present"; else fail "$f missing from the published tree"; fi
done
if [ -f CLAUDE.md ] && ! grep -q "AGENTS.md" CLAUDE.md; then
  fail "CLAUDE.md does not point at AGENTS.md"
elif [ -f CLAUDE.md ]; then
  pass "CLAUDE.md points at AGENTS.md"
fi
echo

# 3. Licence.
#
# Read from the text rather than from a badge, but read the RIGHT text. An
# earlier version searched the LICENSE body for "either version 3 of the
# License, or ... any later version" and treated a hit as a possible
# -or-later grant. That phrase is in every correctly published AGPL-3.0
# LICENSE file: once in section 14, and once in the "How to Apply These Terms"
# appendix, which is boilerplate instructions for other people's programs and
# says nothing about this one. The check therefore fired on a correct file and,
# because the result was only a skip, nobody found out.
#
# A project's own grant lives in its declaration, not in the appendix of the
# licence it points at. So: take the SPDX id from package.json, require the
# README to state the same id, and require the LICENSE text to be the licence
# that id names.
echo "[verify] --- licence ---"
DECLARED_SPDX="$(sed -n 's/.*"license"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' package.json 2>/dev/null | head -1)"
if [ -z "$DECLARED_SPDX" ]; then
  fail "package.json declares no license field, so the published grant is unstated"
else
  pass "package.json declares $DECLARED_SPDX"
  case "$DECLARED_SPDX" in
    AGPL-3.0*)
      if grep -q "GNU AFFERO GENERAL PUBLIC LICENSE" LICENSE 2>/dev/null; then
        pass "LICENSE is the AGPL text, matching the declared $DECLARED_SPDX"
      else
        fail "package.json declares $DECLARED_SPDX but LICENSE is not the AGPL text"
      fi ;;
    *)
      fail "unexpected declared licence $DECLARED_SPDX; confirm deliberately before publishing" ;;
  esac
  # The README is what a human reads. If it names a different id from the one
  # the package metadata declares, one of them is wrong and a reader cannot
  # tell which.
  README_SPDX="$(grep -oE "AGPL-3\.0(-only|-or-later)?" README.md 2>/dev/null | head -1)"
  if [ -z "$README_SPDX" ]; then
    fail "README does not state the licence"
  elif [ "$README_SPDX" = "$DECLARED_SPDX" ]; then
    pass "README states $README_SPDX, matching package.json"
  else
    fail "README says $README_SPDX but package.json declares $DECLARED_SPDX"
  fi
fi
echo

# 4. No secrets reached the published tree.
echo "[verify] --- secrets ---"
# Requires actual entropy in the suffix: at least one digit and at least one
# letter, and not a run of a single character. The documentation deliberately
# shows `gmk_cru_live_xxxxxxxx...` as a placeholder, and a pattern that only
# counted characters flagged it as a leak, which is the kind of false positive
# that gets a check switched off.
SECRET_HITS="$(grep -rIohE "gmk_(acct|cru)_live_[A-Za-z0-9]{20,}" . --exclude-dir=.git 2>/dev/null \
  | awk '{ s = substr($0, index($0, "live_") + 5);
           if (s ~ /[0-9]/ && s ~ /[A-Za-z]/ && s !~ /^(.)\1+$/ && s !~ /^x+$/) print }' \
  | head -3)"
if [ -n "$SECRET_HITS" ]; then
  fail "a live-looking key is present in the published tree: $(echo "$SECRET_HITS" | head -1 | cut -c1-24)..."
else
  pass "no live-looking credentials in the published tree (placeholders ignored)"
fi
echo

# 5. Bootstrap and tests, exactly as documented. A stranger who cannot bootstrap
#    has an unusable repository, so a machine that cannot run the bootstrap
#    cannot pronounce on it either.
echo "[verify] --- bootstrap ---"
if ! command -v pnpm >/dev/null 2>&1; then
  if [ "$ALLOW_MISSING_PNPM" -eq 1 ]; then
    override "pnpm is not on PATH; the documented bootstrap and the test suite were NOT verified"
  else
    fail "pnpm is not on PATH, so the documented bootstrap cannot be verified. Install pnpm, or pass --allow-missing-pnpm to publish without this evidence"
  fi
else
  if pnpm install --frozen-lockfile >"$WORK/install.log" 2>&1; then
    pass "pnpm install --frozen-lockfile from a clean clone"
  else
    fail "install failed: $(tail -3 "$WORK/install.log" | tr '\n' ' ')"
  fi
  echo "[verify] --- tests ---"
  if pnpm turbo test >"$WORK/test.log" 2>&1; then
    pass "the test suite passes from a clean clone"
  else
    fail "tests failed: $(grep -iE 'failed|error' "$WORK/test.log" | tail -3 | tr '\n' ' ')"
  fi
fi
echo

# 6. Published tree versus deployed code. A public repository that does not
#    match what is running is a different kind of untruth from a stale document.
echo "[verify] --- published versus deployed ---"
sha_note() {
  echo "         published $CLONED_SHA"
  echo "         deployed  $1"
}
if [ -z "$EXPECTED_SHA" ]; then
  # /api/v1/version is public and returns dashboard.git_sha, resolved from the
  # deployed checkout at module load.
  VERSION_JSON="$(curl -fsS --max-time 10 "$ORIGIN/api/v1/version" 2>"$WORK/version.err")"
  EXPECTED_SHA="$(printf '%s' "$VERSION_JSON" \
    | sed -n 's/.*"git_sha"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
  if [ -n "$EXPECTED_SHA" ] && [ "$EXPECTED_SHA" != "unknown" ]; then
    echo "[verify] deployed SHA read from $ORIGIN/api/v1/version"
  else
    EXPECTED_SHA=""
  fi
fi

if [ -z "$EXPECTED_SHA" ]; then
  if [ "$ALLOW_SHA_MISMATCH" -eq 1 ]; then
    override "the deployed revision could not be read from $ORIGIN and the comparison was waived"
  else
    fail "could not determine the deployed revision from $ORIGIN/api/v1/version$( [ -s "$WORK/version.err" ] && echo ": $(tr -d '\n' < "$WORK/version.err" | head -c 120)"). Pass one as the second argument, or --allow-sha-mismatch to publish without this evidence"
  fi
elif ! printf '%s' "$EXPECTED_SHA" | grep -qE '^[0-9a-fA-F]{7,40}$'; then
  # Anything shorter than seven is not a git abbreviation, it is a typo, and
  # comparing a prefix of it would match far too much.
  fail "the deployed SHA '$EXPECTED_SHA' is not a git revision of at least 7 hex characters"
else
  # Compare as a PREFIX. The documented invocation uses a short SHA, and
  # comparing it as a whole string against a 40-character rev-parse output made
  # every documented run report a difference.
  N="${#EXPECTED_SHA}"
  if [ "$(printf '%s' "$CLONED_SHA" | cut -c1-"$N" | tr 'A-Z' 'a-z')" = "$(printf '%s' "$EXPECTED_SHA" | tr 'A-Z' 'a-z')" ]; then
    pass "published HEAD matches the deployed revision"
  elif [ "$ALLOW_SHA_MISMATCH" -eq 1 ]; then
    override "published HEAD differs from the deployed revision, accepted by --allow-sha-mismatch"
    sha_note "$EXPECTED_SHA"
  else
    fail "published HEAD does not match the deployed revision. If the public repository is a fresh squashed tree this is expected: pass --allow-sha-mismatch to say so deliberately"
    sha_note "$EXPECTED_SHA"
  fi
fi
echo

if [ "$FAILURES" -gt 0 ]; then
  echo "[verify] $FAILURES failing check(s). Do NOT announce the repository."
  exit 1
fi
if [ "$OVERRIDES" -gt 0 ]; then
  echo "[verify] INCOMPLETE: no failing checks, but $OVERRIDES check(s) were WAIVED by a flag."
  echo "[verify] Those properties are UNVERIFIED. This run is not a pass."
  echo "[verify] Exit code 2 = a human waived something and must inspect the WAIVED lines"
  echo "[verify] above before acting on this run. Only exit 0 means every check ran."
  # Deliberately NOT 0. A waiver is a person deciding to proceed without
  # evidence, which is a legitimate thing to do and must never be readable as
  # an automated green gate: `if verify-public-clone.sh; then announce; fi`
  # would otherwise treat "we skipped the test suite" as "the test suite
  # passed". CI fails on this; a human reads the reasons and decides.
  exit 2
fi
echo "[verify] all checks passed. The repository is usable by a stranger."
