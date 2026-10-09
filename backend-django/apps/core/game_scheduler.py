"""Separate worker: startup recovery and monthly 00:05 Asia/Tashkent reset."""
from datetime import datetime
import logging
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
        while not stop.is_set():
            current = now()
            if current >= due:
                close_old_connections()
                try: game.monthly_reset()
                except Exception: logging.getLogger(__name__).exception('Game monthly reset failed')
                due = next_due(current)
            stop.wait(min(30, max(0.05, (due-now()).total_seconds())))
    finally: close_old_connections()
