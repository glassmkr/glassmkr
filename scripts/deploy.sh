#!/bin/bash
# Glassmkr deploy script with rollback support.
# Runs on the Services server. Installs into /home/agent/glassmkr-sveltekit.
#
# Usage:
#   ./scripts/deploy.sh           # deploy HEAD of origin/main
#   ./scripts/deploy.sh <sha>     # deploy a specific commit
#
# Environment: may be invoked by GitHub Actions (via ssh-action) or manually.

set -euo pipefail

REPO_DIR="/home/agent/glassmkr-sveltekit"

# --- deploy-mutex:begin ---
# One deploy at a time PER HOST, not merely per workflow. deploy.yml's
# concurrency group serializes workflow runs against each other, but a manual
# run of this script overlapping a workflow run resets and rebuilds the same
# checkout, restarts the same services, and overwrites the same marker files
# concurrently: the torn-build outage shape (2026-05-31) with a second door
# (Codex 2026-08-29 #4). Non-blocking on purpose: the GitHub runner's SSH
# session has a 5-minute command timeout, so queueing behind a long build
# would die mid-wait and look like an infrastructure failure. A refused run
# says exactly what to do instead.
DEPLOY_LOCK="/home/agent/.glassmkr-deploy.lock"
exec 200>"$DEPLOY_LOCK"
if ! flock -n 200; then
  echo "Another deploy holds $DEPLOY_LOCK; refusing to overlap it."
  echo "Wait for it to finish, then re-run (workflow deploys: gh run rerun <id> --failed)."
  exit 1
fi
# --- deploy-mutex:end ---

# Prune decision logic lives in its own sourceable file so it can be unit-tested;
# deploy.sh itself is not sourceable because it runs the deploy at import.
#
# Resolved against the REPO, not against this script's own directory. The two
# are not the same place: GitHub Actions invokes /home/agent/deploy.sh, a copy
# outside the repo, where a path relative to BASH_SOURCE points at
# /home/agent/lib/nginx-prune.sh and does not exist. That broke a deploy on
# 2026-08-28, the first run after the self-sync below started keeping the copy
# current: the copy had been stale for long enough that nobody had noticed it
# was only ever correct when run from inside the repo.
#
# Falls back to the script-relative path so a developer running
# ./scripts/deploy.sh from a checkout still works.
# shellcheck source=scripts/lib/nginx-prune.sh
# Staged copy first: the workflow writes it from the SAME revision as this
# script, so the pair cannot skew. The repo copy is next, for a manual run on
# the box, and the script-relative path last, for a developer in a checkout.
if [ -f "/home/agent/deploy-lib/nginx-prune.sh" ]; then
  . "/home/agent/deploy-lib/nginx-prune.sh"
elif [ -f "$REPO_DIR/scripts/lib/nginx-prune.sh" ]; then
  . "$REPO_DIR/scripts/lib/nginx-prune.sh"
else
  . "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/nginx-prune.sh"
fi
ROLLBACK_FILE="/home/agent/.glassmkr-rollback-sha"
# The revision that is actually SERVING, written only after every health check
# has passed. Distinct from git HEAD on purpose.
#
# HEAD is where the checkout points, which is not the same thing. `git reset
# --hard` moves HEAD before the build, so a deploy that fails at build,
# migration or healthcheck leaves HEAD at the new SHA while production still
# runs the old bundle. The next run then compared HEAD against origin/main,
# found them equal, printed "Already at target SHA. Nothing to do." and exited
# 0. A retry after a failed deploy did nothing, reported success, and left
# production stale: the worst combination available.
DEPLOYED_FILE="/home/agent/.glassmkr-deployed-sha"
# glassmkr-status is NOT here: the status page moved to Cloudflare Pages
# (2026-07-25) so it does not share fate with the infrastructure it reports on.
# apps/status now builds with adapter-cloudflare and emits no build/index.js for
# systemd to run. Deployed with `pnpm --filter @glassmkr/status deploy:cf`.
SERVICES=(glassmkr-site glassmkr-dashboard)
# glassmkr-ops is deploy-managed only while the repo still carries its
# source: after the hosted-glue split it runs as a standalone artifact from
# /home/agent/ops-app (see the private repo's hosted/ runbook) and deploys
# must not stop or restart it.
if [ -d "$REPO_DIR/apps/ops" ]; then
  SERVICES+=(glassmkr-ops)
