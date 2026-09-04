#!/bin/bash
# Crucible installer. Installs Node + smartmontools + ipmitool, npm-installs
# @glassmkr/crucible, then delegates config/systemd setup to
# `glassmkr-crucible init` (Crucible 0.9.1+).
#
# Supported package managers: apt (Debian/Ubuntu) and dnf/yum (RHEL, Rocky,
# AlmaLinux, CentOS, Fedora). On any other distribution the installer proceeds
# if Node and npm are already present, and otherwise tells you the one-line
# manual prerequisite; it never hard-rejects a host it could serve.
#
# Hosted at https://glassmkr.com/install.sh. Used by:
#
#   curl -sf https://glassmkr.com/install.sh | sudo bash -s -- --api-key <K>
#
# Self-hosted dashboards: add --ingest-url (or set GLASSMKR_INGEST_URL) to
# point the agent at your own instance instead of app.glassmkr.com:
#
#   curl -sf https://glassmkr.com/install.sh | sudo bash -s -- \
#     --api-key <K> --ingest-url http://your-host:3000/api/v1/ingest
#
# For standalone (no Dashboard) or telegram-enabled setups, see the README at
# https://github.com/glassmkr/crucible ; hand-edit /etc/glassmkr/crucible.yaml
# after the manual install. (Pre-0.13.5 installs may have the file at the
# legacy /etc/glassmkr/collector.yaml; the agent reads either path.)
#
# The entire body runs inside main(), invoked only on the last line
# (`main "$@"`). This is the curl|bash truncation guard (security audit
# §2.2 / catalog T-107): if the download is cut short mid-transfer, the
# partial file either fails to define main() or never reaches the final
# invocation, so no half-a-script executes a dangerous partial command.
set -euo pipefail

# Package-manager abstraction. Set once from /etc/os-release so the rest of the
# script never re-derives it. PKG is "apt" | "dnf" | "yum" | "" (unknown).
PKG=""

detect_pkg() {
  # Prefer the binary that actually exists over the distro name: a host may run
  # a RHEL derivative this script has never heard of but still ship dnf.
  if command -v apt-get >/dev/null 2>&1; then PKG="apt"; return; fi
  if command -v dnf >/dev/null 2>&1; then PKG="dnf"; return; fi
  if command -v yum >/dev/null 2>&1; then PKG="yum"; return; fi
  PKG=""
}

pkg_install() {
  # Install one or more packages with the detected manager. Returns non-zero on
  # failure so callers can decide whether the package is required or optional.
  case "$PKG" in
    apt) apt-get install -y "$@" ;;
    dnf) dnf install -y "$@" ;;
    yum) yum install -y "$@" ;;
    *) return 1 ;;
  esac
}

node_repo_setup() {
  # Add the NodeSource repository for the detected package family, then install
  # nodejs. deb.nodesource for apt hosts, rpm.nodesource for dnf/yum hosts.
  case "$PKG" in
    apt)
      curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
      apt-get install -y nodejs
      ;;
    dnf|yum)
      curl -fsSL https://rpm.nodesource.com/setup_24.x | bash -
      pkg_install nodejs
      ;;
    *)
      return 1
      ;;
  esac
}

