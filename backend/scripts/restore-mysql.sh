#!/usr/bin/env bash
# Restore a backup made by backup-mysql.sh into a database. REFUSES to overwrite a non-empty database unless FORCE=yes.
# Run it as a PRIVILEGED user (DB_USERNAME/DB_PASSWORD here are that user).
# Usage:  DB_HOST=... DB_USERNAME=... DB_PASSWORD=... TARGET_DB=aivistro_restore ./scripts/restore-mysql.sh backups/aivistro-<stamp>.sql.gz[.enc]
# Practise this on a scratch database regularly: a backup you have never restored is not a backup.
set -euo pipefail
FILE="${1:?backup file}"; : "${DB_HOST:?}" "${DB_USERNAME:?}" "${DB_PASSWORD:?}" "${TARGET_DB:?}"
MYSQL="${MYSQL:-mysql}"; export MYSQL_PWD="$DB_PASSWORD"
args=(-h "$DB_HOST" -P "${DB_PORT:-3306}" -u "$DB_USERNAME")
existing=$("$MYSQL" "${args[@]}" -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${TARGET_DB}'")
if [[ "$existing" != "0" && "${FORCE:-}" != "yes" ]]; then echo "$TARGET_DB already has $existing tables. Set FORCE=yes to overwrite." >&2; exit 1; fi
# Needs a user that may create/write the target database (not the app's runtime user, which should not have CREATE DATABASE).
"$MYSQL" "${args[@]}" -e "CREATE DATABASE IF NOT EXISTS \`${TARGET_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"
reader=(cat "$FILE"); [[ "$FILE" == *.enc ]] && reader=(openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE -in "$FILE")
"${reader[@]}" | { [[ "$FILE" == *.gz* ]] && gunzip || cat; } | "$MYSQL" "${args[@]}" "$TARGET_DB"
echo "restored into $TARGET_DB: $("$MYSQL" "${args[@]}" -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${TARGET_DB}'") tables"
