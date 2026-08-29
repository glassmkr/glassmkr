#!/bin/bash
# Roll back the last deploy. Reads previous SHA from /home/agent/.glassmkr-rollback-sha
# and deploys it.

set -euo pipefail

ROLLBACK_FILE="/home/agent/.glassmkr-rollback-sha"

if [ ! -f "$ROLLBACK_FILE" ]; then
  echo "No rollback SHA recorded at $ROLLBACK_FILE. Aborting."
  exit 1
fi

target_sha="$(cat "$ROLLBACK_FILE")"
if [ -z "$target_sha" ]; then
  echo "Rollback file is empty. Aborting."
  exit 1
fi

echo "Rolling back to $target_sha"
exec /home/agent/glassmkr-sveltekit/scripts/deploy.sh "$target_sha"
