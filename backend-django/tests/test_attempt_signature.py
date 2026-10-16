from types import SimpleNamespace
from datetime import datetime

import pytest

from apps.core import attempt_signature as sig
from common.api.exceptions import ContractAPIException


def attempt(student="s1", started=datetime(2026, 10, 16, 8, 0, 0)):
    return SimpleNamespace(id="a1", student_id=student, started_at=started)


def test_signature_is_stable_and_bound_to_student_and_start():
    base = sig.sign(attempt())
    assert base == sig.sign(attempt())
    assert base != sig.sign(attempt(student="s2"))
    assert base != sig.sign(attempt(started=datetime(2026, 10, 16, 8, 0, 1)))


def test_missing_signature_allowed_unless_required(settings):
    request = SimpleNamespace(META={})
    settings.ATTEMPT_SIGNATURE_REQUIRED = False
    sig.verify_request(request, "a1")
    settings.ATTEMPT_SIGNATURE_REQUIRED = True
    with pytest.raises(ContractAPIException) as caught:
        sig.verify_request(request, "a1")
    assert caught.value.status_code == 403
