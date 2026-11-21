"""Durable Telegram notification outbox: enqueue (deduped, preference-aware) and a restart-safe delivery tick.

* No process-local timers or thread pools: state lives in PostgreSQL (TelegramOutbox).
* dedupe_key is unique, so a producer that runs twice (sweeper, retried request, restart) inserts one notification.
* Opt-out (global or per kind) and quiet hours are checked at enqueue time AND at delivery time.
* Delivery claims rows with a short lease; a crashed worker's rows become claimable again after the lease expires.
* Failures: transient errors back off (1m, 5m, 15m, 1h, 6h) up to MAX_ATTEMPTS then 'dead'; permanent errors
  (blocked bot, chat not found) are 'failed' without retries. A 429 pauses the whole tick for Telegram's retry_after.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.legacy_schema.models import User

from . import telegram_delivery as api
from . import telegram_state as state
from .models import TelegramOutbox

logger = logging.getLogger(__name__)
KINDS = ('tests', 'deadlines', 'vocab', 'results', 'feedback', 'attendance', 'teacher', 'announcements')
BACKOFF = (60, 300, 900, 3600, 21600)
MAX_ATTEMPTS = len(BACKOFF) + 1
LEASE = timedelta(seconds=90)
MAX_PER_TICK = 25
PER_MESSAGE_PAUSE = 0.04       # <= 25 messages / second globally (Telegram allows ~30)
MAX_TEXT = 3900


def _tz(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except Exception:  # noqa: BLE001
        return ZoneInfo('Asia/Tashkent')


def quiet_until(pref, now):
    """End of the current quiet period if `now` falls inside it, else None. start == end disables quiet hours."""
    start, end = pref.quiet_start, pref.quiet_end
    if start == end:
        return None
    zone = _tz(pref.timezone)
    local = now.astimezone(zone)
    t = local.time()
    inside = (t >= start or t < end) if start > end else (start <= t < end)
    if not inside:
        return None
    day = local.date()
    if start > end and t >= start:
        day = day + timedelta(days=1)          # evening: the period ends tomorrow morning
    return datetime.combine(day, end, tzinfo=zone).astimezone(now.tzinfo)


def allowed(user_id: str, kind: str) -> bool:
    pref = state.get_preference(user_id)
    return bool(pref.notify_enabled) and kind not in (pref.muted_kinds or [])


def enqueue(user_id: str, kind: str, dedupe_key: str, text: str, keyboard=None, *, now=None, urgent=False):
    """Insert one notification. Returns the row, or None when it already existed / the user opted out."""
    if kind not in KINDS:
        raise ValueError('unknown notification kind')
    now = now or timezone.now()
    if not allowed(user_id, kind):
        return None
    pref = state.get_preference(user_id)
    send_after = now if urgent else (quiet_until(pref, now) or now)
    try:
        with transaction.atomic():
            return TelegramOutbox.objects.create(recipient_id=user_id, kind=kind, dedupe_key=dedupe_key[:255], text=text[:MAX_TEXT],
                                                 keyboard=keyboard, send_after=send_after, next_attempt_at=send_after)
    except IntegrityError:
        return None


def _claim(now, limit):
    with transaction.atomic():
        rows = list(TelegramOutbox.objects.select_for_update(skip_locked=True).filter(
            status__in=('pending', 'sending'), send_after__lte=now, next_attempt_at__lte=now,
        ).exclude(status='sending', locked_until__gt=now).order_by('send_after', 'id')[:limit])
        for row in rows:
            row.status, row.locked_until = 'sending', now + LEASE
            row.save(update_fields=['status', 'locked_until'])
        return rows


def _finish(row, status, error='', retry_in=None, now=None):
    now = now or timezone.now()
    row.status, row.last_error, row.locked_until = status, error[:60], None
    if status == 'sent':
        row.sent_at = now
    if status == 'pending':
        row.next_attempt_at = now + timedelta(seconds=retry_in or 60)
    row.save(update_fields=['status', 'last_error', 'locked_until', 'sent_at', 'next_attempt_at', 'attempts'])


def deliver_due(now=None, *, sleep=time.sleep, limit=MAX_PER_TICK) -> dict:
    """One delivery pass. Safe to run concurrently in several workers and to be killed at any point."""
    now = now or timezone.now()
    stats = dict(sent=0, retried=0, failed=0, skipped=0, dead=0, deferred=0)
    chats_used = set()
    claimed = _claim(now, limit)
    for position, row in enumerate(claimed):
        user = User.objects.filter(id=row.recipient_id, is_active=True).values('telegram_chat_id').first()
        chat = (user or {}).get('telegram_chat_id')
        if not chat:
            _finish(row, 'skipped', 'no_chat', now=now)
            stats['skipped'] += 1
            continue
        if not allowed(row.recipient_id, row.kind):                     # opted out after it was queued
            _finish(row, 'skipped', 'opted_out', now=now)
            stats['skipped'] += 1
            continue
        pref = state.get_preference(row.recipient_id)
        until = quiet_until(pref, now)
        if until is not None:                                           # quiet hours began after it was queued
            row.status, row.locked_until, row.send_after, row.next_attempt_at = 'pending', None, until, until
            row.save(update_fields=['status', 'locked_until', 'send_after', 'next_attempt_at'])
            stats['deferred'] += 1
            continue
        if chat in chats_used:                                          # at most one message per chat per tick
            row.status, row.locked_until, row.next_attempt_at = 'pending', None, now + timedelta(seconds=2)
            row.save(update_fields=['status', 'locked_until', 'next_attempt_at'])
            stats['deferred'] += 1
            continue
        chats_used.add(chat)
        row.attempts += 1
        outcome, detail = api.send_detailed(chat, row.text, dict(inline_keyboard=row.keyboard) if row.keyboard else None)
        if outcome == 'sent':
            _finish(row, 'sent', now=now)
            stats['sent'] += 1
        elif outcome == 'permanent' and detail == 'not_configured':     # worker without a bot token: keep everything queued
            row.attempts -= 1
            for rest in claimed[position:]:
                rest.status, rest.locked_until = 'pending', None
                rest.save(update_fields=['status', 'locked_until', 'attempts'] if rest is row else ['status', 'locked_until'])
            logger.error('TELEGRAM_BOT_TOKEN is not configured: notifications stay queued')
            break
        elif outcome == 'permanent':
            _finish(row, 'failed', str(detail), now=now)
            stats['failed'] += 1
        elif row.attempts >= MAX_ATTEMPTS:
            _finish(row, 'dead', 'retries_exhausted', now=now)
            stats['dead'] += 1
        else:
            _finish(row, 'pending', 'retry', retry_in=max(int(detail or 0), BACKOFF[min(row.attempts - 1, len(BACKOFF) - 1)]), now=now)
            stats['retried'] += 1
            if detail:                                                  # Telegram flood control (429): stop this pass
                for rest in claimed[position + 1:]:                     # hand the untouched claims back immediately
                    rest.status, rest.locked_until = 'pending', None
                    rest.save(update_fields=['status', 'locked_until'])
                break
        sleep(PER_MESSAGE_PAUSE)
    return stats


def status_counts() -> dict:
    from django.db.models import Count
    return dict(TelegramOutbox.objects.values_list('status').annotate(n=Count('id')).order_by())
