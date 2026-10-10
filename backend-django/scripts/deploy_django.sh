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
previous_container="$("${nest[@]}" ps -q backend)"
[[ "$previous_container" =~ ^[0-9a-f]{12,64}$ ]] || { echo 'Previous Nest container identity unavailable'; exit 1; }
"${nest[@]}" build backend
"${django[@]}" build django-api
# Match the running backend, not merely two possibly edited env files. Hashes
# stay inside this shell; neither connection string is written to logs.
nest_database_hash="$(docker exec "$previous_container" node -e 'process.stdout.write(require("crypto").createHash("sha256").update(process.env.DATABASE_URL || "").digest("hex"))')"
django_database_hash="$("${django[@]}" run --rm --no-deps django-api python -c 'import hashlib,os; print(hashlib.sha256(os.environ["DATABASE_URL"].encode()).hexdigest())')"
[[ "$nest_database_hash" == "$django_database_hash" ]] || { echo 'Django and the running Nest backend must use the same DATABASE_URL'; exit 1; }
# Existing web and Tauri sessions must remain verifiable after the cutover.
nest_jwt_hash="$(docker exec "$previous_container" node -e 'process.stdout.write(require("crypto").createHash("sha256").update(process.env.JWT_SECRET || "").digest("hex"))')"
django_jwt_hash="$("${django[@]}" run --rm --no-deps django-api python -c 'import hashlib,os; print(hashlib.sha256(os.environ["JWT_SECRET"].encode()).hexdigest())')"
[[ "$nest_jwt_hash" == "$django_jwt_hash" ]] || { echo 'Django JWT_SECRET differs from running Nest; copy the existing secret before cutover'; exit 1; }
# Verify the image's runtime UID can write the existing shared volume before
# stopping production. Preserve all existing ownership and media files.
"${django[@]}" run --rm --no-deps django-api python -c 'import os,tempfile; fd,path=tempfile.mkstemp(prefix=".bestway-deploy-write-",dir=os.environ["STORAGE_DIR"]); os.close(fd); os.unlink(path)'
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
cutover_started=false
rollback() {
  status=$?
  if [[ "$cutover_started" == true && "$status" != 0 ]]; then
    echo 'Cutover failed; stopping Django workers and restoring Nest service routing'
    if ! "${django[@]}" --profile telegram-polling stop django-api assessment-worker game-scheduler telegram-bot; then
      echo 'Django shutdown failed; Nest was not restarted to avoid duplicate workers. Inspect the running containers.'
      echo "Database migrations were NOT rolled back. Backup retained at $backup"
      exit "$status"
    fi
    # The original stopped container retains its exact image, environment and
    # mounts. Recreating it from this release's compose could also reconcile
    # PostgreSQL and would not restore the previous running configuration.
    if docker start "$previous_container" >/dev/null; then
      nest_ready=false
      for attempt in {1..60}; do
        if docker exec "$previous_container" wget -qO- http://localhost:3001/v1/health >/dev/null 2>&1; then
          nest_ready=true
          break
        fi
        sleep 2
      done
      if [[ "$nest_ready" == true ]]; then
        "${nest[@]}" restart frontend cloudflared || true
      else
        echo 'Previous Nest container did not recover health; inspect its logs before resuming traffic.'
      fi
    else
      echo 'Previous Nest container could not be restarted; manual recovery is required.'
    fi
    echo "Database migrations were NOT rolled back. Backup retained at $backup"
  fi
  exit "$status"
}
trap rollback EXIT
# Convert catchable cancellation signals into failures so EXIT recovery runs.
trap 'exit 130' INT
trap 'exit 143' TERM
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
wait_for_public_readiness() {
  local attempt public_health
  # Restarted frontend and Cloudflare tunnel need time to reconnect. Each probe
  # is bounded; an old API revision or an unavailable site must not pass cutover.
  for attempt in {1..30}; do
    if "${nest[@]}" exec -T frontend wget -qO- -T 5 http://backend:3001/v1/health >/dev/null 2>&1 &&
      public_health="$(curl -fsS --connect-timeout 3 --max-time 5 https://api.bestwayec.uz/v1/health 2>/dev/null)" &&
      printf '%s' "$public_health" | "${django[@]}" exec -T django-api python -c 'import json,os,sys
try:
    matches = json.load(sys.stdin)["data"]["buildCommit"] == os.environ["BUILD_COMMIT"]
except (ValueError, KeyError, TypeError):
    matches = False
sys.exit(0 if matches else 1)' 2>/dev/null &&
      curl -fsS --connect-timeout 3 --max-time 5 https://bestwayec.uz/ >/dev/null 2>&1; then
      return 0
    fi
    echo "Waiting for public API release and website readiness ($attempt/30)"
    if [[ "$attempt" -lt 30 ]]; then sleep 2; fi
  done
  echo 'Public API release and website readiness failed after 30 attempts' >&2
  return 1
}
# Restart edge processes to discard any cached DNS or connections to stopped Nest.
"${nest[@]}" restart frontend cloudflared
wait_for_public_readiness
"${django[@]}" ps
printf 'django\n' > .bestway-runtime
cutover_started=false
echo 'Django API, configured workers and edge routing cutover passed.'
