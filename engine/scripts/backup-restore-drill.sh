#!/usr/bin/env bash
# backup-restore-drill.sh — operational-minimum backup/restore verification
# for the paid private alpha. Dumps the local dev Postgres, restores the dump
# into a fresh, throwaway container (never touches the running dev DB as a
# restore target), and checks that every application table has the same row
# count in both. Exits non-zero with a clear message on any mismatch or
# unexpected error.
#
# Usage: engine/scripts/backup-restore-drill.sh
# Requires: docker, and a running Postgres container matching
# SOURCE_CONTAINER (below) with SOURCE_DB / SOURCE_USER credentials.
#
# This does NOT touch the source container's data — it only reads from it
# (pg_dump) and creates/destroys its own separate temporary container.

set -euo pipefail

SOURCE_CONTAINER="${SOURCE_CONTAINER:-notary-check-pg}"
SOURCE_DB="${SOURCE_DB:-notary_check}"
SOURCE_USER="${SOURCE_USER:-postgres}"
SOURCE_PASSWORD="${SOURCE_PASSWORD:-postgres}"
PG_IMAGE="${PG_IMAGE:-postgres:16-alpine}"

RESTORE_CONTAINER="notary-check-pg-restore-drill-$$"
RESTORE_PASSWORD="restore-drill-password"
RESTORE_PORT="${RESTORE_PORT:-5433}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="$(mktemp -d)"
DUMP_FILE="$WORK_DIR/notary_check.dump"

# Tables that must exist in the schema and be verified. Kept in sync with the
# migrations under engine/migrations/ — update this list when a migration
# adds or drops an application table.
TABLES=(organization review evidence claim evidence_match "user" organization_api_key usage_event waitlist_signup)

RESTORE_CONTAINER_STARTED=0

cleanup() {
  if [[ "$RESTORE_CONTAINER_STARTED" == "1" ]]; then
    echo "==> Tearing down temporary container $RESTORE_CONTAINER"
    docker rm -f "$RESTORE_CONTAINER" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

echo "==> Step 1/5: Verifying source container '$SOURCE_CONTAINER' is running"
docker inspect -f '{{.State.Running}}' "$SOURCE_CONTAINER" 2>/dev/null | grep -q true \
  || fail "source container '$SOURCE_CONTAINER' is not running"

echo "==> Step 1/5: Dumping database '$SOURCE_DB' from '$SOURCE_CONTAINER' (pg_dump, custom format)"
docker exec -e PGPASSWORD="$SOURCE_PASSWORD" "$SOURCE_CONTAINER" \
  pg_dump -U "$SOURCE_USER" -d "$SOURCE_DB" -Fc -f /tmp/notary_check_drill.dump
docker cp "$SOURCE_CONTAINER:/tmp/notary_check_drill.dump" "$DUMP_FILE"
docker exec "$SOURCE_CONTAINER" rm -f /tmp/notary_check_drill.dump
[[ -s "$DUMP_FILE" ]] || fail "dump file is empty or missing at $DUMP_FILE"
echo "    dump written to $DUMP_FILE ($(du -h "$DUMP_FILE" | cut -f1))"

echo "==> Step 2/5: Starting fresh, separate Postgres container '$RESTORE_CONTAINER' on port $RESTORE_PORT"
docker run -d --name "$RESTORE_CONTAINER" \
  -e POSTGRES_PASSWORD="$RESTORE_PASSWORD" \
  -e POSTGRES_DB="$SOURCE_DB" \
  -e POSTGRES_USER="$SOURCE_USER" \
  -p "$RESTORE_PORT:5432" \
  "$PG_IMAGE" >/dev/null
RESTORE_CONTAINER_STARTED=1

echo "    waiting for '$RESTORE_CONTAINER' to accept connections..."
for i in $(seq 1 30); do
  if docker exec -e PGPASSWORD="$RESTORE_PASSWORD" "$RESTORE_CONTAINER" pg_isready -U "$SOURCE_USER" -d "$SOURCE_DB" >/dev/null 2>&1; then
    break
  fi
  if [[ "$i" == "30" ]]; then
    fail "restore container '$RESTORE_CONTAINER' never became ready"
  fi
  sleep 1
done

echo "==> Step 3/5: Restoring dump into '$RESTORE_CONTAINER'"
docker cp "$DUMP_FILE" "$RESTORE_CONTAINER:/tmp/notary_check_drill.dump"
docker exec -e PGPASSWORD="$RESTORE_PASSWORD" "$RESTORE_CONTAINER" \
  pg_restore -U "$SOURCE_USER" -d "$SOURCE_DB" --no-owner --no-privileges /tmp/notary_check_drill.dump \
  || fail "pg_restore reported an error"

echo "==> Step 4/5: Verifying row counts match for every table"
MISMATCH=0
for tbl in "${TABLES[@]}"; do
  src_count=$(docker exec -e PGPASSWORD="$SOURCE_PASSWORD" "$SOURCE_CONTAINER" \
    psql -U "$SOURCE_USER" -d "$SOURCE_DB" -tAc "SELECT count(*) FROM \"$tbl\"")
  restored_count=$(docker exec -e PGPASSWORD="$RESTORE_PASSWORD" "$RESTORE_CONTAINER" \
    psql -U "$SOURCE_USER" -d "$SOURCE_DB" -tAc "SELECT count(*) FROM \"$tbl\"")
  src_count="$(echo "$src_count" | tr -d '[:space:]')"
  restored_count="$(echo "$restored_count" | tr -d '[:space:]')"

  if [[ "$src_count" == "$restored_count" ]]; then
    echo "    OK   $tbl: source=$src_count restored=$restored_count"
  else
    echo "    MISMATCH $tbl: source=$src_count restored=$restored_count"
    MISMATCH=1
  fi
done

echo "==> Step 5/5: Tearing down temporary container"
# (also happens via the EXIT trap; done explicitly here too so the log makes
# the ordering clear even though cleanup() will no-op on the second call)
docker rm -f "$RESTORE_CONTAINER" >/dev/null 2>&1 || true
RESTORE_CONTAINER_STARTED=0

if [[ "$MISMATCH" != "0" ]]; then
  fail "row count mismatch detected between source and restored database — see MISMATCH lines above"
fi

echo "==> PASS: backup/restore drill succeeded, all ${#TABLES[@]} tables match"
