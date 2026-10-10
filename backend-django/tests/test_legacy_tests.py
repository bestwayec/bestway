"""Legacy-only pure/boundary contracts. Real DB assertions run in PG harness."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch
import pytest
from django.urls import resolve
from django.core.cache import cache
from rest_framework.test import APIClient
from apps.core import legacy_tests as service
from common.api.exceptions import ContractAPIException


@pytest.mark.parametrize('response,key,want',[
    ('  NINETEEN   eighty seven ','1987|nineteen eighty seven',True),
    ('1987','1987|nineteen eighty seven',True),('ice cream','ice-cream',False),
    ('the house','house',False),('yes.','yes',False),('１２','12',False),
    ('\ufeffyes\ufeff','yes',True),('a\u0085b','a b',False),('','',False),
    ('station','house|station',True),('other','house|station',False),
])
def test_legacy_rules_are_not_mock_variants(response,key,want):
    assert service.correct(response,key) is want


def test_marks_only_nonempty_and_strings():
    rows=[SimpleNamespace(question_id='a',highlights=['original',5],note=None),SimpleNamespace(question_id='b',highlights=[],note='note'),SimpleNamespace(question_id='c',highlights=None,note=None)]
    assert service.shape_marks(rows)==dict(a=dict(highlights=['original'],note=None),b=dict(highlights=[],note='note'))


def test_utf16_mark_length_preserves_js_slice():
    assert service.utf16_slice('😀'*200,300)=='😀'*150


def test_fisher_yates_permutation_not_mock_order():
    with patch('apps.core.legacy_tests.secrets.randbelow',return_value=0):
        assert service.shuffle([1,2,3])==[2,3,1]


def test_timer_boundary_and_no_clock():
    now=datetime(2026,10,8,tzinfo=timezone.utc)
    attempt=SimpleNamespace(started_at=now-timedelta(minutes=30),test=SimpleNamespace(duration_minutes=30))
    with patch('apps.core.legacy_tests.timezone.now',return_value=now):
        service.assert_time(attempt)
    with patch('apps.core.legacy_tests.timezone.now',return_value=now+timedelta(microseconds=1)):
        with pytest.raises(ContractAPIException) as error: service.assert_time(attempt)
        assert error.value.contract_code=='TEST_TIME_UP'
    attempt.test.duration_minutes=None
    service.assert_time(attempt)


def test_scoped_routes_only_no_invented_autosave_timeout_grade():
    for path,method in [('tests','get'),('tests/demo/list','get'),('tests/demo/x','get'),('tests/demo/x/submit','post'),('tests/x','get'),('tests/x/start','post'),('tests/attempts/mine','get'),('tests/attempts','get'),('tests/attempts/x','get'),('tests/attempts/x/answer','post'),('tests/attempts/x/marks','post'),('tests/attempts/x/flag-cheat','post'),('tests/attempts/x/submit','post'),('tests/questions/x/audio','get'),('tests/attempts/x/certificate','get')]:
        assert method in resolve('/v1/'+path).func.cls.http_method_names


def test_legacy_cheat_route_throttle():
    cache.clear(); client=APIClient(); client.force_authenticate(SimpleNamespace(id='synthetic',role='student',is_authenticated=True))
    with patch('apps.core.legacy_tests.cheat',return_value=dict(saved=True)):
        for _ in range(30):
            assert client.post('/v1/tests/attempts/x/flag-cheat',dict(event='blur'),format='json').status_code==201
        response=client.post('/v1/tests/attempts/x/flag-cheat',dict(event='blur'),format='json')
        assert response.status_code==429
        assert response.json()['error']==dict(code='TOO_MANY_REQUESTS',message='ThrottlerException: Too Many Requests')
    cache.clear()


def test_demo_js_string_coercion():
    assert [service.js_string(v) for v in [1987.0,True,[1,True,None,{'x':1}],{'x':1}]]==['1987','true','1,true,,[object Object]','[object Object]']
    assert [service.js_string(v) for v in [1e-6,1e-7,1e20,1e21,-0.0,1.25]]==['0.000001','1e-7','100000000000000000000','1e+21','0','1.25']


def test_certificate_error_content_type():
    response=APIClient().get('/v1/tests/attempts/missing/certificate')
    assert response.status_code==401
    assert response['Content-Type']=='application/json; charset=utf-8'
