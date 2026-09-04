#!/bin/bash
# Known-bad fixtures for install.sh's warn_if_shadowed (the post-install check
# that a standalone binary earlier on PATH is not hiding the npm install).
#
# Written first and run against the check as shipped in #29, where cases 1, 2
# and 5 failed. Case 1 is the 2026-09-04 report: Ubuntu 24.04, NodeSource
# Node 24 (npm prefix /usr, so the npm bin IS /usr/bin/glassmkr-crucible), both
# sides 1.2.2, and the installer still printed the shadowing warning. The cause
# was not the layout: the check compared the bare package.json version against
# the whole `--version` line ("glassmkr-crucible v1.2.2" minus its v), so it
# warned on every install. That is also why case 4 passed on the old check: it
# warned about everything. Case 4 exists for the fixed check, where a
# same-version standalone binary is only caught by the path compare, and it is
# still a shadow because init writes the unit against whatever PATH resolves.
#
# Each case builds a real prefix tree in a temp dir with npm's relative bin
# symlink, a fake `npm` that answers root/prefix the way npm >= 9 does (no `npm
# bin`), and a fake agent that prints exactly what src/cli.ts prints. Real
# `node` reads the fixture's package.json, as the installer does.
#
# Usage: ./scripts/test-install-shadow-check.sh [path-to-install.sh]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_SH="${1:-$HERE/../apps/site/static/install.sh}"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# The installer's last line is `main "$@"`, the curl|bash truncation guard.
# Source everything but that line; refuse to run if the line is not exactly
# where and what we expect, because then main() could run inside the test.
# Via a temp file, not `source <(...)`: bash 3.2 (macOS) sources an empty
# body from a process substitution and the test then fails on every case.
if [ "$(grep -c '^main "\$@"$' "$INSTALL_SH")" != 1 ]; then
  echo "expected exactly one 'main \"\$@\"' line in $INSTALL_SH" >&2
  exit 1
fi
sed '/^main "\$@"$/d' "$INSTALL_SH" > "$TMP/install-no-main.sh"
# shellcheck disable=SC1090
source "$TMP/install-no-main.sh"

pass=0
fail=0

# mk_agent <path> <version>: a stand-in for dist/preflight.js or a compiled
# standalone binary. Same --version output as src/cli.ts in the agent repo.
mk_agent() {
  printf '#!/bin/bash\necho "glassmkr-crucible v%s"\n' "$2" > "$1"
  chmod +x "$1"
}

# mk_prefix <prefix> <version>: what `npm install -g @glassmkr/crucible` leaves
# under a prefix: lib/node_modules/@glassmkr/crucible with package.json, and
# bin/glassmkr-crucible as npm's RELATIVE symlink into it. Also drops a fake
# `npm` in bin/ that reports this prefix.
mk_prefix() {
  local prefix="$1" ver="$2"
  local pkg="$prefix/lib/node_modules/@glassmkr/crucible"
  mkdir -p "$pkg/dist" "$prefix/bin"
  printf '{"name":"@glassmkr/crucible","version":"%s","bin":{"glassmkr-crucible":"./dist/preflight.js"}}\n' "$ver" > "$pkg/package.json"
  mk_agent "$pkg/dist/preflight.js" "$ver"
  ln -s ../lib/node_modules/@glassmkr/crucible/dist/preflight.js "$prefix/bin/glassmkr-crucible"
  cat > "$prefix/bin/npm" <<NPM
#!/bin/bash
case "\$1 \$2" in
  "root -g") echo "$prefix/lib/node_modules" ;;
  "prefix -g") echo "$prefix" ;;
  *) echo "Unknown command: \"\$1\"" >&2; exit 1 ;;
esac
NPM
  chmod +x "$prefix/bin/npm"
}

# run_check <path-prefix> <npm-root>: run warn_if_shadowed with the fixture
# dirs ahead of the real PATH (real node stays reachable) in a subshell, so
# neither PATH nor bash's command hash leaks between cases.
run_check() {
  ( PATH="$1:$PATH"; hash -r; warn_if_shadowed "$2" ) 2>&1
}

