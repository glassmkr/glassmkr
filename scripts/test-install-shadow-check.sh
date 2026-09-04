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
# The review of #50 (2026-09-04) added cases 6 to 8 and the loader self-tests,
# each written first and watched to fail. Case 6 is the only case that
# exercises the version compare on its own: with that compare deleted outright,
# the first six cases still passed. It also pins that a version-only mismatch
# never tells the operator to remove npm's own bin link, which is the incident
# class this file exists for. Cases 7 and 8 pin the behaviour when readlink -f
# is unavailable: both sides came back empty, compared equal, and a real
# same-version shadow went quiet.
#
# Each case builds a real prefix tree in a temp dir with npm's relative bin
# symlink, a fake `npm` that answers root/prefix the way npm >= 9 does (no `npm
# bin`), and a fake agent that prints exactly what src/cli.ts prints. Real
# `node` reads the fixture's package.json, as the installer does.
#
# Usage: ./scripts/test-install-shadow-check.sh [path-to-install.sh]
# Exit 0: every case passed. 1: a case failed. 2: the fixture could not run (a
# tool it depends on is missing, or the installer could not be loaded), which
# is INCOMPLETE and never a pass.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_SH="${1:-$HERE/../apps/site/static/install.sh}"

# Preconditions. The check reads package.json with node and canonicalises with
# readlink -f; if node were missing, the version compare would be skipped and
# every case would pass on the path compare alone, for the wrong reason.
for tool in node readlink sed grep awk; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "[test:install-shadow] INCOMPLETE: '$tool' is not on PATH" >&2
    exit 2
  fi
done
if ! readlink -f / >/dev/null 2>&1; then
  echo "[test:install-shadow] INCOMPLETE: readlink -f is unsupported here (macOS before 12.3?)" >&2
  exit 2
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# load_installer <path>: define the installer's functions in the current shell
# with main() never existing. Everything from the `main() {` definition to the
# end of the file is dropped before sourcing, so no spelling of an invocation,
# in any position, can reach a main(): one placed above the definition is a
# command not found, one below it is gone with the tail. The first version of
# this loader stripped only the exact final `main "$@"` line, and review showed
# a `main "${@}"` placed elsewhere ran the installer while the fixture stayed
# green (Codex 2026-09-04 #1). Refuses unless the definition appears exactly
# once, sourcing prints nothing (the installer's top level is set, assignments
# and definitions only), warn_if_shadowed is defined, and main is not.
# Sourced from a temp file, not `source <(...)`: bash 3.2 (macOS) sources an
# empty body from a process substitution and every case then fails.
load_installer() {
  local src="$1"
  if [ "$(grep -c '^main() {$' "$src")" != 1 ]; then
    echo "refusing to load $src: expected exactly one 'main() {' line" >&2
    return 1
  fi
  sed '/^main() {$/,$d' "$src" > "$TMP/install-functions.sh"
  # shellcheck disable=SC1090,SC1091
  source "$TMP/install-functions.sh" > "$TMP/source.out" 2>&1 || true
  if [ -s "$TMP/source.out" ]; then
    echo "refusing to load $src: sourcing its definitions produced output (did something execute?)" >&2
    sed 's/^/  | /' "$TMP/source.out" >&2
    return 1
  fi
  if ! declare -F warn_if_shadowed >/dev/null; then
    echo "refusing to load $src: warn_if_shadowed is not defined" >&2
    return 1
  fi
  if declare -F main >/dev/null; then
    echo "refusing to load $src: main() got defined" >&2
    return 1
  fi
}

pass=0
fail=0

# --- loader self-tests: the shapes that could run main() must be refused -----
# Each runs in a subshell so a refused load cannot leave functions behind.
awk '/^main\(\) \{$/{print "main \"${@}\""} {print}' "$INSTALL_SH" > "$TMP/stray-above.sh"
sed 's/^main() {$/run() {/' "$INSTALL_SH" > "$TMP/renamed.sh"
{ cat "$INSTALL_SH"; echo 'main "${@}"'; } > "$TMP/stray-below.sh"
if (load_installer "$TMP/stray-above.sh" >/dev/null 2>&1); then
  fail=$((fail + 1)); echo "FAIL: G1. loader accepted a main invocation placed above the definition"
else
  pass=$((pass + 1))
fi
if (load_installer "$TMP/renamed.sh" >/dev/null 2>&1); then
  fail=$((fail + 1)); echo "FAIL: G2. loader accepted an installer whose main() definition moved or was renamed"
else
  pass=$((pass + 1))
fi
if (load_installer "$TMP/stray-below.sh" >/dev/null 2>&1 && ! declare -F main >/dev/null); then
  pass=$((pass + 1))
else
  fail=$((fail + 1)); echo "FAIL: G3. a second invocation after the definition must be dropped with the tail, leaving no main()"
fi

if ! load_installer "$INSTALL_SH"; then
  echo "[test:install-shadow] INCOMPLETE: could not load $INSTALL_SH" >&2
  exit 2
fi

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

