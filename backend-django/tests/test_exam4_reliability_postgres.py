"""Exercise the HTTP contracts against a disposable PostgreSQL test database."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from io import BytesIO
from threading import Barrier
from types import SimpleNamespace
import wave

import pytest
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection, connections
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import SubmissionHandoff
from apps.legacy_schema.models import (
    MockAnswer, MockAttempt, MockExam, MockQuestion, MockQuestionGroup, MockSection, Setting,
)

pytestmark = pytest.mark.django_db(transaction=True)
ATTEMPT = '/v1/mock/attempts/exam4-test-attempt'
STUDENT = SimpleNamespace(id='synthetic-exam4-student', role='student', is_authenticated=True)


def client_for(actor=STUDENT):
    client = APIClient()
    client.force_authenticate(actor)
    return client


def edit(response, base=None, stamp=1770000000000):
    return dict(questionId='exam4-reading', response=response, baseRevision=base, editedAt=stamp)


def save(client, answer, **headers):
    return client.post(f'{ATTEMPT}/answers', {'answers': [answer]}, format='json', **headers)


@pytest.fixture
def attempt(monkeypatch, settings, tmp_path):
    cache.clear()
    settings.MEDIA_ROOT = str(tmp_path)
    monkeypatch.setattr('apps.core.mock_submission_handoff.schedule', lambda *_: None)
    monkeypatch.setattr('apps.core.mock_attempts.schedule_speaking_compression', lambda *_: None)
    existing = set(connection.introspection.table_names())
    created = []
    for model in (Setting, MockExam, MockSection, MockQuestionGroup, MockQuestion, MockAttempt, MockAnswer):
        if model._meta.db_table not in existing:
            with connection.schema_editor() as editor:
                editor.create_model(model)
            created.append(model)
    try:
        now = timezone.now()
        exam = MockExam.objects.create(id='exam4-test', type='ielts_academic', title='Synthetic exam',
            is_published=True, is_demo=True, is_free_for_approved=True, price=0, created_at=now,
            updated_at=now, profile='full_mock', content_version=1)
        for index, skill in enumerate(('reading', 'writing', 'speaking')):
            section = MockSection.objects.create(id=f'exam4-section-{skill}', exam=exam, skill=skill, sort_order=index)
            group = MockQuestionGroup.objects.create(id=f'exam4-group-{skill}', section=section, sort_order=0,
                created_at=now, audio_play_limit=1)
            MockQuestion.objects.create(id=f'exam4-{skill}', group=group, number=1, sort_order=0, prompt='Synthetic prompt',
                type={'reading': 'short_answer', 'writing': 'essay_task1', 'speaking': 'speaking_task'}[skill],
                correct_answers=['alpha'] if skill == 'reading' else None, points=1, created_at=now)
        yield MockAttempt.objects.create(id='exam4-test-attempt', exam=exam, student_id=STUDENT.id,
            started_at=now, status='in_progress', mode='timed', flow_mode='full_test', current_skill='reading',
            deadline_at=now + timedelta(hours=2), anti_cheat_count=0)
    finally:
        cache.clear()
        for model in reversed(created):
            with connection.schema_editor() as editor:
                editor.delete_model(model)


def test_concurrent_edits_have_one_winner_and_idempotent_retries(attempt):
    barrier = Barrier(2)

    def write(response):
        try:
            barrier.wait(timeout=5)
            result = save(client_for(), edit(response))
            assert result.status_code == 201, result.data
            return result.data['data']['receipts']['exam4-reading']
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(write, ['alpha', 'beta']))
    assert sorted(receipt['status'] for receipt in results) == ['conflict', 'saved']
    row = MockAnswer.objects.get(attempt=attempt, question_id='exam4-reading')
    winner = results[0] if row.response == 'alpha' else results[1]
    assert winner['status'] == 'saved'
    assert save(client_for(), edit(row.response)).data['data']['receipts']['exam4-reading'] == winner
    assert save(client_for(), edit('latest', winner['revision'])).data['data']['receipts']['exam4-reading']['status'] == 'saved'
    row.refresh_from_db()
    assert row.response == 'latest'


def test_section_retry_and_session_takeover_preserve_persisted_answers(attempt):
    client = client_for()
    first = {'HTTP_X_EXAM_SESSION': 'tab-exam4-first'}
    second = {'HTTP_X_EXAM_SESSION': 'tab-exam4-second'}
    assert save(client, edit('alpha'), **first).status_code == 201
    assert save(client, edit('intrusion'), **second).status_code == 409
    assert client.post(f'{ATTEMPT}/session', {'sessionId': second['HTTP_X_EXAM_SESSION'], 'takeover': True},
                       format='json').status_code == 200
    assert save(client, edit('intrusion'), **first).status_code == 409
    payload = {'expectedSkill': 'reading'}
    automatic = client.post(f'{ATTEMPT}/advance', {**payload, 'requireExpired': True}, format='json', **second)
    assert automatic.data['error']['code'] == 'EXAM_DEADLINE_ACTIVE'
    for _ in range(2):
        advanced = client.post(f'{ATTEMPT}/advance', payload, format='json', **second)
        assert advanced.status_code == 201
        assert advanced.data['data']['currentSkill'] == 'writing'
    assert save(client, edit('too late'), **second).status_code == 403
    assert MockAnswer.objects.get(attempt=attempt, question_id='exam4-reading').response == 'alpha'
    attempt.refresh_from_db()
    assert attempt.submitted_sections == ['reading']


def test_expiry_and_duplicate_submit_score_only_persisted_work(attempt):
    client = client_for()
    assert save(client, edit('alpha')).status_code == 201
    premature = client.post(f'{ATTEMPT}/submit', {'requireExpired': True}, format='json')
    assert premature.data['error']['code'] == 'EXAM_DEADLINE_ACTIVE'
    MockAttempt.objects.filter(pk=attempt.pk).update(deadline_at=timezone.now() - timedelta(seconds=1))
    assert save(client, edit('incorrect after expiry')).data['error']['code'] == 'MOCK_TIME_UP'
    payload = {'force': True, 'timeUp': True, 'requireExpired': True, 'answers': [edit('late')]}
    result = client.post(f'{ATTEMPT}/submit', payload, format='json')
    assert result.status_code == 201, result.data
    assert result.data['data']['status'] == 'completed'
    assert client.post(f'{ATTEMPT}/submit', payload, format='json').data['data']['status'] == 'completed'
    row = MockAnswer.objects.get(attempt=attempt, question_id='exam4-reading')
    assert (row.response, row.is_correct, row.score, row.is_graded) == ('alpha', True, 1, True)
    assert SubmissionHandoff.objects.filter(attempt_id=attempt.id).count() == 1


def test_recording_receipt_range_and_ownership(attempt):
    MockAttempt.objects.filter(pk=attempt.pk).update(current_skill='speaking')
    source = BytesIO()
    with wave.open(source, 'wb') as output:
        output.setparams((1, 2, 8000, 0, 'NONE', 'not compressed'))
        output.writeframes(b'\x01\x00' * 8000)
    data = source.getvalue()
    upload = SimpleUploadedFile('take.wav', data, content_type='audio/wav')
    client = client_for()
    audio_path = f'{ATTEMPT}/answers/exam4-speaking/audio'
    slot = f'{ATTEMPT}/speaking/exam4-speaking'
    assert client.post(slot, {'audio': SimpleUploadedFile('tiny.wav', b'bad', content_type='audio/wav')}).status_code == 400
    assert not MockAnswer.objects.filter(attempt=attempt, question_id='exam4-speaking').exists()
    uploaded = client.post(slot, {'audio': upload})
    assert uploaded.status_code == 201, uploaded.data
    assert uploaded.data['data']['saved'] is True
    assert uploaded.data['data']['audioDurationMs'] == 1000
    corrupt = SimpleUploadedFile('corrupt.wav', data[:12] + b'\0' * 2048, content_type='audio/wav')
    assert client.post(slot, {'audio': corrupt}).data['error']['code'] == 'INVALID_AUDIO'
    ranged = client.get(audio_path, HTTP_RANGE='bytes=-64')
    assert ranged.status_code == 206
    assert ranged['Cache-Control'] == 'private, no-store'
    assert b''.join(ranged.streaming_content) == data[-64:]
    assert client.get(audio_path, HTTP_RANGE='bytes=99999-').status_code == 416
    outsider = client_for(SimpleNamespace(id='different-student', role='student', is_authenticated=True))
    assert outsider.get(audio_path).status_code in (403, 404)
    graded = client.post(f'{ATTEMPT}/submit', {'confirm': True}, format='json')
    assert graded.data['data']['status'] == 'grading', graded.data
    assert not MockAnswer.objects.get(attempt=attempt, question_id='exam4-speaking').is_graded
