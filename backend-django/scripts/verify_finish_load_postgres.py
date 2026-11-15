"""Loopback-only load check of Finish (mock submit) on the real schema.

30 students press Finish at the same moment (a group whose exam clock ends together),
then 30 more Finish requests arrive as double clicks and retries on 10 of those attempts.
Every response must be 2xx, quick (the web proxy gives up after 8 s and answers 502),
and each attempt must end with exactly one hand-off and one assessment job per skill:
no duplicate result. Every fixture row and recording is removed.
"""
import os
import statistics
import sys
import threading
import time
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlparse
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if urlparse(os.environ.get('DATABASE_URL', '')).hostname not in ('localhost', '127.0.0.1', '::1'):
    raise SystemExit('Only a loopback PostgreSQL fixture is allowed')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.local')
os.environ.setdefault('ALLOWED_HOSTS', 'testserver,localhost,127.0.0.1')
# No AI provider is called here: the hand-off creates the jobs, nobody grades them.
os.environ['ASSESSMENT_INLINE_TICK'] = 'false'
os.environ['ASSESSMENT_WORKER_ENABLED'] = 'false'
import django

django.setup()
from django.conf import settings
from django.db import connection, connections
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import SubmissionHandoff
from apps.core import mock_submission_handoff
from apps.legacy_schema.models import (AssessmentJob, MockAnswer, MockAttempt, MockExam, MockQuestion,
                                       MockQuestionGroup, MockSection, Notification, User)

STUDENTS = int(os.environ.get('FINISH_LOAD_STUDENTS', '30'))
PROXY_TIMEOUT_S = 8.0
# Production serves the API with gunicorn 2 workers x 2 threads: 4 requests at a time.
# Queue time counts, exactly as the proxy's 8 s clock sees it.
SLOTS = threading.BoundedSemaphore(int(os.environ.get('FINISH_LOAD_SLOTS', '4')))
run_id = uuid4().hex[:10]
exam_id = 'load-exam-' + run_id
checks = []


def check(value, message):
    if not value:
        raise AssertionError(message)
    checks.append(message)
    print('PASS ' + message)


