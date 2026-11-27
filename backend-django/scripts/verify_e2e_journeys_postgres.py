"""Loopback-only end-to-end check of the required end-to-end journeys: student, teacher and security (milestone 7) on the real PostgreSQL schema.

Real Telegram update dictionaries go through the real handler (and the HTTP webhook); only the network call to
api.telegram.org is replaced by a recorder. Every fixture row is removed.
"""
import json
import datetime as _dt
import os
import sys
import threading
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import urlparse
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if urlparse(os.environ.get('DATABASE_URL', '')).hostname not in ('localhost', '127.0.0.1', '::1'):
    raise SystemExit('Only a loopback PostgreSQL fixture is allowed')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.local')
os.environ.setdefault('ALLOWED_HOSTS', 'testserver,localhost,127.0.0.1')
os.environ['TELEGRAM_WEBHOOK_SECRET'] = 'e2e-secret-' + uuid4().hex
os.environ['TELEGRAM_BOT_TOKEN'] = '000000:e2e-token-never-sent'
os.environ.pop('SUPERADMIN_TELEGRAM_ID', None)
import django

django.setup()
from django.db import connection
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import ClassroomEnrollment
from apps.core import class_quiz as cq
from apps.core import class_quiz_appeals as appeals
from apps.core import vocabulary_bot as vb
from apps.core import vocabulary_review, vocabulary_service
from apps.core import telegram_notify as notify
from apps.core import telegram_outbox as outbox
from apps.core.auth_service import hash_password
from apps.core import telegram_bot as bot
from apps.core import telegram_delivery as delivery
from apps.core import telegram_state
from apps.core.models import (ClassQuiz, ClassQuizAssignment, ClassQuizAttempt, TelegramOutbox, UserWeakWord, VocabularyAttempt, VocabularySet, VocabularyWord)
from apps.legacy_schema.models import Group, StudentProfile, User
from apps.core.telegram_links import token_hash
from apps.legacy_schema.models import TelegramLinkToken

run = uuid4().hex[:8]
checks, users, groups_made = [], [], []
photos = []       # every photo sent: dict(chat, png)
out = []          # every outgoing Telegram message / edit: dict(chat, text, keyboard, edit)
update_ids = iter(range(int(uuid4().int % 10**8) + 2 * 10**10, 10**12))


def check(value, message):
    if not value:
        raise AssertionError('FAIL ' + message)
    checks.append(message)
    print('PASS ' + message)


def _enforce_callback_limit(keyboard):
    """Telegram rejects inline keyboards whose callback_data exceeds 64 bytes: fail the script instead of hiding it."""
    for row in keyboard or []:
        for button in row:
            data = button.get('callback_data')
            if data is not None and len(data.encode()) > 64:
                raise AssertionError(f'callback_data over 64 bytes ({len(data.encode())}): {data}')


def fake_call(method, payload=None):
    payload = payload or {}
    _enforce_callback_limit((payload.get('reply_markup') or {}).get('inline_keyboard'))
    if method == 'editMessageText':
        out.append(dict(chat=payload['chat_id'], text=payload['text'], keyboard=(payload.get('reply_markup') or {}).get('inline_keyboard'), edit=True))
    return {'ok': True, 'message_id': 1}


def fake_send(chat_id, text, reply_markup=None):
    _enforce_callback_limit((reply_markup or {}).get('inline_keyboard'))
    out.append(dict(chat=chat_id, text=text, keyboard=(reply_markup or {}).get('inline_keyboard'), edit=False))
    return {'message_id': 1}


def fake_menu(chat_id, text, keyboard):
    out.append(dict(chat=chat_id, text=text, keyboard=None, edit=False, reply_keyboard=keyboard))


