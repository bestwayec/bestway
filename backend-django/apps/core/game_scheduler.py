"""Separate worker: startup recovery, monthly 00:05 reset, daily 20:00 streak check & Sunday leaderboard."""
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from django.db import close_old_connections
from django.utils import timezone

from . import game

ZONE = ZoneInfo('Asia/Tashkent')


def next_due(now):
    now = now.astimezone(ZONE)
    due = datetime(now.year, now.month, 1, 0, 5, tzinfo=ZONE)
    if due <= now:
        year, month = (now.year+1, 1) if now.month==12 else (now.year, now.month+1)
        due = datetime(year, month, 1, 0, 5, tzinfo=ZONE)
    return due


def run(stop, once=False, now=timezone.now):
    close_old_connections()
    try:
        game.startup_recovery()
        if once: return
        due = next_due(now())
        last_streak_date = None
        last_leaderboard_week = None

        while not stop.is_set():
            current = now()
            current_tashkent = current.astimezone(ZONE)
            today = current_tashkent.date()

            # 1. Monthly Reset
            if current >= due:
                close_old_connections()
                try:
                    game.monthly_reset()
                except Exception:
                    logging.getLogger(__name__).exception('Game monthly reset failed')
                due = next_due(current)

            # 2. Daily Streak Check at 20:00 Asia/Tashkent
            if current_tashkent.hour >= 20 and last_streak_date != today:
                close_old_connections()
                try:
                    from apps.notifications.telegram_tasks import check_daily_streaks
                    check_daily_streaks(current)
                    last_streak_date = today
                except Exception:
                    logging.getLogger(__name__).exception('Telegram daily streak check failed')

            # 3. Sunday Weekly Leaderboard at 20:05 Asia/Tashkent
            cal_week = current_tashkent.isocalendar()[:2]
            if (
                current_tashkent.weekday() == 6
                and current_tashkent.hour >= 20
                and current_tashkent.minute >= 5
                and last_leaderboard_week != cal_week
            ):
                close_old_connections()
                try:
                    from apps.notifications.telegram_tasks import send_weekly_leaderboard
                    send_weekly_leaderboard(current)
                    last_leaderboard_week = cal_week
                except Exception:
                    logging.getLogger(__name__).exception('Telegram weekly leaderboard failed')

            stop.wait(min(30, max(0.05, (due-now()).total_seconds())))
    finally:
        close_old_connections()
