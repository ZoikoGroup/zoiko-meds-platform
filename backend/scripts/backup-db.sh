#!/usr/bin/env bash
set -euo pipefail

BUCKET="gs://zoikomeds-db-backups"
CONTAINER="zoikomeds-db"
DB_NAME="zoikomeds"
DB_USER="postgres"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="/tmp/zoikomeds-backups"
BACKUP_FILE="$BACKUP_DIR/zoikomeds-${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[backup] Starting dump at $(date)"
docker exec "$CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$BACKUP_FILE"

if [ ! -s "$BACKUP_FILE" ]; then
  echo "[backup] FAILED: backup file is empty or missing" >&2
  exit 1
fi

SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[backup] Dump complete: $BACKUP_FILE ($SIZE)"

echo "[backup] Uploading to $BUCKET"
gcloud storage cp "$BACKUP_FILE" "$BUCKET/"

echo "[backup] Cleaning up local file"
rm -f "$BACKUP_FILE"

echo "[backup] Done at $(date)"