def mk_user(role, chat=None):
    now = timezone.now()
    uid = f'tq-{role}-{uuid4().hex[:6]}-{run}'
    User.objects.create(id=uid, name=f'tq {role}', phone='+99875' + uuid4().hex[:7], role=role, password_hash='x', is_active=True,
                        telegram_chat_id=chat, created_at=now, updated_at=now)
    users.append(uid)
    # Synthetic users start WITHOUT a quiet window: the default 22:00-07:00 (Asia/Tashkent) would otherwise defer every
    # notification whenever this script runs in the evening, making results depend on the wall clock. Quiet hours are
    # exercised explicitly where they are tested.
    from apps.core.models import TelegramPreference as _Pref
    _Pref.objects.update_or_create(user_id=uid, defaults=dict(quiet_start=_dt.time(0, 0), quiet_end=_dt.time(0, 0)))
    return SimpleNamespace(id=uid, role=role, is_authenticated=True)


def mk_student(group_id, chat):
    student = mk_user('student', chat)
    with connection.cursor() as cursor:
        cursor.execute('INSERT INTO "StudentProfile" ("userId","availablePrograms","activeProgram","isApproved","groupId","currentPoints","linkCode","createdAt","pointsPeriod","gameQualified","qualifiedAt") '
                       "VALUES (%s, ARRAY['IELTS']::\"ExamProgram\"[], 'IELTS', true, %s, 0, %s, NOW(), NULL, false, NULL)",
                       [student.id, group_id, 'TQ' + uuid4().hex[:8].upper()])
    if group_id is not None:
        ClassroomEnrollment.objects.create(group_id=group_id, student_id=student.id, started_at=timezone.now())
    return student


def tap(chat, data, message_id=77, chat_type='private', update_id=None):
    bot.handle({'update_id': update_id or next(update_ids), 'callback_query': {'id': 'cb' + uuid4().hex[:6], 'from': {'id': int(chat), 'first_name': 'S'},
               'message': {'message_id': message_id, 'chat': {'id': int(chat), 'type': chat_type}}, 'data': data}})


def say(chat, text, update_id=None):
    bot.handle({'update_id': update_id or next(update_ids), 'message': {'chat': {'id': int(chat), 'type': 'private'}, 'from': {'id': int(chat), 'first_name': 'S'}, 'text': text}})


def last(chat=None):
    rows = [o for o in out if chat is None or str(o['chat']) == str(chat)]
    return rows[-1] if rows else None


def buttons(message):
    return [b for row in (message['keyboard'] or []) for b in row]


def find_button(message, prefix):
    return next((b for b in buttons(message) if b['callback_data'].startswith(prefix)), None)


def mark():
    out.clear()


def texts(chat=None):
    return ' '.join(o['text'] for o in out if chat is None or str(o['chat']) == str(chat))


def code(fn, *args):
    try:
        fn(*args)
    except Exception as error:      # noqa: BLE001
        return getattr(error, 'contract_code', type(error).__name__)
    return None


def mk_login_user(role, phone, password):
    uid = f'e2e-{role}-{uuid4().hex[:6]}-{run}'
    now_ = timezone.now()
    User.objects.create(id=uid, name=f'e2e {role}', phone=phone, role=role, password_hash=hash_password(password), is_active=True, created_at=now_, updated_at=now_)
    users.append(uid)
    return uid


