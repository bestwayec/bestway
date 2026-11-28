"""Loopback-only BESTWAY 5.1 check of server-authoritative exam closure on the real schema.

Clock control: no real timer is awaited. Deadlines are moved into the past in the database,
which is exactly what the server sees when the wall clock passes them.

Covers: teacher fixed-close configuration and validation, deadline capping, manual Finish,
a student who closed the browser (worker hand-in, confirmed answers kept, objective score),
late-write rejection inside the grace window, a never-started student (no fabricated score),
manual Finish racing the worker, two concurrent workers, duplicate sweeps, catch-up after
downtime outside the old 48-hour report window, and the production worker entrypoint.
"""
import os
import sys
import threading
from datetime import timedelta
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if urlparse(os.environ.get('DATABASE_URL', '')).hostname not in ('localhost', '127.0.0.1', '::1'):
    raise SystemExit('Only a loopback PostgreSQL fixture is allowed')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.local')
os.environ.setdefault('ALLOWED_HOSTS', 'testserver,localhost,127.0.0.1')
os.environ['ASSESSMENT_INLINE_TICK'] = 'false'
import django

django.setup()
from django.db import close_old_connections
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core import mock_deadline, mock_submission_handoff as handoff, mock_submissions
from apps.core.homework_scoring import ASSIGNMENT_KEY
from apps.core.mock_attempts import aware
from apps.core.models import HomeworkAssignment, HomeworkSubmission
from apps.legacy_schema.models import MockAnswer, MockAttempt

sys.path.insert(0, str(Path(__file__).resolve().parent))
from exam51_fixtures import Fixture  # noqa: E402

fx = Fixture('x51d')
checks = []


def check(value, message):
    if not value:
        raise AssertionError('FAIL ' + message)
    checks.append(message)
    print('PASS ' + message)


