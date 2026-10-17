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

from django.conf import settings

HEADER = 'HTTP_X_ATTEMPT_SIGNATURE'


def _key() -> bytes:
    secret = (settings.JWT_SECRET or settings.SECRET_KEY).encode('utf-8')
    return hashlib.sha256(b'bestway-attempt-signature-v1:' + secret).digest()


def _message(attempt_id, student_id, started_at) -> bytes:
    stamp = started_at.replace(tzinfo=None).isoformat() if started_at else ''
    return f'{attempt_id}:{student_id}:{stamp}'.encode('utf-8')


def sign(attempt) -> str:
    return hmac.new(_key(), _message(attempt.id, attempt.student_id, attempt.started_at), hashlib.sha256).hexdigest()


def verify_request(request, attempt_id) -> None:
    """Raise a 403 ContractAPIException when the supplied signature is not valid."""
    from apps.legacy_schema.models import MockAttempt  # local import avoids app-loading cycles
    provided = request.META.get(HEADER, '')
    required = getattr(settings, 'ATTEMPT_SIGNATURE_REQUIRED', False)
    if not provided:
        if required:
            _reject()
        return
    attempt = MockAttempt.objects.filter(id=attempt_id).first()
    if attempt is None:
        return  # the engine reports MOCK_ATTEMPT_NOT_FOUND itself
    if not hmac.compare_digest(provided, sign(attempt)):
        _reject()


def _reject():
    from common.api.exceptions import ContractAPIException
    raise ContractAPIException('ATTEMPT_SIGNATURE_INVALID', 'Imtihon sessiyasi imzosi noto\'g\'ri', 403)
