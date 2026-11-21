#!/bin/sh
set -eu
umask 077

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
backup_dir=${BACKUP_DIR:-"$project_dir/.backups"}
compose_file="$project_dir/docker-compose.oci.yml"
env_file="$project_dir/.env.oci"

mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_file="$backup_dir/chess_academy-$timestamp.dump"
temporary_file="$backup_file.partial"
trap 'rm -f "$temporary_file"' EXIT

docker compose --env-file "$env_file" -f "$compose_file" exec -T postgres \
  sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --format=custom --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"' \
  > "$temporary_file"

mv "$temporary_file" "$backup_file"
chmod 600 "$backup_file"
find "$backup_dir" -type f -name 'chess_academy-*.dump' -mtime +7 -delete
trap - EXIT
printf '%s\n' "$backup_file"
