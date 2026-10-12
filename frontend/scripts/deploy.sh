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
#     bash /var/www/zoiko-meds-platform/frontend/scripts/deploy.sh <COMMIT_SHA>
#
# Override any of these if the host differs:
#     REPO_DIR    checkout root            (default /var/www/zoiko-meds-platform)
#     BRANCH      branch the SHA must be on (default main)
#     PUBLIC_URL  URL nginx serves dist/ at (default https://app.zoikomeds.com)
set -euo pipefail

REPO_DIR="${REPO_DIR:-/var/www/zoiko-meds-platform}"
BRANCH="${BRANCH:-main}"
PUBLIC_URL="${PUBLIC_URL:-https://app.zoikomeds.com}"

log() { printf '\n[deploy-frontend] %s\n' "$*"; }

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
  echo "[deploy-frontend] FAILED: no deploy SHA given." >&2
  echo "[deploy-frontend] Usage: bash $0 <full-40-character-commit-sha>" >&2
  echo "[deploy-frontend]    or: DEPLOY_SHA=<sha> bash $0" >&2
  echo "[deploy-frontend] This script will not fall back to origin/$BRANCH." >&2
  exit 1
fi

# Normalise before anything compares this against git's own (lowercase) output.
DEPLOY_SHA=$(printf '%s' "$DEPLOY_SHA" | tr 'A-F' 'a-f')

# Full 40 hex only. An abbreviated SHA can turn ambiguous as the repository
# grows, and accepting a branch or tag name here would reintroduce exactly the
# floating target this check exists to eliminate.
case "$DEPLOY_SHA" in
  *[!0-9a-f]* | "")
    echo "[deploy-frontend] FAILED: deploy SHA is not hexadecimal -- refusing." >&2
    exit 1
    ;;
esac
if [ ${#DEPLOY_SHA} -ne 40 ]; then
  echo "[deploy-frontend] FAILED: deploy SHA must be the full 40 characters (got ${#DEPLOY_SHA})." >&2
  exit 1
fi

log "Fetching $BRANCH"
# Explicit refspec: the ancestry check below reads refs/remotes/origin/$BRANCH,
# so that ref has to be updated -- not merely FETCH_HEAD.
git fetch --prune origin "+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}"

# The commit object must actually be here after the fetch.
if ! git cat-file -e "${DEPLOY_SHA}^{commit}" 2>/dev/null; then
  echo "[deploy-frontend] FAILED: $DEPLOY_SHA is not a commit in this repository" >&2
  echo "[deploy-frontend] (checked after fetching $BRANCH)." >&2
  exit 1
fi

# And it must be on $BRANCH. This is what stops an arbitrary commit -- one from
# an unmerged branch, a fork, or one dropped from main by a force-push -- from
# reaching production through the manual deploy path.
if ! git merge-base --is-ancestor "$DEPLOY_SHA" "origin/${BRANCH}"; then
  echo "[deploy-frontend] FAILED: $DEPLOY_SHA is not reachable from origin/${BRANCH}." >&2
  echo "[deploy-frontend] Refusing to deploy a commit that is not on ${BRANCH}." >&2
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
  echo "[deploy-frontend] FAILED: HEAD is $actual_sha but $DEPLOY_SHA was authorised." >&2
  exit 1
fi
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