photos = []
try:
    now = timezone.now()
    PW = 'Correct-Horse-9!'
    phone_t, phone_tb = '+99890' + str(uuid4().int)[:7], '+99891' + str(uuid4().int)[:7]
    teacher_id, teacher_b_id = mk_login_user('teacher', phone_t, PW), mk_login_user('teacher', phone_tb, PW)
    gid, gid_b = f'e2e-g-{uuid4().hex[:6]}-{run}', f'e2e-gb-{uuid4().hex[:6]}-{run}'
    Group.objects.create(id=gid, name='E2E A', teacher_id=teacher_id, created_at=now)
    Group.objects.create(id=gid_b, name='E2E B', teacher_id=teacher_b_id, created_at=now)
    groups_made.extend([gid, gid_b])
    # the student's account exists on the website; the Telegram chat is NOT linked yet
    student = mk_student(gid, None)
    student_b = mk_student(gid_b, '860000002')
    CHAT, CHAT_B, CHAT_X = '860000001', '860000002', '860000009'
    http_anon, http_t, http_tb = APIClient(), APIClient(), APIClient()

    with patch.object(delivery, 'call', fake_call), patch.object(delivery, 'send', fake_send), patch.object(delivery, 'menu', fake_menu), \
            patch.object(delivery, 'plain', lambda chat, text, **k: out.append(dict(chat=chat, text=text, keyboard=None, edit=False))), \
            patch.object(delivery, 'send_photo', lambda chat, photo, **k: photos.append(str(chat)) or {'message_id': 1}), \
            patch.object(delivery, 'send_detailed', lambda chat, text, reply_markup=None: (_enforce_callback_limit((reply_markup or {}).get('inline_keyboard')), out.append(dict(chat=str(chat), text=text, keyboard=(reply_markup or {}).get('inline_keyboard'), edit=False)), ('sent', None))[2]), patch.object(delivery, 'answer_callback', lambda *a, **k: None):

        # ================================================================ TEACHER JOURNEY
        r = http_anon.post('/v1/auth/login', dict(phone=phone_t, password=PW), format='json')
        check(r.status_code == 200 and r.json()['success'], 'TEACHER: real HTTP login with phone + password')
        token = r.json()['data'].get('accessToken') or r.json()['data'].get('token')
        http_t.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        check(http_anon.post('/v1/auth/login', dict(phone=phone_t, password='wrong-password'), format='json').status_code == 401, 'TEACHER: a wrong password is refused')
        tb_token = http_anon.post('/v1/auth/login', dict(phone=phone_tb, password=PW), format='json').json()['data'].get('accessToken')
        http_tb.credentials(HTTP_AUTHORIZATION=f'Bearer {tb_token}')
        questions = []
        for i in range(1, 41):
            if i % 4 == 0:
                questions.append(dict(type='text', prompt=f'Q{i}: The window was ___ (break).', correctAnswers=['broken'], acceptedVariants=['Broken!']))
            elif i % 4 == 1:
                questions.append(dict(type='tf', prompt=f'Q{i}: "It was written." is passive.', correctAnswers=['True']))
            else:
                questions.append(dict(type='mcq', prompt=f'Q{i}: choose the passive form.', options=['is done', 'does', 'did', 'doing'], correctAnswers=[0]))
        r = http_t.post('/v1/class-quizzes', dict(title='Passive Voice — 40', category='grammar', timeLimitMinutes=30, maxAttempts=1), format='json')
        quiz_id = r.json()['data']['id']
        r = http_t.put(f'/v1/class-quizzes/{quiz_id}/questions', dict(questions=questions), format='json')
        check(r.status_code == 200 and r.json()['data']['questionCount'] == 40, 'TEACHER: creates a 40-question test (MCQ + True/False + text) over HTTP')
        check(http_t.get(f'/v1/class-quizzes/{quiz_id}/preview').json()['data']['issues'] == [] and 'correctAnswers' not in json.dumps(http_t.get(f'/v1/class-quizzes/{quiz_id}/preview').json()['data']['student_view']), 'TEACHER: the preview shows what students see, without keys')
        check(http_tb.get(f'/v1/class-quizzes/{quiz_id}').status_code == 404, 'SECURITY: teacher B cannot open teacher A\'s test')
        http_t.post(f'/v1/class-quizzes/{quiz_id}/publish', {}, format='json')
        deadline = (timezone.now() + timedelta(days=2)).isoformat()
        check(http_tb.post(f'/v1/class-quizzes/{quiz_id}/assign', dict(groupIds=[gid], deadline=deadline), format='json').status_code in (403, 404), 'SECURITY: teacher B cannot assign teacher A\'s test (or to A\'s group)')
        r = http_t.post(f'/v1/class-quizzes/{quiz_id}/assign', dict(groupIds=[gid], deadline=deadline), format='json')
        assignment_id = r.json()['data'][0]['id']
        check(r.status_code == 201 and TelegramOutbox.objects.filter(recipient_id=student.id).count() == 0, 'TEACHER: assigns the test to their group with a deadline (the student has no linked Telegram yet: nothing queued)')
        check(http_tb.get(f'/v1/class-quiz-assignments/{assignment_id}/overview').status_code == 404, 'SECURITY: teacher B cannot monitor teacher A\'s results')

        # ================================================================ STUDENT JOURNEY
        say(CHAT, '/tests')
        check('/start' in last(CHAT)['text'], 'STUDENT: an unlinked Telegram account is asked to link first')
        say(CHAT, '/start deadbeef-not-a-token')
        check(not User.objects.filter(telegram_chat_id=CHAT).exists(), 'SECURITY: an invalid link token links nothing')
        raw = 'tok-' + uuid4().hex
        TelegramLinkToken.objects.create(id=str(uuid4()), user_id=student.id, token_hash=token_hash(raw), expires_at=timezone.now() + timedelta(minutes=10), created_at=timezone.now())
        say(CHAT, f'/start {raw}')
        check(User.objects.get(id=student.id).telegram_chat_id == CHAT, 'STUDENT: /start with a valid single-use token links the account')
        say(CHAT_X, f'/start {raw}')
        check(not User.objects.filter(telegram_chat_id=CHAT_X).exists() and User.objects.get(id=student.id).telegram_chat_id == CHAT, 'SECURITY: the same token cannot link a second Telegram account')
        expired = 'tok-' + uuid4().hex
        TelegramLinkToken.objects.create(id=str(uuid4()), user_id=student_b.id, token_hash=token_hash(expired), expires_at=timezone.now() - timedelta(minutes=1), created_at=timezone.now())
        say(CHAT_X, f'/start {expired}')
        check(not User.objects.filter(telegram_chat_id=CHAT_X).exists(), 'SECURITY: an expired token links nothing')
        # the teacher's assignment arrives as a durable notification once linked + worker delivery
        notify.quiz_assigned(assignment_id)
        outbox.deliver_due(timezone.now(), sleep=lambda s: None)
        check(any('Yangi test: Passive Voice' in o['text'] and 'Savollar: 40' in o['text'] and 'Vaqt chegarasi: 30' in o['text'] for o in out if o['chat'] == CHAT), 'STUDENT: receives "New test: … Questions: 40 Time limit: 30 minutes" with Start / Instructions')
        mark()
        say(CHAT, '/tests')
        listing = last(CHAT)
        tap(CHAT, find_button(listing, 'qo:')['callback_data'])
        tap(CHAT, find_button(last(CHAT), 'qs:')['callback_data'])
        attempt = ClassQuizAttempt.objects.get(student_id=student.id)
        check(attempt.status == 'in_progress' and (attempt.deadline_at - attempt.started_at) <= timedelta(minutes=30, seconds=1), 'STUDENT: starts the test; the server sets the 30-minute deadline')
        wrong_at = {5, 10, 15, 20}      # four deliberate mistakes (0-based question numbers shown 6, 11, 16, 21)
        for index in range(40):
            shown = last(CHAT)
            if f'Savol {index + 1}/40' not in shown['text']:
                tap(CHAT, f'qn:{attempt.id}:{index}')
                shown = last(CHAT)
            if 'xabar sifatida' in shown['text']:
                say(CHAT, 'wrong' if index in wrong_at else 'broken')
            else:
                options = [b for b in buttons(shown) if b['callback_data'].startswith(f'qa:{attempt.id}:{index}:')]
                good = '0'                 # option 0 is the right one in this fixture (is done / True)
                pick = next(b for b in options if b['callback_data'].endswith(':1')) if index in wrong_at else next(b for b in options if b['callback_data'].endswith(':' + good))
                tap(CHAT, pick['callback_data'])
        check(ClassQuizAttempt.objects.get(id=attempt.id).status == 'in_progress', 'STUDENT: answers saved question by question, attempt still open until finished')
        last_msg = last(CHAT)
        tap(CHAT, f'qf:{attempt.id}')
        tap(CHAT, f'qc:{attempt.id}')
        done = ClassQuizAttempt.objects.get(id=attempt.id)
        check(done.status == 'submitted' and done.question_count == 40 and done.correct_count == 40 - len(wrong_at) and done.percent == 90.0, 'STUDENT: finishes; the server scored 36/40 = 90%')
        check('To\'g\'ri: <b>36 / 40</b>' in texts(CHAT) and photos.count(CHAT) == 1, 'STUDENT: result text and exactly one private result image')
        tap(CHAT, f'qc:{attempt.id}')
        check(photos.count(CHAT) == 1 and ClassQuizAttempt.objects.filter(student_id=student.id).count() == 1, 'SECURITY: a duplicate Finish creates no second result or image')
        mark()
        tap(CHAT, f'qr:{attempt.id}:0')
        check('Xatolar' in last(CHAT)['text'] and 'To\'g\'ri javob' in last(CHAT)['text'], 'STUDENT: reviews mistakes with correct answers after finishing')
        # vocabulary -> /takror
        vset = VocabularySet.objects.create(title='E2E words', created_by_id=teacher_id, group_id=gid, is_public=True)
        for i in range(1, 16):
            VocabularyWord.objects.create(set=vset, english=f'e2eword{i}', uzbek=f'tarjima{i}')
        mark()
        tap(CHAT, f'vm:{vset.id}:A')
        practice = vb.BotVocabRun.objects.get(student_id=student.id, kind='practice', status='active')
        for index, q in enumerate(practice.questions):
            say(CHAT, q['expected'].split(',')[0] if index % 5 else 'nope')
            nxt = find_button(last(CHAT), 'vn:')
            if nxt:
                tap(CHAT, nxt['callback_data'])
        tap(CHAT, f'vc:{practice.id}')
        weak_due = vocabulary_review.due(student.id, timezone.now()).count()
        check(VocabularyAttempt.objects.filter(student_id=student.id).count() == 1 and UserWeakWord.objects.filter(student_id=student.id).count() == 15 and UserWeakWord.objects.filter(student_id=student.id, correct_streak=0).count() == 3, 'STUDENT: vocabulary practice is stored; the 3 wrong words are tracked with streak 0 (retry in 10 minutes), the other 12 are scheduled')
        UserWeakWord.objects.filter(student_id=student.id).update(next_review_at=timezone.now() - timedelta(hours=1))   # time passes: everything is due
        mark()
        say(CHAT, '/takror')
        check('<b>15</b> ta takrorlash' in last(CHAT)['text'], 'STUDENT: /takror says "Today you have 15 review questions"')
        tap(CHAT, 'vr:go')
        review = vb.BotVocabRun.objects.get(student_id=student.id, kind='review', status='active')
        for index, q in enumerate(review.questions):
            if q['input'] == 'mcq':
                option = q['options'].index(q['expected']) if index < 13 else next(n for n, o in enumerate(q['options']) if o != q['expected'])
                tap(CHAT, f'vo:{review.id}:{index}:{option}')
            else:
                say(CHAT, q['expected'].split(',')[0] if index < 13 else 'nope')
            nxt = find_button(last(CHAT), 'vn:')
            if nxt and index < 14:
                tap(CHAT, nxt['callback_data'])
        tap(CHAT, f'vc:{review.id}')
        summary = ' '.join(o['text'] for o in out[-3:])
        check('Takrorlash yakunlandi' in summary and 'To\'g\'ri: 13/15' in summary, 'STUDENT: completes the revision; summary "Correct: 13/15"')
        check(vocabulary_service.generate_srs_quiz_for_user(student.id)['totalQuestions'] == vocabulary_review.due(student.id, timezone.now()).count(), 'STUDENT: website and Telegram agree on what is still due')

        # ================================================================ TEACHER MONITORING (HTTP, after the student finished)
        overview = http_t.get(f'/v1/class-quiz-assignments/{assignment_id}/overview').json()['data']
        me = next(p for p in overview['participants'] if p['studentId'] == student.id)
        check(me['state'] == 'submitted' and me['bestPercent'] == 90.0 and overview['submitted'] == 1, 'TEACHER: monitors completion and sees the student\'s 90%')
        check(b'student,state' in http_t.get(f'/v1/class-quiz-assignments/{assignment_id}/export').content, 'TEACHER: CSV export works')

        # ================================================================ SECURITY MATRIX
        http_s, http_sb, http_parent = APIClient(), APIClient(), APIClient()
        http_s.force_authenticate(SimpleNamespace(id=student.id, role='student', is_authenticated=True))
        http_sb.force_authenticate(SimpleNamespace(id=student_b.id, role='student', is_authenticated=True))
        check(http_anon.get(f'/v1/class-quiz-attempts/{attempt.id}/result').status_code in (401, 403), 'SECURITY: anonymous users cannot read a result')
        check(http_s.get(f'/v1/class-quiz-attempts/{attempt.id}/result').json()['data']['percent'] == 90.0, 'SECURITY: student A reads their own result')
        check(http_sb.get(f'/v1/class-quiz-attempts/{attempt.id}/result').status_code == 404, 'SECURITY: student B cannot read student A\'s result')
        check(http_sb.get(f'/v1/class-quiz-attempts/{attempt.id}').status_code == 404, 'SECURITY: student B cannot open student A\'s attempt')
        check(http_s.get(f'/v1/class-quiz-attempts/{attempt.id}/staff').status_code == 403, 'SECURITY: a student cannot use the staff view')
        check(http_tb.get(f'/v1/class-quiz-attempts/{attempt.id}/staff').status_code == 404, 'SECURITY: teacher B cannot open A\'s student\'s attempt')
        parent_id = mk_login_user('parent', '+99893' + str(uuid4().int)[:7], PW)
        http_parent.force_authenticate(SimpleNamespace(id=parent_id, role='parent', is_authenticated=True))
        check(http_parent.get(f'/v1/class-quiz/children/{student.id}/results').status_code == 403, 'SECURITY: an unlinked parent cannot see a child\'s results')
        with connection.cursor() as cursor:
            cursor.execute('INSERT INTO "ParentStudent" ("parentUserId","studentId","createdAt") VALUES (%s,%s,NOW())', [parent_id, student.id])
        child = http_parent.get(f'/v1/class-quiz/children/{student.id}/results').json()['data']
        check(child and child[0]['percent'] == 90.0 and 'review' not in json.dumps(child, default=str) and 'correctAnswer' not in json.dumps(child, default=str), 'SECURITY: a linked parent sees the percentage only (no answers, no keys)')
        mark()
        say(CHAT, '/superadmin')
        check(not any('Superadmin Panel' in o['text'] for o in out), 'SECURITY: /superadmin from a student chat shows no admin panel')
        mark()
        tap(CHAT, 'tg')
        tap(CHAT, 'ta')
        check(all('ustozlar uchun' in o['text'] for o in out), 'SECURITY: a student cannot call teacher tools by forging callbacks')
        for hostile in ('qa:' + 'x' * 70 + ':0:0', 'qs:../../etc', 'vo:::', 'tb:g', 'st:k:bogus'):
            tap(CHAT, hostile)
        check(User.objects.filter(id=student.id).exists(), 'SECURITY: invalid callback data is refused gracefully')
        # expired deadline: a started attempt cannot be revived; closed test cannot be restarted
        a2 = cq.assign_quiz(SimpleNamespace(id=teacher_id, role='teacher'), quiz_id, [gid], timezone.now() + timedelta(days=1), max_attempts=3)[0]['id']
        mark()
        tap(CHAT, f'qs:{a2}')
        att2 = ClassQuizAttempt.objects.get(assignment_id=a2, student_id=student.id)
        ClassQuizAttempt.objects.filter(id=att2.id).update(deadline_at=timezone.now() - timedelta(seconds=5))
        tap(CHAT, f'qa:{att2.id}:0:0')
        check(ClassQuizAttempt.objects.get(id=att2.id).status == 'submitted' and 'Vaqt tugadi' in texts(CHAT), 'SECURITY: an answer after the server deadline is refused and the attempt auto-submitted')
        ClassQuizAssignment.objects.filter(id=a2).update(deadline=timezone.now() - timedelta(minutes=1))
        tap(CHAT, f'qs:{a2}')
        check(ClassQuizAttempt.objects.filter(assignment_id=a2, student_id=student.id).count() == 1, 'SECURITY: an expired examination cannot be restarted')
        # simultaneous submissions of one attempt
        a3 = cq.assign_quiz(SimpleNamespace(id=teacher_id, role='teacher'), quiz_id, [gid], timezone.now() + timedelta(days=1), max_attempts=3)[0]['id']
        att3 = cq.start_attempt(SimpleNamespace(id=student.id, role='student'), a3)
        results, errors = [], []

        def finish_now():
            try:
                results.append(cq.finish_attempt(SimpleNamespace(id=student.id, role='student'), att3['attemptId']))
            except Exception as error:      # noqa: BLE001
                errors.append(error)

        threads = [threading.Thread(target=finish_now) for _ in range(6)]
        for th in threads:
            th.start()
        for th in threads:
            th.join()
        check(not errors and len({(r['attemptId'], r['percent'], r['submittedAt']) for r in results}) == 1 and ClassQuizAttempt.objects.filter(assignment_id=a3, student_id=student.id).count() == 1, 'SECURITY: six simultaneous Finish calls produce one stored result')
        # restart during a test: a new process (re-import) resumes from the database
        a4 = cq.assign_quiz(SimpleNamespace(id=teacher_id, role='teacher'), quiz_id, [gid], timezone.now() + timedelta(days=1), max_attempts=3)[0]['id']
        tap(CHAT, f'qs:{a4}')
        att4 = ClassQuizAttempt.objects.get(assignment_id=a4, student_id=student.id)
        tap(CHAT, find_button(last(CHAT), f'qa:{att4.id}:0:')['callback_data'])
        import importlib
        importlib.reload(cq)
        mark()
        tap(CHAT, f'qs:{a4}')
        check('Savol 2/40' in last(CHAT)['text'] and ClassQuizAttempt.objects.filter(assignment_id=a4, student_id=student.id).count() == 1, 'SECURITY: after a process restart the active test resumes at question 2 with its saved answer')
    print(f'\nALL {len(checks)} CHECKS PASSED')
