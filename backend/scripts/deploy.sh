#!/usr/bin/env bash
#
# Deploy the ZoikoMeds API on the Compute Engine VM.
#
# The restart target is detected from what is actually running on the host --
# the docker compose `api` service, a pm2 process, or a systemd unit. The host
# has changed hands between them, and a hardcoded guess either fails outright or
# "succeeds" while the previous build keeps serving.
#
# Run it on the VM, from anywhere:
#     bash /var/www/zoiko-meds-platform/backend/scripts/deploy.sh <COMMIT_SHA>
#
# Override any of these if the host differs:
#     REPO_DIR   checkout root                (default /var/www/zoiko-meds-platform)
#     BRANCH     branch the SHA must be on    (default main)
#     PM2_NAME   pm2 process name             (default zoikomeds-api)
#     CONTAINER_NAME docker container name       (default zoikomeds-api)
#     SYSTEMD_UNIT systemd unit               (default zoikomeds-api)
#     PORT       port the API listens on      (default 8000)
#     API_PREFIX global route prefix          (default api)
#     SKIP_MIGRATE=1 to skip prisma migrate deploy
#
# Order matters: dependencies -> generate -> migrate -> build -> restart.
# Migrations run before the restart so the new code never starts against a
# schema it does not expect, and the script aborts on any failure rather than
# leaving a half-deployed service.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/var/www/zoiko-meds-platform}"
BRANCH="${BRANCH:-main}"
PM2_NAME="${PM2_NAME:-zoikomeds-api}"
CONTAINER_NAME="${CONTAINER_NAME:-zoikomeds-api}"
SYSTEMD_UNIT="${SYSTEMD_UNIT:-zoikomeds-api}"
PORT="${PORT:-8000}"
API_PREFIX="${API_PREFIX:-api}"

log() { printf '\n[deploy] %s\n' "$*"; }

cd "$REPO_DIR"

# --- the exact commit this run is authorised to deploy ------------------------
#
# Mandatory, and exact. This used to be `git reset --hard origin/$BRANCH`, which
# deployed whatever main pointed at the moment the script happened to run --
# not the commit whose CI run authorised the deploy. If main advanced between
# CI going green and this script starting, production received a commit that no
# successful CI run had ever tested, and the workflow still reported success.
#
# The SHA now travels unbroken from github.event.workflow_run.head_sha, through
# the workflow's DEPLOY_SHA env var and the SSH command, to the reset below.
#
# There is deliberately NO fallback to origin/$BRANCH. A missing or unusable
# SHA must fail the deploy loudly; silently widening it to "latest main" is the
# precise bug this block exists to remove.
DEPLOY_SHA="${1:-${DEPLOY_SHA:-}}"

if [ -z "$DEPLOY_SHA" ]; then
  echo "[deploy] FAILED: no deploy SHA given." >&2
  echo "[deploy] Usage: bash $0 <full-40-character-commit-sha>" >&2
  echo "[deploy]    or: DEPLOY_SHA=<sha> bash $0" >&2
  echo "[deploy] This script will not fall back to origin/$BRANCH." >&2
  exit 1
fi

# Normalise before anything compares this against git's own (lowercase) output.
DEPLOY_SHA=$(printf '%s' "$DEPLOY_SHA" | tr 'A-F' 'a-f')

# Full 40 hex only. An abbreviated SHA can turn ambiguous as the repository
# grows, and accepting a branch or tag name here would reintroduce exactly the
# floating target this check exists to eliminate.
case "$DEPLOY_SHA" in
  *[!0-9a-f]* | "")
    echo "[deploy] FAILED: deploy SHA is not hexadecimal -- refusing." >&2
    exit 1
    ;;
