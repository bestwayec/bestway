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
