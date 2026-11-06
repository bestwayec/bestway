"""Synthetic, isolated PostgreSQL checks for teacher grading atomicity and locks."""
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import urlparse
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
url = urlparse(os.environ.get('DATABASE_URL', ''))
if url.hostname not in {'localhost', '127.0.0.1', '::1'} or not url.path.lstrip('/').startswith(('bestway_audit_', 'bestway_security_')):
    raise SystemExit('Requires an explicitly disposable loopback audit/security database')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.local')

import django
django.setup()
from django.db import close_old_connections, connection, connections, transaction
from django.utils import timezone
from psycopg import sql
from apps.core import assessment
from apps.legacy_schema.models import AssessmentJob, MockAttempt, MockExam, StudentProfile, User
from common.api.exceptions import ContractAPIException

prefix = 'manual-grade-' + uuid4().hex[:12]
ids = {name: prefix + '-' + name for name in ('admin', 'student', 'exam', 'attempt', 'job')}
actor = SimpleNamespace(id=ids['admin'], role='admin', name='Synthetic teacher')
now = timezone.now()


def insert(table, **values):
    with connection.cursor() as cursor:
        query = sql.SQL('INSERT INTO {} ({}) VALUES ({})').format(sql.Identifier(table),
            sql.SQL(',').join(map(sql.Identifier, values)), sql.SQL(',').join(sql.Placeholder() for _ in values))
        cursor.execute(query, list(values.values()))


def check(value, message):
    if not value:
        raise AssertionError(message)
    print('PASS ' + message)


try:
    for role in ('admin', 'student'):
        insert('User', id=ids[role], name='Synthetic local user', phone=ids[role], passwordHash='unused', role=role, updatedAt=now)
    with connection.cursor() as cursor:
        cursor.execute('INSERT INTO "StudentProfile" ("userId","availablePrograms","activeProgram","isApproved","linkCode") VALUES (%s,ARRAY[\'IELTS\']::"ExamProgram"[],\'IELTS\',true,%s)', [ids['student'], prefix])
    insert('MockExam', id=ids['exam'], type='ielts_academic', title='Synthetic grading test', profile='practice', updatedAt=now)
    insert('MockAttempt', id=ids['attempt'], examId=ids['exam'], studentId=ids['student'], status='grading', submittedAt=now, flowMode='full_test')
    AssessmentJob.objects.create(id=ids['job'], attempt_id=ids['attempt'], student_id=ids['student'], program='IELTS',
        skill='writing', input_hash='synthetic-hash', input_snapshot={'parts': []}, generation=1,
        rubric_version='v1', prompt_version='v1', policy_mode='FULL_MOCK_AI_WITH_REVIEW',
        status='PROCESSING', version=1, attempt_count=1, lease_token='synthetic-lease',
        lease_expires_at=now + __import__('datetime').timedelta(minutes=10), created_at=now, updated_at=now)

    # A failed final write must roll back the preceding job update.
    with patch.object(MockAttempt, 'save', side_effect=RuntimeError('injected persistence failure')):
        try:
            assessment.teacher_grade_attempt(actor, ids['attempt'], {'writing_score': 6.5})
        except RuntimeError as error:
            assert str(error) == 'injected persistence failure'
        else:
            raise AssertionError('expected injected save failure')
    job = AssessmentJob.objects.get(id=ids['job'])
    check(job.status == 'PROCESSING' and job.final_score is None and job.version == 1
          and job.lease_token == 'synthetic-lease', 'failed manual grade rolls back all job changes')

    locked, release = Event(), Event()
    def hold_and_reopen():
        close_old_connections()
        try:
            with transaction.atomic():
                attempt = MockAttempt.objects.select_for_update().get(id=ids['attempt'])
                attempt.status = 'in_progress'
                attempt.save(update_fields=['status'])
                locked.set()
                assert release.wait(10)
        finally:
            connections.close_all()

    def grade_after_lock():
        close_old_connections()
        try:
            with connections['default'].cursor() as cursor:
                cursor.execute("SELECT set_config('application_name', %s, false)", [prefix])
            try:
                assessment.teacher_grade_attempt(actor, ids['attempt'], {'writing_score': 6.5})
            except ContractAPIException as error:
                return error.contract_code
            return 'unexpected-success'
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as pool:
        holder = pool.submit(hold_and_reopen)
        assert locked.wait(10)
        grader = pool.submit(grade_after_lock)
        try:
            waiting = False
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT wait_event_type, query FROM pg_stat_activity WHERE application_name = %s", [prefix])
                    state = cursor.fetchone()
                if state and state[0] == 'Lock':
                    # pg_stat_activity can truncate long SELECTs before FOR UPDATE.
                    waiting = state[1].lstrip().startswith('SELECT "MockAttempt".')
                    break
                if grader.done():
                    break
                time.sleep(.05)
            check(waiting, 'manual grade waits for the attempt lock before reading and changing scores')
            release.set()
            holder.result(timeout=15)
            outcome = grader.result(timeout=15)
        finally:
            release.set()
    check(outcome == 'MOCK_ATTEMPT_NOT_SUBMITTED' and MockAttempt.objects.get(id=ids['attempt']).status == 'in_progress',
          'manual grade observes a concurrent reopen under the shared attempt lock')
    job.refresh_from_db()
    check(job.status == 'PROCESSING' and job.final_score is None, 'rejected manual grade does not modify the assessment job')

    MockAttempt.objects.filter(id=ids['attempt']).update(status='grading')
    result = assessment.teacher_grade_attempt(actor, ids['attempt'], {'writing_score': 6.5, 'teacher_comment': 'Synthetic review'})
    job.refresh_from_db()
    check(result['success'] and job.status == 'SUCCEEDED' and job.final_score == 6.5
          and job.lease_token is None and job.lease_expires_at is None and job.version == 2,
          'successful manual grade invalidates the prior worker lease and increments the version')
    stale = SimpleNamespace(id=ids['job'], lease_token='synthetic-lease')
    with transaction.atomic():
        try:
            assessment.require_lease(stale)
        except ContractAPIException as error:
            check(error.contract_code == 'ASSESSMENT_STALE_LEASE', 'stale worker cannot finalize over the teacher grade')
        else:
            raise AssertionError('stale worker lease was accepted')
finally:
    AssessmentJob.objects.filter(id=ids['job']).delete()
    MockAttempt.objects.filter(id=ids['attempt']).delete()
    MockExam.objects.filter(id=ids['exam']).delete()
    StudentProfile.objects.filter(user_id=ids['student']).delete()
    User.objects.filter(id__in=[ids['student'], ids['admin']]).delete()
    connections.close_all()