def api(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


def expire(attempt_id, ago):
    """Move the attempt's server deadline `ago` into the past (controlled clock)."""
    past = timezone.now() - ago
    row = MockAttempt.objects.get(id=attempt_id)
    sections = {k: past.isoformat().replace('+00:00', 'Z') for k in (row.section_deadlines or {})}
    MockAttempt.objects.filter(id=attempt_id).update(deadline_at=past, overall_deadline_at=past, section_deadlines=sections or None)


def start(student, exam_id, assignment_id):
    response = api(student).post(f'/v1/mock/exams/{exam_id}/start',
                                 {'mode': 'timed', 'skills': ['reading'], 'assignmentId': assignment_id}, format='json')
    if response.status_code != 201:
        raise AssertionError(f'start HTTP {response.status_code}: {response.data}')
    return response.data['data']['attemptId']


def answer(student, attempt_id, qid, value, status=201):
    response = api(student).post(f'/v1/mock/attempts/{attempt_id}/answers', {'answers': [{'questionId': qid, 'response': value}]}, format='json')
    if response.status_code != status:
        raise AssertionError(f'answer HTTP {response.status_code}: {response.data}')
    return response


try:
    teacher = fx.user('teacher', 'Teacher A')
    other_teacher = fx.user('teacher', 'Teacher B')
    gid = fx.group(teacher, 'Synthetic IELTS Advanced')
    a, b, c = (fx.student(gid, f'Student 0{i}') for i in (1, 2, 3))
    exam_id, q = fx.reading_exam()

    t = api(teacher)
    close = timezone.now() + timedelta(minutes=30)
    bad = t.post(f'/v1/groups/{gid}/assignments', {'title': 'Mock', 'exam_id': exam_id, 'deadline': close.isoformat(),
                                                   'timing_policy': 'whenever'}, format='json')
    check(bad.status_code == 400, 'an unknown timing policy is refused')
    bad = t.post(f'/v1/groups/{gid}/assignments', {'title': 'Mock', 'exam_id': exam_id, 'deadline': close.isoformat(),
                                                   'timing_policy': 'fixed_close', 'opens_at': (close + timedelta(minutes=1)).isoformat()}, format='json')
    check(bad.status_code == 400, 'an opening time after the closing time is refused')
    bad = t.post(f'/v1/groups/{gid}/assignments', {'title': 'Mock', 'exam_id': exam_id,
                                                   'deadline': (timezone.now() - timedelta(minutes=1)).isoformat(),
                                                   'timing_policy': 'fixed_close'}, format='json')
    check(bad.status_code == 400, 'a fixed closing time in the past is refused')
    created = t.post(f'/v1/groups/{gid}/assignments', {'title': 'Synthetic Mock 07', 'exam_id': exam_id, 'deadline': close.isoformat(),
                                                       'timing_policy': 'fixed_close'}, format='json')
    check(created.status_code == 201 and created.data['data']['timing_policy'] == 'fixed_close', 'teacher creates a fixed-close exam assignment')
    assignment_id = created.data['data']['id']
    assignment = HomeworkAssignment.objects.get(id=assignment_id)
    check(sorted(assignment.participant_ids) == sorted([a.id, b.id, c.id]), 'the eligible participant snapshot holds the three students')
    foreign = api(other_teacher).post(f'/v1/groups/{gid}/assignments', {'title': 'x', 'exam_id': exam_id, 'deadline': close.isoformat()}, format='json')
    check(foreign.status_code in (403, 404), 'an unrelated teacher cannot assign to the group')

    # Student A finishes manually.
    att_a = start(a, exam_id, assignment_id)
    row = MockAttempt.objects.get(id=att_a)
    check(abs((aware(row.overall_deadline_at) - close).total_seconds()) < 1, 'a 60-minute exam is capped at the common 30-minute closing time')
    for qid, value in zip(q, ('blue', 'green', 'wrong', 'black')):
        answer(a, att_a, qid, value)
    done = api(a).post(f'/v1/mock/attempts/{att_a}/submit', {'confirm': True, 'confirmed': True}, format='json')
    check(done.status_code in (200, 201) and done.data['data']['status'] == 'completed', 'student A submits manually')

    # Student B answers two questions, then closes the browser.
    att_b = start(b, exam_id, assignment_id)
    answer(b, att_b, q[0], 'blue')
    answer(b, att_b, q[1], 'yellow')
    expire(att_b, timedelta(seconds=30))
    late = answer(b, att_b, q[2], 'red', status=400)
    check(late.data['error']['code'] == 'MOCK_TIME_UP', 'an answer after the deadline is rejected (MOCK_TIME_UP)')
    check(mock_deadline.sweep() == 0 and MockAttempt.objects.get(id=att_b).status == 'in_progress',
          'inside the grace window (upload recovery / racing Finish) the worker waits')
    expire(att_b, timedelta(minutes=10))

    # Race: the student's late Finish and two workers at once.
    results, errors = [], []

    def worker():
        try:
            results.append(('sweep', mock_deadline.sweep()))
        except Exception as error:  # noqa: BLE001
            errors.append(error)
        finally:
            close_old_connections()

    def manual():
        try:
            results.append(('manual', mock_submissions.submit(b, att_b)['status']))
        except Exception as error:  # noqa: BLE001
            errors.append(error)
        finally:
            close_old_connections()

    threads = [threading.Thread(target=worker), threading.Thread(target=worker), threading.Thread(target=manual)]
    [th.start() for th in threads]
    [th.join() for th in threads]
    check(not errors, f'concurrent workers and a manual Finish raise nothing ({errors})')
    row = MockAttempt.objects.get(id=att_b)
    check(row.status == 'completed' and row.submitted_at is not None, 'student B is handed in after the deadline without the browser')
    check(MockAttempt.objects.filter(student_id=b.id, exam_id=exam_id).count() == 1, 'exactly one attempt exists for student B')
    sweeps = sum(v for k, v in results if k == 'sweep')
    check(sweeps <= 1, f'at most one worker hands the attempt in ({sweeps})')
    stored = {x.question_id: x for x in MockAnswer.objects.filter(attempt_id=att_b)}
    check(stored[q[0]].response == 'blue' and stored[q[1]].response == 'yellow' and stored[q[2]].response == '',
          'confirmed answers are kept; the rejected late answer was never stored')
    check(row.raw_scores['reading']['score'] == 1 and row.raw_scores['reading']['max'] == 4, 'the objective score is computed (1/4)')
    kind = 'auto' if '__auto_submitted' in (row.media_state or {}) else 'manual'
    check((sweeps == 1) == (kind == 'auto'), f'the winner of the race is recorded truthfully ({kind})')
    check(mock_deadline.sweep() == 0, 'a duplicate sweep does nothing')
    a_row = MockAttempt.objects.get(id=att_a)
    check('__auto_submitted' not in (a_row.media_state or {}), 'the manual hand-in stays manual')

    handoff.wait(att_a)
    handoff.wait(att_b)
    subs = {s.student_id: s for s in HomeworkSubmission.objects.filter(assignment_id=assignment_id)}
    check(subs[a.id].status == 'graded' and subs[a.id].score_percent == 75, 'student A homework result syncs (75%)')
    check(subs[b.id].status == 'graded' and subs[b.id].score_percent == 25, 'student B homework result syncs from the auto hand-in (25%)')
    check(c.id not in subs and not MockAttempt.objects.filter(student_id=c.id).exists(), 'student C never started: no attempt and no fabricated score')

    # Catch-up after downtime: expired three days ago (outside the old 48-hour window).
    exam2, q2 = fx.reading_exam()
    second = t.post(f'/v1/groups/{gid}/assignments', {'title': 'Old exam', 'exam_id': exam2,
                                                      'deadline': (timezone.now() + timedelta(hours=1)).isoformat()}, format='json')
    att_old = start(a, exam2, second.data['data']['id'])
    answer(a, att_old, q2[0], 'blue')
    expire(att_old, timedelta(days=3))
    HomeworkAssignment.objects.filter(id=second.data['data']['id']).update(deadline=timezone.now() - timedelta(days=3))
    from io import StringIO
    from django.core.management import call_command
    out = StringIO()
    call_command('finalize_expired_attempts', stdout=out)
    check(MockAttempt.objects.get(id=att_old).status == 'completed' and 'auto-submitted=' in out.getvalue(),
          'a deadline missed during three days of downtime is finalized by the catch-up command')
    from apps.core.models import TelegramOutbox
    check(TelegramOutbox.objects.filter(recipient_id=a.id, dedupe_key=f'auto_submit:{att_old}').count() == 1,
          'the student privately receives one auto-submit notice')
    detail = api(a).get(f'/v1/mock/attempts/{att_old}')
    check(detail.status_code == 200 and detail.data['data'].get('submissionKind') == 'auto'
          and MockAttempt.objects.get(id=att_old).media_state['__auto_submitted']['reason'] == 'deadline',
          'the attempt API reports submissionKind=auto with reason deadline')
    with django.db.connection.cursor() as cursor:
        cursor.execute('SELECT count(*) FROM "AuditLog" WHERE "action"=%s AND "entityId"=%s', ['mock.attempt.auto_submit', att_old])
        check(cursor.fetchone()[0] == 1, 'one audit record marks the automatic hand-in')

    # Production worker entrypoint (python manage.py run_assessment_worker --once).
    exam3, q3 = fx.reading_exam()
    third = t.post(f'/v1/groups/{gid}/assignments', {'title': 'Worker exam', 'exam_id': exam3,
                                                     'deadline': (timezone.now() + timedelta(hours=1)).isoformat()}, format='json')
    att_w = start(c, exam3, third.data['data']['id'])
    expire(att_w, timedelta(minutes=20))
    call_command('run_assessment_worker', '--once')
    check(MockAttempt.objects.get(id=att_w).status == 'completed', 'the production assessment worker entrypoint closes expired exams')
    handoff.wait(att_w)
    sub_c = HomeworkSubmission.objects.get(assignment_id=third.data['data']['id'], student_id=c.id)
    check(sub_c.status == 'graded' and sub_c.score_percent == 0, 'an empty auto hand-in is a real 0% (not missing), because the student started')

    # Grace: objective-only attempts close after 60 s; Speaking keeps the 6-minute upload recovery window.
    from apps.legacy_schema.models import MockSection
    exam5, _ = fx.reading_exam()
    exam6, _ = fx.reading_exam()
    MockSection.objects.create(id=str(__import__('uuid').uuid4()), exam_id=exam6, skill='speaking', title='Speaking', sort_order=1, duration_minutes=14)
    fifth = t.post(f'/v1/groups/{gid}/assignments', {'title': 'Objective', 'exam_id': exam5, 'deadline': (timezone.now() + timedelta(hours=1)).isoformat()}, format='json')
    sixth = t.post(f'/v1/groups/{gid}/assignments', {'title': 'Speaking', 'exam_id': exam6, 'deadline': (timezone.now() + timedelta(hours=1)).isoformat()}, format='json')
    att_o = start(a, exam5, fifth.data['data']['id'])
    att_s = start(b, exam6, sixth.data['data']['id'])
    from apps.core.mock_practice import SCOPE_KEY
    row_s = MockAttempt.objects.get(id=att_s)
    state = dict(row_s.media_state)
    state[SCOPE_KEY] = dict(state[SCOPE_KEY], skills=['reading', 'speaking'])
    MockAttempt.objects.filter(id=att_s).update(media_state=state)   # Speaking in this attempt's scope
    expire(att_o, timedelta(minutes=2))
    expire(att_s, timedelta(minutes=2))
    mock_deadline.sweep()
    check(MockAttempt.objects.get(id=att_o).status != 'in_progress', 'an objective-only attempt is handed in 60 s after its deadline')
    check(MockAttempt.objects.get(id=att_s).status == 'in_progress', 'an attempt with Speaking keeps the 6-minute upload recovery grace')
    expire(att_s, timedelta(minutes=7))
    mock_deadline.sweep()
    check(MockAttempt.objects.get(id=att_s).status != 'in_progress', 'the Speaking attempt is handed in after its grace')

    # Untimed legacy attempt linked to a closed assignment does not stay open forever.
    exam4, _ = fx.reading_exam()
    fourth = t.post(f'/v1/groups/{gid}/assignments', {'title': 'Legacy', 'exam_id': exam4,
                                                      'deadline': (timezone.now() + timedelta(hours=1)).isoformat()}, format='json')
    att_l = start(b, exam4, fourth.data['data']['id'])
    MockAttempt.objects.filter(id=att_l).update(deadline_at=None, overall_deadline_at=None, section_deadlines=None)
    HomeworkAssignment.objects.filter(id=fourth.data['data']['id']).update(deadline=timezone.now() - timedelta(hours=1))
    check(mock_deadline.sweep() == 0, 'an attempt without its own timer is kept open until the assignment cap')
    HomeworkAssignment.objects.filter(id=fourth.data['data']['id']).update(deadline=timezone.now() - timedelta(hours=4))
    check(mock_deadline.sweep() == 1 and MockAttempt.objects.get(id=att_l).status == 'completed',
          'an untimed assigned attempt closes three hours after the assignment closed')
    check(MockAttempt.objects.get(id=att_l).media_state['__auto_submitted']['reason'] == 'assignment_closed', 'its reason is assignment_closed')
    check((MockAttempt.objects.get(id=att_l).media_state or {}).get(ASSIGNMENT_KEY) == fourth.data['data']['id'], 'assignment provenance is preserved')
finally:
    fx.cleanup()
print(f'BESTWAY 5.1 exam deadline: {len(checks)}/{len(checks)} PASS')