# check <quiet|warn> <desc> <path-prefix> <npm-root>: run the check and assert
# whether it warned. A non-zero exit from the check is its own failure, printed
# with the captured output, rather than aborting the whole run under set -e.
LAST_OUT=""
check() {
  local want="$1" desc="$2" path="$3" root="$4"
  local out got="quiet" rc=0
  out="$(run_check "$path" "$root")" || rc=$?
  LAST_OUT="$out"
  if [ "$rc" -ne 0 ]; then
    fail=$((fail + 1))
    echo "FAIL: $desc"
    echo "      warn_if_shadowed exited $rc"
    printf '%s\n' "$out" | sed 's/^/      | /'
    return
  fi
  if printf '%s' "$out" | grep -q '^WARNING:'; then got="warn"; fi
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    echo "FAIL: $desc"
    echo "      want=$want got=$got"
    printf '%s\n' "$out" | sed 's/^/      | /'
  fi
}

# --- 1. KNOWN-BAD (2026-09-04): NodeSource layout, npm prefix /usr -----------
# PATH resolves to /usr/bin/glassmkr-crucible, which IS npm's bin symlink, and
# both sides are 1.2.2. Nothing is shadowed; the installer warned anyway.
T="$TMP/c1"; mk_prefix "$T/usr" 1.2.2
check quiet "1. NodeSource layout (prefix /usr), same version, npm bin on PATH" \
  "$T/usr/bin" "$T/usr/lib/node_modules"

# --- 2. default prefix /usr/local, same version ------------------------------
# The layout the check was presumably written on. It warned here too.
T="$TMP/c2"; mk_prefix "$T/usr/local" 1.2.2
check quiet "2. default layout (prefix /usr/local), same version, npm bin on PATH" \
  "$T/usr/local/bin" "$T/usr/local/lib/node_modules"

# --- 3. the real shadow: an OLDER standalone binary earlier on PATH ----------
T="$TMP/c3"; mk_prefix "$T/usr" 1.2.2
mkdir -p "$T/usr/local/bin"; mk_agent "$T/usr/local/bin/glassmkr-crucible" 1.1.1
check warn "3. older standalone binary ahead of the npm bin on PATH" \
  "$T/usr/local/bin:$T/usr/bin" "$T/usr/lib/node_modules"
if printf '%s' "$LAST_OUT" | grep -q "$T/usr/local/bin/glassmkr-crucible"; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  echo "FAIL: 3b. the warning must name the shadowing path"
  printf '%s\n' "$LAST_OUT" | sed 's/^/      | /'
fi

# --- 4. a SAME-version standalone binary earlier on PATH ---------------------
# Still a shadow: init will point the unit at it and the next npm upgrade is
# invisible. The version compare alone cannot see this.
T="$TMP/c4"; mk_prefix "$T/usr" 1.2.2
mkdir -p "$T/usr/local/bin"; mk_agent "$T/usr/local/bin/glassmkr-crucible" 1.2.2
check warn "4. same-version standalone binary ahead of the npm bin on PATH" \
  "$T/usr/local/bin:$T/usr/bin" "$T/usr/lib/node_modules"

# --- 5. merged-/usr: PATH reaches the npm bin as /bin/glassmkr-crucible ------
# Debian and Ubuntu ship /bin -> usr/bin. When /bin precedes /usr/bin on PATH,
# `command -v` returns a different STRING for the same file. Resolving both
# sides is what makes this quiet; a raw path compare would warn.
T="$TMP/c5"; mk_prefix "$T/usr" 1.2.2
ln -s usr/bin "$T/bin"
check quiet "5. merged-/usr alias of the npm bin (/bin -> usr/bin), same version" \
  "$T/bin:$T/usr/bin" "$T/usr/lib/node_modules"

echo "[test:install-shadow] $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
