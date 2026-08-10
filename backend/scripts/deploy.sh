#!/usr/bin/env bash
#
# Deploy the ZoikoMeds API on a Compute Engine VM that runs Node directly under
# pm2 or systemd (no docker compose — the container path in
# .github/workflows/deploy.yml never matched this host).
#
# Run it on the VM, from anywhere:
#     bash /var/www/zoiko-meds-platform/backend/scripts/deploy.sh
#
# Override any of these if the host differs:
#     REPO_DIR   checkout root                (default /var/www/zoiko-meds-platform)
#     BRANCH     branch to deploy             (default main)
#     PM2_NAME   pm2 process name             (default zoikomeds-api)
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
SYSTEMD_UNIT="${SYSTEMD_UNIT:-zoikomeds-api}"
PORT="${PORT:-8000}"
API_PREFIX="${API_PREFIX:-api}"

log() { printf '\n[deploy] %s\n' "$*"; }

cd "$REPO_DIR"

log "Updating $BRANCH"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"
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
  log "Applying migrations"
  npx prisma migrate deploy
else
  log "Skipping migrations (SKIP_MIGRATE=1)"
fi

log "Building"
npm run build

# dist/main.js is what start:prod runs; if it is missing the build silently
# produced nothing and restarting would take the API down.
if [ ! -f dist/main.js ]; then
  echo "[deploy] FAILED: dist/main.js missing after build" >&2
  exit 1
fi

log "Rebuilding and restarting Docker container"
cd "$REPO_DIR/backend"
docker compose up -d --build api
restarted="docker:api"

# Poll rather than sleep-and-hope: the process needs a moment to bind the port.
log "Waiting for health on 127.0.0.1:$PORT/$API_PREFIX/health"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/${API_PREFIX}/health" >/dev/null 2>&1; then
    log "Healthy after ${i}s — restarted via $restarted"
    log "Deployed $(git rev-parse --short HEAD)"
    exit 0
  fi
  sleep 1
done

echo "[deploy] FAILED: no health response after 30s. Recent logs:" >&2
if [ "${restarted%%:*}" = "pm2" ]; then
  pm2 logs "$PM2_NAME" --lines 40 --nostream >&2 || true
else
  sudo journalctl -u "$SYSTEMD_UNIT" -n 40 --no-pager >&2 || true
fi
exit 1
