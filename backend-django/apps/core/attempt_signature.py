"""Tamper-evident exam session signature.

The server issues an HMAC bound to (attempt, student, start time) when an attempt
starts or resumes. Clients echo it in ``X-Attempt-Signature`` on answer/submit
calls. A forged or foreign signature is rejected, so answers cannot be replayed
into another student's attempt. Deadlines and scoring stay server-authoritative.
Set ``ATTEMPT_SIGNATURE_REQUIRED=true`` to also reject requests without a signature
once every client build sends it.
"""
import hashlib
import hmac
from datetime import datetime, timezone

from django.conf import settings

HEADER = 'HTTP_X_ATTEMPT_SIGNATURE'


def _key() -> bytes:
    secret = (settings.JWT_SECRET or settings.SECRET_KEY).encode('utf-8')
    return hashlib.sha256(b'bestway-attempt-signature-v1:' + secret).digest()


def canonical_started_at(value) -> str:
    """UTC, millisecond precision: the exact value "MockAttempt"."startedAt" TIMESTAMP(3) stores.

    A freshly created attempt holds microseconds in memory while the database keeps
    milliseconds, so signing the raw value made the signature change after a reload.
    Naive datetimes are treated as UTC (the column is UTC). Strings are parsed first.
    """
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace('Z', '+00:00'))
        except ValueError:
            return value
    if not isinstance(value, datetime):
        return ''
    value = value.astimezone(timezone.utc) if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return value.strftime('%Y-%m-%dT%H:%M:%S.') + f'{value.microsecond // 1000:03d}Z'


def truncate_to_millis(value: datetime) -> datetime:
    """Use for a new attempt's startedAt so the stored value equals what was signed."""
    return value.replace(microsecond=value.microsecond // 1000 * 1000)


def _message(attempt_id, student_id, started_at) -> bytes:
    return f'{attempt_id}:{student_id}:{canonical_started_at(started_at)}'.encode()


def sign(attempt) -> str:
    return hmac.new(_key(), _message(attempt.id, getattr(attempt, 'student_id', None), getattr(attempt, 'started_at', None)), hashlib.sha256).hexdigest()


def verify_request(request, attempt_id) -> None:
    """Raise a 403 ContractAPIException when the supplied signature is not valid."""
    from apps.legacy_schema.models import (
        MockAttempt,  # local import avoids app-loading cycles
    )
    provided = request.META.get(HEADER, '')
    required = getattr(settings, 'ATTEMPT_SIGNATURE_REQUIRED', False)
    if not provided:
        if required:
            _reject()
        return
    attempt = MockAttempt.objects.filter(id=attempt_id).first()
    if attempt is None:
        return  # the engine reports MOCK_ATTEMPT_NOT_FOUND itself
    # A supplied signature must match exactly. There is deliberately no "the owner may
    # skip it" fallback: that let any signature (including another attempt's) through.
    if not hmac.compare_digest(provided, sign(attempt)):
        _reject()


def _reject():
    from common.api.exceptions import ContractAPIException
    raise ContractAPIException('ATTEMPT_SIGNATURE_INVALID', 'Imtihon sessiyasi imzosi noto\'g\'ri', 403)
