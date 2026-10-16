"""
Finite State Machine (FSM) & Dialog Session Engine for Telegram Bot.
Provides in-memory and cache-backed session state management for multi-step dialogs.
Strictly guards superadmin-only workflows (Topic Management, System Configs).
"""
import logging
import os
import time
from typing import Any, Dict, Optional, Union
from django.conf import settings

logger = logging.getLogger(__name__)

DEFAULT_SUPERADMIN_TELEGRAM_ID = '5582178765'


def get_superadmin_id() -> str:
    """Returns the configured Superadmin Telegram ID."""
    if settings.configured:
        return str(getattr(settings, 'SUPERADMIN_TELEGRAM_ID', os.environ.get('SUPERADMIN_TELEGRAM_ID', DEFAULT_SUPERADMIN_TELEGRAM_ID)))
    return str(os.environ.get('SUPERADMIN_TELEGRAM_ID', DEFAULT_SUPERADMIN_TELEGRAM_ID))


SUPERADMIN_TELEGRAM_ID = get_superadmin_id()

# In-memory storage fallback for FSM dialogs
_FSM_MEMORY: Dict[str, Dict[str, Any]] = {}
_FSM_CACHE_PREFIX = "tg_fsm:"
_FSM_TIMEOUT_SECONDS = 86400  # 24 hours

# State Constants for Topic Management
STATE_NONE = ''
STATE_WRITING_TYPE = 'topic_writing_type'
STATE_WRITING_PROMPT = 'topic_writing_prompt'
STATE_WRITING_IMAGE = 'topic_writing_image'
STATE_WRITING_CONFIRM = 'topic_writing_confirm'

STATE_SPEAKING_PART = 'topic_speaking_part'
STATE_SPEAKING_TITLE = 'topic_speaking_title'
STATE_SPEAKING_CUES = 'topic_speaking_cues'
STATE_SPEAKING_QUESTIONS = 'topic_speaking_questions'
STATE_SPEAKING_CONFIRM = 'topic_speaking_confirm'

TOPIC_STATES = {
    STATE_WRITING_TYPE,
    STATE_WRITING_PROMPT,
    STATE_WRITING_IMAGE,
    STATE_WRITING_CONFIRM,
    STATE_SPEAKING_PART,
    STATE_SPEAKING_TITLE,
    STATE_SPEAKING_CUES,
    STATE_SPEAKING_QUESTIONS,
    STATE_SPEAKING_CONFIRM,
}


def is_superadmin(chat_id: Optional[Union[int, str]] = None, user: Any = None) -> bool:
    """Verifies whether the given chat_id or user model has Superadmin privileges."""
    sa_id = get_superadmin_id()
    if chat_id is not None and str(chat_id).strip() == sa_id:
        return True
    if user is not None and getattr(user, 'role', None) == 'super_admin':
        return True
    return False


def is_topic_state(state: Optional[str]) -> bool:
    """Checks if a state string belongs to Topic Management."""
    if not state:
        return False
    return state in TOPIC_STATES or state.startswith('topic_')


def check_superadmin_guard(chat_id: Union[int, str]) -> bool:
    """
    Superadmin Security Guard.
    Ensures that only SUPERADMIN_TELEGRAM_ID can perform topic management tasks.
    Rejects unauthorized access with an alert message and resets dialog state.
    """
    cid = str(chat_id).strip()
    if not is_superadmin(chat_id=cid):
        clear_state(cid)
        try:
            from . import telegram_delivery as api
            api.send(cid, "⛔ Bu bo'lim faqat Superadmin uchun ruxsat etilgan.")
        except Exception as exc:
            logger.warning("Failed to send superadmin rejection alert: %r", exc)
        return False
    return True


def _cache_get(key: str) -> Optional[Any]:
    if settings.configured:
        try:
            from django.core.cache import cache
            return cache.get(key)
        except Exception as exc:
            logger.debug("Cache get error: %r", exc)
    return None


def _cache_set(key: str, val: Any, timeout: int = _FSM_TIMEOUT_SECONDS) -> None:
    if settings.configured:
        try:
            from django.core.cache import cache
            cache.set(key, val, timeout=timeout)
        except Exception as exc:
            logger.debug("Cache set error: %r", exc)


def _cache_delete(key: str) -> None:
    if settings.configured:
        try:
            from django.core.cache import cache
            cache.delete(key)
        except Exception as exc:
            logger.debug("Cache delete error: %r", exc)


def get_state(chat_id: Union[int, str]) -> Dict[str, Any]:
    """
    Retrieves the current FSM state and data dictionary for the given chat_id.
    Returns an empty dict if no active dialog state exists.
    """
    cid = str(chat_id).strip()
    session = _cache_get(f"{_FSM_CACHE_PREFIX}{cid}")

    if not isinstance(session, dict):
        session = _FSM_MEMORY.get(cid)

    if not isinstance(session, dict):
        return {}

    return session


def set_state(chat_id: Union[int, str], state: str, data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Sets the active dialog state and payload data for the given chat_id.
    If the state is a protected topic management state, superadmin guard is enforced.
    """
    cid = str(chat_id).strip()

    if is_topic_state(state) and not is_superadmin(chat_id=cid):
        clear_state(cid)
        try:
            from . import telegram_delivery as api
            api.send(cid, "⛔ Bu bo'lim faqat Superadmin uchun ruxsat etilgan.")
        except Exception as exc:
            logger.warning("Failed to send superadmin rejection alert: %r", exc)
        return {}

    session = {
        'chat_id': cid,
        'state': str(state or '').strip(),
        'data': dict(data) if isinstance(data, dict) else {},
        'updated_at': time.time(),
    }

    _FSM_MEMORY[cid] = session
    _cache_set(f"{_FSM_CACHE_PREFIX}{cid}", session, timeout=_FSM_TIMEOUT_SECONDS)

    return session


def update_state_data(chat_id: Union[int, str], **kwargs: Any) -> Dict[str, Any]:
    """
    Updates the payload data dictionary of the active dialog state for the given chat_id.
    """
    cid = str(chat_id).strip()
    session = get_state(cid)

    if not session or not isinstance(session, dict):
        session = {
            'chat_id': cid,
            'state': '',
            'data': {},
            'updated_at': time.time(),
        }

    data = session.get('data')
    if not isinstance(data, dict):
        data = {}

    data.update(kwargs)
    session['data'] = data
    session['updated_at'] = time.time()

    _FSM_MEMORY[cid] = session
    _cache_set(f"{_FSM_CACHE_PREFIX}{cid}", session, timeout=_FSM_TIMEOUT_SECONDS)

    return session


def clear_state(chat_id: Union[int, str]) -> None:
    """
    Resets/clears the active dialog state and data for the given chat_id.
    """
    cid = str(chat_id).strip()
    _FSM_MEMORY.pop(cid, None)
    _cache_delete(f"{_FSM_CACHE_PREFIX}{cid}")
