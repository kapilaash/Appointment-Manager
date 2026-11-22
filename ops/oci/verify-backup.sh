#!/bin/sh
# Prove that a backup can actually be restored: load it into a throwaway, network-isolated
# PostgreSQL container, run sanity checks, then delete the container.
#
#   sh ops/oci/verify-backup.sh                      # newest dump in $BACKUP_DIR (default .backups/)
#   sh ops/oci/verify-backup.sh path/to/file.dump    # a specific dump
#
# Optional: BACKUP_VERIFY_HEARTBEAT_URL is requested after a successful check, so an external
# dead-man monitor alerts you if verification stops happening or starts failing.
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
backup_dir=${BACKUP_DIR:-"$project_dir/.backups"}
backup_file=${1:-$(ls -1t "$backup_dir"/chess_academy-*.dump 2>/dev/null | head -n 1 || true)}
postgres_image=${POSTGRES_IMAGE:-postgres:16-alpine}

if [ -z "$backup_file" ] || [ ! -s "$backup_file" ]; then
  echo "verify-backup: no backup file found (looked in $backup_dir)" >&2
  exit 1
fi

container="chess-backup-verify-$$"
password=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

echo "verify-backup: restoring $(basename "$backup_file") into a disposable database"
docker run -d --rm --name "$container" --network none \
  -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB=restore_check \
  "$postgres_image" >/dev/null

attempt=0
until docker exec "$container" pg_isready -U postgres -d restore_check >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    echo "verify-backup: temporary PostgreSQL did not start" >&2
    exit 1
  fi
  sleep 1
done
# The image restarts the server once after initialisation; wait for the final start.
sleep 2
until docker exec "$container" pg_isready -U postgres -d restore_check >/dev/null 2>&1; do sleep 1; done

docker exec "$container" psql -U postgres -d restore_check -q -c "CREATE EXTENSION IF NOT EXISTS btree_gist" >/dev/null
# Stream the dump in, so this works the same on Linux servers and Windows/macOS workstations.
docker exec -i "$container" pg_restore --no-owner --no-privileges --exit-on-error \
  -U postgres -d restore_check < "$backup_file"

query() { docker exec "$container" psql -U postgres -d restore_check -tAc "$1"; }
fail() { echo "verify-backup: FAILED - $1" >&2; exit 1; }

revision=$(query "SELECT version_num FROM alembic_version" || true)
[ -n "$revision" ] || fail "no migration version recorded"
for table in users instructors availability_rules appointments change_requests outbox_events; do
  [ "$(query "SELECT to_regclass('public.$table') IS NOT NULL")" = "t" ] || fail "table $table is missing"
done
admins=$(query "SELECT count(*) FROM users WHERE role = 'admin' AND is_active")
[ "$admins" -ge 1 ] || fail "no active administrator in the backup"
users=$(query "SELECT count(*) FROM users")
appointments=$(query "SELECT count(*) FROM appointments")

echo "verify-backup: OK - migration $revision, $users users ($admins active admins), $appointments appointments"
if [ -n "${BACKUP_VERIFY_HEARTBEAT_URL:-}" ]; then
  curl -fsS --max-time 10 "$BACKUP_VERIFY_HEARTBEAT_URL" >/dev/null || echo "verify-backup: heartbeat ping failed" >&2
fi
