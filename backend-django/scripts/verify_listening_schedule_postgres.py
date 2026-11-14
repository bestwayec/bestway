"""Loopback-only check of the IELTS timed Listening schedule on the real schema.

Pressing Play records the part's start once (reading time, then the recording). While the part
is playing on the server clock the audio can be fetched again (reload, lost connection); after
it ends it cannot. Clients that never start a part keep the old play-count rule. Every fixture
row is removed.
"""
import os
import sys
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlparse
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if urlparse(os.environ.get('DATABASE_URL', '')).hostname not in ('localhost', '127.0.0.1', '::1'):
    raise SystemExit('Only a loopback PostgreSQL fixture is allowed')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.local')
os.environ.setdefault('ALLOWED_HOSTS', 'testserver,localhost,127.0.0.1')
import django

django.setup()
from django.db import connection
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core import mock_attempts as engine
from apps.core.mock_media import record_audio_access
from apps.legacy_schema.models import MockAnswer, MockAttempt, MockExam, MockQuestion, MockQuestionGroup, MockSection, User
from common.api.exceptions import ContractAPIException

run_id = uuid4().hex[:10]
student = SimpleNamespace(id='lsn-' + run_id, role='student', is_authenticated=True)
exam_id = 'lsn-exam-' + run_id
client = APIClient()
client.force_authenticate(student)
checks = []


def check(value, message):
    if not value:
        raise AssertionError(message)
    checks.append(message)
    print('PASS ' + message)


def access(attempt_id, group_id):
    try:
        record_audio_access(student, attempt_id, group_id)
        return 'ok'
    except ContractAPIException as error:
        return error.contract_code


try:
    now = timezone.now()
    User.objects.create(id=student.id, name='Listening fixture', phone='+99877' + run_id[:7], role='student',
                        password_hash='unused', is_active=True, created_at=now, updated_at=now)
    with connection.cursor() as cursor:
        cursor.execute('INSERT INTO "StudentProfile" ("userId","availablePrograms","activeProgram","isApproved","groupId","currentPoints","linkCode","createdAt","pointsPeriod","gameQualified","qualifiedAt") '
                       "VALUES (%s, ARRAY['IELTS','MULTILEVEL']::\"ExamProgram\"[], 'IELTS', true, NULL, 0, %s, %s, NULL, false, NULL)",
                       [student.id, 'LSN' + run_id[:8].upper(), now])
    MockExam.objects.create(id=exam_id, title='Listening fixture ' + run_id, type='ielts_academic', profile='practice',
                            is_published=True, is_demo=True, price=0, is_free_for_approved=True, content_version=1,
                            created_at=now, updated_at=now)
    section = MockSection.objects.create(id=str(uuid4()), exam_id=exam_id, skill='listening', title='Listening', sort_order=0, duration_minutes=30)
    groups = []
    for index in range(2):
        group = MockQuestionGroup.objects.create(id=str(uuid4()), section_id=section.id, sort_order=index, title=f'Part {index + 1}',
                                                 audio_key=f'fixture/{run_id}-{index}.mp3', audio_play_limit=1, audio_duration_sec=60, created_at=now)
        MockQuestion.objects.create(id=str(uuid4()), group_id=group.id, number=index + 1, sort_order=0, type='short_answer',
                                    prompt='Q', points=1, options=None, correct_answers=['x'], accepted_variants=[], word_limit=2, created_at=now)
        groups.append(group)
    one, two = groups

    started = client.post(f'/v1/mock/exams/{exam_id}/start', {'mode': 'timed', 'skills': ['listening']}, format='json')
    check(started.status_code == 201, f'timed attempt starts (HTTP {started.status_code})')
    attempt_id = started.data['data'].get('attemptId') or started.data['data'].get('id')

    first = client.post(f'/v1/mock/attempts/{attempt_id}/listening/{one.id}/start', {}, format='json')
    data = first.data['data']
    check(first.status_code == 201 and data['readingSeconds'] == 30 and data['durationSec'] == 60,
          'Play records the part: 30 s reading time from the blueprint, then the 60 s recording')
    again = client.post(f'/v1/mock/attempts/{attempt_id}/listening/{one.id}/start', {}, format='json')
    check(again.data['data']['startedAt'] == data['startedAt'], 'a second start (reload) returns the first schedule, never a restart')
    check([access(attempt_id, one.id) for _ in range(3)] == ['ok', 'ok', 'ok'],
          'while the part plays, the audio can be fetched again (reload, lost connection)')
    detail = client.get(f'/v1/mock/attempts/{attempt_id}')
    check(detail.data['data']['listeningSchedule'][one.id]['startedAt'] == data['startedAt'], 'the attempt carries the schedule for the runner after a reload')

    attempt = MockAttempt.objects.get(id=attempt_id)
    state = dict(attempt.media_state)
    past = timezone.now() - timedelta(seconds=60 + 120 + 5)
    state['listening:' + one.id] = dict(state['listening:' + one.id], readingEndsAt=engine.iso(past))
    MockAttempt.objects.filter(id=attempt_id).update(media_state=state)
    check(access(attempt_id, one.id) == 'AUDIO_REPLAY_BLOCKED', 'after the recording has ended on the server clock, the audio is closed')

    check([access(attempt_id, two.id), access(attempt_id, two.id)] == ['ok', 'AUDIO_REPLAY_BLOCKED'],
          'a client that never starts the part keeps the old once-only count')

    practice = client.post(f'/v1/mock/attempts/{attempt_id}/submit', {'confirm': True, 'force': True}, format='json')
    check(practice.status_code in (200, 201), 'the attempt is handed in')
    closed = client.post(f'/v1/mock/attempts/{attempt_id}/listening/{one.id}/start', {}, format='json')
    check(closed.status_code == 400 and 'listeningSchedule' not in client.get(f'/v1/mock/attempts/{attempt_id}').data['data'],
          'no schedule after the hand-in')
finally:
    MockAnswer.objects.filter(attempt__student_id=student.id).delete()
    MockAttempt.objects.filter(student_id=student.id).delete()
    MockQuestion.objects.filter(group__section__exam_id=exam_id).delete()
    MockQuestionGroup.objects.filter(section__exam_id=exam_id).delete()
    MockSection.objects.filter(exam_id=exam_id).delete()
    MockExam.objects.filter(id=exam_id).delete()
    with connection.cursor() as cursor:
        cursor.execute('DELETE FROM "StudentProfile" WHERE "userId" = %s', [student.id])
    User.objects.filter(id=student.id).delete()
    left = MockAttempt.objects.filter(student_id=student.id).count() + MockExam.objects.filter(id=exam_id).count() + User.objects.filter(id=student.id).count()
    if left == 0:
        print('PASS all fixture rows are removed')
        checks.append('cleanup')

print(f'Listening schedule contracts: {len(checks)}/{len(checks)} PASS')
