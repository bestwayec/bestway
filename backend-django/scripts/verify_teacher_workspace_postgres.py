"""Loopback-only verification of Teacher Workspace 2.0 on the real PostgreSQL schema.

Synthetic data: teacher A with 3 groups x 20 students, teacher B with one group, an outsider student, published and
DRAFT exams, a vocabulary set. Covers the dashboard overview, the one-screen attendance sheet (nothing pre-filled,
conflict detection, roster/duplicate/role checks, transactional save), three-step homework creation for every type
(idempotent under repeated and parallel clicks, DRAFT exams refused, no keys in previews), the student "My homework"
list and quiz runner over HTTP, live teacher results (pending vs graded zero, removed students keep their results)
and Telegram notices queued in the outbox only (nothing is sent). Every fixture row is removed.
"""
import datetime as _dt
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
os.environ.pop('TELEGRAM_BOT_TOKEN', None)          # nothing can reach Telegram from this script
import django

django.setup()
from django.db import connection
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core import teacher_workspace as tw
from apps.core.models import (ClassQuiz, ClassQuizAssignment, ClassQuizAttempt, Cohort, HomeworkAssignment, HomeworkSubmission,
                              TelegramOutbox, TelegramPreference, VocabularySet, VocabularyWord)
from apps.legacy_schema.models import Attendance, Group, MockExam, User
from common.api.exceptions import ContractAPIException

run = uuid4().hex[:8]
checks, users, groups_made, exams_made = [], [], [], []


def check(value, message):
    if not value:
        raise AssertionError('FAIL ' + message)
    checks.append(message)
    print('PASS ' + message)


def code(fn, *args, **kwargs):
    try:
        fn(*args, **kwargs)
    except ContractAPIException as error:
        return error.code
    return None


def mk_user(role, name=None, chat=None):
    now = timezone.now()
    uid = f'tw-{role}-{uuid4().hex[:6]}-{run}'
    User.objects.create(id=uid, name=name or f'tw {role}', phone='+99877' + uuid4().hex[:7], role=role, password_hash='x',
                        is_active=True, telegram_chat_id=chat, created_at=now, updated_at=now)
    users.append(uid)
    TelegramPreference.objects.update_or_create(user_id=uid, defaults=dict(quiet_start=_dt.time(0, 0), quiet_end=_dt.time(0, 0)))
    return SimpleNamespace(id=uid, role=role, is_authenticated=True, name=name or f'tw {role}')


def mk_group(teacher, name, schedule=None):
    gid = f'tw-group-{uuid4().hex[:6]}-{run}'
    Group.objects.create(id=gid, name=name, teacher_id=teacher.id, schedule=schedule, created_at=timezone.now())
    groups_made.append(gid)
    return gid


def mk_student(group_id, name, chat=None):
    student = mk_user('student', name, chat)
    with connection.cursor() as cursor:
        cursor.execute('INSERT INTO "StudentProfile" ("userId","availablePrograms","activeProgram","isApproved","groupId","currentPoints","linkCode","createdAt","pointsPeriod","gameQualified","qualifiedAt") '
                       "VALUES (%s, ARRAY['IELTS']::\"ExamProgram\"[], 'IELTS', true, %s, 0, %s, NOW(), NULL, false, NULL)",
                       [student.id, group_id, 'TW' + uuid4().hex[:8].upper()])
    return student


def client(actor):
    c = APIClient()
    c.force_authenticate(actor)
    return c


def mk_exam(title, published):
    now = timezone.now()
    eid = str(uuid4())
    MockExam.objects.create(id=eid, title=title, type='ielts_academic', profile='IELTS', content_version=1, is_published=published, price=0,
                            is_demo=False, is_free_for_approved=False, created_at=now, updated_at=now)
    exams_made.append(eid)
    return eid


QUESTIONS = '\n'.join(f'{i}. The letter was ___ yesterday.\nA) written\nB) write\nC) writes\nD) writing' for i in range(1, 21))
KEY = '\n'.join(f'{i} A' for i in range(1, 21))