warn_if_shadowed() {
  # L4: if a standalone binary shadows the npm install on PATH, `glassmkr-crucible`
  # would run the OLD code (old init -> old wrapper -> unit points at the old
  # binary). Warn loudly so the operator removes it. $1 is `npm root -g`.
  #
  # Two tests, either one warns. Path: what PATH resolves must be npm's own
  # global bin, {prefix}/bin/glassmkr-crucible, compared after readlink -f on
  # both sides because npm's bin is a relative symlink into node_modules and a
  # merged-/usr host can reach it as /bin/... Version: the semver the PATH
  # binary reports must equal what npm just installed. The first version of
  # this check (#29) compared the bare package.json version against the whole
  # `--version` line, "glassmkr-crucible v1.2.2" minus its v, so it warned on
  # EVERY install (2026-09-04, Ubuntu 24.04 + NodeSource, both sides 1.2.2).
  # `npm bin -g` is gone since npm 9 and `dirname "$(npm root -g)"` is
  # {prefix}/lib, not the bin dir; `npm prefix -g` is what both agree on.
  #
  # The two tests get different remediation. Only a PROVEN path mismatch may
  # say "remove that file": on a version-only mismatch PATH already resolves to
  # npm's own bin link, and telling the operator to delete it recreates the
  # incident above (review of #50, finding #2). When readlink -f itself is
  # unavailable each side falls back to its raw path rather than to "": two
  # empty strings compared equal and hid a real same-version shadow (finding
  # #3). scripts/test-install-shadow-check.sh holds the fixtures.
  local resolved npm_prefix npm_bin resolved_real npm_bin_real installed_ver path_ver
  local path_differs="" version_differs=""
  resolved="$(command -v glassmkr-crucible 2>/dev/null || true)"
  [ -n "$resolved" ] || return 0
  npm_prefix="$(npm prefix -g 2>/dev/null || true)"
  if [ -n "$npm_prefix" ]; then
    npm_bin="$npm_prefix/bin/glassmkr-crucible"
    resolved_real="$(readlink -f "$resolved" 2>/dev/null || true)"
    npm_bin_real="$(readlink -f "$npm_bin" 2>/dev/null || true)"
    [ -n "$resolved_real" ] || resolved_real="$resolved"
    [ -n "$npm_bin_real" ] || npm_bin_real="$npm_bin"
    [ "$resolved_real" = "$npm_bin_real" ] || path_differs=1
  fi
  installed_ver="$(node -e "console.log(require(\"$1/@glassmkr/crucible/package.json\").version)" 2>/dev/null || true)"
  path_ver="$(glassmkr-crucible --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+[0-9A-Za-z.+-]*' | head -n1 || true)"
  if [ -n "$installed_ver" ] && [ -n "$path_ver" ] && [ "$installed_ver" != "$path_ver" ]; then
    version_differs=1
  fi
  if [ -n "$path_differs" ]; then
    echo "WARNING: 'glassmkr-crucible' on PATH is $resolved (${path_ver:-unknown version}), not npm's own $npm_bin (${installed_ver:-unknown version})."
    echo "         An older standalone binary is shadowing the npm install. Remove $resolved so the new agent version is used, then re-run this installer."
  elif [ -n "$version_differs" ]; then
    echo "WARNING: 'glassmkr-crucible' on PATH ($resolved) reports $path_ver but npm just installed $installed_ver."
    if [ -n "$npm_prefix" ]; then
      echo "         That path is npm's own bin link, so do not delete it. Check 'npm ls -g @glassmkr/crucible' and re-run 'npm install -g @glassmkr/crucible', then re-run this installer."
    else
      echo "         'npm prefix -g' failed, so this installer cannot tell whether that file is npm's; do not delete it. Check 'npm ls -g @glassmkr/crucible' and re-run 'npm install -g @glassmkr/crucible', then re-run this installer."
    fi
  fi
}

main() {
  # L5: a restrictive inherited umask (077, common on CIS-hardened hosts) makes
  # `npm install -g` write the package 0700 root:root, after which the unprivileged
  # service user cannot exec it (203/EXEC). Pin a sane umask for the install.
  umask 022
  echo "=== Glassmkr Crucible Installer ==="

  if [ ! -f /etc/os-release ]; then
    echo "WARN: cannot read /etc/os-release; proceeding on package-manager detection alone."
  else
    . /etc/os-release
    echo "Detected: ${PRETTY_NAME:-unknown}"
  fi

  detect_pkg
  if [ -n "$PKG" ]; then
    echo "Package manager: $PKG"
  else
    echo "No supported package manager (apt/dnf/yum) found; will use existing tools where present."
  fi

  if [ "$EUID" -ne 0 ]; then
    echo "ERROR: please run as root (sudo)"
    exit 1
  fi

  # Args. --dashboard-key kept as a back-compat alias for --api-key.
  local SERVER_NAME=""
  local API_KEY="${GLASSMKR_API_KEY:-}"
  local INGEST_URL="${GLASSMKR_INGEST_URL:-}"
  local NO_START=""
  while [[ $# -gt 0 ]]; do
    case $1 in
      --name) SERVER_NAME="$2"; shift 2 ;;
      --api-key) API_KEY="$2"; shift 2 ;;
      --dashboard-key) API_KEY="$2"; shift 2 ;;
      --ingest-url) INGEST_URL="$2"; shift 2 ;;
      --no-start) NO_START="--no-start"; shift ;;
      *) echo "ignoring unknown arg: $1"; shift ;;
    esac
  done

  if [ -z "$API_KEY" ]; then
    if [ -t 0 ]; then
      read -p "Dashboard API key: " API_KEY
    fi
  fi
  if [ -z "$API_KEY" ]; then
    echo "ERROR: --api-key is required (or set GLASSMKR_API_KEY in the environment)."
    echo "Get one in the Dashboard: https://app.glassmkr.com/servers"
    exit 1
  fi

  # Node 24 (matches the Dockerfile and the publish workflow). The agent's real
  # floor is Node 22.19 (undici 8's engines.node); 24 is what we ship and test.
  if ! command -v node >/dev/null 2>&1; then
    echo "Installing Node.js 24..."
    if ! node_repo_setup; then
      echo "ERROR: Node.js is not installed and this host has no package manager"
      echo "the installer knows how to add a NodeSource repo for."
      echo "Install Node.js 22.19+ with your distribution's tooling, then re-run"
      echo "this script (it will detect the existing node and continue), or do"
      echo "the manual install: 'npm install -g @glassmkr/crucible' then"
      echo "'sudo glassmkr-crucible init --api-key <K>'."
      exit 1
    fi
  fi
  echo "Node.js: $(node --version)"

  # Node 24 ships a bundled npm 11.x. Pull the latest stable quietly so the
  # version stays current and npm does not nag about an available upgrade on
  # every run. If the upgrade fails (sandboxed env, no network, permission
  # issue), fall through and use the bundled npm: non-fatal.
  npm install -g npm@latest >/dev/null 2>&1 || true

  # smartmontools + ipmitool are optional: they widen coverage (SMART / IPMI)
  # but the agent runs and reports without them. Best-effort on every distro.
  if ! command -v smartctl >/dev/null 2>&1; then
    if [ -n "$PKG" ]; then
      echo "Installing smartmontools..."
      pkg_install smartmontools 2>/dev/null || echo "WARN: smartmontools install failed. SMART monitoring will be limited."
    else
      echo "WARN: no package manager to install smartmontools. SMART monitoring will be limited."
    fi
  fi

  if ! command -v ipmitool >/dev/null 2>&1; then
    if [ -n "$PKG" ]; then
      echo "Installing ipmitool (best-effort; may be unavailable in containers)..."
      pkg_install ipmitool 2>/dev/null || echo "WARN: ipmitool not available. IPMI monitoring will be disabled."
    else
      echo "WARN: no package manager to install ipmitool. IPMI monitoring will be disabled."
    fi
  fi

  mkdir -p /var/lib/glassmkr
  chmod 700 /var/lib/glassmkr

  echo "Installing @glassmkr/crucible..."
  npm install -g @glassmkr/crucible
  # L4: pick up the freshly-installed shim (the shell caches command paths), and
  # ensure the package is readable/executable even if a strict umask slipped
  # through above.
  hash -r 2>/dev/null || true
  GM_NODE_ROOT="$(npm root -g 2>/dev/null || true)"
  [ -n "$GM_NODE_ROOT" ] && chmod -R a+rX "$GM_NODE_ROOT/@glassmkr" 2>/dev/null || true
  warn_if_shadowed "$GM_NODE_ROOT"

  # Hand off to init: validates the key, writes /etc/glassmkr/crucible.yaml
  # (and migrates a legacy /etc/glassmkr/collector.yaml in place when present
  # on an upgrade host, preserving any operator edits), writes the systemd
  # unit with the dynamically-detected binary path, runs daemon-reload, and
  # (unless --no-start) enables-and-starts the service.
  local NAME_FLAG=()
  if [ -n "$SERVER_NAME" ]; then
    NAME_FLAG=(--name "$SERVER_NAME")
  fi
  # Self-hosted: pass the ingest URL through, and allowlist exactly its origin
  # so http/private-network endpoints work. The operator typed this URL into
  # the install command, so allowlisting that one origin carries the same
  # consent as the URL itself; init still runs all its other endpoint checks
  # (no credentials in the URL, protocol sanity, DNS resolution).
  local URL_FLAGS=()
  if [ -n "$INGEST_URL" ]; then
    local INGEST_ORIGIN
    INGEST_ORIGIN=$(printf '%s' "$INGEST_URL" | sed -E 's#^(https?://[^/]+).*$#\1#')
    URL_FLAGS=(--ingest-url "$INGEST_URL" --allow-endpoint-origin "$INGEST_ORIGIN")
  fi
  glassmkr-crucible init --api-key "$API_KEY" --force "${NAME_FLAG[@]}" "${URL_FLAGS[@]}" $NO_START

  echo ""
  echo "=== Installation complete ==="
  echo "  systemctl status glassmkr-crucible --no-pager | head -20"
  echo "  journalctl -u glassmkr-crucible -n 50 --no-pager"
  echo "Config: /etc/glassmkr/crucible.yaml"
}

main "$@"
