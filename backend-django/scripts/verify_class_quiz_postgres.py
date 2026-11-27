"""Loopback-only verification of the classroom quiz engine on the real PostgreSQL schema.

Ownership and role boundaries (teacher A/B, students, parent, outsider, admin), immutable snapshots, idempotent
start/answer/finish, concurrent starts, server-owned deadlines, exact scoring, privacy of answer keys, no IELTS band.
Every fixture row is removed.
"""
import json
import os
import sys
import threading
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

from apps.core.models import ClassroomEnrollment
from apps.core import class_quiz as cq
from apps.core.models import ClassQuiz, ClassQuizAttempt
from apps.legacy_schema.models import Group, User
from common.api.exceptions import ContractAPIException

run = uuid4().hex[:8]
checks, users, groups_made = [], [], []


def check(value, message):
    if not value:
        raise AssertionError('FAIL ' + message)
    checks.append(message)
    print('PASS ' + message)


def code(fn, *args, **kwargs):
    try:
        fn(*args, **kwargs)
        return 'ok'
    except ContractAPIException as error:
        return error.contract_code


def mk_user(role, name=None):
    now = timezone.now()
    uid = f'cq-{role}-{uuid4().hex[:6]}-{run}'
    User.objects.create(id=uid, name=name or f'cq {role}', phone='+99874' + uuid4().hex[:7], role=role, password_hash='x',
                        is_active=True, created_at=now, updated_at=now)
    users.append(uid)
    return SimpleNamespace(id=uid, role=role, is_authenticated=True)


def mk_group(teacher):
    gid = f'cq-group-{uuid4().hex[:6]}-{run}'
    Group.objects.create(id=gid, name='cq group', teacher_id=teacher.id, created_at=timezone.now())
    groups_made.append(gid)
    return gid


def mk_student(group_id, name=None):
    student = mk_user('student', name)
    with connection.cursor() as cursor:
        cursor.execute('INSERT INTO "StudentProfile" ("userId","availablePrograms","activeProgram","isApproved","groupId","currentPoints","linkCode","createdAt","pointsPeriod","gameQualified","qualifiedAt") '
                       "VALUES (%s, ARRAY['IELTS']::\"ExamProgram\"[], 'IELTS', true, %s, 0, %s, NOW(), NULL, false, NULL)",
                       [student.id, group_id, 'CQ' + uuid4().hex[:8].upper()])
    if group_id is not None:
        ClassroomEnrollment.objects.create(group_id=group_id, student_id=student.id, started_at=timezone.now())
    return student


def questions(n=40):
    out = []
    for i in range(1, n + 1):
        if i % 3 == 1:
            out.append(dict(type='mcq', prompt=f'Question {i}: choose the passive form.', options=['is done', 'does', 'did', 'doing'], correctAnswers=[0], explanation='Passive uses be + V3.'))
        elif i % 3 == 2:
            out.append(dict(type='tf', prompt=f'Question {i}: "The book was written by her." is passive.', correctAnswers=['True'], explanation='be + past participle'))
        else:
            out.append(dict(type='text', prompt=f'Question {i}: Complete: The window was ___ (break).', correctAnswers=['broken'], acceptedVariants=['Broken!']))
    return out


def student_text(payload):
    return json.dumps(payload, default=str)


def answers_for(attempt_payload, snapshot_questions, wrong=()):
    """Correct answers for every question except the numbers in `wrong` (1-based position)."""
    out = {}
    for pos, q in enumerate(snapshot_questions, 1):
        if q['type'] == 'text':
            out[q['id']] = 'zzz' if pos in wrong else 'Broken'
        elif q['type'] == 'tf':
            out[q['id']] = (1 if pos in wrong else 0)
        else:
            out[q['id']] = (3 if pos in wrong else 0)
    return out


