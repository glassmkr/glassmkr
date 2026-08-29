#!/bin/bash
# Pure decision logic for pruning dangling nginx symlinks, split out of deploy.sh
# so it can be exercised by scripts/test-nginx-prune.sh. Sourcing this file must
# have no side effects: deploy.sh is NOT sourceable (it runs the deploy at import),
# which is why the predicate lives here instead.
#
# Background. sync_nginx_configs() iterates files that EXIST in the repo, so it can
# add and relink but never remove. When a site is decommissioned its config is
# deleted from the repo, `git reset --hard` deletes it from the working tree, and the
# symlink is left dangling. nginx refuses to start on a dangling include, but a
# RUNNING nginx never re-reads config, so the breakage stays invisible until
# something restarts it. status.glassmkr.com moved to Cloudflare Pages on 2026-07-25,
# the link was left behind, and glassmkr.com plus app.glassmkr.com were down for
# 11h45m on 2026-07-31 when an unrelated restart finally tripped over it.

# nginx_link_should_prune <link> <repo_dir> <sites_available>
#
# Exit 0 to prune, non-zero to leave alone.
#
# Decides from the FULLY RESOLVED path, never from the raw `readlink` text. The
# first version of this compared raw targets against absolute patterns, which meant
# a relative link (`../sites-available/foo`, the ordinary way `ln -s` is used and the
# Debian convention) matched no pattern at all. That was not merely a missed prune:
# the sites-available link WAS matched and removed while the sites-enabled link was
# skipped, so on a relative-link host the prune CREATED the dangling state it exists
# to remove. `readlink -f` follows relative targets and multi-hop chains, and still
# returns the final path when that path does not exist, which is exactly the dangling
# case we are looking for.
#
# Only ever removes a link that resolves to something MISSING. A dangling link is
# never load-bearing: nginx cannot serve from it, it can only refuse to start. A live
# link is left strictly alone no matter who owns it.
nginx_link_should_prune() {
  local link="$1" repo_dir="$2" sites_available="$3"
  local resolved

  [ -L "$link" ] || return 1

  # Canonicalise the comparison bases too. `readlink -f` returns a fully resolved
  # path, so comparing it against a base that still contains a symlinked component
  # never matches and the prune silently does nothing. That is not theoretical: it
  # is what /var -> /private/var does on macOS, and any symlinked component of the
  # deploy checkout path would do the same on the host.
  repo_dir=$(readlink -f "$repo_dir" 2>/dev/null || echo "$repo_dir")
  sites_available=$(readlink -f "$sites_available" 2>/dev/null || echo "$sites_available")

  resolved=$(readlink -f "$link" 2>/dev/null || true)
  # An unresolvable link tells us nothing; leave it for a human.
  [ -n "$resolved" ] || return 1
  # Still resolves to something real: not our problem, whoever owns it.
  [ -e "$resolved" ] && return 1

  # Dangling. Ours if the chain reaches into the repo we sync from, or if it lands in
  # sites-available, which nothing but this script manages. The second case matters
  # because once the sites-available link is gone the sites-enabled link can no longer
  # be traced back to the repo, and that orphan is precisely what breaks nginx.
  case "$resolved" in
    "$repo_dir"/*) return 0 ;;
    "$sites_available"/*) return 0 ;;
  esac

  return 1
}
