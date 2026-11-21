#!/bin/sh
set -eu

deploy_root=${1:?Usage: deploy-release.sh DEPLOY_ROOT RELEASE_SHA}
release_sha=${2:?Usage: deploy-release.sh DEPLOY_ROOT RELEASE_SHA}
release_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
env_file="$deploy_root/.env.oci"
current_link="$deploy_root/current"

case "$deploy_root" in
  /srv/*) ;;
  *) echo "Deploy root must be under /srv" >&2; exit 2 ;;
esac
case "$deploy_root" in
  *[!A-Za-z0-9_./-]*) echo "Deploy root contains unsupported characters" >&2; exit 2 ;;
esac
case "$release_sha" in
  *[!0-9a-f]*|'') echo "Release SHA must be lowercase hexadecimal" >&2; exit 2 ;;
esac
[ "${#release_sha}" -eq 40 ] || { echo "Release SHA must contain 40 characters" >&2; exit 2; }
[ -f "$env_file" ] || { echo "Missing deployment environment file: $env_file" >&2; exit 2; }

mkdir -p "$deploy_root"
if [ ! -f "$deploy_root/.sentry-auth-token" ]; then
  : > "$deploy_root/.sentry-auth-token"
  chmod 600 "$deploy_root/.sentry-auth-token"
fi
export SENTRY_AUTH_TOKEN_FILE="$deploy_root/.sentry-auth-token"
export SENTRY_RELEASE="$release_sha"
export VITE_SENTRY_RELEASE="$release_sha"

compose_at() {
  source_dir=$1
  shift
  docker compose \
    --project-name chess-academy-oci \
    --env-file "$env_file" \
    -f "$source_dir/docker-compose.oci.yml" \
    -f "$source_dir/docker-compose.observability.yml" \
    --profile observability "$@"
}

wait_for_release() {
  source_dir=$1
  attempt=0
  while [ "$attempt" -lt 24 ]; do
    if compose_at "$source_dir" exec -T backend python -c "import urllib.request; urls=['http://backend:8000/health/ready','http://frontend:80/','http://loki:3100/ready','http://alloy:12345/metrics','http://prometheus:9090/-/healthy','http://meta-prometheus:9090/-/healthy','http://alertmanager:9093/-/healthy','http://meta-alertmanager:9093/-/healthy','http://grafana:3000/api/health','http://observability-heartbeat:9100/metrics']; [urllib.request.urlopen(url, timeout=4).read() for url in urls]" \
      && compose_at "$source_dir" exec -T backend python -c "import urllib.request; body=urllib.request.urlopen('http://observability-heartbeat:9100/metrics',timeout=4).read().decode(); components=['api','worker','frontend','search','prometheus','meta_prometheus','alertmanager','meta_alertmanager','grafana','loki','alloy','blackbox_exporter']; assert all('observability_component_healthy{component='+chr(34)+name+chr(34)+'} 1' in body for name in components), body" \
      && compose_at "$source_dir" exec -T worker python -c "import urllib.request; body=urllib.request.urlopen('http://127.0.0.1:8001/metrics', timeout=4).read().decode(); assert 'worker_search_dependency_available 1.0' in body" \
      && compose_at "$source_dir" exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 5
  done
  return 1
}

previous_release=
if [ -L "$current_link" ]; then
  previous_release=$(readlink -f "$current_link" || true)
fi

rollback_release() {
  [ -n "$previous_release" ] && [ -d "$previous_release" ] || return 0
  echo "Rolling application images back to $previous_release." >&2
  ln -sfn "$previous_release" "$current_link.next"
  mv -Tf "$current_link.next" "$current_link"
  compose_at "$previous_release" build
  compose_at "$previous_release" up -d --remove-orphans
  if wait_for_release "$previous_release"; then
    echo "Application rollback completed. Database migrations remain at the newer schema; migrations must remain backward compatible." >&2
  else
    echo "Rollback was started but its health checks failed; inspect the OCI host immediately." >&2
  fi
}

compose_at "$release_dir" config --quiet
compose_at "$release_dir" build
compose_at "$release_dir" run --rm backend alembic upgrade head
ln -sfn "$release_dir" "$current_link.next"
mv -Tf "$current_link.next" "$current_link"
if ! compose_at "$release_dir" up -d --remove-orphans; then
  echo "Release $release_sha failed to start." >&2
  rollback_release
  exit 1
fi

if wait_for_release "$release_dir"; then
  echo "Release $release_sha is healthy."
  exit 0
fi

echo "Release $release_sha failed its health checks." >&2
rollback_release
exit 1
