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

from apps.legacy_schema.models import Group, User
from common.api.exceptions import ContractAPIException

from . import telegram_delivery as api
from . import telegram_state as state
from .models import TelegramClassroomBinding, TelegramOutbox

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


def enqueue(user_id: str, kind: str, dedupe_key: str, text: str, keyboard=None, *, now=None, urgent=False, group_id: str | None = None, chat_id_override: str | None = None):
    """Insert one notification. Returns the row, or None when it already existed / opted out / group unbound."""
    if kind not in KINDS:
        raise ValueError('unknown notification kind')
    now = now or timezone.now()
    chat_target = str(chat_id_override) if chat_id_override is not None else None
    if group_id or chat_target:
        if not group_id or not chat_target:
            return None
        if not TelegramClassroomBinding.objects.filter(
            group_id=group_id, chat_id=chat_target, is_active=True, bot_can_post=True,
            verified_telegram_id__isnull=False,
        ).exists():
            return None
        send_after = now
    else:
        if not allowed(user_id, kind):
            return None
        pref = state.get_preference(user_id)
        send_after = now if urgent else (quiet_until(pref, now) or now)
    try:
        with transaction.atomic():
            return TelegramOutbox.objects.create(
                recipient_id=user_id,
                kind=kind,
                dedupe_key=dedupe_key[:255],
                group_id=group_id,
                chat_id_override=chat_target,
                text=text[:MAX_TEXT],
                keyboard=keyboard,
                send_after=send_after,
                next_attempt_at=send_after,
            )
    except IntegrityError:
        return None


def invalidate_group_queue(group_id: str, reason: str = 'group_disconnected') -> int:
    """Immediately invalidate all pending/sending outbox items targeting a disconnected classroom."""
    return TelegramOutbox.objects.filter(
        group_id=group_id,
        status__in=('pending', 'sending'),
    ).update(status='skipped', last_error=reason[:60], locked_until=None)


def _claim(now, limit):
    with transaction.atomic():
        rows = list(TelegramOutbox.objects.select_for_update(skip_locked=True).filter(
            status__in=('pending', 'sending'), send_after__lte=now, next_attempt_at__lte=now,
        ).exclude(status='sending', locked_until__gt=now).order_by('send_after', 'id')[:limit])
        for row in rows:
            row.status, row.locked_until = 'sending', now + LEASE
            row.save(update_fields=['status', 'locked_until'])
        return rows


def _renew_lease(row, now) -> bool:
    """Fencing check right before a send: the row must still carry OUR lease. One tick can take longer than LEASE
    (25 sends x 20 s timeout), and a second worker may already have re-claimed a row we have not reached yet; without
    this check both workers would send it. Renewing also keeps our own lease fresh for the send that follows."""
    fresh = max(now, timezone.now()) + LEASE   # `now` may be an injected clock (tests, catch-up runs)
    taken = TelegramOutbox.objects.filter(id=row.id, status='sending', locked_until=row.locked_until).update(locked_until=fresh)
    if taken:
        row.locked_until = fresh
    return bool(taken)


def _finish(row, status, error='', retry_in=None, now=None):
    now = now or timezone.now()
    lease = row.locked_until
    row.status, row.last_error, row.locked_until = status, error[:60], None
    if status == 'sent':
        row.sent_at = now
    if status == 'pending':
        row.next_attempt_at = now + timedelta(seconds=retry_in or 60)
    fields = ['status', 'last_error', 'locked_until', 'sent_at', 'next_attempt_at', 'attempts']
    TelegramOutbox.objects.filter(pk=row.pk, status='sending', locked_until=lease).update(
        **{field: getattr(row, field) for field in fields},
    )