try:
    now = timezone.now()
    teacher_a, teacher_b, admin = mk_user('teacher'), mk_user('teacher'), mk_user('admin')
    ga, gb = mk_group(teacher_a), mk_group(teacher_b)
    s1, s2 = mk_student(ga, '=cmd|calc'), mk_student(ga, 'Aziza')  # a hostile name for the CSV check
    sb = mk_student(gb)
    outsider = mk_user('student')
    parent, other_parent = mk_user('parent'), mk_user('parent')
    with connection.cursor() as cursor:
        cursor.execute('INSERT INTO "ParentStudent" ("parentUserId","studentId","createdAt") VALUES (%s,%s,NOW())', [parent.id, s1.id])

    # -------------------------------------------------------------- authoring and ownership
    created = cq.create_quiz(teacher_a, dict(title='Passive Voice Practice', category='grammar', timeLimitMinutes=30, maxAttempts=1))
    qid = created['id']
    cq.replace_questions(teacher_a, qid, questions(40))
    full = cq.get_quiz(teacher_a, qid)
    check(full['questionCount'] == 40 and {q['type'] for q in full['questions']} == {'mcq', 'tf', 'text'}, 'a teacher authors a 40-question quiz with multiple-choice, true/false and text items')
    check([q['id'] for q in cq.list_quizzes(teacher_a)] == [qid] and cq.list_quizzes(teacher_b) == [], 'teachers list only their own quizzes')
    check(code(cq.get_quiz, teacher_b, qid) == 'QUIZ_NOT_FOUND', "Teacher B cannot open Teacher A's quiz (404, existence not disclosed)")
    check(code(cq.update_quiz, teacher_b, qid, dict(title='hijack')) == 'QUIZ_NOT_FOUND', "Teacher B cannot edit Teacher A's quiz")
    check(code(cq.replace_questions, teacher_b, qid, questions(5)) == 'QUIZ_NOT_FOUND', "Teacher B cannot replace Teacher A's questions")
    check(cq.get_quiz(admin, qid)['id'] == qid, 'an administrator can open any quiz')
    check(code(cq.create_quiz, s1, dict(title='Student quiz')) == 'FORBIDDEN', 'a student cannot create quizzes')
    check(code(cq.replace_questions, teacher_a, qid, [dict(type='mcq', prompt='x', options=['a', 'A'], correctAnswers=[0])]) == 'VALIDATION_ERROR', 'duplicate options are rejected')
    check(code(cq.replace_questions, teacher_a, qid, [dict(type='text', prompt='x', correctAnswers=[])]) == 'VALIDATION_ERROR', 'a text question without accepted answers is rejected')
    check(code(cq.replace_questions, teacher_a, qid, [dict(type='mcq', prompt='x', options=['a', 'b'], correctAnswers=[5])]) == 'VALIDATION_ERROR', 'a correct answer outside the options is rejected')
    check(cq.get_quiz(teacher_a, qid)['questionCount'] == 40, 'a rejected edit leaves the draft untouched')

    imp = cq.create_quiz(teacher_a, dict(title='Imported vocabulary', category='vocabulary'))
    done = cq.import_questions(teacher_a, imp['id'], "1. She ___ a book.\nA) reads\nB) read\n2. The sky is blue.\n3. Opposite of hot ____", "1 A\n2 true\n3 cold / cool")
    kinds = [q['type'] for q in done['questions']]
    check(kinds == ['mcq', 'tf', 'text'] and done['questions'][2]['correctAnswers'] == ['cold', 'cool'], f'the existing paste parser + an answer key import mixed questions {kinds}')
    check(code(cq.import_questions, teacher_a, imp['id'], '1. Only question', '') == 'MISSING_ANSWER', 'an import without a key for a question is refused')

    preview = cq.preview(teacher_a, qid)
    check('correctAnswers' not in json.dumps(preview['student_view'], default=str) and preview['student_view']['questionCount'] == 40, 'preview shows the student view without any answer key')

    # -------------------------------------------------------------- publishing and assigning
    check(code(cq.assign_quiz, teacher_a, qid, [ga], now + timedelta(days=2)) == 'QUIZ_NOT_PUBLISHED', 'an unpublished quiz cannot be assigned')
    cq.publish_quiz(teacher_a, qid)
    check(code(cq.assign_quiz, teacher_a, qid, [gb], now + timedelta(days=2)) == 'FORBIDDEN', "a teacher cannot assign to another teacher's group")
    check(code(cq.assign_quiz, teacher_a, qid, [ga], now - timedelta(hours=1)) == 'VALIDATION_ERROR', 'a past deadline is refused')
    check(code(cq.assign_quiz, teacher_b, qid, [gb], now + timedelta(days=2)) == 'QUIZ_NOT_FOUND', "Teacher B cannot assign Teacher A's quiz even to their own group")
    assigned = cq.assign_quiz(teacher_a, qid, [ga], now + timedelta(days=2))[0]
    aid = assigned['id']
    from apps.core.models import ClassQuizAssignment
    snapshot_before = ClassQuizAssignment.objects.get(id=aid).snapshot_hash
    check(assigned['questionCount'] == 40 and assigned['timeLimitMinutes'] == 30, 'assignment carries 40 questions and the 30-minute limit')

    # editing the quiz afterwards must not rewrite the issued snapshot
    edited = questions(40)
    edited[0]['prompt'] = 'EDITED AFTER ISSUE'
    edited[0]['correctAnswers'] = [1]
    cq.replace_questions(teacher_a, qid, edited)
    row = ClassQuizAssignment.objects.get(id=aid)
    check(row.snapshot_hash == snapshot_before and 'EDITED AFTER ISSUE' not in json.dumps(row.snapshot, default=str) and cq.get_quiz(teacher_a, qid)['revision'] > 1,
          'editing the quiz later does not change the issued snapshot (immutable)')

    # -------------------------------------------------------------- student boundaries
    check(code(cq.start_attempt, outsider, aid) == 'QUIZ_NOT_FOUND', 'a student outside the group cannot start it (404)')
    check(code(cq.start_attempt, sb, aid) == 'QUIZ_NOT_FOUND', "a student of another teacher's group cannot start it (404)")
    check(code(cq.start_attempt, teacher_a, aid) == 'FORBIDDEN' and code(cq.start_attempt, parent, aid) == 'FORBIDDEN', 'teachers and parents cannot take the quiz')
    check(cq.my_assignments(outsider) == [] and [a['id'] for a in cq.my_assignments(s1)] == [aid], 'My Tests lists the assignment only for group members')

    # -------------------------------------------------------------- start: idempotent, no keys, server clock
    started = cq.start_attempt(s1, aid)
    text = student_text(started)
    check(not any(k in text for k in ('correctAnswers', 'acceptedVariants', 'explanation')) and started['questionCount'] == 40,
          'the attempt payload exposes no answer keys or explanations')
    again = cq.start_attempt(s1, aid)
    check(again['attemptId'] == started['attemptId'] and again['resumed'], 'starting twice returns the same attempt (idempotent, recovery)')
    attempt = ClassQuizAttempt.objects.get(id=started['attemptId'])
    check(abs((attempt.deadline_at - attempt.started_at).total_seconds() - 1800) < 2, 'the deadline is the server start time + 30 minutes')

    # concurrency: one student, many simultaneous starts on another assignment
    second = cq.assign_quiz(teacher_a, qid, [ga], now + timedelta(days=3), max_attempts=2)[0]['id']
    results = []
    barrier = threading.Barrier(8)

    def go():
        django.db.close_old_connections()
        barrier.wait()
        try:
            results.append(cq.start_attempt(s2, second)['attemptId'])
        except Exception as error:
            results.append(repr(error))
        finally:
            connection.close()
    ts = [threading.Thread(target=go) for _ in range(8)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    check(len(set(results)) == 1 and ClassQuizAttempt.objects.filter(assignment_id=second, student_id=s2.id).count() == 1,
          f'8 simultaneous starts create exactly one attempt ({len(set(results))} distinct)')

    # -------------------------------------------------------------- answers: idempotent, validated, isolated
    snap = ClassQuizAssignment.objects.get(id=aid).snapshot['questions']
    ordered = [q for qid_ in started['questions'] for q in snap if q['id'] == qid_['id']]
    first_q = snap[0]
    cq.save_answer(s1, started['attemptId'], first_q['id'], 0)
    r1 = cq.save_answer(s1, started['attemptId'], first_q['id'], 0)
    check(r1['answered'] == 1, 'saving the same answer twice (duplicate callback) stores one answer')
    cq.save_answer(s1, started['attemptId'], first_q['id'], 2)
    check(cq.get_attempt(s1, started['attemptId'])['savedAnswers'][first_q['id']] == '2', 'the last answer wins before the deadline')
    check(code(cq.save_answer, s1, started['attemptId'], first_q['id'], 9) == 'VALIDATION_ERROR', 'an out-of-range option is rejected')
    check(code(cq.save_answer, s1, started['attemptId'], 'nope', 0) == 'QUESTION_NOT_FOUND', 'an unknown question id is rejected')
    check(code(cq.save_answer, s2, started['attemptId'], first_q['id'], 0) == 'ATTEMPT_NOT_FOUND', "Student B cannot write into Student A's attempt")
    check(code(cq.get_attempt, s2, started['attemptId']) == 'ATTEMPT_NOT_FOUND' and code(cq.finish_attempt, s2, started['attemptId']) == 'ATTEMPT_NOT_FOUND', "Student B cannot read or finish Student A's attempt")
    check(code(cq.my_result, s1, started['attemptId']) == 'RESULT_NOT_READY', 'the result (and keys) stay closed until the attempt is submitted')

    # restart / recovery: answers are in PostgreSQL, the next question is derived, nothing lives in process memory
    for q in snap[:20]:
        cq.save_answer(s1, started['attemptId'], q['id'], '0' if q['type'] != 'text' else 'Broken')
    recovered = cq.start_attempt(s1, aid)
    check(recovered['resumed'] and len(recovered['savedAnswers']) == 20 and recovered['nextIndex'] is not None, 'after an interruption the same attempt resumes with the saved answers and the next question')

    # -------------------------------------------------------------- exact scoring (31/40 -> 77.5%), repeat-safe finish
    wrong_positions = set(range(32, 41)) | {0}
    final = answers_for(started, snap, wrong=wrong_positions)
    for q in snap:
        if q['id'] in final:
            cq.save_answer(s1, started['attemptId'], q['id'], final[q['id']])
    result = cq.finish_attempt(s1, started['attemptId'])
    check(result['correct'] == 31 and result['total'] == 40 and result['percent'] == 77.5, f'exact server-side scoring: {result["correct"]}/{result["total"]} = {result["percent"]}%')
    check(cq.finish_attempt(s1, started['attemptId'])['percent'] == 77.5 and ClassQuizAttempt.objects.filter(assignment_id=aid, student_id=s1.id).count() == 1,
          'a repeated Finish returns the same stored result (idempotent)')
    check(result['isIeltsBand'] is False and 'band' not in json.dumps(result, default=str).lower().replace('isieltsband', ''), 'a classroom quiz result is a percentage, never an IELTS band')
    review = cq.my_result(s1, started['attemptId'])
    check(len(review['incorrect']) == 9 and all(r['correctAnswer'] for r in review['incorrect']), 'after submission the student sees the 9 incorrect answers with the correct ones')
    check(code(cq.save_answer, s1, started['attemptId'], first_q['id'], 0) == 'ATTEMPT_FINISHED', 'no answers are accepted after submission')
    check(code(cq.start_attempt, s1, aid) == 'NO_ATTEMPTS_LEFT', 'a second attempt is refused when the maximum is 1')

    # -------------------------------------------------------------- answer keys are not handed over while a retake remains
    first_try = cq.finish_attempt(s2, results[0])
    hidden = cq.my_result(s2, results[0])
    check(first_try['keysVisible'] is False and hidden['keysVisible'] is False and hidden['incorrect']
          and all(r['correctAnswer'] is None and r['explanation'] == '' for r in hidden['review']),
          'with attempts left (1 of 2 used) the review shows right/wrong but no correct answers or explanations')
    staff_view = cq.attempt_for_staff(teacher_a, results[0])
    check(staff_view['keysVisible'] is True and all(r['correctAnswer'] for r in staff_view['review']), 'the teacher still sees the correct answers')
    retake = cq.start_attempt(s2, second)
    check(retake['attemptNo'] == 2 and 'correctAnswers' not in json.dumps(retake, default=str), 'the retake starts without any key')
    last_try = cq.finish_attempt(s2, retake['attemptId'])
    check(last_try['keysVisible'] is True and all(r['correctAnswer'] for r in cq.my_result(s2, results[0])['review']),
          'after the last attempt the correct answers are revealed for every attempt')

    # -------------------------------------------------------------- deadlines are server-owned
    third = cq.assign_quiz(teacher_a, qid, [ga], now + timedelta(days=1))[0]['id']
    late = cq.start_attempt(s2, third)
    snap3 = ClassQuizAssignment.objects.get(id=third).snapshot['questions']  # question ids are per issued snapshot
    cq.save_answer(s2, late['attemptId'], snap3[0]['id'], 0)
    ClassQuizAttempt.objects.filter(id=late['attemptId']).update(deadline_at=timezone.now() - timedelta(seconds=5))
    check(code(cq.save_answer, s2, late['attemptId'], snap3[1]['id'], 0) == 'TIME_UP', 'an answer after the server deadline is rejected (TIME_UP)')
    auto = ClassQuizAttempt.objects.get(id=late['attemptId'])
    check(auto.status == 'submitted' and auto.auto_submitted and auto.correct_count is not None, 'the expired attempt was finalised automatically from the answers saved in time')
    check(len(auto.answers.all()) == 1, 'nothing submitted after the deadline was counted')
    closed = cq.assign_quiz(teacher_a, qid, [ga], now + timedelta(minutes=5))[0]['id']
    ClassQuizAssignment.objects.filter(id=closed).update(deadline=timezone.now() - timedelta(minutes=1))
    check(code(cq.start_attempt, s1, closed) == 'QUIZ_CLOSED', 'a quiz whose deadline passed cannot be started')

    # -------------------------------------------------------------- teacher results and exports
    overview = cq.assignment_overview(teacher_a, aid)
    states = {p['name']: p['state'] for p in overview['participants']}
    check(overview['total'] == 2 and overview['submitted'] == 1 and overview['completionPercent'] == 50.0 and len(overview['pending']) == 1,
          f'the teacher sees participants, 50% completion and the pending student {states}')
    check(code(cq.assignment_overview, teacher_b, aid) == 'QUIZ_NOT_FOUND', "Teacher B cannot see Teacher A's group results")
    check(code(cq.assignment_overview, s1, aid) == 'FORBIDDEN', 'a student cannot open the teacher overview')
    csv_text = cq.export_csv(teacher_a, aid)
    check("'=cmd|calc" in csv_text and '\n=cmd' not in csv_text, 'the CSV export neutralises spreadsheet-formula student names')
    check(cq.attempt_for_staff(teacher_a, started['attemptId'])['correct'] == 31 and code(cq.attempt_for_staff, teacher_b, started['attemptId']) == 'QUIZ_NOT_FOUND', 'a teacher reviews only their own group\'s attempts')

    # -------------------------------------------------------------- parents
    summary = cq.parent_results(parent, s1.id)
    check(summary and summary[0]['percent'] == 77.5 and 'review' not in json.dumps(summary, default=str) and 'correctAnswer' not in json.dumps(summary, default=str),
          'a parent sees a linked child\'s percentage summary only (no answers, no keys)')
    check(code(cq.parent_results, other_parent, s1.id) == 'FORBIDDEN' and code(cq.parent_results, teacher_a, s1.id) == 'FORBIDDEN', 'an unlinked parent (or any other role) is refused')

    # -------------------------------------------------------------- HTTP surface
    http = APIClient()
    http.force_authenticate(teacher_a)
    r = http.post('/v1/class-quizzes', dict(title='HTTP quiz', category='mixed'), format='json')
    check(r.status_code == 201 and r.json()['data']['status'] == 'draft', 'HTTP: a teacher creates a quiz')
    hs = APIClient()
    hs.force_authenticate(s2)
    check(hs.post('/v1/class-quizzes', dict(title='nope'), format='json').status_code == 403, 'HTTP: a student cannot create quizzes (403)')
    check(APIClient().get('/v1/class-quiz-assignments/mine').status_code in (401, 403), 'HTTP: anonymous users are refused')
    resp = http.get(f'/v1/class-quiz-assignments/{aid}/export')
    check(resp.status_code == 200 and resp['Content-Type'].startswith('text/csv'), 'HTTP: the CSV export is served to the owning teacher')
    print(f'\nALL {len(checks)} CHECKS PASSED')
finally:
    with connection.cursor() as cursor:
        cursor.execute('DELETE FROM "TelegramOutbox" WHERE recipient_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM "ClassQuizAnswer" WHERE attempt_id IN (SELECT id FROM "ClassQuizAttempt" WHERE student_id = ANY(%s))', [users])
        cursor.execute('DELETE FROM "ClassQuizAttempt" WHERE student_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM "ClassQuizAssignment" WHERE group_id = ANY(%s)', [groups_made])
        cursor.execute('DELETE FROM "ClassQuizQuestion" WHERE quiz_id IN (SELECT id FROM "ClassQuiz" WHERE owner_id = ANY(%s))', [users])
        cursor.execute('DELETE FROM "ClassQuiz" WHERE owner_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM "ParentStudent" WHERE "parentUserId" = ANY(%s)', [users])
        ClassroomEnrollment.objects.filter(student_id__in=users).delete()
        cursor.execute('DELETE FROM "StudentProfile" WHERE "userId" = ANY(%s)', [users])
        cursor.execute('DELETE FROM "Group" WHERE id = ANY(%s)', [groups_made])
        cursor.execute('DELETE FROM "User" WHERE id = ANY(%s)', [users])
