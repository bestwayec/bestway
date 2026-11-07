#!/usr/bin/env bash
# Run from the VPS checkout after the CI and production approval gates.
set -Eeuo pipefail
umask 077
cd "$(dirname "${BASH_SOURCE[0]}")/.."
stage=${1:?Expected prepare or activate}
release=${2:?Expected full commit SHA}
[[ "$release" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid release SHA' >&2; exit 1; }
exec 9>"$(git rev-parse --git-dir)/bestway-deploy.lock"
flock -n 9 || { echo 'Another deployment holds the VPS lock' >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$release" ]] || { echo 'Checkout changed since approval' >&2; exit 1; }
git diff --quiet && git diff --cached --quiet || { echo 'Tracked changes present' >&2; exit 1; }
test -s backend-django/.env || { echo 'Django environment missing' >&2; exit 1; }
export BUILD_COMMIT="$release" DOCKER_BUILDKIT=1
compose=(docker compose -f docker-compose.yml)
case "$stage" in
  prepare)
    # BuildKit keeps its layer cache on the VPS. Never recreate live services here.
    "${compose[@]}" config --quiet
    timeout 30m "${compose[@]}" build db-migrator backend frontend
    mkdir -p .local
    printf '%s\n' "$release" > .local/prepared-release.tmp
    mv .local/prepared-release.tmp .local/prepared-release
    ;;
  activate)
    [[ -f .local/prepared-release && "$(cat .local/prepared-release)" == "$release" ]] || { echo 'Release was not prepared' >&2; exit 1; }
    "${compose[@]}" config --quiet
    mkdir -p backups
    backup="backups/before-release-${release:0:12}-$(date -u +%Y%m%dT%H%M%SZ).dump"
    "${compose[@]}" exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup"
    test -s "$backup"
    "${compose[@]}" exec -T postgres pg_restore --list < "$backup" >/dev/null
    echo "Verified database backup: $backup"
    failed() {
      status=$?
      echo "Deployment failed (status $status); migrations are not automatically reversed. Backup: $backup" >&2
      "${compose[@]}" ps || true
      "${compose[@]}" logs --no-color --tail 100 db-migrator backend frontend assessment-worker game-scheduler telegram-bot || true
      exit "$status"
    }
    trap failed ERR
    # Apply the two migration systems explicitly, before starting new workers.
    timeout 5m "${compose[@]}" up -d --no-build --wait --wait-timeout 180 postgres django-cache
    timeout 5m "${compose[@]}" run --rm --no-deps db-migrator
    timeout 5m "${compose[@]}" run --rm --no-deps backend python manage.py migrate --noinput
    timeout 8m "${compose[@]}" up -d --no-build --wait --wait-timeout 300 backend frontend assessment-worker game-scheduler telegram-bot
    "${compose[@]}" exec -T backend python -m config.healthcheck
    curl -fsS --max-time 10 --retry 15 --retry-delay 2 --retry-all-errors http://127.0.0.1:3005/ >/dev/null
    "${compose[@]}" ps
    trap - ERR
    ;;
  *) echo 'Unknown deployment stage' >&2; exit 2 ;;
esac
