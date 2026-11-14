"""Loopback-only check of the exam window contracts on the real schema.

Answers: the last edit wins by edit time on the server clock (an edit queued offline
never overwrites a newer saved answer; the newer value comes back as `stale`); clients
that send no edit time keep the old behaviour. Finish: submitting again returns the
stored state and never creates a second attempt. Every fixture row is removed.
"""
import os
import sys
from datetime import timedelta, timezone as dt_timezone
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

from apps.legacy_schema.models import MockAnswer, MockAttempt, MockExam, MockQuestion, MockQuestionGroup, MockSection, User

run_id = uuid4().hex[:10]
student = SimpleNamespace(id='win-' + run_id, role='student', is_authenticated=True)
exam_id = 'win-exam-' + run_id
client = APIClient()
client.force_authenticate(student)
checks = []


def check(value, message):
    if not value:
        raise AssertionError(message)
    checks.append(message)
    print('PASS ' + message)


def ms(moment):
    return int(moment.timestamp() * 1000)


def save(items, status=201):
    response = client.post(f'/v1/mock/attempts/{attempt_id}/answers', {'answers': items}, format='json')
    if response.status_code != status:
        raise AssertionError(f'answers HTTP {response.status_code}: {response.data}')
    return response.data.get('data') if status < 400 else response.data


def stored(question_id):
    row = MockAnswer.objects.get(attempt_id=attempt_id, question_id=question_id)
    if row.updated_at is not None and row.updated_at.tzinfo is None:   # Prisma column: UTC without time zone
        row.updated_at = row.updated_at.replace(tzinfo=dt_timezone.utc)
    return row


attempt_id = None
try:
    now = timezone.now()
    User.objects.create(id=student.id, name='Exam window fixture', phone='+99878' + run_id[:7], role='student',
                        password_hash='unused', is_active=True, created_at=now, updated_at=now)
    with connection.cursor() as cursor:
        cursor.execute('INSERT INTO "StudentProfile" ("userId","availablePrograms","activeProgram","isApproved","groupId","currentPoints","linkCode","createdAt","pointsPeriod","gameQualified","qualifiedAt") '
                       "VALUES (%s, ARRAY['IELTS','MULTILEVEL']::\"ExamProgram\"[], 'IELTS', true, NULL, 0, %s, %s, NULL, false, NULL)",
                       [student.id, 'WIN' + run_id[:8].upper(), now])
    MockExam.objects.create(id=exam_id, title='Exam window fixture ' + run_id, type='ielts_academic', profile='practice',
                            is_published=True, is_demo=True, price=0, is_free_for_approved=True, content_version=1,
                            created_at=now, updated_at=now)
    section = MockSection.objects.create(id=str(uuid4()), exam_id=exam_id, skill='reading', title='Reading', sort_order=0, duration_minutes=60)
    group = MockQuestionGroup.objects.create(id=str(uuid4()), section_id=section.id, sort_order=0, title='Passage 1',
                                             passage_text='The sky is blue on a clear day.', audio_play_limit=1, created_at=now)
    q1, q2 = str(uuid4()), str(uuid4())
    for number, qid in enumerate((q1, q2), start=1):
        MockQuestion.objects.create(id=qid, group_id=group.id, number=number, sort_order=number, type='short_answer',
                                    prompt=f'Question {number}', points=1, options=None, correct_answers=['blue'],
                                    accepted_variants=[], word_limit=2, created_at=now)

    started = client.post(f'/v1/mock/exams/{exam_id}/start', {'mode': 'practice'}, format='json')
    check(started.status_code == 201, f'practice attempt starts (HTTP {started.status_code})')
    attempt_id = started.data['data'].get('attemptId') or started.data['data'].get('id')

    base = timezone.now()
    first = save([{'questionId': q1, 'response': 'first', 'editedAt': ms(base - timedelta(seconds=30))}])
    check(first['saved'] == 1 and 'stale' not in first and stored(q1).response == 'first', 'an edit with its edit time is saved')
    newer = save([{'questionId': q1, 'response': 'newer', 'editedAt': ms(base - timedelta(seconds=10))}])
    check('stale' not in newer and stored(q1).response == 'newer', 'a newer edit replaces the saved answer')
    old = save([{'questionId': q1, 'response': 'queued offline', 'editedAt': ms(base - timedelta(seconds=20))}])
    check(old.get('stale') == {q1: 'newer'} and stored(q1).response == 'newer',
          'an older queued edit does not overwrite; the newer value comes back as stale')
    check(abs((stored(q1).updated_at - (base - timedelta(seconds=10))).total_seconds()) < 0.01, 'the stored time is the edit time on the server clock')
    batch = save([{'questionId': q2, 'response': 'b-late', 'editedAt': ms(base - timedelta(seconds=1))},
                  {'questionId': q2, 'response': 'b-early', 'editedAt': ms(base - timedelta(seconds=5))}])
    check(batch['saved'] == 2 and stored(q2).response == 'b-late', 'inside one batch the latest edit of a question wins')
    save([{'questionId': q2, 'response': 'clock ahead', 'editedAt': ms(timezone.now() + timedelta(hours=2))}])
    check(stored(q2).response == 'clock ahead' and stored(q2).updated_at <= timezone.now(), 'an edit time in the future is clamped to now')
    plain = save([{'questionId': q1, 'response': 'desktop client'}])
    check('stale' not in plain and stored(q1).response == 'desktop client', 'a client without edit times keeps the old behaviour')
    bad = save([{'questionId': q1, 'response': 'x', 'editedAt': 'yesterday'}], status=400)
    check(bad['error']['code'] == 'VALIDATION_ERROR', 'an invalid edit time is refused')

    one = client.post(f'/v1/mock/attempts/{attempt_id}/submit', {'confirm': True, 'confirmed': True, 'force': True}, format='json')
    two = client.post(f'/v1/mock/attempts/{attempt_id}/submit', {'confirm': True, 'confirmed': True, 'force': True}, format='json')
    check(one.status_code in (200, 201) and two.status_code in (200, 201), f'submit and a repeated submit both answer ({one.status_code}, {two.status_code})')
    check(one.data['data']['status'] == two.data['data']['status'] != 'in_progress', 'the repeated submit returns the stored state')
    check(MockAttempt.objects.filter(student_id=student.id, exam_id=exam_id).count() == 1, 'only one attempt exists after a repeated submit')
    late = save([{'questionId': q1, 'response': 'after submit', 'editedAt': ms(timezone.now())}], status=400)
    check(stored(q1).response == 'desktop client', f'no answer changes after submit ({late["error"]["code"]})')
finally:
    MockAnswer.objects.filter(attempt__student_id=student.id).delete()
    MockAttempt.objects.filter(student_id=student.id).delete()
    MockQuestion.objects.filter(group__section__exam_id=exam_id).delete()
    MockQuestionGroup.objects.filter(section__exam_id=exam_id).delete()
    MockSection.objects.filter(exam_id=exam_id).delete()
    MockExam.objects.filter(id=exam_id).delete()
    with connection.cursor() as cursor:
        cursor.execute('DELETE FROM "StudentProfile" WHERE "userId"=%s', [student.id])
    User.objects.filter(id=student.id).delete()
check(not MockAttempt.objects.filter(student_id=student.id).exists() and not MockExam.objects.filter(id=exam_id).exists(), 'all fixture rows are removed')
print(f'Exam window contracts: {len(checks)}/{len(checks)} PASS')