try:
    today = timezone.localdate()
    weekday = tw.WEEKDAYS[today.weekday()]
    teacher, teacher_b, admin = mk_user('teacher', 'Ustoz Aziza'), mk_user('teacher', 'Ustoz Bekzod'), mk_user('admin', 'Admin')
    g1 = mk_group(teacher, 'B1 Kechki', [dict(day=weekday, startTime='18:00', endTime='19:30')])
    g2 = mk_group(teacher, 'A2 Ertalabki', [dict(day=weekday, startTime='09:00', endTime='10:30')])
    g3 = mk_group(teacher, 'IELTS 6.5', [dict(day=tw.WEEKDAYS[(today.weekday() + 1) % 7], startTime='15:00', endTime='16:30')])
    gb = mk_group(teacher_b, 'Boshqa ustoz guruhi')
    roster = {g: [mk_student(g, f'O\'quvchi {g[-4:]}-{i:02d}', chat=str(880000000 + len(users)) if i < 15 else None) for i in range(20)]
              for g in (g1, g2, g3)}
    outsider = mk_student(gb, 'Begona o\'quvchi', chat='889999999')
    s1, s2, s3 = roster[g1][0], roster[g1][1], roster[g1][2]
    T, TB, A, S1, S2, SO = client(teacher), client(teacher_b), client(admin), client(s1), client(s2), client(outsider)

    # ---------------------------------------------------------------- dashboard overview
    ov = T.get('/v1/teacher/workspace/overview').json()['data']
    check(len(ov['groups']) == 3 and ov['todayGroups'] == 2 and [g['name'] for g in ov['groups']][:2] == ['A2 Ertalabki', 'B1 Kechki'],
          "overview: the teacher's 3 groups, today's 2 scheduled groups first in lesson-time order")
    check(all(g['studentCount'] == 20 for g in ov['groups']) and gb not in [g['id'] for g in ov['groups']], "overview: 20 students per group, never Teacher B's group")
    check(ov['today'] == dict(present=0, late=0, absent=0) and ov['activeHomework'] == 0, 'overview: nothing is invented before any action')
    check(client(s1).get('/v1/teacher/workspace/overview').status_code == 403, 'overview: a student is refused (403)')

    # ---------------------------------------------------------------- attendance: one screen
    url = f'/v1/teacher/workspace/groups/{g1}/attendance'
    sheet = T.get(url).json()['data']
    check(len(sheet['students']) == 20 and all(s['state'] is None for s in sheet['students']) and sheet['marked'] == 0 and sheet['scheduled'],
          'attendance: opening the sheet lists all 20 students and marks NOBODY (no silent "all present")')
    check(not Attendance.objects.filter(group_id=g1).exists(), 'attendance: opening the sheet writes nothing')
    check(TB.get(url).status_code == 403 and S1.get(url).status_code == 403, "attendance: Teacher B and students cannot open Teacher A's sheet")
    records = [dict(studentId=s.id, state='present') for s in roster[g1]]
    records[1]['state'], records[2]['state'], records[3]['state'] = 'absent', 'absent', 'late'
    saved = T.put(url, dict(date=today.isoformat(), records=records, revision=sheet['revision']), format='json')
    body = saved.json()['data']
    check(saved.status_code == 200 and body['summary'] == dict(present=17, absent=2, late=1) and body['marked'] == 20,
          'attendance: one save stores 20 marks and returns the summary Present 17 / Absent 2 / Late 1')
    reloaded = T.get(url).json()['data']
    check({s['studentId']: s['state'] for s in reloaded['students']} == {r['studentId']: r['state'] for r in records},
          'attendance: reloading shows exactly the saved marks')
    stale = T.put(url, dict(date=today.isoformat(), records=[dict(studentId=s1.id, state='absent')], revision=sheet['revision']), format='json')
    check(stale.status_code == 409 and stale.json()['error']['code'] == 'ATTENDANCE_CHANGED' and Attendance.objects.get(group_id=g1, student_id=s1.id, date=today).state == 'present',
          'attendance: a save based on an outdated sheet is refused (409) and overwrites nothing')
    dup = T.put(url, dict(date=today.isoformat(), records=[dict(studentId=s1.id, state='late'), dict(studentId=s1.id, state='absent')]), format='json')
    check(dup.status_code == 400 and dup.json()['error']['code'] == 'DUPLICATE_STUDENT', 'attendance: the same student twice in one save is refused')
    foreign = T.put(url, dict(date=today.isoformat(), records=[dict(studentId=s1.id, state='late'), dict(studentId=outsider.id, state='present')],
                              revision=reloaded['revision']), format='json')
    check(foreign.status_code == 400 and Attendance.objects.get(group_id=g1, student_id=s1.id, date=today).state == 'present',
          'attendance: a student from another group rolls the whole save back (transactional, s1 unchanged)')
    check(T.put(url, dict(date='2026-02-31', records=records), format='json').status_code == 400, 'attendance: an invalid date is refused')
    future = (today + timedelta(days=5)).isoformat()
    check(T.put(url, dict(date=future, records=records), format='json').status_code == 400, 'attendance: a future date is refused')
    yesterday = (today - timedelta(days=1)).isoformat()
    check(T.put(url, dict(date=yesterday, records=[dict(studentId=s1.id, state='late')]), format='json').status_code == 200
          and T.get(url, {'date': yesterday}).json()['data']['counts'] == dict(present=0, absent=0, late=1),
          'attendance: a previous lesson can be opened and edited by the group teacher')
    history = T.get(url + '/history').json()['data']
    check(history[0]['date'] == today.isoformat() and history[0]['present'] == 17 and len(history) == 2, 'attendance: history lists saved days with counts')
    check(TB.put(url, dict(date=today.isoformat(), records=records), format='json').status_code == 403, "attendance: Teacher B cannot write Teacher A's attendance")
    check(TelegramOutbox.objects.filter(recipient_id=s2.id, kind='attendance').count() == 1, 'attendance: the absent student gets ONE queued notice (outbox, not sent)')
    check(T.get('/v1/teacher/workspace/overview').json()['data']['today'] == dict(present=17, late=1, absent=2), "overview: today's attendance counts follow the saved sheet")

    # ---------------------------------------------------------------- homework: options + preview
    published_exam = mk_exam(f'Practice Mock {run}', True)
    draft_exam = mk_exam(f'BESTWAY IELTS Academic Full Mock 27 draft {run}', False)
    vset = VocabularySet.objects.create(title='Unit 7 Travel', created_by_id=teacher.id, group_id=g1, is_public=True)
    for i in range(10):
        VocabularyWord.objects.create(set=vset, english=f'journey{i}', uzbek=f'safar{i}')
    hw_url = f'/v1/teacher/workspace/groups/{g1}/homework'
    options = T.get(hw_url + '/options').json()['data']
    check(options['group']['studentCount'] == 20 and vset.id in [s['id'] for s in options['vocabularySets']], 'step A/B: options show the group size and its vocabulary set')
    exam_ids = [e['id'] for e in options['exams']]
    check(published_exam in exam_ids and draft_exam not in exam_ids, 'step B: only published exams are offered (the DRAFT exam is not)')
    deadline = (timezone.now() + timedelta(days=2)).replace(microsecond=0).isoformat()
    quiz_body = dict(type='quiz', title='Passive Voice — 20 savol', deadline=deadline, timeLimitMinutes=30, maxAttempts=1,
                     newQuiz=dict(questionsText=QUESTIONS, answerKey=KEY, category='grammar'))
    preview = T.post(hw_url + '/preview', quiz_body, format='json')
    pv = preview.json()['data']
    check(preview.status_code == 200 and pv['questionCount'] == 20 and pv['studentCount'] == 20 and 'answerKey' not in json.dumps(pv)
          and not ClassQuiz.objects.filter(owner_id=teacher.id).exists(), 'step C: the preview shows 20 questions / 20 students, no key, and writes nothing')
    bad_key = dict(quiz_body, newQuiz=dict(questionsText=QUESTIONS, answerKey='1 A', category='grammar'))
    check(T.post(hw_url + '/preview', bad_key, format='json').json()['error']['code'] == 'MISSING_ANSWER', 'step C: questions without an answer key are reported before assigning')
    check(T.post(hw_url, dict(type='exam', title='Draft', examId=draft_exam, deadline=deadline), format='json').status_code == 404,
          'security: a DRAFT exam cannot be assigned to students')
    past = (timezone.now() - timedelta(hours=1)).isoformat()
    check(T.post(hw_url, dict(quiz_body, deadline=past), format='json').json()['error']['code'] == 'DEADLINE_IN_PAST', 'step C: an expired deadline is refused')
    check(TB.post(hw_url, quiz_body, format='json').status_code == 403, "security: Teacher B cannot assign homework to Teacher A's group")
    check(S1.post(hw_url, quiz_body, format='json').status_code == 403, 'security: a student cannot assign homework')

    # ---------------------------------------------------------------- homework: assign once (double click + parallel)
    first = T.post(hw_url, quiz_body, format='json')
    again = T.post(hw_url, quiz_body, format='json')
    check(first.status_code == 201 and again.status_code == 200 and again.json()['data']['created'] is False and again.json()['data']['id'] == first.json()['data']['id']
          and ClassQuizAssignment.objects.filter(group_id=g1).count() == 1 and ClassQuiz.objects.filter(owner_id=teacher.id).count() == 1,
          'idempotency: a repeated click returns the same quiz assignment (1 quiz, 1 assignment)')
    quiz_id = first.json()['data']['id']
    vocab_body = dict(type='vocabulary', vocabularySetId=vset.id, title='Unit 7 Travel', deadline=deadline, minPassPercent=60)
    results, barrier = [], threading.Barrier(6)

    def go():
        django.db.close_old_connections()
        barrier.wait()
        try:
            results.append(client(teacher).post(hw_url, vocab_body, format='json').status_code)
        finally:
            connection.close()
    threads = [threading.Thread(target=go) for _ in range(6)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    check(sorted(results) == [200] * 5 + [201] and HomeworkAssignment.objects.filter(cohort__classroom_id=g1, vocabulary_set=vset).count() == 1,
          f'idempotency: 6 parallel clicks create exactly ONE vocabulary assignment ({sorted(results)})')
    vocab_id = HomeworkAssignment.objects.get(cohort__classroom_id=g1, vocabulary_set=vset).id
    exam_res = T.post(hw_url, dict(type='exam', examId=published_exam, title='Practice Mock', deadline=deadline), format='json')
    lesson_res = T.post(hw_url, dict(type='lesson', title='Essay: my city', deadline=deadline, minPassPercent=50), format='json')
    check(exam_res.status_code == 201 and lesson_res.status_code == 201, 'homework: a published exam and a lesson task are assigned')
    lesson_id = lesson_res.json()['data']['id']
    b_quiz = T.post(f'/v1/teacher/workspace/groups/{g2}/homework', dict(quiz_body, title='Group A2 test'), format='json')
    check(b_quiz.status_code == 201 and ClassQuizAssignment.objects.filter(group_id=g2).count() == 1, 'homework: the same teacher assigns to a second group independently')

    # ---------------------------------------------------------------- Telegram: queued, never sent, website button
    quiz_rows = TelegramOutbox.objects.filter(dedupe_key__startswith=f'quiz_assigned:{quiz_id}:')
    linked = [s for s in roster[g1] if User.objects.get(id=s.id).telegram_chat_id]
    check(quiz_rows.count() == len(linked) == 15 and all(r.status == 'pending' for r in quiz_rows),
          'telegram: one "new test" notice per LINKED student (15 of 20), queued as pending — nothing sent')
    buttons = [b for row in quiz_rows.first().keyboard for b in row]
    check(any(b.get('url', '').endswith(f'/homework/quiz/{quiz_id}') for b in buttons) and any(b.get('callback_data') == f'qs:{quiz_id}' for b in buttons),
          'telegram: the notice opens the same assignment on the website AND in the bot')
    hw_rows = TelegramOutbox.objects.filter(dedupe_key__startswith=f'homework_assigned:{vocab_id}:')
    check(hw_rows.count() == 15 and 'Unit 7 Travel' in hw_rows.first().text and hw_rows.first().keyboard[0][0]['url'].endswith('/homework'),
          'telegram: website homework (vocabulary) queues one notice per linked student with an "Open homework" link')
    check(not TelegramOutbox.objects.filter(recipient_id=outsider.id).exclude(kind='attendance').exists(), 'telegram: nobody outside the group is notified')

    # ---------------------------------------------------------------- student: My homework + quiz runner over HTTP
    mine = S1.get('/v1/student/homework').json()['data']
    kinds = sorted(i['kind'] for i in mine)
    check(kinds == ['exam', 'lesson', 'quiz', 'vocabulary'] and all(i['status'] == 'not_started' for i in mine),
          f'student: My homework lists the 4 assignments of HER group as NOT STARTED ({kinds})')
    check(SO.get('/v1/student/homework').json()['data'] == [], "security: a student of another group sees none of this group's homework")
    check(T.get('/v1/student/homework').status_code == 403, 'security: the student list is students-only')
    check(SO.post(f'/v1/class-quiz-assignments/{quiz_id}/start').status_code == 404, "security: an outsider cannot start the group's quiz")
    started = S1.post(f'/v1/class-quiz-assignments/{quiz_id}/start').json()['data']
    check(started['questionCount'] == 20 and 'correctAnswers' not in json.dumps(started) and started['secondsLeft'] > 1700,
          'runner: the quiz starts with 20 questions, no answer key, a 30-minute server timer')
    attempt_id = started['attemptId']
    for i, q in enumerate(started['questions']):
        S1.post(f'/v1/class-quiz-attempts/{attempt_id}/answer', dict(questionId=q['id'], response=0 if i < 16 else 1), format='json')
    S1.post(f'/v1/class-quiz-attempts/{attempt_id}/answer', dict(questionId=started['questions'][0]['id'], response=0), format='json')
    resumed = S1.get(f'/v1/class-quiz-attempts/{attempt_id}').json()['data']
    check(resumed['resumed'] and len(resumed['savedAnswers']) == 20 and resumed['status'] == 'in_progress', 'runner: reopening resumes with all 20 saved answers (duplicate answer is harmless)')
    check(S2.get(f'/v1/class-quiz-attempts/{attempt_id}').status_code == 404, "security: Student B cannot open Student A's attempt")
    finish = S1.post(f'/v1/class-quiz-attempts/{attempt_id}/finish').json()['data']
    finish2 = S1.post(f'/v1/class-quiz-attempts/{attempt_id}/finish').json()['data']
    check(finish['correct'] == 16 and finish['percent'] == 80.0 and finish2['percent'] == 80.0 and ClassQuizAttempt.objects.filter(assignment_id=quiz_id, student_id=s1.id).count() == 1,
          'runner: server grading 16/20 = 80%, a second Finish returns the same stored result')
    check(finish['isIeltsBand'] is False and 'band' not in json.dumps({k: v for k, v in finish.items() if k != 'isIeltsBand'}).lower(), 'runner: a classroom quiz is a percentage, never an IELTS band')
    check(TelegramOutbox.objects.filter(dedupe_key=f'result_ready:{attempt_id}').count() == 1, 'telegram: the website finish queues the same result for Telegram (one notice)')
    mine = {i['kind']: i for i in S1.get('/v1/student/homework').json()['data']}
    check(mine['quiz']['status'] == 'graded' and mine['quiz']['percent'] == 80.0, 'student: My homework shows the quiz as GRADED 80%')
    # vocabulary through the existing snapshot scorer
    session = S2.post(f'/v1/student/assignments/{vocab_id}/vocabulary', dict(mode='eng_uzb'), format='json').json()['data']
    words = {w['id']: w for w in VocabularyWord.objects.filter(set=vset).values('id', 'english', 'uzbek')}
    answers = []
    for n, q in enumerate(session['questions']):
        w = words[q['wordId']]
        right = w['uzbek'] if q['type'] == 'eng_uzb' else w['english']
        answers.append(dict(wordId=q['wordId'], answer=right if n < 7 else 'xato'))
    vres = S2.post(f'/v1/student/assignments/{vocab_id}/vocabulary/submit', dict(sessionId=session['sessionId'], answers=answers), format='json').json()['data']
    check(vres['percentage'] == 70.0 and HomeworkSubmission.objects.get(assignment_id=vocab_id, student_id=s2.id).score_percent == 70,
          'vocabulary: the existing snapshot scorer gives 7/10 = 70% and stores one submission')
    # lesson task -> awaiting review (never a fake grade)
    S2.post(f'/v1/student/assignments/{lesson_id}/submit', {}, format='json')
    mine2 = {i['kind']: i for i in S2.get('/v1/student/homework').json()['data']}
    check(mine2['vocabulary']['status'] == 'graded' and mine2['vocabulary']['percent'] == 70 and mine2['lesson']['status'] == 'awaiting_review'
          and mine2['lesson']['percent'] is None, 'student: vocabulary GRADED 70%, lesson AWAITING REVIEW with no invented score')

    # ---------------------------------------------------------------- teacher: live results
    r = T.get(f'/v1/teacher/workspace/homework/quiz/{quiz_id}/results').json()['data']
    check(r['counts']['assigned'] == 20 and r['counts']['submitted'] == 1 and r['counts']['pending'] == 19 and r['averagePercent'] == 80.0,
          'results: Assigned 20 / Submitted 1 / Pending 19 / Average 80% — server counts')
    row = next(x for x in r['students'] if x['studentId'] == s1.id)
    check(row['status'] == 'graded' and row['correct'] == 16 and row['attemptId'] == attempt_id, 'results: the completed student shows 16/20 with a link to the attempt')
    staff = T.get(f'/v1/class-quiz-attempts/{attempt_id}/staff').json()['data']
    check(len(staff['incorrect']) == 4 and all(x['correctAnswer'] for x in staff['review']), "results: the teacher inspects the submission and its 4 mistakes")
    check(TB.get(f'/v1/teacher/workspace/homework/quiz/{quiz_id}/results').status_code == 404 and TB.get(f'/v1/class-quiz-attempts/{attempt_id}/staff').status_code == 404,
          "security: Teacher B sees neither the results nor the submission")
    lr = T.get(f'/v1/teacher/workspace/homework/lesson/{lesson_id}/results').json()['data']
    lrow = next(x for x in lr['students'] if x['studentId'] == s2.id)
    check(lr['counts']['awaitingReview'] == 1 and lrow['status'] == 'awaiting_review' and lrow['percent'] is None and lrow['canGrade'],
          'results: a lesson submission is AWAITING REVIEW (distinct from a graded zero) and gradable')
    grade = T.post(f'/v1/teacher/assignments/{lesson_id}/grade', dict(student_id=s2.id, score_percent=0), format='json')
    lr = T.get(f'/v1/teacher/workspace/homework/lesson/{lesson_id}/results').json()['data']
    lrow = next(x for x in lr['students'] if x['studentId'] == s2.id)
    check(grade.status_code == 200 and lrow['status'] == 'graded' and lrow['percent'] == 0 and lr['counts']['graded'] == 1,
          'results: a teacher grade of 0 shows as GRADED 0% (not as pending)')
    remind = T.post(f'/v1/teacher/workspace/homework/quiz/{quiz_id}/remind').json()['data']
    again_remind = T.post(f'/v1/teacher/workspace/homework/quiz/{quiz_id}/remind').json()['data']
    check(remind['pending'] == 19 and remind['queued'] == 14 and again_remind['queued'] == 0,
          'reminder: 19 pending, 14 linked get ONE reminder per day (a second click queues nothing)')
    listed = T.get(hw_url).json()['data']
    check(len(listed) == 4 and {i['assignment']['kind'] for i in listed} == {'quiz', 'vocabulary', 'exam', 'lesson'}, "group homework: the group's 4 assignments with counts")
    # removed student keeps history
    with connection.cursor() as cursor:
        cursor.execute('UPDATE "StudentProfile" SET "groupId" = %s WHERE "userId" = %s', [g3, s1.id])
    r = T.get(f'/v1/teacher/workspace/homework/quiz/{quiz_id}/results').json()['data']
    gone = next(x for x in r['students'] if x['studentId'] == s1.id)
    check(gone['removed'] and gone['percent'] == 80.0 and r['counts']['assigned'] == 19 and ClassQuizAttempt.objects.filter(id=attempt_id).exists(),
          'history: a student moved out of the group keeps the 80% result (shown as removed, not counted as assigned)')
    # expired deadline
    ClassQuizAssignment.objects.filter(id=quiz_id).update(deadline=timezone.now() - timedelta(minutes=1))
    check(S2.post(f'/v1/class-quiz-assignments/{quiz_id}/start').status_code == 403, 'deadline: a student cannot start after the deadline')
    s2_status = {i['kind']: i for i in S2.get('/v1/student/homework').json()['data']}
    r = T.get(f'/v1/teacher/workspace/homework/quiz/{quiz_id}/results').json()['data']
    check(s2_status.get('quiz') is None or s2_status['quiz']['status'] == 'overdue', 'deadline: the expired quiz is OVERDUE (or hidden) for a non-submitter')
    check(r['counts']['overdue'] == 19 and T.post(f'/v1/teacher/workspace/homework/quiz/{quiz_id}/remind').status_code == 409,
          'deadline: the teacher sees 19 overdue and cannot send reminders after the deadline')
    check(A.get(f'/v1/teacher/workspace/homework/quiz/{quiz_id}/results').status_code == 200, 'admin: an administrator may inspect any group results')
    print(f'\nALL {len(checks)} CHECKS PASSED')
finally:
    with connection.cursor() as cursor:
        cursor.execute('DELETE FROM "TelegramOutbox" WHERE recipient_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM "ResultCardDelivery" WHERE recipient_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM "ClassQuizAnswer" WHERE attempt_id IN (SELECT id FROM "ClassQuizAttempt" WHERE student_id = ANY(%s))', [users])
        cursor.execute('DELETE FROM "ClassQuizAttempt" WHERE student_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM "ClassQuizAssignment" WHERE group_id = ANY(%s)', [groups_made])
        cursor.execute('DELETE FROM "ClassQuizQuestion" WHERE quiz_id IN (SELECT id FROM "ClassQuiz" WHERE owner_id = ANY(%s))', [users])
        cursor.execute('DELETE FROM "ClassQuiz" WHERE owner_id = ANY(%s)', [users])
    from apps.core.models import UserWeakWord, VocabularyAttempt, VocabularyHomeworkSession, VocabularyReviewEvent
    HomeworkSubmission.objects.filter(student_id__in=users).delete()
    VocabularyHomeworkSession.objects.filter(student_id__in=users).delete()
    VocabularyReviewEvent.objects.filter(review__student_id__in=users).delete()
    UserWeakWord.objects.filter(student_id__in=users).delete()
    VocabularyAttempt.objects.filter(student_id__in=users).delete()
    HomeworkAssignment.objects.filter(cohort__classroom_id__in=groups_made).delete()
    Cohort.objects.filter(classroom_id__in=groups_made).delete()
    VocabularyWord.objects.filter(set__created_by_id__in=users).delete()
    VocabularySet.objects.filter(created_by_id__in=users).delete()
    TelegramPreference.objects.filter(user_id__in=users).delete()
    from apps.core.models import ClassroomEnrollment, TelegramDialogState
    ClassroomEnrollment.objects.filter(student_id__in=users).delete()
    TelegramDialogState.objects.filter(user_id__in=users).delete()
    with connection.cursor() as cursor:
        cursor.execute('DELETE FROM "Attendance" WHERE "groupId" = ANY(%s)', [groups_made])
        cursor.execute('DELETE FROM "MockExam" WHERE id = ANY(%s)', [exams_made])
        cursor.execute('DELETE FROM "StudentProfile" WHERE "userId" = ANY(%s)', [users])
        cursor.execute('DELETE FROM "Group" WHERE id = ANY(%s)', [groups_made])
        cursor.execute('DELETE FROM "User" WHERE id = ANY(%s)', [users])
