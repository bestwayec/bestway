"""Private, once-only delivery of result cards. Only the owner's own chat receives an automatic card."""
from __future__ import annotations

import logging

from django.db import IntegrityError, transaction

from . import result_card as rc
from . import telegram_delivery as api
from .models import ResultCardDelivery

logger = logging.getLogger(__name__)


def claim(kind: str, ref_id: str, recipient: str, version: int = 1) -> bool:
    """True only for the first caller; concurrent/duplicate callers get False and send nothing."""
    try:
        with transaction.atomic():
            ResultCardDelivery.objects.create(kind=kind, ref_id=ref_id, recipient_id=recipient, version=version)
        return True
    except IntegrityError:
        return False


def send_card(chat_id, data: dict, lang: str, *, kind: str, ref_id: str, recipient: str, version: int = 1, auto: bool = True, caption=None, keyboard=None):
    """Render from already-saved data and send as a photo. auto=True dedupes; auto=False is an explicit user request."""
    if auto and not claim(kind, ref_id, recipient, version):
        return None
    try:
        png = rc.render_png(data, lang)
    except Exception:  # pragma: no cover - never let a rendering problem break the result flow
        logger.exception('result card rendering failed')
        return None
    return api.send_photo(chat_id, png, caption=caption, reply_markup=dict(inline_keyboard=keyboard) if keyboard else None)
