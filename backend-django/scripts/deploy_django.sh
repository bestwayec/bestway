#!/usr/bin/env bash
# Explicit, reviewable Django cutover. Invoke from the repository checkout:
# bash backend-django/scripts/deploy_django.sh <verified-release-commit-sha>
# Requires existing healthy production stack, secrets, Docker Compose >=2.24.4.
# Prisma alone owns schema migrations; this script never calls Django migrate.
set -euo pipefail
umask 077
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
release_sha="${1:?Pass the exact release commit SHA whose CI succeeded}"
[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'Full commit SHA required'; exit 1; }
[[ "$(git rev-parse HEAD)" == "$release_sha" ]] || { echo 'Checkout differs from release SHA'; exit 1; }
git diff --quiet && git diff --cached --quiet || { echo 'Tracked checkout changes must be reviewed first'; exit 1; }
test -s backend-django/.env || { echo 'backend-django/.env is required'; exit 1; }
test -s backend/.env || { echo 'Existing backend/.env is required'; exit 1; }
if [[ -f .bestway-runtime && "$(cat .bestway-runtime)" == django ]]; then
  echo 'Django is already active; this script is for the initial Nest cutover only'
  exit 1
fi
export BUILD_COMMIT="$release_sha"
nest=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)
django=(docker compose -f docker-compose.django.yml -f docker-compose.django.cutover.yml --profile workers)
# Do not print resolved compose configuration: it includes deployment secrets.
"${nest[@]}" config --quiet
"${django[@]}" config --quiet
"${nest[@]}" exec -T postgres pg_isready -U postgres -d education_center
"${nest[@]}" exec -T backend wget -qO- http://localhost:3001/v1/health >/dev/null
previous_image="$(docker inspect --format '{{.Image}}' "$("${nest[@]}" ps -q backend)")"
[[ "$previous_image" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo 'Previous Nest image identity unavailable'; exit 1; }
"${nest[@]}" build backend
"${django[@]}" build django-api
# Validate production settings before downtime; edge intentionally terminates TLS.
"${django[@]}" run --rm --no-deps django-api python manage.py check --deploy --fail-level ERROR
"${django[@]}" run --rm --no-deps django-api python -c 'import django; django.setup(); from django.conf import settings; assert "backend" in settings.ALLOWED_HOSTS, "ALLOWED_HOSTS must include backend for the existing frontend proxy"'
# Reject modified, failed or foreign migration histories before any DDL or
# downtime. Only unapplied migrations bundled with this release are permitted.
"${django[@]}" run --rm --no-deps django-api python manage.py check_legacy_schema --migration-history-only --allow-pending
mkdir -p backups
backup="backups/before-django-${release_sha:0:12}-$(date -u +%Y%m%dT%H%M%SZ).dump"
"${nest[@]}" exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$backup"
test -s "$backup" || { echo 'Database backup failed'; exit 1; }
"${nest[@]}" exec -T postgres pg_restore --list < "$backup" >/dev/null
echo "Database backup verified: $backup"
rollback_overlay="${backup%.dump}-rollback.yml"
printf 'services:\n  backend:\n    image: %s\n    pull_policy: never\n' "$previous_image" > "$rollback_overlay"
cutover_started=false
rollback() {
  status=$?
  if [[ "$cutover_started" == true && "$status" != 0 ]]; then
    echo 'Cutover failed; stopping Django workers and restoring Nest service routing'
    "${django[@]}" --profile telegram-polling stop django-api assessment-worker game-scheduler telegram-bot || true
    docker compose -f docker-compose.yml -f docker-compose.prod.yml -f "$rollback_overlay" \
      up -d --no-build --wait --wait-timeout 120 backend || true
    "${nest[@]}" restart frontend cloudflared || true
    echo "Database migrations were NOT rolled back. Backup retained at $backup"
  fi
  exit "$status"
}
trap rollback EXIT
cutover_started=true
# Nest runs its schedulers inside the API process. Stop it before starting any
# Django worker, and before assigning the same Docker backend DNS alias.
"${nest[@]}" stop backend
# Override the Nest startup entrypoint: apply authoritative schema only, no API.
"${nest[@]}" run --rm --no-deps --entrypoint npx backend prisma migrate deploy
"${django[@]}" run --rm --no-deps django-api python manage.py check_legacy_schema
"${django[@]}" up -d --wait --wait-timeout 180 django-cache django-api assessment-worker game-scheduler
"${django[@]}" exec -T django-api python -m config.healthcheck
# Nest's process is stopped, so Django may now take exclusive ownership of the
# same Telegram token. Disabled bots stay disabled; webhook initialization exits.
telegram_mode="$("${django[@]}" exec -T django-api python -c 'import os; print(os.environ.get("TELEGRAM_MODE", "polling").lower() if os.environ.get("TELEGRAM_BOT_TOKEN") else "off")')"
if [[ "$telegram_mode" == polling ]]; then
  "${django[@]}" --profile telegram-polling up -d telegram-bot
elif [[ "$telegram_mode" == webhook ]]; then
  "${django[@]}" exec -T django-api python manage.py run_telegram_bot --once
fi
# Restart edge processes to discard any cached DNS or connections to stopped Nest.
"${nest[@]}" restart frontend cloudflared
"${nest[@]}" exec -T frontend wget -qO- http://backend:3001/v1/health >/dev/null
curl -fsS --max-time 30 https://api.bestwayec.uz/v1/health | \
  "${django[@]}" exec -T django-api python -c 'import json,os,sys; assert json.load(sys.stdin)["data"]["buildCommit"] == os.environ["BUILD_COMMIT"], "Public API is not this release"'
curl -fsS --max-time 30 https://bestwayec.uz/ >/dev/null
"${django[@]}" ps
printf 'django\n' > .bestway-runtime
cutover_started=false
echo 'Django API, configured workers and edge routing cutover passed.'