def fire(jobs):
    """Run every (client, attempt_id) Finish at once; returns (status, seconds) per call."""
    barrier = threading.Barrier(len(jobs))
    results = [None] * len(jobs)

    def one(index, client, attempt_id):
        try:
            barrier.wait()
            started = time.perf_counter()
            with SLOTS:
                response = client.post(f'/v1/mock/attempts/{attempt_id}/submit',
                                       {'confirm': True, 'confirmed': True, 'force': True}, format='json')
            results[index] = (response.status_code, time.perf_counter() - started,
                              (response.data or {}).get('data', {}).get('status') if response.status_code < 300 else response.data)
        except Exception as error:  # a crash is a failed Finish, not a test error
            results[index] = (599, 0.0, repr(error))
        finally:
            connections.close_all()

    threads = [threading.Thread(target=one, args=(i, c, a)) for i, (c, a) in enumerate(jobs)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    return results


def summary(label, results):
    seconds = sorted(r[1] for r in results)
    p95 = seconds[max(0, int(len(seconds) * 0.95) - 1)]
    print(f'{label}: n={len(results)} p50={statistics.median(seconds)*1000:.0f} ms '
          f'p95={p95*1000:.0f} ms max={seconds[-1]*1000:.0f} ms')
    return seconds[-1]


students, attempt_ids, recordings = [], [], []
media_dir = Path(settings.MEDIA_ROOT) / 'speaking_submissions' / ('load-' + run_id)
try:
    now = timezone.now()
    MockExam.objects.create(id=exam_id, title='Finish load fixture ' + run_id, type='ielts_academic', profile='full_mock',
                            is_published=True, is_demo=True, price=0, is_free_for_approved=True, content_version=1,
                            created_at=now, updated_at=now)
    questions = {}
    for order, (skill, qtype, count) in enumerate([('listening', 'short_answer', 2), ('reading', 'short_answer', 2),
                                                   ('writing', 'essay_task2', 1), ('speaking', 'speaking_task', int(os.environ.get('FINISH_LOAD_RECORDINGS', '2')))]):
        section = MockSection.objects.create(id=str(uuid4()), exam_id=exam_id, skill=skill, title=skill.title(),
                                             sort_order=order, duration_minutes=10)
        group = MockQuestionGroup.objects.create(id=str(uuid4()), section_id=section.id, sort_order=0, part_number=1,
                                                 title=f'{skill.title()} part 1', passage_text='The sky is blue.',
                                                 audio_play_limit=2, created_at=now)
        questions[skill] = []
        for number in range(1, count + 1):
            qid = str(uuid4())
            auto = skill in ('listening', 'reading')
            MockQuestion.objects.create(id=qid, group_id=group.id, number=number, sort_order=number, type=qtype,
                                        prompt=f'{skill} question {number}', points=1 if auto else 9, options=None,
                                        correct_answers=['blue'] if auto else None, accepted_variants=[],
                                        word_limit=2 if auto else None, created_at=now)
            questions[skill].append(qid)

    media_dir.mkdir(parents=True, exist_ok=True)
    recording = os.urandom(int(os.environ.get('FINISH_LOAD_AUDIO_KB', '512')) * 1024)
    for index in range(STUDENTS):
        sid = f'load-{run_id}-{index:02d}'
        User.objects.create(id=sid, name=f'Finish load {index}', phone=f'+99870{run_id[:3]}{index:04d}'[:20], role='student',
                            password_hash='unused', is_active=True, created_at=now, updated_at=now)
        with connection.cursor() as cursor:
            cursor.execute('INSERT INTO "StudentProfile" ("userId","availablePrograms","activeProgram","isApproved","groupId","currentPoints","linkCode","createdAt","pointsPeriod","gameQualified","qualifiedAt") '
                           "VALUES (%s, ARRAY['IELTS','MULTILEVEL']::\"ExamProgram\"[], 'IELTS', true, NULL, 0, %s, %s, NULL, false, NULL)",
                           [sid, f'LD{run_id[:6].upper()}{index:02d}', now])
        actor = SimpleNamespace(id=sid, role='student', is_authenticated=True)
        client = APIClient()
        client.force_authenticate(actor)
        started = client.post(f'/v1/mock/exams/{exam_id}/start', {}, format='json')
        if started.status_code != 201:
            raise AssertionError(f'start HTTP {started.status_code}: {started.data}')
        aid = started.data['data'].get('attemptId') or started.data['data'].get('id')
        rows = []
        for skill, ids in questions.items():
            for qid in ids:
                key = None
                if skill == 'speaking':
                    key = f'speaking_submissions/load-{run_id}/{aid}-{qid}.webm'
                    (Path(settings.MEDIA_ROOT) / key).write_bytes(recording)
                    recordings.append(key)
                rows.append(MockAnswer(id=str(uuid4()), attempt_id=aid, question_id=qid, is_graded=False, updated_at=now,
                                       response='' if skill == 'speaking' else 'blue' if skill != 'writing' else ' '.join(['word'] * 260),
                                       audio_key=key))
        MockAnswer.objects.bulk_create(rows)
        # The student has reached the last section (Speaking) of the full mock.
        MockAttempt.objects.filter(id=aid).update(current_skill='speaking', submitted_sections=['listening', 'reading', 'writing'])
        students.append((client, aid))
        attempt_ids.append(aid)
    check(len(attempt_ids) == STUDENTS, f'{STUDENTS} full mock attempts are waiting at Speaking')

    first = fire(students)
    slowest = summary('30 parallel Finish', first)
    check(all(200 <= code < 300 for code, _, _ in first), f'every parallel Finish answers 2xx ({sorted({c for c, _, _ in first})})')
    check(all(status == 'grading' for _, _, status in first), 'every Finish reports the honest pending state (Writing/Speaking await grading)')
    check(slowest < PROXY_TIMEOUT_S, f'the slowest Finish ({slowest:.2f} s) is far inside the 8 s proxy limit')

    repeats = fire([students[i % 10] for i in range(30)])
    summary('30 repeated Finish (double click / retry)', repeats)
    check(all(200 <= code < 300 for code, _, _ in repeats), 'repeated Finish requests answer 2xx too')
    check(all(status == 'grading' for _, _, status in repeats), 'a repeated Finish returns the stored state')

    deadline = time.monotonic() + 60
    while SubmissionHandoff.objects.filter(attempt_id__in=attempt_ids, done_at__isnull=True).exists() and time.monotonic() < deadline:
        mock_submission_handoff.process_pending()  # also what the worker loop does
        time.sleep(0.5)
    handoffs = list(SubmissionHandoff.objects.filter(attempt_id__in=attempt_ids))
    check(len(handoffs) == STUDENTS and all(h.done_at for h in handoffs), 'each attempt has one hand-off and every hand-off finished after the response')
    check(MockAttempt.objects.filter(exam_id=exam_id).count() == STUDENTS, 'no second attempt was created')
    jobs = list(AssessmentJob.objects.filter(attempt_id__in=attempt_ids).values_list('attempt_id', 'skill'))
    check(len(jobs) == len(set(jobs)) == STUDENTS * 2, f'exactly one Writing and one Speaking job per attempt ({len(jobs)} jobs, no duplicates)')
    check(all(a.submitted_at and a.status == 'grading' for a in MockAttempt.objects.filter(id__in=attempt_ids)), 'every attempt is stored as handed in')
finally:
    ids = attempt_ids
    AssessmentJob.objects.filter(attempt_id__in=ids).delete()
    SubmissionHandoff.objects.filter(attempt_id__in=ids).delete()
    MockAnswer.objects.filter(attempt_id__in=ids).delete()
    MockAttempt.objects.filter(exam_id=exam_id).delete()
    MockQuestion.objects.filter(group__section__exam_id=exam_id).delete()
    MockQuestionGroup.objects.filter(section__exam_id=exam_id).delete()
    MockSection.objects.filter(exam_id=exam_id).delete()
    MockExam.objects.filter(id=exam_id).delete()
    student_ids = [f'load-{run_id}-{i:02d}' for i in range(STUDENTS)]
    Notification.objects.filter(user_id__in=student_ids).delete()
    with connection.cursor() as cursor:
        cursor.execute('DELETE FROM "StudentProfile" WHERE "userId" = ANY(%s)', [student_ids])
    User.objects.filter(id__in=student_ids).delete()
    for key in recordings:
        (Path(settings.MEDIA_ROOT) / key).unlink(missing_ok=True)
    if media_dir.exists():
        media_dir.rmdir()
check(not MockExam.objects.filter(id=exam_id).exists() and not SubmissionHandoff.objects.filter(attempt_id__in=attempt_ids).exists(),
      'all fixture rows are removed')
print(f'Finish load: {len(checks)}/{len(checks)} PASS')
