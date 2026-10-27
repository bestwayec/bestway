"""Command to trigger daily streak checks and weekly leaderboard reports."""
import logging
import signal
import time
from threading import Event

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.notifications.telegram_tasks import (
    TASHKENT_TZ,
    check_daily_streaks,
    get_tashkent_now,
    send_weekly_leaderboard,
)

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Run Telegram streak notifications check or weekly leaderboard report."

    def add_arguments(self, parser):
        parser.add_argument(
            "--check",
            action="store_true",
            help="Run daily streak check once immediately.",
        )
        parser.add_argument(
            "--leaderboard",
            action="store_true",
            help="Send weekly leaderboard report once immediately.",
        )
        parser.add_argument(
            "--daemon",
            action="store_true",
            help="Run daemon scheduler (daily 20:00 check & Sunday 20:00 leaderboard).",
        )

    def handle(self, *args, **options):
        if options["check"]:
            self.stdout.write(self.style.NOTICE("Running daily streak check..."))
            res = check_daily_streaks()
            self.stdout.write(self.style.SUCCESS(f"Streak check complete: {res}"))
            return

        if options["leaderboard"]:
            self.stdout.write(self.style.NOTICE("Sending weekly leaderboard..."))
            res = send_weekly_leaderboard()
            self.stdout.write(self.style.SUCCESS(f"Leaderboard broadcast complete: {res}"))
            return

        if options["daemon"]:
            self.stdout.write(self.style.SUCCESS("Starting Telegram streak & retention scheduler daemon..."))
            stop_event = Event()

            def _handle_exit(sig, frame):
                self.stdout.write("Shutting down streak scheduler...")
                stop_event.set()

            signal.signal(signal.SIGINT, _handle_exit)
            signal.signal(signal.SIGTERM, _handle_exit)

            last_streak_date = None
            last_leaderboard_week = None

            while not stop_event.is_set():
                now_tashkent = get_tashkent_now()
                today = now_tashkent.date()

                # Daily check at 20:00 Asia/Tashkent
                if now_tashkent.hour >= 20 and last_streak_date != today:
                    self.stdout.write(f"[{now_tashkent}] Triggering 20:00 streak check...")
                    try:
                        res = check_daily_streaks(now_tashkent)
                        self.stdout.write(self.style.SUCCESS(f"Streak check result: {res}"))
                        last_streak_date = today
                    except Exception as e:
                        logger.exception("Error in daemon streak check: %s", e)

                # Weekly Sunday check at 20:05 Asia/Tashkent
                current_cal_week = now_tashkent.isocalendar()[:2]
                if now_tashkent.weekday() == 6 and now_tashkent.hour >= 20 and last_leaderboard_week != current_cal_week:
                    self.stdout.write(f"[{now_tashkent}] Triggering Sunday weekly leaderboard...")
                    try:
                        res = send_weekly_leaderboard(now_tashkent)
                        self.stdout.write(self.style.SUCCESS(f"Weekly leaderboard result: {res}"))
                        last_leaderboard_week = current_cal_week
                    except Exception as e:
                        logger.exception("Error in daemon leaderboard: %s", e)

                stop_event.wait(30)
            return

        # Default: run streak check
        res = check_daily_streaks()
        self.stdout.write(self.style.SUCCESS(f"Daily streak check result: {res}"))
