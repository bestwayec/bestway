from datetime import datetime
from types import SimpleNamespace

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


# --- reload stability and strict verification -------------------------------------------
from datetime import timezone as _tz, timedelta as _td
from unittest.mock import patch as _patch

from django.db import connection as _connection
from django.utils import timezone as _timezone


def _as_stored(value):
    """What Postgres returns for "MockAttempt"."startedAt" TIMESTAMP(3)."""
    with _connection.cursor() as cursor:
        cursor.execute("SELECT %s::timestamp(3) with time zone", [value])
        return cursor.fetchone()[0]


@pytest.mark.django_db
def test_signature_issued_at_start_verifies_after_reload_from_database():
    started = sig.truncate_to_millis(_timezone.now().replace(microsecond=123987))  # as start() stores it
    issued = sig.sign(attempt(started=started))                                   # signed in memory
    reloaded = attempt(started=_as_stored(started))                               # re-read from DB
    assert reloaded.started_at.microsecond == 123000
    assert sig.sign(reloaded) == issued


@pytest.mark.django_db
def test_untruncated_start_would_change_after_reload():
    # Documents the original bug: Postgres rounds .123987 to .124, so microsecond-precision
    # values must be truncated before they are stored and signed.
    raw = _timezone.now().replace(microsecond=123987)
    assert _as_stored(raw).microsecond == 124000


def test_canonical_stamp_is_utc_milliseconds_for_any_representation():
    utc = datetime(2026, 11, 6, 5, 0, 0, 123456, tzinfo=_tz.utc)
    tashkent = utc.astimezone(_tz(_td(hours=5)))
    assert sig.canonical_started_at(utc) == "2026-11-06T05:00:00.123Z"
    assert sig.canonical_started_at(tashkent) == "2026-11-06T05:00:00.123Z"
    assert sig.canonical_started_at(utc.replace(tzinfo=None)) == "2026-11-06T05:00:00.123Z"
    assert sig.canonical_started_at("2026-11-06T05:00:00.123456Z") == "2026-11-06T05:00:00.123Z"


def _verify(provided, target, user_id):
    request = SimpleNamespace(META={sig.HEADER: provided}, user=SimpleNamespace(id=user_id, is_authenticated=True))
    with _patch("apps.legacy_schema.models.MockAttempt.objects") as objects:
        objects.filter.return_value.first.return_value = target
        sig.verify_request(request, target.id)


def test_matching_signature_is_accepted():
    target = SimpleNamespace(id="a1", student_id="s1", started_at=datetime(2026, 11, 6, 5, 0, 0, 123000))
    _verify(sig.sign(target), target, "s1")


def test_another_attempts_signature_is_rejected_even_for_the_owner():
    target = SimpleNamespace(id="a1", student_id="s1", started_at=datetime(2026, 11, 6, 5, 0, 0, 123000))
    other = SimpleNamespace(id="a2", student_id="s1", started_at=datetime(2026, 11, 6, 5, 0, 0, 123000))
    with pytest.raises(ContractAPIException) as caught:
        _verify(sig.sign(other), target, "s1")
    assert caught.value.status_code == 403
