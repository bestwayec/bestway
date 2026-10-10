"""Checkpoint 3 boundaries; real reference/database tests live in the PG runner."""
from types import SimpleNamespace
from unittest.mock import patch
import pytest
from django.urls import resolve
from rest_framework.test import APIClient


@pytest.mark.parametrize('path,method',[
    ('mock/exams/x/purchase','post'),('mock/purchases','get'),('mock/exams/x/confirm-purchase','post'),
    ('mock/exams/x/reject-purchase','post'),('mock/attempts','get'),('mock/attempts/x/force-submit','post'),
    ('mock/attempts/x/extend','post'),('mock/attempts/x/reopen','post'),('mock/attempts/x','delete'),('mock/attempts/x/certificate','get')])
def test_all_ten_contracts_registered(path,method):
    assert method in resolve('/v1/'+path).func.cls.http_method_names


def test_support_anonymous_denied_before_database():
    client=APIClient()
    for method,path in [('get','/v1/mock/purchases'),('post','/v1/mock/exams/x/purchase'),('get','/v1/mock/attempts/x/certificate'),('delete','/v1/mock/attempts/x')]:
        assert getattr(client,method)(path).status_code==401


def test_student_cannot_administer_attempt():
    client=APIClient(); client.force_authenticate(SimpleNamespace(id='student',role='student',is_authenticated=True))
    for path in ('force-submit','extend','reopen'):
        assert client.post('/v1/mock/attempts/x/'+path,dict(minutes=1),format='json').status_code==403
    assert client.delete('/v1/mock/attempts/x').status_code==403


def test_extend_number_coercion():
    client=APIClient(); client.force_authenticate(SimpleNamespace(id='admin',role='admin',is_authenticated=True))
    with patch('apps.core.mock_support.extend',return_value=dict(saved=True)) as mocked:
        assert client.post('/v1/mock/attempts/x/extend',dict(minutes='5'),format='json').status_code==201
        assert mocked.call_args.args[2]==5
        assert client.post('/v1/mock/attempts/x/extend',dict(minutes='0x10'),format='json').status_code==201
        assert mocked.call_args.args[2]==16
    assert client.post('/v1/mock/attempts/x/extend',dict(minutes=0),format='json').status_code==400


def test_certificate_error_metadata():
    response=APIClient().get('/v1/mock/attempts/x/certificate')
    assert response.status_code==401 and response['Content-Type']=='application/json; charset=utf-8'
