"""Regression checks with synthetic signatures, filesystem fixtures and PostgreSQL locks."""
import hashlib
import hmac
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from urllib.parse import urlencode
from unittest.mock import patch

import pytest
from django.contrib.auth.models import AnonymousUser
from django.db import close_old_connections
from django.http import Http404
from django.test import RequestFactory, override_settings
from rest_framework.test import APIRequestFactory, force_authenticate
from apps.core.models import PlacementTestResult
from apps.core.telegram_views import verify_telegram_auth
from apps.core.mock_attempt_views import speaking_audio_view
from apps.legacy_schema.models import User
from apps.exams import placement_views as placement
from common.api.exceptions import ContractAPIException
from common.auth.authentication import LegacyUser
from config.urls import serve_media


@pytest.mark.parametrize('kind', ['webapp', 'widget'])
@pytest.mark.parametrize('offset,accepted', [(0, True), (-86401, False), (31, False), (None, False)])
def test_signed_timestamp(kind, offset, accepted):
    now, token = 1800000000, 'synthetic-test-token'
    fields = {'user': json.dumps({'id': 123})} if kind == 'webapp' else {'id': '123'}
    if offset is not None:
        fields['auth_date'] = str(now + offset)
    key = hmac.new(b'WebAppData', token.encode(), hashlib.sha256).digest() if kind == 'webapp' else hashlib.sha256(token.encode()).digest()
    fields['hash'] = hmac.new(key, '\n'.join(f'{k}={v}' for k, v in sorted(fields.items())).encode(), hashlib.sha256).hexdigest()
    def data():
        return {'initData': urlencode(fields)} if kind == 'webapp' else fields
    with patch.dict('os.environ', {'TELEGRAM_BOT_TOKEN': token}), patch('apps.core.telegram_views.time.time', return_value=now):
        if accepted:
            assert str(verify_telegram_auth(data())['id']) == '123'
            fields['hash'] = '0' * 64
        with pytest.raises(ContractAPIException):
            verify_telegram_auth(data())


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize('folder', ['speaking_submissions', 'private/speaking_submissions'])
@pytest.mark.parametrize('actor,expected', [('owner', 200), ('other', 403), (None, 401)])
def test_private_recordings_and_authorized_legacy_download(folder, actor, expected):
    with TemporaryDirectory() as directory:
        root = Path(directory)
        file = root / folder / 'test.wav'
        file.parent.mkdir(parents=True)
        file.write_bytes(b'synthetic audio')
        (root / 'alias.wav').symlink_to(file)
        with patch.dict('os.environ', {'STORAGE_DIR': directory}):
            for path in [f'{folder}/test.wav', f'media/{folder}/test.wav', 'alias.wav', '../outside.wav']:
                with pytest.raises(Http404):
                    serve_media(RequestFactory().get('/media/' + path), path)
            (root / 'public.jpg').write_bytes(b'public')
            response = serve_media(RequestFactory().get('/media/public.jpg'), 'public.jpg')
            assert b''.join(response.streaming_content) == b'public'
            response.close()
        request = APIRequestFactory().get('/v1/mock/attempts/a/answers/q/audio')
        if actor:
            force_authenticate(request, user=LegacyUser(actor, 'Test', '', 'student', True))
        with override_settings(MEDIA_ROOT=directory), patch('apps.legacy_schema.models.MockAttempt.objects.filter') as attempts, patch('apps.legacy_schema.models.MockAnswer.objects.filter') as answers:
            attempts.return_value.first.return_value = SimpleNamespace(student_id='owner')
            answers.return_value.first.return_value = SimpleNamespace(audio_key=f'{folder}/test.wav')
            response = speaking_audio_view(request, 'a', 'q')
            assert response.status_code == expected
            if expected == 200:
                assert b''.join(response.streaming_content) == b'synthetic audio'
                response.close()


def test_anonymous_claim_cannot_supply_identity():
    request = RequestFactory().post('/claim', data=json.dumps({'result_token': 'test', 'user_id': 'victim'}), content_type='application/json')
    request.user = AnonymousUser()
    assert placement.placement_claim_view(request).status_code == 401


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize('cached_only', [False, True])
def test_concurrent_claim_has_exactly_one_owner(cached_only):
    token = 'synthetic-claim-token'
    cached = dict(guest_session_id='guest', cefr_level='B2', cefr_label='B2', estimated_ielts_band='6', score_percent=75)
    if not cached_only:
        PlacementTestResult.objects.create(result_token=token, **cached)
    def claim(identifier):
        close_old_connections()
        try:
            request = RequestFactory().post('/claim', data=json.dumps({'result_token': token, 'user_id': 'ignored'}), content_type='application/json')
            request.audit_user = User(id=identifier, name='Test')
            return placement.placement_claim_view(request).status_code
        finally:
            close_old_connections()
    with patch.object(placement, 'get_authenticated_user_from_request', side_effect=lambda r: r.audit_user), patch.object(placement, '_sync_profile_placement'), patch.object(placement.cache, 'get', return_value=cached), patch.object(placement.cache, 'set'):
        with ThreadPoolExecutor(max_workers=2) as pool:
            assert sorted(pool.map(claim, ['student-a', 'student-b'])) == [200, 409]
        record = PlacementTestResult.objects.get(result_token=token)
        assert record.is_claimed
        assert claim(record.student_id) == 200
        assert claim('unrelated-user') == 409


@pytest.mark.django_db(transaction=True)
def test_claim_profile_failure_rolls_back_assignment():
    token = 'synthetic-rollback-token'
    record = PlacementTestResult.objects.create(result_token=token, guest_session_id='g', cefr_level='B2', cefr_label='B2', estimated_ielts_band='6')
    request = RequestFactory().post('/claim', data=json.dumps({'result_token': token}), content_type='application/json')
    with patch.object(placement, 'get_authenticated_user_from_request', return_value=User(id='owner', name='Test')), patch.object(placement, '_sync_profile_placement', side_effect=RuntimeError('synthetic failure')):
        with pytest.raises(RuntimeError, match='synthetic failure'):
            placement.placement_claim_view(request)
    record.refresh_from_db()
    assert not record.is_claimed
    assert record.student_id is None


@pytest.mark.django_db(transaction=True)
def test_cache_restoration_preserves_existing_claim_owner():
    request = RequestFactory().post('/claim', data=json.dumps({'result_token': 'cache-owner-token'}), content_type='application/json')
    cached = dict(guest_session_id='g', cefr_level='B2', cefr_label='B2', estimated_ielts_band='6', is_claimed=True, student_id='owner')
    with patch.object(placement, 'get_authenticated_user_from_request', return_value=User(id='other', name='Test')), patch.object(placement.cache, 'get', return_value=cached):
        assert placement.placement_claim_view(request).status_code == 409
    assert PlacementTestResult.objects.get(result_token='cache-owner-token').student_id == 'owner'
