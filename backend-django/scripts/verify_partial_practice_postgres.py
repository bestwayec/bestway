"""Local-only disposable API test of scoped Writing/Speaking task practice.

No external providers, production mutations, or browser E2E are involved.
"""
import io
from datetime import timedelta
from decimal import Decimal, ROUND_HALF_UP
import os
from pathlib import Path
import sys
from types import SimpleNamespace
from urllib.parse import urlparse
from uuid import uuid4
import wave
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if urlparse(os.environ.get('DATABASE_URL', '')).hostname not in {'127.0.0.1', 'localhost', '::1'}:
    raise SystemExit('Refusing non-local DATABASE_URL')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.local')
os.environ.setdefault('ALLOWED_HOSTS', 'testserver,localhost,127.0.0.1')
import django
django.setup()

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.utils import timezone
from rest_framework.test import APIClient
from apps.core import mock_authoring
from apps.core.multilevel import CURRENT_SPEC, CURRENT_SPEAKING_PROFILE
from apps.legacy_schema.models import (AssessmentJob, AuditLog, MockAttempt,
    MockExam, MockQuestion, MockQuestionGroup, MockSection, Notification, User)

run_id = uuid4().hex[:12]
admin = SimpleNamespace(id=str(uuid4()), role='super_admin', is_authenticated=True)
student = SimpleNamespace(id=str(uuid4()), role='student', is_authenticated=True)
exam_id = str(uuid4())
client = APIClient()
media_keys = []
checks = []


def check(condition, label):
    if not condition:
        raise AssertionError(label)
    checks.append(label)
    print('PASS ' + label)


def data(response, status=200, code=None):
    if response.status_code != status:
        raise AssertionError(f"{response.request.get('PATH_INFO')} HTTP {response.status_code}: {response.data}")
    if code:
        check(response.data['error']['code'] == code, f"HTTP {status} {code}")
        return response.data['error']
    checks.append(f"HTTP {status} {response.request.get('PATH_INFO')}")
    return response.data['data']


def snapshot():
    return dict(exam=MockExam.objects.values().get(id=exam_id),
                sections=list(MockSection.objects.filter(exam_id=exam_id).order_by('id').values()),
                groups=list(MockQuestionGroup.objects.filter(section__exam_id=exam_id).order_by('id').values()),
                questions=list(MockQuestion.objects.filter(group__section__exam_id=exam_id).order_by('id').values()))


def audio(seconds=30):
    stream = io.BytesIO()
    with wave.open(stream, 'wb') as file:
        file.setnchannels(1)
        file.setsampwidth(2)
        file.setframerate(8000)
        file.writeframes(b'\0\0' * round(seconds * 8000))
    return SimpleUploadedFile('local-fixture.wav', stream.getvalue(), content_type='audio/wav')


