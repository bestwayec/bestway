"""One active exam session per attempt (tabs and devices).

Each browser tab sends its own session id in ``X-Exam-Session``. The first tab that claims an
attempt holds it; another tab or device gets 409 ``EXAM_SESSION_ELSEWHERE`` on every change
until the student chooses "continue here" (takeover). Nothing is written to the attempt row:
the holder is kept in the cache (Redis in production) for ``SESSION_TTL_SECONDS`` after its last
request, so a closed tab frees the attempt by itself. Requests without the header (desktop app,
older web builds) are not checked, so they keep working exactly as before.
"""
from __future__ import annotations

import re
import time

from django.core.cache import cache

from . import mock_attempts as engine

HEADER = 'HTTP_X_EXAM_SESSION'
SESSION_TTL_SECONDS = 90
_VALID = re.compile(r'^[A-Za-z0-9-]{8,100}$')


def _key(attempt_id: str) -> str:
    return f'exam-session:{attempt_id}'


def _validate(session_id) -> str:
    if not isinstance(session_id, str) or not _VALID.match(session_id):
        engine.fail('VALIDATION_ERROR', 'sessionId must be 8-100 letters, digits or dashes')
    return session_id


def _holder(attempt_id: str):
    value = cache.get(_key(attempt_id))
    return value if isinstance(value, dict) and value.get('sessionId') else None


def _state(value: dict, session_id: str) -> dict:
    return {'active': value['sessionId'] == session_id, 'claimedAt': value.get('claimedAt')}


def claim(actor, attempt_id: str, session_id, takeover: bool = False) -> dict:
    """Hold the attempt for this tab; ``takeover`` moves it here from another tab or device."""
    session_id = _validate(session_id)
    engine.own(actor, attempt_id)
    key = _key(attempt_id)
    if takeover:
        value = {'sessionId': session_id, 'claimedAt': int(time.time() * 1000)}
        cache.set(key, value, SESSION_TTL_SECONDS)
        return _state(value, session_id)
    cache.add(key, {'sessionId': session_id, 'claimedAt': int(time.time() * 1000)}, SESSION_TTL_SECONDS)
    value = _holder(attempt_id)
    if value is None:  # expired between add and get: claim again
        value = {'sessionId': session_id, 'claimedAt': int(time.time() * 1000)}
        cache.set(key, value, SESSION_TTL_SECONDS)
    if value['sessionId'] == session_id:
        cache.touch(key, SESSION_TTL_SECONDS)  # extends the lease, never changes the holder
    return _state(value, session_id)


def release(actor, attempt_id: str, session_id) -> dict:
    session_id = _validate(session_id)
    engine.own(actor, attempt_id)
    value = _holder(attempt_id)
    if value and value['sessionId'] == session_id:
        cache.delete(_key(attempt_id))
    return {'released': True}


def guard(request, attempt_id: str) -> None:
    """Refuse a change from a tab that does not hold the attempt (only when it sends a session id)."""
    session_id = request.META.get(HEADER)
    if not session_id:
        return
    state = claim(request.user, attempt_id, session_id)
    if not state['active']:
        engine.fail('EXAM_SESSION_ELSEWHERE', 'This exam is open in another tab or on another device.', 409)