def _send_group(row, now):
    from .telegram_classroom_service import verify_current_binding

    bindings = TelegramClassroomBinding.objects.filter(
        group_id=row.group_id, chat_id=row.chat_id_override, is_active=True, bot_can_post=True,
        verified_telegram_id__isnull=False,
    )
    binding = bindings.first() if row.group_id and row.chat_id_override else None
    if binding is None:
        return 'skipped', 'group_disconnected'
    try:
        verify_current_binding(binding)
    except ContractAPIException as error:
        if error.status_code >= 500:
            return 'retry', None
        return 'skipped', 'group_authority_revoked'

    with transaction.atomic():
        # Disconnect and rebind take the same lock. Recheck the verified revision and lease.
        if not Group.objects.select_for_update().filter(pk=row.group_id).first():
            return 'skipped', 'group_disconnected'
        if not bindings.filter(pk=binding.pk, updated_at=binding.updated_at).exists():
            return 'skipped', 'group_binding_changed'
        if not _renew_lease(row, now):
            return 'lost', None
        return api.send_detailed(
            binding.chat_id, row.text, dict(inline_keyboard=row.keyboard) if row.keyboard else None,
        )


def deliver_due(now=None, *, sleep=time.sleep, limit=MAX_PER_TICK) -> dict:
    """One delivery pass. Safe to run concurrently in several workers and to be killed at any point."""
    now = now or timezone.now()
    stats = dict(sent=0, retried=0, failed=0, skipped=0, dead=0, deferred=0)
    chats_used = set()
    claimed = _claim(now, limit)
    for position, row in enumerate(claimed):
        if not _renew_lease(row, now):                                       # our lease expired and another worker owns it now
            stats['lost'] = stats.get('lost', 0) + 1
            continue
        if row.group_id or row.chat_id_override:
            chat = str(row.chat_id_override)
        else:
            if row.dedupe_key.startswith('guard_alert:'):
                from .live_exam_guard import private_teacher_access
                from .models import ExamIntegrityIncident

                incident = ExamIntegrityIncident.objects.select_related('attempt').filter(
                    pk=row.dedupe_key.split(':', 2)[1],
                ).first()
                if not incident or not private_teacher_access(row.recipient_id, incident):
                    _finish(row, 'skipped', 'supervisor_permission_revoked', now=now)
                    stats['skipped'] += 1
                    continue
            user = User.objects.filter(id=row.recipient_id, is_active=True).values('telegram_chat_id').first()
            chat = (user or {}).get('telegram_chat_id')
            if not chat or not str(chat).isdigit() or int(chat) <= 0:
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
            _finish(row, 'pending', retry_in=2, now=now)
            stats['deferred'] += 1
            continue
        chats_used.add(chat)
        row.attempts += 1
        if row.group_id or row.chat_id_override:
            outcome, detail = _send_group(row, now)
        else:
            outcome, detail = api.send_detailed(chat, row.text, dict(inline_keyboard=row.keyboard) if row.keyboard else None)
        if outcome == 'skipped':
            row.attempts -= 1
            _finish(row, 'skipped', detail, now=now)
            stats['skipped'] += 1
        elif outcome == 'lost':
            stats['lost'] = stats.get('lost', 0) + 1
        elif outcome == 'sent':
            _finish(row, 'sent', now=now)
            stats['sent'] += 1
        elif outcome == 'permanent' and detail == 'not_configured':     # worker without a bot token: keep everything queued
            row.attempts -= 1
            for rest in claimed[position:]:
                TelegramOutbox.objects.filter(
                    pk=rest.pk, status='sending', locked_until=rest.locked_until,
                ).update(status='pending', locked_until=None, attempts=rest.attempts)
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
                    TelegramOutbox.objects.filter(
                        pk=rest.pk, status='sending', locked_until=rest.locked_until,
                    ).update(status='pending', locked_until=None)
                break
        sleep(PER_MESSAGE_PAUSE)
    return stats


def status_counts() -> dict:
    from django.db.models import Count
    return dict(TelegramOutbox.objects.values_list('status').annotate(n=Count('id')).order_by())