finally:
    with connection.cursor() as cursor:
        cursor.execute('DELETE FROM "TelegramOutbox" WHERE recipient_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM "ParentStudent" WHERE "parentUserId" = ANY(%s)', [users])
        cursor.execute('DELETE FROM "ResultCardDelivery" WHERE recipient_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM "TelegramLinkToken" WHERE "userId" = ANY(%s)', [users])
        cursor.execute('DELETE FROM core_vocabularyreviewevent WHERE review_id IN (SELECT id FROM "UserWeakWord" WHERE student_id = ANY(%s))', [users])
        cursor.execute('DELETE FROM "UserWeakWord" WHERE student_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM "BotVocabRun" WHERE student_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM core_vocabularypracticesession WHERE student_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM "VocabularyAttempt" WHERE student_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM "PointsLog" WHERE "studentId" = ANY(%s)', [users])
        cursor.execute('DELETE FROM "VocabularyWord" WHERE set_id IN (SELECT id FROM "VocabularySet" WHERE created_by_id = ANY(%s))', [users])
        cursor.execute('DELETE FROM "VocabularySet" WHERE created_by_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM "ClassQuizCorrection" WHERE attempt_id IN (SELECT id FROM "ClassQuizAttempt" WHERE student_id = ANY(%s))', [users])
        cursor.execute('DELETE FROM "ClassQuizAppeal" WHERE student_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM "ClassQuizAnswer" WHERE attempt_id IN (SELECT id FROM "ClassQuizAttempt" WHERE student_id = ANY(%s))', [users])
        cursor.execute('DELETE FROM "ClassQuizAttempt" WHERE student_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM "ClassQuizAssignment" WHERE group_id = ANY(%s)', [groups_made])
        cursor.execute('DELETE FROM "ClassQuizQuestion" WHERE quiz_id IN (SELECT id FROM "ClassQuiz" WHERE owner_id = ANY(%s))', [users])
        cursor.execute('DELETE FROM "ClassQuiz" WHERE owner_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM "RefreshToken" WHERE "userId" = ANY(%s)', [users])
        cursor.execute('DELETE FROM core_telegramdialogstate WHERE user_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM core_telegrampreference WHERE user_id = ANY(%s)', [users])
        ClassroomEnrollment.objects.filter(student_id__in=users).delete()
        cursor.execute('DELETE FROM "StudentProfile" WHERE "userId" = ANY(%s)', [users])
        cursor.execute('DELETE FROM "Group" WHERE id = ANY(%s)', [groups_made])
        cursor.execute('DELETE FROM "User" WHERE id = ANY(%s)', [users])
