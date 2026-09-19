#!/usr/bin/env bash
#
# Deploy the ZoikoMeds platform SPA (Vite) to app.zoikomeds.com.
#
# nginx serves frontend/dist/ as static files directly — there is no process
# to restart. That means a successful `npm run build` looks identical to a
# successful deploy from the shell's point of view, even when nginx is still
# serving yesterday's files (wrong directory, a stale symlink, a build that
# silently wrote to the wrong path). This script does not trust "the build
# exited 0" as proof of anything; it proves the public URL is actually
# serving the bundle this run just produced before it reports success.
#
# Run it on the VM, from anywhere:
#     bash /var/www/zoiko-meds-platform/frontend/scripts/deploy.sh
#
# Override any of these if the host differs:
#     REPO_DIR    checkout root            (default /var/www/zoiko-meds-platform)
#     BRANCH      branch to deploy         (default main)
#     PUBLIC_URL  URL nginx serves dist/ at (default https://app.zoikomeds.com)
set -euo pipefail

REPO_DIR="${REPO_DIR:-/var/www/zoiko-meds-platform}"
BRANCH="${BRANCH:-main}"
PUBLIC_URL="${PUBLIC_URL:-https://app.zoikomeds.com}"

log() { printf '\n[deploy-frontend] %s\n' "$*"; }

cd "$REPO_DIR"

log "Updating $BRANCH"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"
log "Now at $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"

cd "$REPO_DIR/frontend"

log "Installing dependencies"
npm ci

log "Building"
if ! npm run build; then
  echo "[deploy-frontend] FAILED: vite build exited non-zero -- see the compiler output above." >&2
  exit 1
fi

if [ ! -f dist/index.html ]; then
  echo "[deploy-frontend] FAILED: dist/index.html missing after build." >&2
  echo "[deploy-frontend] dist/ contains:" >&2
  find dist -maxdepth 1 2>/dev/null >&2 || true
  exit 1
fi

# The hash in the built entry script's filename is what actually distinguishes
# this build from the previous one — comparing it against what the public URL
# serves is the only real proof nginx picked up the new files. Grepping the
# main index chunk specifically (not any hashed filename in the page) because
# vendor/asset chunks can be unchanged between builds even when the app code
# is not.
NEW_HASH=$(grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' dist/index.html | head -1)
if [ -z "$NEW_HASH" ]; then
  echo "[deploy-frontend] FAILED: could not find an assets/index-*.js reference in dist/index.html." >&2
  echo "[deploy-frontend] The build output shape may have changed; update this script's grep pattern." >&2
  exit 1
fi
log "This build's entry bundle: $NEW_HASH"

# Poll rather than sleep-and-hope: Cloudflare sits in front of this origin,
# and a proxy layer between the build and the assertion is exactly the kind
# of gap that lets "the workflow was green" and "the site is stale" coexist.
log "Waiting for $PUBLIC_URL to serve $NEW_HASH"
for i in $(seq 1 30); do
  served=$(curl -fsS "$PUBLIC_URL/" 2>/dev/null | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1 || echo "")
  if [ "$served" = "$NEW_HASH" ]; then
    log "Live after ${i}s — $PUBLIC_URL is serving $NEW_HASH"
    log "Deployed $(git rev-parse --short HEAD)"
    exit 0
  fi
  sleep 2
done

echo "[deploy-frontend] FAILED: $PUBLIC_URL never served $NEW_HASH after 60s." >&2
echo "[deploy-frontend] Last hash seen from the public URL: ${served:-<none>}" >&2
echo "[deploy-frontend] The build succeeded and dist/ has the right files locally --" >&2
echo "[deploy-frontend] the gap is between dist/ and what the public URL returns." >&2
echo "[deploy-frontend] Check: nginx root path for app.zoikomeds.com, whether it" >&2
echo "[deploy-frontend] points at this exact dist/ directory, and Cloudflare's cache" >&2
echo "[deploy-frontend] (a Page Rule or Cache Rule caching HTML would show this exact" >&2
echo "[deploy-frontend] symptom -- check cf-cache-status on a direct curl -I)." >&2
exit 1