esac
if [ ${#DEPLOY_SHA} -ne 40 ]; then
  echo "[deploy] FAILED: deploy SHA must be the full 40 characters (got ${#DEPLOY_SHA})." >&2
  exit 1
fi

log "Fetching $BRANCH"
# Explicit refspec: the ancestry check below reads refs/remotes/origin/$BRANCH,
# so that ref has to be updated -- not merely FETCH_HEAD.
git fetch --prune origin "+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}"

# The commit object must actually be here after the fetch.
if ! git cat-file -e "${DEPLOY_SHA}^{commit}" 2>/dev/null; then
  echo "[deploy] FAILED: $DEPLOY_SHA is not a commit in this repository" >&2
  echo "[deploy] (checked after fetching $BRANCH)." >&2
  exit 1
fi

# And it must be on $BRANCH. This is what stops an arbitrary commit -- one from
# an unmerged branch, a fork, or one dropped from main by a force-push -- from
# reaching production through the manual deploy path.
if ! git merge-base --is-ancestor "$DEPLOY_SHA" "origin/${BRANCH}"; then
  echo "[deploy] FAILED: $DEPLOY_SHA is not reachable from origin/${BRANCH}." >&2
  echo "[deploy] Refusing to deploy a commit that is not on ${BRANCH}." >&2
  exit 1
fi

log "Checking out exactly $DEPLOY_SHA"
# -B so this works whether or not the local branch exists or is currently
# checked out; --force because the working tree must match the commit exactly.
# Note this may move the local branch BACKWARDS when main has already advanced:
# that is the point -- the commit that passed CI is what ships.
git checkout --quiet --force -B "$BRANCH" "$DEPLOY_SHA"
git reset --hard "$DEPLOY_SHA"

# Prove the checkout landed where it was told, rather than assuming it did.
actual_sha=$(git rev-parse HEAD)
if [ "$actual_sha" != "$DEPLOY_SHA" ]; then
  echo "[deploy] FAILED: HEAD is $actual_sha but $DEPLOY_SHA was authorised." >&2
  exit 1
fi
log "Now at $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"

cd "$REPO_DIR/backend"

# Dev dependencies are required here, not optional: `nest build` comes from
# @nestjs/cli and the prisma CLI is a devDependency too. Installing with
# --omit=dev would break both the build and the migration step.
log "Installing dependencies"
npm ci

log "Generating Prisma client"
npx prisma generate

if [ "${SKIP_MIGRATE:-0}" != "1" ]; then
  # Printed first so the log shows what was pending, against which datasource,
  # before anything is applied. `migrate deploy` alone reports only what it did,
  # which is no help when the answer is "nothing, and here is why".
  log "Migration status before applying"
  npx prisma migrate status || true

  log "Applying migrations"
  # A failed migration already recorded in the ledger makes this exit non-zero
  # (P3009) and, with set -e, aborts the deploy before the restart. That is the
  # intended outcome: the running build keeps serving a schema it matches, and
  # resolving the failure is a deliberate act (`prisma migrate resolve`) rather
  # than something a deploy script guesses at.
  npx prisma migrate deploy
else
  # Loud, because this is how code reaches production ahead of its schema. Every
  # query touching a new column then fails at runtime while the deploy looks
  # clean — which is exactly what happened to SavedMedicine on 2026-08-17.
  log "WARNING: SKIP_MIGRATE=1 — migrations NOT applied."
  log "WARNING: the build about to start may expect columns the database lacks."
  npx prisma migrate status || true
fi

log "Building"
if ! npm run build; then
  echo "[deploy] FAILED: nest build exited non-zero -- see the compiler output above." >&2
  exit 1
fi

# dist/main.js is what the runtime starts: both `start:prod` and the Dockerfile
# CMD name it. A build can succeed and still put it somewhere else -- any .ts
# outside src/ in the compilation moves TypeScript's inferred rootDir up to
# backend/, which emits dist/src/main.js instead. Print the layout so the next
# failure names itself rather than looking like an empty build.
if [ ! -f dist/main.js ]; then
  echo "[deploy] FAILED: dist/main.js missing after build" >&2
  echo "[deploy] dist/ contains:" >&2
  find dist -maxdepth 2 -name '*.js' -print 2>/dev/null | head -20 >&2 || true
  echo "[deploy] If main.js sits under dist/src/, tsconfig.build.json has lost its" >&2
  echo "[deploy] rootDir/outDir pin -- restore that rather than moving files." >&2
  exit 1
fi

cd "$REPO_DIR/backend"
# Order matters: look for something this host has actually run before falling
# back to what the repo merely describes. `docker compose ps --services` lists
# services defined in the committed compose file, so it matches on any host with
# docker installed -- including a pm2 host -- and must not be the first test.
if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER_NAME"; then
  log "Rebuilding and restarting the docker compose api service"
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build api
  restarted="docker:api"
elif command -v pm2 >/dev/null 2>&1 && pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  log "Restarting pm2 process $PM2_NAME"
  # --update-env so a changed .env is picked up instead of inherited stale.
  pm2 restart "$PM2_NAME" --update-env
  pm2 save || true
  restarted="pm2:$PM2_NAME"
elif systemctl list-units --full --all 2>/dev/null | grep -q "${SYSTEMD_UNIT}.service"; then
  log "Restarting systemd unit $SYSTEMD_UNIT"
  sudo systemctl restart "$SYSTEMD_UNIT"
  restarted="systemd:$SYSTEMD_UNIT"
elif docker compose ps --services 2>/dev/null | grep -qx api; then
  # Nothing has run here yet, but compose describes the service: first release.
  log "No existing process found; starting the compose api service for the first time"
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build api
  restarted="docker:api"
else
  # Falling through would leave the previous build serving while the job goes
  # green -- the exact drift this script exists to prevent.
  echo "[deploy] FAILED: no restart target found (no compose 'api' service, no pm2" >&2
  echo "[deploy] process '$PM2_NAME', no systemd unit '$SYSTEMD_UNIT')." >&2
  exit 1
fi

# Poll rather than sleep-and-hope: the process needs a moment to bind the port.
log "Waiting for health on 127.0.0.1:$PORT/$API_PREFIX/health"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/${API_PREFIX}/health" >/dev/null 2>&1; then
    log "Healthy after ${i}s — restarted via $restarted"

    # A bound port is not a working release. The migrations above ran against
    # whatever DATABASE_URL this shell has; the API may read a different
    # database (a container's env overrides the host .env), in which case every
    # query touching a new column fails while this script reports success —
    # which is exactly what happened to SavedMedicine on 2026-08-17. Ask the
    # running process what its own database says, and report the datasource it
    # names so a mismatch is visible rather than inferred.
    schema=$(curl -fsS "http://127.0.0.1:${PORT}/${API_PREFIX}/health/schema" 2>/dev/null || echo '')
    if [ -z "$schema" ]; then
      log "WARNING: /health/schema did not answer. This build predates it, or the"
      log "WARNING: process is not serving yet. Schema state is UNVERIFIED."
    else
      log "Schema as the API sees it: $schema"
      case "$schema" in
        *'"status":"ok"'*)
          log "Schema is up to date on the database the API actually reads."
          ;;
        *)
          echo "[deploy] FAILED: the API is serving against a schema that is not up to date." >&2
          echo "[deploy] $schema" >&2
          echo "[deploy] The 'detail' field above says what will reconcile it. Two cases" >&2
          echo "[deploy] look alike from here and are not: 'behind' means migrations were" >&2
          echo "[deploy] applied to a different database than the API reads (compare the" >&2
          echo "[deploy] datasource above with \$DATABASE_URL as this shell sees it), while" >&2
          echo "[deploy] 'drift' means the ledger is complete but the tables are not, which" >&2
          echo "[deploy] no amount of 'migrate deploy' will fix." >&2
          exit 1
          ;;
      esac
    fi

    log "Deployed $(git rev-parse --short HEAD)"
    exit 0
  fi
  sleep 1
done

echo "[deploy] FAILED: no health response after 30s. Recent logs:" >&2
case "${restarted%%:*}" in
  docker) docker compose logs --tail 40 api >&2 || true ;;
  pm2)    pm2 logs "$PM2_NAME" --lines 40 --nostream >&2 || true ;;
  *)      sudo journalctl -u "$SYSTEMD_UNIT" -n 40 --no-pager >&2 || true ;;
esac
exit 1
