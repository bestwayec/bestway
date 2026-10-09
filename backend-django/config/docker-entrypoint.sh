#!/bin/sh
set -eu
# Production server/worker processes require a compatible authoritative schema.
# Read-only management checks remain usable before applying Prisma migrations.
case "$*" in
  gunicorn*|*manage.py\ run_assessment_worker*|*manage.py\ run_game_scheduler*|*manage.py\ run_telegram_bot*)
    python manage.py check_legacy_schema
    ;;
esac
exec "$@"