# assert_out <yes|no> <needle> <desc>: the last check's output must (yes) or
# must not (no) contain needle, matched as a fixed string.
assert_out() {
  local want="$1" needle="$2" desc="$3" has="no"
  if printf '%s' "$LAST_OUT" | grep -qF -- "$needle"; then has="yes"; fi
  if [ "$has" = "$want" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    echo "FAIL: $desc"
    if [ "$want" = yes ]; then echo "      missing: $needle"; else echo "      unexpected: $needle"; fi
    printf '%s\n' "$LAST_OUT" | sed 's/^/      | /'
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
# Both compares fail. The remediation is to remove the standalone file, and the
# message must name it, never npm's own bin.
T="$TMP/c3"; mk_prefix "$T/usr" 1.2.2
mkdir -p "$T/usr/local/bin"; mk_agent "$T/usr/local/bin/glassmkr-crucible" 1.1.1
check warn "3. older standalone binary ahead of the npm bin on PATH" \
  "$T/usr/local/bin:$T/usr/bin" "$T/usr/lib/node_modules"
assert_out yes "Remove $T/usr/local/bin/glassmkr-crucible" "3b. the warning tells the operator to remove the shadowing file"
assert_out yes "1.1.1" "3c. the warning names the version on PATH"
assert_out yes "1.2.2" "3d. the warning names the installed version"
assert_out no "Remove $T/usr/bin/glassmkr-crucible" "3e. the warning never tells the operator to remove npm's own bin"

# --- 4. a SAME-version standalone binary earlier on PATH ---------------------
# Still a shadow: init will point the unit at it and the next npm upgrade is
# invisible. The version compare alone cannot see this.
T="$TMP/c4"; mk_prefix "$T/usr" 1.2.2
mkdir -p "$T/usr/local/bin"; mk_agent "$T/usr/local/bin/glassmkr-crucible" 1.2.2
check warn "4. same-version standalone binary ahead of the npm bin on PATH" \
  "$T/usr/local/bin:$T/usr/bin" "$T/usr/lib/node_modules"
assert_out yes "Remove $T/usr/local/bin/glassmkr-crucible" "4b. the warning tells the operator to remove the shadowing file"

# --- 5. merged-/usr: PATH reaches the npm bin as /bin/glassmkr-crucible ------
# Debian and Ubuntu ship /bin -> usr/bin. When /bin precedes /usr/bin on PATH,
# `command -v` returns a different STRING for the same file. Resolving both
# sides is what makes this quiet; a raw path compare would warn.
T="$TMP/c5"; mk_prefix "$T/usr" 1.2.2
ln -s usr/bin "$T/bin"
check quiet "5. merged-/usr alias of the npm bin (/bin -> usr/bin), same version" \
  "$T/bin:$T/usr/bin" "$T/usr/lib/node_modules"

# --- 6. path EQUAL, version different: the version compare on its own --------
# PATH resolves to npm's own bin link (the path compare passes), but what that
# link runs reports 1.1.1 while the package.json npm just wrote says 1.2.2.
# Real shapes: a bin link left pointing at an older tree after a prefix change,
# or a hand-copied file at the bin path that npm did not replace. The version
# compare must catch it, and because the path is proven to be npm's own, the
# remediation must not be "remove it" (Codex 2026-09-04 #2, #4).
T="$TMP/c6"; mk_prefix "$T/usr" 1.2.2
mk_agent "$T/usr/lib/node_modules/@glassmkr/crucible/dist/preflight.js" 1.1.1
check warn "6. npm's own bin reports 1.1.1 while the installed package.json says 1.2.2" \
  "$T/usr/bin" "$T/usr/lib/node_modules"
assert_out yes "1.1.1" "6b. the warning names the version on PATH"
assert_out yes "1.2.2" "6c. the warning names the installed version"
assert_out no "Remove " "6d. a version-only mismatch must not tell the operator to remove anything"

# --- 7/8. readlink -f unavailable --------------------------------------------
# The first fix ran `readlink -f ... || true` on both sides, so when readlink
# itself failed both came back empty, compared equal, and case 4 went quiet: a
# real same-version shadow pinned into the unit. Unknown must not read as safe;
# the fallback is the raw path, which still separates 7 from 8 (Codex #3).
mkdir -p "$TMP/noreadlink"
printf '#!/bin/bash\nexit 1\n' > "$TMP/noreadlink/readlink"; chmod +x "$TMP/noreadlink/readlink"
T="$TMP/c7"; mk_prefix "$T/usr" 1.2.2
mkdir -p "$T/usr/local/bin"; mk_agent "$T/usr/local/bin/glassmkr-crucible" 1.2.2
check warn "7. readlink -f unavailable: same-version standalone ahead of the npm bin still warns" \
  "$TMP/noreadlink:$T/usr/local/bin:$T/usr/bin" "$T/usr/lib/node_modules"
assert_out yes "Remove $T/usr/local/bin/glassmkr-crucible" "7b. the warning tells the operator to remove the shadowing file"
T="$TMP/c8"; mk_prefix "$T/usr" 1.2.2
check quiet "8. readlink -f unavailable: NodeSource layout, same version, still quiet" \
  "$TMP/noreadlink:$T/usr/bin" "$T/usr/lib/node_modules"

echo "[test:install-shadow] $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
