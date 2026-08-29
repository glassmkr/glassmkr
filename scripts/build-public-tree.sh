#!/bin/sh
# Materialise the tree that becomes the public repository's first commit.
#
# The public repo is a fresh squashed history, so this is a curation step, not a
# git filter: everything tracked, minus every path in PUBLIC_REPO_EXCLUDE.txt.
# It was done by hand for the first rehearsals, which meant the staged tree
# silently went stale whenever the branch moved on. A stale tree is worse than
# no tree, because a gate run against it reports on code that will not ship.
#
# Usage: ./scripts/build-public-tree.sh <destination>
set -eu

DEST="${1:?usage: build-public-tree.sh <destination>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

EXCLUDES="$ROOT/PUBLIC_REPO_EXCLUDE.txt"
[ -f "$EXCLUDES" ] || { echo "missing $EXCLUDES" >&2; exit 1; }

rm -rf "$DEST"
mkdir -p "$DEST"

# Tracked files only: an untracked local scratch file must never reach the tree
# just because it happens to sit in the working directory.
git ls-files -z > /tmp/.public-tree-files.$$
tar --null -cf - -T /tmp/.public-tree-files.$$ | (cd "$DEST" && tar -xf -)
rm -f /tmp/.public-tree-files.$$

# Then remove every excluded prefix. Comments and blank lines are skipped.
removed=0
while IFS= read -r line; do
  case "$line" in ''|\#*) continue ;; esac
  if [ -e "$DEST/$line" ]; then
    rm -rf "$DEST/$line"
    removed=$((removed + 1))
  fi
done < "$EXCLUDES"

echo "public tree: $(find "$DEST" -type f | wc -l | tr -d ' ') file(s), $removed excluded path(s) removed"
echo "  -> $DEST"
