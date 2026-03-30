#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
mapfile -t SQL_FILES < <(find "$ROOT_DIR/sql" -maxdepth 1 -type f -name '*.sql' | sort)

if [[ "${#SQL_FILES[@]}" -eq 0 ]]; then
  echo "No SQL files found under $ROOT_DIR/sql"
  exit 1
fi

MYSQL_HOST="${MYSQL_HOST:-${DB_HOST:-}}"
MYSQL_PORT="${MYSQL_PORT:-${DB_PORT:-3306}}"
MYSQL_USER="${MYSQL_USER:-${DB_USER:-}}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-${DB_PASSWORD:-}}"
MYSQL_DATABASE="${MYSQL_DATABASE:-${DB_NAME:-}}"

if [[ -z "${MYSQL_HOST}" || -z "${MYSQL_USER}" || -z "${MYSQL_PASSWORD}" || -z "${MYSQL_DATABASE}" ]]; then
  echo "Missing MYSQL_HOST / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE"
  exit 1
fi

for SQL_FILE in "${SQL_FILES[@]}"; do
  MYSQL_PWD="${MYSQL_PASSWORD}" mysql \
    -h "${MYSQL_HOST}" \
    -P "${MYSQL_PORT}" \
    -u "${MYSQL_USER}" \
    "${MYSQL_DATABASE}" < "${SQL_FILE}"
  echo "Applied ${SQL_FILE} to ${MYSQL_DATABASE}@${MYSQL_HOST}:${MYSQL_PORT}"
done
