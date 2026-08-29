#!/bin/bash
# Crucible installer for Ubuntu/Debian. Installs Node + smartmontools +
# ipmitool, npm-installs @glassmkr/crucible, then delegates config/systemd
# setup to `glassmkr-crucible init` (Crucible 0.9.1+).
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

main() {
  echo "=== Glassmkr Crucible Installer ==="

  # OS check
  if [ ! -f /etc/os-release ]; then
    echo "ERROR: cannot detect OS. Only Ubuntu and Debian are supported."
    exit 1
  fi
  . /etc/os-release
  if [[ "$ID" != "ubuntu" && "$ID" != "debian" ]]; then
    echo "ERROR: only Ubuntu and Debian are supported. Detected: $ID"
    exit 1
  fi
  echo "Detected: $PRETTY_NAME"

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

  # Node 24 (matches the Dockerfile and the publish workflow)
  if ! command -v node >/dev/null 2>&1; then
    echo "Installing Node.js 24..."
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
    apt-get install -y nodejs
  fi
  echo "Node.js: $(node --version)"

  # Node 24 ships a bundled npm 11.x. Pull the latest stable quietly so the
  # version stays current and npm does not nag about an available upgrade on
  # every run. If the upgrade fails (sandboxed env, no network, permission
  # issue), fall through and use the bundled npm: non-fatal.
  npm install -g npm@latest >/dev/null 2>&1 || true

  if ! command -v smartctl >/dev/null 2>&1; then
    echo "Installing smartmontools..."
    apt-get install -y smartmontools
  fi

  if ! command -v ipmitool >/dev/null 2>&1; then
    echo "Installing ipmitool (best-effort; may be unavailable in containers)..."
    apt-get install -y ipmitool 2>/dev/null || echo "WARN: ipmitool not available. IPMI monitoring will be disabled."
  fi

  mkdir -p /var/lib/glassmkr
  chmod 700 /var/lib/glassmkr

  echo "Installing @glassmkr/crucible..."
  npm install -g @glassmkr/crucible

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
  glassmkr-crucible init --api-key "$API_KEY" "${NAME_FLAG[@]}" "${URL_FLAGS[@]}" $NO_START

  echo ""
  echo "=== Installation complete ==="
  echo "  systemctl status glassmkr-crucible --no-pager | head -20"
  echo "  journalctl -u glassmkr-crucible -n 50 --no-pager"
  echo "Config: /etc/glassmkr/crucible.yaml"
}

main "$@"
