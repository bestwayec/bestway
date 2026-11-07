#!/usr/bin/env bash
# Run from the VPS checkout after the CI and production approval gates.
#
#   prepare <sha>   build images while the live stack keeps serving traffic and
#                   record the images that are live right now for rollback.
#   activate <sha>  verified backup -> migrations -> canonical content import ->
#                   swap application containers -> health checks. If the swap or
#                   any later check fails, the previous application images are
#                   restored. Database migrations are never reversed automatically;
#                   the verified backup path is printed instead.
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
export BUILD_COMMIT="$release" DOCKER_BUILDKIT=1 BUILDKIT_PROGRESS=plain
compose=(docker compose -f docker-compose.yml)

# Application services swapped on activate, and the image tag each one runs.
app_services=(backend frontend assessment-worker game-scheduler telegram-bot)
declare -A live_image=([backend]=bestway-django:local [frontend]=bestway-frontend:local)
rollback_file=.local/rollback-images
started=$SECONDS
phase() { printf '\n==> [%s +%ss] %s\n' "$(date -u +%H:%M:%S)" "$((SECONDS - started))" "$*"; }

case "$stage" in
  prepare)
    phase "Validate compose configuration"
    "${compose[@]}" config --quiet
    free_kb=$(df -Pk "$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /)" | awk 'NR==2 {print $4}')
    echo "Free space for Docker: $((free_kb / 1024)) MiB"
    (( free_kb > 2 * 1024 * 1024 )) || { echo 'Less than 2 GiB free for Docker; build would fail. Free space first.' >&2; exit 1; }

    # Record what is live *before* the build retags :local, and pin it with a tag
    # so the previous release survives dangling-image cleanup.
    phase "Record live images for rollback"
    mkdir -p .local
    : > .local/rollback-images.tmp
    for svc in "${!live_image[@]}"; do
      cid=$("${compose[@]}" ps -q "$svc" 2>/dev/null | head -n1 || true)
      [[ -n "$cid" ]] || { echo "No running $svc container; nothing to roll back to"; continue; }
      image_id=$(docker inspect --format '{{.Image}}' "$cid")
      docker tag "$image_id" "bestway-rollback/$svc:previous"
      printf '%s %s\n' "$svc" "$image_id" >> .local/rollback-images.tmp
      echo "$svc rollback image: $image_id"
    done
    mv .local/rollback-images.tmp "$rollback_file"

    # BuildKit keeps its layer cache on the VPS. Never recreate live services here.
    phase "Build release images"
    timeout 30m "${compose[@]}" build db-migrator backend frontend
    printf '%s\n' "$release" > .local/prepared-release.tmp
    mv .local/prepared-release.tmp .local/prepared-release
    phase "Prepared $release"
    ;;
  activate)
    [[ -f .local/prepared-release && "$(cat .local/prepared-release)" == "$release" ]] || { echo 'Release was not prepared' >&2; exit 1; }
    phase "Validate compose configuration"
    "${compose[@]}" config --quiet

    phase "Back up and verify database"
    mkdir -p backups
    backup="backups/before-release-${release:0:12}-$(date -u +%Y%m%dT%H%M%SZ).dump"
    "${compose[@]}" exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup"
    test -s "$backup"
    "${compose[@]}" exec -T postgres pg_restore --list < "$backup" >/dev/null
    echo "Verified database backup: $backup"

    swapped=0
    rollback() {
      [[ -s "$rollback_file" ]] || { echo 'No recorded rollback images; manual recovery required.' >&2; return 1; }
      while read -r svc image_id; do
        [[ -n "${live_image[$svc]:-}" ]] || continue
        docker tag "$image_id" "${live_image[$svc]}"
        echo "Restored $svc -> $image_id" >&2
      done < "$rollback_file"
      timeout 8m "${compose[@]}" up -d --no-build --no-deps --wait --wait-timeout 300 "${app_services[@]}"
    }
    failed() {
      status=$?
      trap - ERR
      echo "Deployment failed (status $status) after $((SECONDS - started))s. Backup: $backup" >&2
      "${compose[@]}" ps || true
      "${compose[@]}" logs --no-color --tail 100 "${app_services[@]}" || true
      if (( swapped )); then
        echo 'Rolling back application containers to the previous release images.' >&2
        if rollback; then
          echo 'ROLLED BACK: previous application images are serving again. Migrations stay applied.' >&2
        else
          echo 'ROLLBACK FAILED: inspect the stack manually.' >&2
        fi
      else
        echo 'Live application containers were not replaced.' >&2
      fi
      exit "$status"
    }
    trap failed ERR

    # Both migration systems and the canonical content run in one-off containers
    # from the new images, so a failure here leaves the live stack untouched.
    phase "Start data services"
    timeout 5m "${compose[@]}" up -d --no-build --wait --wait-timeout 180 postgres django-cache
    phase "Apply Prisma migrations"
    timeout 5m "${compose[@]}" run --rm --no-deps db-migrator
    phase "Apply Django migrations"
    timeout 5m "${compose[@]}" run --rm --no-deps backend python manage.py migrate --noinput
    phase "Import canonical Record Mock 1"
    timeout 5m "${compose[@]}" run --rm --no-deps backend python manage.py import_cd_record_mock_1

    phase "Replace application containers"
    swapped=1
    timeout 8m "${compose[@]}" up -d --no-build --wait --wait-timeout 300 "${app_services[@]}"
    phase "Health checks"
    "${compose[@]}" exec -T backend python -m config.healthcheck
    curl -fsS --max-time 10 --retry 15 --retry-delay 2 --retry-all-errors http://127.0.0.1:3001/v1/health >/dev/null
    curl -fsS --max-time 10 --retry 15 --retry-delay 2 --retry-all-errors http://127.0.0.1:3005/ >/dev/null
    "${compose[@]}" ps
    trap - ERR
    phase "Activated $release"
    ;;
  *) echo 'Unknown deployment stage' >&2; exit 2 ;;
esac
