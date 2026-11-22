"""Durable Telegram bot state primitives (PostgreSQL), safe across restarts and multiple workers."""
from __future__ import annotations

import logging
from datetime import timedelta

from django.db import IntegrityError, ProgrammingError, transaction
from django.utils import timezone

from .models import TelegramUpdateReceipt

logger = logging.getLogger(__name__)
RETENTION = timedelta(days=7)


def claim_update(update: dict) -> bool:
    """True the first time an update_id is seen, False for a duplicate/replay. Atomic via the unique constraint.

    Updates without a numeric update_id (never sent by Telegram) are processed as before. If the receipts table does
    not exist yet (migration not applied) deduplication is skipped with a warning instead of taking the bot down.
    """
    update_id = update.get('update_id') if isinstance(update, dict) else None
    if type(update_id) is not int:
        return True
    kind = 'callback' if update.get('callback_query') else 'message' if update.get('message') else 'other'
    try:
        with transaction.atomic():
            TelegramUpdateReceipt.objects.create(update_id=update_id, kind=kind)
    except IntegrityError:
        logger.info('Duplicate Telegram update %s ignored', update_id)
        return False
    except ProgrammingError as error:
        if 'does not exist' in str(error):
            logger.warning('Telegram update de-duplication inactive: receipts table is missing')
            return True
        raise
    return True


def prune_receipts(now=None) -> int:
    cutoff = (now or timezone.now()) - RETENTION
    deleted, _ = TelegramUpdateReceipt.objects.filter(received_at__lt=cutoff).delete()
    return deleted


# ------------------------------------------------------------------------------- durable dialog state / preferences
from .models import TelegramDialogState, TelegramPreference  # noqa: E402

DIALOG_TTL = timedelta(hours=6)


def set_dialog(user_id: str, state: str, payload: dict, now=None) -> None:
    now = now or timezone.now()
    TelegramDialogState.objects.update_or_create(user_id=user_id, defaults=dict(state=state, payload=payload, expires_at=now + DIALOG_TTL))


def get_dialog(user_id: str, now=None):
    """(state, payload) or (None, {}) when there is none or it expired. Survives restarts and works across workers."""
    row = TelegramDialogState.objects.filter(user_id=user_id).first()
    if row is None or row.expires_at <= (now or timezone.now()):
        return None, {}
    return row.state, row.payload


def clear_dialog(user_id: str) -> None:
    TelegramDialogState.objects.filter(user_id=user_id).delete()


def get_preference(user_id: str) -> TelegramPreference:
    row, _created = TelegramPreference.objects.get_or_create(user_id=user_id)
    return row


def language_of(user_id: str) -> str:
    row = TelegramPreference.objects.filter(user_id=user_id).values_list('language', flat=True).first()
    return row if row in ('uz', 'en') else 'uz'