try:
    now = timezone.now()
    for index, actor in enumerate((admin, student)):
        User.objects.create(id=actor.id, name='Partial Practice Fixture', phone=f'+99877{run_id[:6]}{index}',
                            role=actor.role, password_hash='unused', is_active=True, created_at=now, updated_at=now)
    with connection.cursor() as cursor:
        cursor.execute('INSERT INTO "StudentProfile" ("userId","availablePrograms","activeProgram","isApproved","groupId","currentPoints","linkCode","createdAt","pointsPeriod","gameQualified","qualifiedAt") '
                       "VALUES (%s, ARRAY['MULTILEVEL','IELTS']::\"ExamProgram\"[], 'MULTILEVEL', true, NULL, 0, %s, %s, NULL, false, NULL)",
                       [student.id, f'PP{run_id[:8].upper()}', now])
    MockExam.objects.create(id=exam_id, title='Local partial practice ' + run_id, type='multilevel', profile='practice',
                            specification_version=CURRENT_SPEC, speaking_profile_version=CURRENT_SPEAKING_PROFILE,
                            is_published=False, is_demo=True, price=0, is_free_for_approved=True,
                            content_version=25, created_by_id=admin.id, created_at=now, updated_at=now)
    qids = {'writing': [], 'speaking': []}
    excluded = None
    for skill_index, skill in enumerate(('listening', 'writing', 'speaking')):
        section = MockSection.objects.create(id=str(uuid4()), exam_id=exam_id, skill=skill, title=skill.title(), sort_order=skill_index)
        groups = 3 if skill == 'writing' else 2
        number = 1
        for index in range(groups):
            maximum = 6 if skill == 'writing' and index == 2 else 5 if skill != 'listening' else None
            group = MockQuestionGroup.objects.create(id=str(uuid4()), section_id=section.id, sort_order=index,
                title=f'Authored {skill} {index + 1}', max_score=maximum, audio_play_limit=2,
                stimulus_ref='shared-original-stimulus' if skill == 'writing' and index < 2 else None,
                part_number=index + 1 if skill == 'listening' else None, created_at=now)
            count = 0 if skill == 'listening' else 3 if skill == 'speaking' and index == 0 else 1
            for qi in range(count):
                qid = str(uuid4())
                MockQuestion.objects.create(id=qid, group_id=group.id, number=number, sort_order=qi,
                    type='speaking_task' if skill == 'speaking' else 'essay_task2' if index == 2 else 'essay_task1',
                    prompt='Compare the pictures.' if skill == 'speaking' and index == 1 else f'Original authored {skill} prompt {number}.',
                    points=9, options=[], correct_answers=[], accepted_variants=[], created_at=now)
                number += 1
                if skill == 'speaking' and index == 1:
                    excluded = qid
                else:
                    qids[skill].append(qid)
    before = snapshot()

    client.force_authenticate(admin)
    report = data(client.get(f'/v1/mock/exams/{exam_id}/readiness'))
    check(not report['ready'] and report['practiceReady'] and report['practiceQuestionCount'] == 6,
          'Review keeps full readiness false and exposes six valid practice tasks')
    data(client.patch(f'/v1/mock/exams/{exam_id}', {'isPublished': True}, format='json'), 400, 'MOCK_NOT_READY')
    client.force_authenticate(student)
    definition = data(client.get(f'/v1/mock/exams/{exam_id}'))
    check(definition['ready'] is False and definition['practiceSkills'] == ['writing', 'speaking'],
          'Student detail distinguishes strict readiness and available practice skills')
    listed = next(e for e in data(client.get('/v1/mock/exams')) if e['id'] == exam_id)
    check(not listed['ready'] and listed['practiceReady'], 'Catalogue agrees on both readiness contracts')
    data(client.post(f'/v1/mock/exams/{exam_id}/start', {'mode': 'practice'}, format='json'), 400, 'MOCK_NOT_READY')
    started = data(client.post(f'/v1/mock/exams/{exam_id}/start', {'mode': 'practice', 'skills': ['writing', 'speaking']}, format='json'), 201)
    attempt_id = started['attemptId']
    check(started['flowMode'] == 'partial_practice' and started['exam']['questionCount'] == 6,
          'Explicit partial practice starts only the six valid authored tasks')
    check(excluded not in started['practiceScope']['questionIds'] and [s['skill'] for s in started['exam']['sections']] == ['writing', 'speaking'],
          'Empty Listening and missing-picture Speaking task are excluded')
    resumed = data(client.post(f'/v1/mock/exams/{exam_id}/start', {'mode': 'practice', 'skills': ['speaking', 'writing']}, format='json'), 201)
    check(resumed['attemptId'] == attempt_id and resumed['resumed'], 'Matching selection resumes the frozen scope')
    data(client.post(f'/v1/mock/exams/{exam_id}/start', {'mode': 'practice', 'skills': ['writing']}, format='json'), 409, 'MOCK_ATTEMPT_SCOPE_CONFLICT')
    data(client.post(f'/v1/mock/attempts/{attempt_id}/answer', {'questionId': excluded, 'response': 'Forged'}, format='json'), 400, 'QUESTION_NOT_IN_EXAM')
    data(client.post(f'/v1/mock/attempts/{attempt_id}/answers', {'answers': [{'questionId': excluded, 'response': 'Forged'}]}, format='json'), 403, 'SECTION_LOCKED')
    data(client.post(f'/v1/mock/attempts/{attempt_id}/speaking/{excluded}/start', {}, format='json'), 403, 'QUESTION_NOT_IN_EXAM')
    data(client.post(f'/v1/mock/attempts/{attempt_id}/speaking/{excluded}', {'audio': audio()}, format='multipart'), 400, 'QUESTION_NOT_IN_EXAM')
    data(client.post(f'/v1/mock/attempts/{attempt_id}/submit', {}, format='json'), 400, 'MOCK_ATTEMPT_INCOMPLETE')
    check(not AssessmentJob.objects.filter(attempt_id=attempt_id).exists(), 'Incomplete submission creates no assessment jobs')
    for qid in qids['writing']:
        data(client.post(f'/v1/mock/attempts/{attempt_id}/answer', {'questionId': qid, 'response': 'Original local fixture essay response.'}, format='json'), 201)
    from apps.legacy_schema.models import MockAnswer
    task_clock = timezone.now() - timedelta(seconds=95)
    for qid in qids['speaking']:
        with patch('django.utils.timezone.now', return_value=task_clock):
            phase = data(client.post(f'/v1/mock/attempts/{attempt_id}/speaking/{qid}/start', {}, format='json'), 201)
            repeated = data(client.post(f'/v1/mock/attempts/{attempt_id}/speaking/{qid}/start', {}, format='json'), 201)
            check(phase['startedAt'] == repeated['startedAt'] and phase['expiresAt'] == repeated['expiresAt'],
                  'Practice speaking start keeps one authoritative active response window')
            data(client.post(f'/v1/mock/attempts/{attempt_id}/speaking/{qid}', {'audio': audio()}, format='multipart'), 400, 'SPEAKING_RESPONSE_ACTIVE')
        task_clock += timedelta(seconds=30)
        with patch('django.utils.timezone.now', return_value=task_clock):
            data(client.post(f'/v1/mock/attempts/{attempt_id}/speaking/{qid}', {'audio': audio(3), 'durationMs': 30000}, format='multipart'), 400, 'SPEAKING_AUDIO_DURATION_INVALID')
            check(not MockAnswer.objects.filter(attempt_id=attempt_id, question_id=qid).exists(),
                  'Three-second upload never creates a student answer despite claimed duration metadata')
            accepted = data(client.post(f'/v1/mock/attempts/{attempt_id}/speaking/{qid}', {'audio': audio()}, format='multipart'), 201)
            check(accepted['audioDurationMs'] == 30000, 'Accepted audio duration comes from decoded sample count')
        task_clock += timedelta(seconds=1)
    media_keys.extend(MockAnswer.objects.filter(attempt_id=attempt_id).exclude(audio_key=None).values_list('audio_key', flat=True))
    submitted = data(client.post(f'/v1/mock/attempts/{attempt_id}/submit', {}, format='json'), 201)
    check(submitted['status'] == 'grading' and set(submitted['rawScores']) == {'writing', 'speaking'}
          and submitted['overallScore'] is None and submitted['cefrLevel'] is None,
          'Submission awaits teacher scoring and invents no overall or CEFR score')
    jobs = list(AssessmentJob.objects.filter(attempt_id=attempt_id))
    check(len(jobs) == 2 and all(j.status == 'NEEDS_REVIEW' and j.policy_mode == 'MANUAL_ONLY' for j in jobs),
          'Both scoped skills enter the durable manual review ledger')
    check(all(j.input_snapshot.get('practiceMode') == 'PARTIAL' for j in jobs), 'Assessment snapshots explicitly identify partial practice')
    client.force_authenticate(admin)
    for qid in [*qids['writing'], *qids['speaking']]:
        data(client.post(f'/v1/mock/attempts/{attempt_id}/grade', {'questionId': qid, 'score': 4, 'feedback': 'Local teacher feedback.'}, format='json'), 201)
    result = data(client.get(f'/v1/mock/attempts/{attempt_id}'))
    check(result['status'] == 'completed' and
          {skill: {key: raw[key] for key in ('score', 'max')} for skill, raw in result['rawScores'].items()} ==
          {'writing': {'score': 12, 'max': 16}, 'speaking': {'score': 4, 'max': 5}},
          'Teacher grades complete only the selected tasks with the authored rubric maxima')
    check(all(raw['practiceGrade']['score'] == float((Decimal(35) + Decimal(15) * Decimal(str(raw['score'])) / Decimal(str(raw['max']))).quantize(Decimal('.1'), rounding=ROUND_HALF_UP))
              and raw['practiceGrade']['rawScore'] == raw['score'] and raw['practiceGrade']['rawMax'] == raw['max']
              and raw['practiceGrade']['isOfficial'] is False for raw in result['rawScores'].values()),
          'New internal practice grades preserve teacher raw evidence without an official level')
    check(result['overallScore'] is None and result['cefrLevel'] is None and not result['standardScores'],
          'Partial practice never claims a full Multilevel estimate')
    jobs = list(AssessmentJob.objects.filter(attempt_id=attempt_id))
    check(all(j.status == 'SUCCEEDED' and j.final_score_source == 'TEACHER' and j.final_score == result['rawScores'][j.skill]['score'] for j in jobs),
          'The durable assessment ledger and attempt result share the teacher final score')
    data(client.get(f'/v1/mock/attempts/{attempt_id}/certificate'), 400, 'MOCK_PARTIAL_PRACTICE_NO_CERTIFICATE')
    check(snapshot() == before, 'Source exam content, version and publish state remain unchanged')
    client.force_authenticate(student)
    student_result = data(client.get(f'/v1/mock/attempts/{attempt_id}'))
    check(student_result['rawScores'] == result['rawScores'] and student_result['status'] == result['status'],
          'Student and teacher see the same persisted scores')
    print(f'SUMMARY {len(checks)}/{len(checks)} passed')
finally:
    MockExam.objects.filter(id=exam_id).delete()
    Notification.objects.filter(user_id__in=[student.id, admin.id]).delete()
    AuditLog.objects.filter(user_id__in=[student.id, admin.id]).delete()
    User.objects.filter(id__in=[student.id, admin.id]).delete()
    from apps.core.mock_media import delete_unreferenced
    for key in media_keys:
        delete_unreferenced(key)
    print('CLEANUP disposable_exam_leftovers=' + str(MockExam.objects.filter(id=exam_id).count()))
