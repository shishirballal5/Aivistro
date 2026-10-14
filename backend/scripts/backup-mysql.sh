#!/usr/bin/env bash
# Consistent logical backup of the AIVISTRO database (InnoDB snapshot, no table locks).
# Usage:  DB_HOST=... DB_PORT=3306 DB_USERNAME=... DB_PASSWORD=... DB_NAME=... ./scripts/backup-mysql.sh [output-dir]
# The dump user needs SELECT, SHOW VIEW, TRIGGER, EVENT and RELOAD-free (single-transaction). Newer mysqldump clients may warn about masking
# policies on servers they do not know: the script treats a missing end marker, not the warning, as failure.
# Optional: BACKUP_PASSPHRASE=... encrypts the file with AES-256 (openssl). Keep the passphrase somewhere other than the backup.
# For production also enable point-in-time recovery (binary logs / your provider's PITR): this script is the daily full copy.
set -euo pipefail
: "${DB_HOST:?}" "${DB_USERNAME:?}" "${DB_PASSWORD:?}" "${DB_NAME:?}"
OUT="${1:-./backups}"; mkdir -p "$OUT"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"; FILE="$OUT/${DB_NAME}-${STAMP}.sql.gz"
MYSQLDUMP="${MYSQLDUMP:-mysqldump}"
MYSQL_PWD="$DB_PASSWORD" "$MYSQLDUMP" -h "$DB_HOST" -P "${DB_PORT:-3306}" -u "$DB_USERNAME" \
  --single-transaction --routines --triggers --events --hex-blob --set-gtid-purged=OFF --no-tablespaces "$DB_NAME" | gzip -9 > "$FILE"
# A dump that stopped half way is worse than none: prove it is complete (mysqldump writes this marker last) BEFORE encrypting.
gunzip -c "$FILE" | tail -c 400 | grep -q -- "-- Dump completed" || { echo "backup INCOMPLETE (no end marker): do not rely on $FILE" >&2; rm -f "$FILE"; exit 1; }
if [[ -n "${BACKUP_PASSPHRASE:-}" ]]; then
  openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_PASSPHRASE -in "$FILE" -out "$FILE.enc" && rm "$FILE" && FILE="$FILE.enc"
fi
SIZE=$(wc -c < "$FILE" | tr -d ' ')
[[ "$SIZE" -gt 1024 ]] || { echo "backup suspiciously small ($SIZE bytes): treat as FAILED" >&2; exit 1; }
echo "backup written: $SIZE bytes" >&2
echo "$FILE"   # stdout is ONLY the path, so callers can do FILE=$(./backup-mysql.sh)
