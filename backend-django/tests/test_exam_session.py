from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.core.cache import cache
from django.test import override_settings

from apps.core import exam_session
from common.api.exceptions import ContractAPIException

LOCMEM = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache', 'LOCATION': 'exam-session-tests'}}
actor = SimpleNamespace(id='student-1')


@pytest.fixture(autouse=True)
def isolated_cache():
    with override_settings(CACHES=LOCMEM), patch('apps.core.exam_session.engine.own', return_value=None):
        cache.clear()
        yield
        cache.clear()


def request(session_id=None):
    meta = {exam_session.HEADER: session_id} if session_id else {}
    return SimpleNamespace(META=meta, user=actor)


def test_first_tab_holds_second_is_refused_until_it_takes_over():
    assert exam_session.claim(actor, 'att', 'tab-aaaaaaaa')['active'] is True
    assert exam_session.claim(actor, 'att', 'tab-aaaaaaaa')['active'] is True       # heartbeat
    elsewhere = exam_session.claim(actor, 'att', 'tab-bbbbbbbb')
    assert elsewhere['active'] is False and elsewhere['claimedAt']
    assert exam_session.claim(actor, 'att', 'tab-bbbbbbbb', takeover=True)['active'] is True
    assert exam_session.claim(actor, 'att', 'tab-aaaaaaaa')['active'] is False


def test_guard_refuses_only_a_tab_that_does_not_hold_the_attempt():
    exam_session.guard(request('tab-aaaaaaaa'), 'att')          # claims implicitly
    with pytest.raises(ContractAPIException) as refused:
        exam_session.guard(request('tab-bbbbbbbb'), 'att')
    assert refused.value.status_code == 409 and refused.value.contract_code == 'EXAM_SESSION_ELSEWHERE'
    exam_session.guard(request(None), 'att')                    # no header: desktop / older build


def test_release_frees_only_its_own_hold():
    exam_session.claim(actor, 'att', 'tab-aaaaaaaa')
    exam_session.release(actor, 'att', 'tab-bbbbbbbb')
    assert exam_session.claim(actor, 'att', 'tab-bbbbbbbb')['active'] is False
    exam_session.release(actor, 'att', 'tab-aaaaaaaa')
    assert exam_session.claim(actor, 'att', 'tab-bbbbbbbb')['active'] is True


def test_an_expired_hold_is_free_again():
    exam_session.claim(actor, 'att', 'tab-aaaaaaaa')
    cache.delete(exam_session._key('att'))                      # the TTL passed
    assert exam_session.claim(actor, 'att', 'tab-bbbbbbbb')['active'] is True


@pytest.mark.parametrize('bad', [None, '', 'short', 'x' * 101, 'has space', 42])
def test_session_id_is_validated(bad):
    with pytest.raises(ContractAPIException) as refused:
        exam_session.claim(actor, 'att', bad)
    assert refused.value.contract_code == 'VALIDATION_ERROR'


def test_ownership_is_checked_before_anything_is_stored():
    with patch('apps.core.exam_session.engine.own', side_effect=ContractAPIException('MOCK_ATTEMPT_NOT_FOUND', 'x', 404)):
        with pytest.raises(ContractAPIException):
            exam_session.claim(actor, 'att', 'tab-intruder', takeover=True)
    assert cache.get(exam_session._key('att')) is None