fi
# Hosted-glue split (2026-08-30): nginx site configs and the ops app are
# moving to the private repository, with server-local homes on this box.
# Prefer the local infra dir once the cutover has created it; fall back to
# the in-repo path so this script works identically before and after the
# cutover and the public-repo removal can land as a separate, safe step.
NGINX_LOCAL_DIR="/home/agent/infra/nginx/sites"
if [ -d "$NGINX_LOCAL_DIR" ]; then
  NGINX_REPO_DIR="$NGINX_LOCAL_DIR"
else
  NGINX_REPO_DIR="$REPO_DIR/infrastructure/nginx/sites"
fi
NGINX_SITES_AVAILABLE="/etc/nginx/sites-available"
NGINX_SITES_ENABLED="/etc/nginx/sites-enabled"

# Sync nginx site configs from the repo's infrastructure/nginx/sites/
# directory into /etc/nginx/sites-available/ via symlinks. Ensures
# sites-enabled symlinks exist, runs `nginx -t`, then reloads nginx
# if any file changed. Closes retrospective F2 (sites-available vs
# sites-enabled drift from manual edits never synced back).
#
# Backout: if `nginx -t` fails after the symlink swap, restore the
# previous file from the .pre-symlink.bak.* snapshot created on
# first run, then abort the deploy. Manual operator follow-up.
sync_nginx_configs() {
  if [ ! -d "$NGINX_REPO_DIR" ]; then
    echo "[deploy:nginx] $NGINX_REPO_DIR does not exist, skipping sync"
    return 0
  fi

  echo "[deploy:nginx] syncing site configs from $NGINX_REPO_DIR"
  local changed=0

  # CONTENT changes count as changes, not only link changes.
  #
  # The loop below manages symlinks: sites-available/<name> points at the repo
  # file. That means when a config's CONTENT changes, the link is already
  # correct, `changed` stays 0, and nginx is never reloaded. The file on disk is
  # right and the running nginx is still serving the previously parsed config,
  # which is the same "a running nginx never re-reads config" trap that caused
  # the 11h45m outage, arriving from the other direction: there, a dangling link
  # was never noticed; here, a correct link hides an edit.
  #
  # Found 2026-08-28 when a Link header added to glassmkr.com deployed, reported
  # "no changes; config validated", and did not take effect. Every nginx content
  # change before this was equally ineffective until some unrelated link change
  # happened to force a reload.
  local repo_sum
  repo_sum=$(cat "$NGINX_REPO_DIR"/* 2>/dev/null | sha256sum | cut -d' ' -f1)
  local sum_file="/var/lib/glassmkr/nginx-configs.sha256"
  sudo mkdir -p "$(dirname "$sum_file")"
  if [ ! -f "$sum_file" ] || [ "$(sudo cat "$sum_file" 2>/dev/null)" != "$repo_sum" ]; then
    echo "[deploy:nginx]   config content changed since last deploy"
    changed=1
  fi

  for repo_file in "$NGINX_REPO_DIR"/*; do
    [ -e "$repo_file" ] || continue
    local filename
    filename=$(basename "$repo_file")
    local target="$NGINX_SITES_AVAILABLE/$filename"
    local enabled_link="$NGINX_SITES_ENABLED/$filename"

    # If target is a regular file (not yet a symlink), snapshot it once.
    if [ -f "$target" ] && [ ! -L "$target" ]; then
      local snap="$target.pre-symlink.bak.$(date -u +%Y%m%dT%H%M%SZ)"
      echo "[deploy:nginx]   snapshotting $target -> $snap"
      sudo cp "$target" "$snap"
    fi

    # If the symlink already points at the right repo file, skip the rest.
    if [ -L "$target" ] && [ "$(readlink "$target")" = "$repo_file" ]; then
      :
    else
      echo "[deploy:nginx]   linking $target -> $repo_file"
      sudo ln -sf "$repo_file" "$target"
      changed=1
    fi

    # Ensure sites-enabled link exists pointing at sites-available.
    if [ ! -L "$enabled_link" ] && [ ! -e "$enabled_link" ]; then
      echo "[deploy:nginx]   enabling $filename"
      sudo ln -sf "$target" "$enabled_link"
      changed=1
    fi
  done

  # PRUNE links whose repo source is gone. The loop above only iterates files that
  # EXIST in the repo, so it can add and relink but never remove; see the header of
  # scripts/lib/nginx-prune.sh for the outage this closes and for why the decision is
  # made from the RESOLVED path rather than the raw readlink text.
  for scope in "$NGINX_SITES_ENABLED" "$NGINX_SITES_AVAILABLE"; do
    [ -d "$scope" ] || continue
    for link in "$scope"/*; do
      if nginx_link_should_prune "$link" "$NGINX_REPO_DIR" "$NGINX_SITES_AVAILABLE"; then
        echo "[deploy:nginx]   pruning dangling link $link (source removed)"
        sudo rm -f "$link"
        changed=1
      fi
    done
  done

  # ALWAYS validate, even when this function changed nothing. `nginx -t` used to run
  # only when changed=1, so a deploy that merely DELETED a repo config did no additive
  # work, reported "no changes", skipped the test, and shipped a broken config
  # silently. Validation is cheap; skipping it is what let the 11h45m outage through.
  echo "[deploy:nginx] running nginx -t"
  if ! sudo nginx -t; then
    echo "[deploy:nginx] FATAL: nginx -t failed after sync. Manual intervention required."
    echo "[deploy:nginx] Snapshots at $NGINX_SITES_AVAILABLE/*.pre-symlink.bak.* preserve previous state."
    return 1
  fi

  if [ "$changed" -eq 0 ]; then
    echo "[deploy:nginx] no changes; config validated"
    return 0
  fi

  echo "[deploy:nginx] reloading nginx"
  sudo systemctl reload nginx
  # Record the content hash only AFTER a successful reload, so a failed deploy
  # does not convince the next one that the running config is current.
  printf '%s' "$repo_sum" | sudo tee "$sum_file" >/dev/null
  echo "[deploy:nginx] sync complete"
}

# === Cutover safety guard (added 2026-05-15) ===
# During the Forge -> Dashboard cutover (CC_RENAME_CUTOVER_PLAN_2026-05-15),
# both glassmkr-forge.service (still serving traffic on port 4003) and
# the new glassmkr-dashboard.service (created in Phase 1B, awaiting Phase 4
# cutover) exist on prod. An auto-deploy in this state would
# `systemctl start glassmkr-dashboard` and hit a port-4003 binding
# conflict because forge is still bound. Refuse to deploy when both
# units exist. The guard auto-clears in Phase 4 when glassmkr-forge.service
# is removed from /etc/systemd/system/.
#
# To bypass this guard for the Phase 4 cutover itself, set
# CUTOVER_OVERRIDE=1 in the deploy environment.
if [ "${CUTOVER_OVERRIDE:-}" != "1" ]; then
  if [ -f /etc/systemd/system/glassmkr-forge.service ] \
     && [ -f /etc/systemd/system/glassmkr-dashboard.service ]; then
    echo "ERROR: cutover transition state detected."
    echo "Both glassmkr-forge.service and glassmkr-dashboard.service exist."
    echo "Refusing to auto-deploy to avoid port-4003 binding conflict."
    echo "See ~/Documents/Glassmkr/CC_RENAME_CUTOVER_PLAN_2026-05-15.md."
    echo "Phase 4 cutover removes glassmkr-forge.service; this guard auto-clears."
    echo "To bypass for Phase 4 itself: set CUTOVER_OVERRIDE=1."
    exit 1
  fi
fi

cd "$REPO_DIR"

# The SHA we are rolling back FROM: the one that last served traffic, read from
# the durable marker rather than from HEAD. On a box that has never completed a
# deploy under this scheme the marker is absent, and an empty value makes the
# guard below fall through to a full deploy, which is the safe direction.
head_sha="$(git rev-parse HEAD)"
current_sha="$(cat "$DEPLOYED_FILE" 2>/dev/null || true)"
echo "Checkout HEAD:  $head_sha"
echo "Last deployed:  ${current_sha:-<unknown, will deploy>}"

# --- rollback-bootstrap:begin ---
# Extracted verbatim and exercised by scripts/deploy-sha-guard.test.mjs. The
# markers exist so the test runs THIS text rather than a copy of it that can
# drift; this repository has shipped a guard whose checked file was not its
# executed file more than once.
#
# Precedence for "what would we roll back to":
#   1. the durable deployed marker, when a deploy has completed before
#   2. ROLLBACK_SHA, supplied by an operator, validated against this repository
#   3. whatever the running service reports it is serving
#   4. nothing, which aborts unless ALLOW_NO_ROLLBACK=1 is given deliberately
#
# Step 2 exists because the previous version printed a recovery command that
# could not work. It told the operator to write the rollback file by hand and
# re-run with the override, but on that re-run the probe failed again and the
# script deleted the file BEFORE reading the override, then continued with no
# target at all. The recovery instruction destroyed the thing it asked for.
# An operator-supplied target is now validated first and never deleted.
rollback_from=""
rollback_source=""

if [ -n "$current_sha" ]; then
  rollback_from="$current_sha"
  rollback_source="the deployed marker"
elif [ -n "${ROLLBACK_SHA:-}" ]; then
  # Validate before trusting: a full 40-character revision this checkout can
  # actually resolve. A short or unknown value is refused rather than recorded,
  # because a rollback to an object git cannot check out is not a rollback.
  if printf '%s' "$ROLLBACK_SHA" | grep -qE '^[0-9a-f]{40}$' && git cat-file -e "${ROLLBACK_SHA}^{commit}" 2>/dev/null; then
    rollback_from="$ROLLBACK_SHA"
    rollback_source="ROLLBACK_SHA supplied by the operator"
  else
    echo "ERROR: ROLLBACK_SHA='${ROLLBACK_SHA}' is not a full 40-character revision"
    echo "       that this checkout contains. Refusing to record it."
    echo "       Try: git fetch --all, then re-run with a full commit SHA."
    exit 1
  fi
else
  echo "No deployed marker yet; asking the running service what it is serving..."
  # /api/v1/version reports dashboard.git_sha, resolved at module load in the
  # deployed checkout, so it is the revision the live handler was built from.
  served_sha="$(curl -sS --max-time 5 http://127.0.0.1:4003/api/v1/version 2>/dev/null \
    | sed -n 's/.*"git_sha"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1 || true)"
  if printf '%s' "$served_sha" | grep -qE '^[0-9a-f]{40}$' && git cat-file -e "${served_sha}^{commit}" 2>/dev/null; then
    rollback_from="$served_sha"
    rollback_source="the running service"
  else
    echo "       (probe returned: '${served_sha:-<no answer>}')"
  fi
fi

if [ -n "$rollback_from" ]; then
  echo "$rollback_from" > "$ROLLBACK_FILE"
  echo "Rollback target: $rollback_from (from $rollback_source)."
else
  # No validated target from any source. Only NOW is it safe to clear a stale
  # file, and only because nothing validated is being discarded.
  rm -f "$ROLLBACK_FILE"
  echo "ERROR: could not determine a revision to roll back to."
  echo
  echo "This would be the FIRST deploy under the marker scheme, and there is"
  echo "no verified revision to roll back to. Proceeding would mean replacing"
  echo "a running production service with no way back to what it was."
  echo
  echo "Fix one of these, then re-run:"
  echo "  * the service is down or not answering /api/v1/version on :4003"
  echo "  * it reports git_sha 'unknown' (built outside a git checkout)"
  echo "  * it reports a revision this checkout does not have (git fetch --all)"
  echo
  echo "Or supply the previous revision yourself. It is validated against this"
  echo "checkout and recorded only if it resolves:"
  echo "  ROLLBACK_SHA=<full-40-char-sha> $0"
  echo
  echo "To deploy with NO rollback target at all, which is rarely right:"
  echo "  ALLOW_NO_ROLLBACK=1 $0"
  if [ "${ALLOW_NO_ROLLBACK:-0}" = "1" ]; then
    echo
    echo "ALLOW_NO_ROLLBACK=1 given: continuing without a verified rollback target."
  else
    exit 1
  fi
fi
# --- rollback-bootstrap:end ---

target="${1:-origin/main}"
echo "Fetching..."
git fetch origin main --tags

# Clear generated artifacts before pull. These files are committed to
# git BUT are also regenerated by apps/site's prebuild (scripts/gen-rules.mjs),
# so after a successful build they show up as modified in the working tree.
# The next deploy's `git pull --ff-only` then refuses to fast-forward over
# them ("Your local changes would be overwritten by merge"), bricking deploys
# fleet-wide until a manual `git checkout --` recovery.
#
# Discard any local modifications to these specific paths so pull is clean.
# We intentionally do NOT `git reset --hard` or stash the whole tree; an
# operator may have intentional uncommitted state elsewhere (rare, but
# preserve it). Failing checkout is tolerated; if the file is already clean
# or missing, no-op.
#
# 2026-05-22: added sitemap.xml after task #164 wired per-rule sitemap
# entries into gen-rules.mjs. Without this, deploys started failing on
# the same fast-forward block as the original llms.txt / rules.json
# trio. Four consecutive prod deploys (#220, #224, #225, #226's merge)
# failed in a row because of this single missing line, leaving prod
# pinned at the pre-Codex-F3 state.
echo "Clearing generated artifacts (regenerated by prebuild)..."
git checkout -- \
  apps/site/src/lib/data/rules.json \
  apps/site/static/llms-full.txt \
  apps/site/static/llms.txt \
  apps/site/static/sitemap.xml 2>/dev/null || true

if [ -n "${1:-}" ]; then
  echo "Checking out explicit target: $target"
  git checkout "$target"
else
  echo "Hard-syncing to origin/main"
  git checkout main
  # Hard reset instead of `pull --ff-only`: the prebuild regenerates tracked
  # artifacts (rules.json, sitemap.xml, llms*.txt) so the working tree is dirty
  # after every deploy. The enumerated `git checkout --` above tries to clear
  # them, but any file it misses wedges a `pull --ff-only` fleet-wide until a
  # manual reset (2026-07-14: a new rule's regenerated sitemap block did exactly
  # that). `reset --hard origin/main` is the robust equivalent for a CD checkout
  # and cannot be blocked by local artifact churn. The same-SHA guard below
  # still short-circuits a genuine no-op deploy.
  git reset --hard origin/main
fi

new_sha="$(git rev-parse HEAD)"

# The invoked copy of this script is refreshed by the deploy workflow, before
# this file is executed (see .github/workflows/deploy.yml). It used to be done
# here instead, which was wrong in a way worth recording: copying from inside
# the running script means the new version only takes effect next time, and the
# first run after it started working failed outright, because the copy resolved
# `lib/nginx-prune.sh` against its own directory rather than the repo. Doing it
# in the workflow makes the file whole before bash opens it and removes the
# one-deploy lag.

echo "New HEAD: $new_sha"

# Compare the TARGET against what is actually serving. If the last completed
# deploy is already this SHA there is genuinely nothing to do; if the marker is
# absent or older, deploy, even when HEAD already points here because a previous
# run reset and then failed.
if [ -n "$current_sha" ] && [ "$current_sha" = "$new_sha" ]; then
  echo "Already deployed and healthy at $new_sha. Nothing to do."
  exit 0
fi
if [ "$head_sha" = "$new_sha" ] && [ "$current_sha" != "$new_sha" ]; then
  echo "HEAD is already at $new_sha but it has never completed a deploy; continuing."
fi

echo "Installing dependencies..."
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# Fail-fast: build BEFORE stopping any service. If the build fails,
# the running services keep serving on their existing build with zero
# downtime. (Prior script stopped services first, then rm -rf'd builds,
# then attempted build — a build failure left services unable to
# restart. This was the 2026-05-14 outage's deploy-side trigger.)
echo "Building (turbo --force)..."
if ! pnpm turbo build --force; then
  echo "Build failed. Services unchanged; deployment aborted."
  exit 1
fi

# Sync nginx configs from repo. Runs after build (so a build failure
# doesn't strand nginx half-updated) and before service restart. If
# `nginx -t` fails after the sync, abort the deploy — services keep
# serving on their existing build.
if ! sync_nginx_configs; then
  echo "Nginx sync failed; aborting deploy. Services unchanged."
  exit 1
fi

# Apply any pending Postgres migrations BEFORE swapping binaries. The
# scripts/migrate-postgres.mjs runner is idempotent (no-op when up to
# date) and uses ON_ERROR_STOP=1 + atomic BEGIN/COMMIT per migration.
# If it fails here, services keep serving on the old build — same
# fail-safe shape as the build + nginx-sync steps above.
#
# Closes the 2026-05-18 incident: PR #135 deploy shipped code that
# read columns added by migration 021, but the migration was never
# run on prod (historical workflow was "operator runs psql by hand").
# Result was a 15h fleet-wide ingest outage. This step removes the
# can-be-skipped manual coupling.
echo "Applying pending Postgres migrations..."
if ! node "$REPO_DIR/scripts/migrate-postgres.mjs"; then
  echo "Migration apply failed; aborting deploy. Services unchanged."
  exit 1
fi

# Apply pending ClickHouse migrations. Same fail-safe shape as the
# Postgres step above. ClickHouse migrations are intentionally
# idempotent (every statement uses IF NOT EXISTS / IF EXISTS) so
# re-running is a no-op. Added 2026-05-20 alongside migration 002
# (snap.gpu column) which is required by the lifecycle.ts ingest
# writer; without this guard the deploy would ship code that fails
# every snapshot insert with "unknown column gpu".
#
# Source the dashboard env so CLICKHOUSE_DATABASE etc. propagate to the
# runner. Without this the runner defaults to DB=dashboard, but prod's
# actual DB is named "glassmkr" (see /etc/glassmkr/dashboard.env), and
# the migration silently no-ops against the wrong DB. The runner reads
# either GMK_CH_* or CLICKHOUSE_* env names; we set them via the env
# file the service already uses so there's a single source of truth.
echo "Applying pending ClickHouse migrations..."
if [[ -f /etc/glassmkr/dashboard.env ]]; then
  # shellcheck disable=SC1091
  set -a; . /etc/glassmkr/dashboard.env; set +a
fi
if ! node "$REPO_DIR/scripts/migrate-clickhouse.mjs"; then
  echo "ClickHouse migration apply failed; aborting deploy. Services unchanged."
  exit 1
fi

# Build + nginx sync + migrations succeeded. Stop -> start -> verify per service.
echo "Stopping services: ${SERVICES[*]}"
sudo systemctl stop "${SERVICES[@]}"

echo "Starting services with per-service active-state verification..."
for svc in "${SERVICES[@]}"; do
  echo "  starting ${svc}..."
  sudo systemctl start "${svc}"
  # Wait up to 60 seconds for the service to reach active state.
  attempts=0
  while [ "$attempts" -lt 12 ]; do
    state="$(systemctl is-active "${svc}.service" 2>/dev/null || true)"
    if [ "$state" = "active" ]; then
      echo "  ${svc}: active"
      break
    fi
    sleep 5
    attempts=$((attempts + 1))
  done
  state="$(systemctl is-active "${svc}.service" 2>/dev/null || true)"
  if [ "$state" != "active" ]; then
    echo "ERROR: ${svc} did not reach active within 60s (state: ${state})."
    echo "Aborting deploy. Other services may be in mixed state — inspect manually."
    exit 1
  fi
done

# Post-restart HTTP healthcheck. systemd "active" only means the process
# started — it does NOT mean the SvelteKit handler is actually answering
# requests. The 2026-05-20 incident: dashboard's build chunks were
# replaced under a running process, systemd reported active, but every
# /api/v1/* request 500'd because the running process couldn't load the
# new chunk filenames. This loop closes that gap by probing the
# unauthenticated /api/v1/health endpoint until it returns 200 (or the
# timeout trips). Only runs against services that match the dashboard
# pattern; other services keep the existing systemd-active gate.
for svc in "${SERVICES[@]}"; do
  case "$svc" in
    glassmkr-dashboard|glassmkr-forge)
      probe_url="http://127.0.0.1:4003/api/v1/health"
      ;;
    *)
      continue
      ;;
  esac
  echo "  verifying ${svc} via ${probe_url}..."
  attempts=0
  http_code=0
  while [ "$attempts" -lt 12 ]; do
    http_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$probe_url" 2>/dev/null || echo 000)"
    if [ "$http_code" = "200" ]; then
      echo "  ${svc}: /api/v1/health returned 200"
      break
    fi
    sleep 5
    attempts=$((attempts + 1))
  done
  if [ "$http_code" != "200" ]; then
    echo "ERROR: ${svc} systemd-active but /api/v1/health returned ${http_code} after 60s."
    echo "Likely cause: stale build chunks, missing migration, or runtime config error."
    echo "Inspect with: sudo journalctl -u ${svc} --since '2 min ago' --no-pager"
    exit 1
  fi
done

# Every service is up and answered /api/v1/health with 200. Only now is this
# revision "deployed": the marker is the thing the next run trusts, so writing
# it any earlier would recreate the silent-no-op trap this exists to close.
echo "$new_sha" > "$DEPLOYED_FILE"

echo "Done. Deployed $new_sha."
# Print a rollback command ONLY when there is a real revision to roll back to.
# `$0 $(cat missing-file)` expands to a bare `$0`, whose target defaults to
# origin/main: a "rollback" that deploys forward. Never print a command whose
# argument might vanish.
rollback_sha="$(cat "$ROLLBACK_FILE" 2>/dev/null || true)"
if printf '%s' "$rollback_sha" | grep -qE '^[0-9a-f]{7,40}$'; then
  echo "To roll back:  $0 $rollback_sha"
  echo "  ($rollback_sha is the revision that served traffic before this deploy.)"
else
  echo "NO ROLLBACK TARGET is recorded, so no rollback command is printed here."
  echo "  Find the previous revision yourself before running $0 <sha>."
  echo "  Do NOT run $0 with no argument to 'go back': with no argument it"
  echo "  deploys origin/main, which is forward, not back."
fi
