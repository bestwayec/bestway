"""Loopback-only end-to-end check of the Telegram quiz flow (milestone 3) on the real PostgreSQL schema.

Real Telegram update dictionaries go through the real handler (and the HTTP webhook); only the network call to
api.telegram.org is replaced by a recorder. Every fixture row is removed.
"""
import json
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
os.environ['TELEGRAM_WEBHOOK_SECRET'] = 'quiz-secret-' + uuid4().hex
os.environ['TELEGRAM_BOT_TOKEN'] = '000000:quiz-token-never-sent'
os.environ.pop('SUPERADMIN_TELEGRAM_ID', None)
import django

django.setup()
from django.db import connection
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core import class_quiz as cq
from apps.core import telegram_bot as bot
from apps.core import telegram_delivery as delivery
from apps.core import telegram_state
from apps.core.models import ClassQuizAttempt, ClassQuizAssignment, TelegramDialogState, TelegramUpdateReceipt
from apps.legacy_schema.models import Group, User

run = uuid4().hex[:8]
checks, users, groups_made = [], [], []
photos = []       # photos sent (chat ids)
out = []          # every outgoing Telegram message / edit: dict(chat, text, keyboard, edit)
update_ids = iter(range(int(uuid4().int % 10**8) + 2 * 10**10, 10**12))


def check(value, message):
    if not value:
        raise AssertionError('FAIL ' + message)
    checks.append(message)
    print('PASS ' + message)


def fake_call(method, payload=None):
    payload = payload or {}
    if method == 'editMessageText':
        out.append(dict(chat=payload['chat_id'], text=payload['text'], keyboard=(payload.get('reply_markup') or {}).get('inline_keyboard'), edit=True))
    return {'ok': True, 'message_id': 1}


def fake_send(chat_id, text, reply_markup=None):
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
    return SimpleNamespace(id=uid, role=role, is_authenticated=True)


def mk_student(group_id, chat):
    student = mk_user('student', chat)
    with connection.cursor() as cursor:
        cursor.execute('INSERT INTO "StudentProfile" ("userId","availablePrograms","activeProgram","isApproved","groupId","currentPoints","linkCode","createdAt","pointsPeriod","gameQualified","qualifiedAt") '
                       "VALUES (%s, ARRAY['IELTS']::\"ExamProgram\"[], 'IELTS', true, %s, 0, %s, NOW(), NULL, false, NULL)",
                       [student.id, group_id, 'TQ' + uuid4().hex[:8].upper()])
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


try:
    teacher = mk_user('teacher')
    now = timezone.now()
    gid, gid_b = f'tq-g-{uuid4().hex[:6]}-{run}', f'tq-gb-{uuid4().hex[:6]}-{run}'
    for g in (gid, gid_b):
        Group.objects.create(id=g, name='tq group', teacher_id=teacher.id, created_at=now)
        groups_made.append(g)
    CHAT, CHAT_B, CHAT_T, CHAT_X = '810000001', '810000002', '810000003', '810000009'
    student, student_b = mk_student(gid, CHAT), mk_student(gid_b, CHAT_B)
    teacher_user = User.objects.get(id=teacher.id)
    User.objects.filter(id=teacher.id).update(telegram_chat_id=CHAT_T)

    questions = []
    for i in range(1, 41):
        if i % 3 == 1:
            questions.append(dict(type='mcq', prompt=f'Q{i}: choose the passive form.', options=['is done', 'does', 'did', 'doing'], correctAnswers=[0], explanation='be + V3'))
        elif i % 3 == 2:
            questions.append(dict(type='tf', prompt=f'Q{i}: "It was written." is passive.', correctAnswers=['True'], explanation='passive'))
        else:
            questions.append(dict(type='text', prompt=f'Q{i}: The window was ___ (break).', correctAnswers=['broken'], acceptedVariants=['Broken!'], explanation='past participle'))
    quiz = cq.create_quiz(teacher, dict(title='Passive Voice Practice', category='grammar', timeLimitMinutes=30, maxAttempts=1))['id']
    cq.replace_questions(teacher, quiz, questions)
    cq.publish_quiz(teacher, quiz)
    assignment = cq.assign_quiz(teacher, quiz, [gid], now + timedelta(days=2))[0]['id']

    with patch.object(delivery, 'call', fake_call), patch.object(delivery, 'send', fake_send), patch.object(delivery, 'menu', fake_menu), \
            patch.object(delivery, 'send_photo', lambda chat, photo, **k: photos.append(str(chat)) or {'message_id': 9}), patch.object(delivery, 'answer_callback', lambda *a, **k: None), patch.object(delivery, 'contact_request', lambda c, t: out.append(dict(chat=c, text=t, keyboard=None, edit=False))):
        # ---------------------------------------------------------------- list + card
        say(CHAT, '📝 Testlarim')
        listing = last(CHAT)
        check(listing and 'Mening testlarim' in listing['text'] and find_button(listing, f'qo:{assignment}'), 'My Tests lists the assigned quiz with an open button')
        tap(CHAT, f'qo:{assignment}')
        card = last(CHAT)
        check('Yangi test: Passive Voice Practice' in card['text'] and 'Savollar: 40' in card['text'] and 'Vaqt chegarasi: 30' in card['text'], 'the test card shows title, 40 questions and the 30-minute limit')
        check(find_button(card, 'qs:') and find_button(card, 'qi:'), 'the card offers Start test and Instructions buttons')
        tap(CHAT, f'qi:{assignment}')
        check('Ko\'rsatmalar' in last(CHAT)['text'], 'Instructions open on request')

        # ---------------------------------------------------------------- start
        tap(CHAT, f'qs:{assignment}')
        first = last(CHAT)
        check('Savol 1/40' in first['text'] and '⏱' in first['text'], 'Start test opens question 1/40 with the server-side time left')
        attempts = ClassQuizAttempt.objects.filter(assignment_id=assignment, student_id=student.id)
        check(attempts.count() == 1, 'exactly one attempt row exists')
        attempt_id = attempts.first().id
        tap(CHAT, f'qs:{assignment}')
        check(ClassQuizAttempt.objects.filter(assignment_id=assignment, student_id=student.id).count() == 1 and 'Savol 1/40' in last(CHAT)['text'],
              'tapping Start again resumes the same attempt (idempotent)')

        # ---------------------------------------------------------------- answer 1..20 (restart afterwards)
        wrong = {1, 5, 12, 20, 22, 25, 31, 34, 40}  # 9 mistakes -> 31/40
        position = 0

        def play(upto):
            global position
            while position < upto:
                msg = last(CHAT)
                n = position + 1
                check_title = f'Savol {n}/40' in msg['text']
                if not check_title:
                    raise AssertionError(f'FAIL expected question {n}, bot showed: {msg["text"][:60]!r}')
                qtype = ['mcq', 'tf', 'text'][(n - 1) % 3]
                if qtype == 'text':
                    say(CHAT, 'zzz' if n in wrong else 'Broken')
                else:
                    option = (3 if qtype == 'mcq' else 1) if n in wrong else 0
                    button = next(b for b in buttons(msg) if b['callback_data'].endswith(f':{position}:{option}'))
                    tap(CHAT, button['callback_data'])
                position += 1
        play(20)
        check('Savol 21/40' in last(CHAT)['text'], 'after 20 answers the bot is on question 21')
        check(all(len(b['callback_data'].encode()) <= 64 for m in out for b in buttons(m)), 'every callback_data stays within Telegram\'s 64-byte limit')
        check(all(len(m['text']) <= 4096 for m in out), 'no message exceeds Telegram\'s 4096-character limit')

        # duplicate delivery of the same update and a double tap with a fresh update id
        dup = next(update_ids)
        n_before = len(out)
        tap(CHAT, find_button(last(CHAT), 'qn:')['callback_data'] if find_button(last(CHAT), 'qn:') else f'qn:{attempt_id}:20', update_id=dup)
        n_after_first = len(out)
        tap(CHAT, f'qn:{attempt_id}:20', update_id=dup)
        check(len(out) == n_after_first, 'a duplicate update_id is ignored (no second message)')

        # ---------------------------------------------------------------- simulated bot restart in the middle
        # Nothing exam-related lives in process memory: a fresh process only has PostgreSQL.
        for module in (delivery,):
            pass
        TelegramDialogState.objects.filter(user_id=student.id).delete()  # even the dialog row is gone: state is derived from the attempt
        tap(CHAT, f'qs:{assignment}')
        check('Savol 21/40' in last(CHAT)['text'], 'after a restart (dialog state lost) Start resumes exactly at question 21 from the saved answers')
        check(telegram_state.get_dialog(student.id)[0] == 'quiz_text', 'question 21 is a free-text question: its pending state was rebuilt in PostgreSQL from the attempt after the restart')
        play(40)
        check(position == 40, 'answers 21-40 (free text and choices) were all accepted in order')
        confirm = last(CHAT)
        check('Testni yakunlaysizmi' in confirm['text'] and find_button(confirm, 'qc:'), 'after the last answer the bot asks for confirmation before finishing')

        # ---------------------------------------------------------------- parallel finish + duplicate callbacks
        replies = []
        barrier = threading.Barrier(6)

        def finish():
            django.db.close_old_connections()
            barrier.wait()
            try:
                tap(CHAT, f'qc:{attempt_id}')
            finally:
                connection.close()
        ts = [threading.Thread(target=finish) for _ in range(6)]
        [t.start() for t in ts]
        [t.join() for t in ts]
        done = ClassQuizAttempt.objects.get(id=attempt_id)
        check(done.status == 'submitted' and done.correct_count == 31 and done.percent == 77.5, f'6 simultaneous Finish taps produce one result: {done.correct_count}/40 = {done.percent}%')
        results = [o for o in out if 'Test natijasi' in o['text']]
        check(results and all('To\'g\'ri: <b>31 / 40</b>' in r['text'] and 'Ball: <b>77.5%</b>' in r['text'] for r in results), 'every result message shows the same 31 / 40 and 77.5%')
        check('Vaqt: <b>' in results[-1]['text'] and 'Yaxshi' in results[-1]['text'], 'the result shows elapsed time and a status label')

        # ---------------------------------------------------------------- review mistakes
        mark()
        tap(CHAT, find_button(results[-1], 'qr:')['callback_data'])
        page1 = last(CHAT)
        check('Xatolar' in page1['text'] and "To'g'ri javob" in page1['text'] and find_button(page1, 'qr:'), 'Review mistakes shows incorrect answers with the correct ones and a next-page button')
        tap(CHAT, find_button(page1, 'qr:')['callback_data'])
        tap(CHAT, f'qr:{attempt_id}:2')
        check('Xatolar' in last(CHAT)['text'] and '9' in last(CHAT)['text'], 'the review pages through all 9 mistakes')

        # ---------------------------------------------------------------- hostile / invalid callbacks and identities
        mark()
        n_attempts = ClassQuizAttempt.objects.count()
        tap(CHAT_B, f'qs:{assignment}')
        check('tegishli emas' in last(CHAT_B)['text'] and ClassQuizAttempt.objects.count() == n_attempts, "a student of another group cannot start Teacher's quiz via a forwarded button (no attempt created)")
        tap(CHAT_B, f'qn:{attempt_id}:0')
        check('tegishli emas' in last(CHAT_B)['text'], "Student B cannot open Student A's attempt with its id")
        tap(CHAT_B, f'qr:{attempt_id}:0')
        check('tegishli emas' in last(CHAT_B)['text'] and 'Xatolar' not in last(CHAT_B)['text'], "Student B cannot read Student A's mistakes or answers")
        tap(CHAT_X, f'qs:{assignment}')
        check('bog\'lang' in last(CHAT_X)['text'], 'an unlinked Telegram account is asked to link first')
        tap(CHAT_T, f'qs:{assignment}')
        check("faqat o'quvchilar" in last(CHAT_T)['text'], 'a teacher account cannot take the quiz through the bot')
        for hostile in ('qa:garbage', 'qa:' + 'x' * 70, "qs:'; DROP TABLE \"User\";--", 'qn:abc:def', 'qz:whatever', 'qa::0:0', 'qa:' + attempt_id + ':99:0', 'qa:' + attempt_id + ':0:9'):
            mark()
            tap(CHAT, hostile)  # must not raise
        check(User.objects.filter(id=student.id).exists(), 'malformed and hostile callback data is refused gracefully')
        mark()
        tap(CHAT, f'qo:{assignment}', chat_type='supergroup')
        check('shaxsiy chat' in last(CHAT)['text'], 'quiz buttons pressed inside a group chat are refused (answers stay private)')
        mark()
        say(CHAT, 'hello there')
        check(not any('Saqlandi' in o['text'] for o in out), 'ordinary text without a pending question is not treated as an answer')
        done_again = ClassQuizAttempt.objects.get(id=attempt_id)
        tap(CHAT, f'qa:{attempt_id}:0:0')
        check(ClassQuizAttempt.objects.get(id=attempt_id).percent == done_again.percent, 'tapping an old answer button after submission changes nothing')

        # ---------------------------------------------------------------- expired deadline during a quiz
        a2 = cq.assign_quiz(teacher, quiz, [gid], timezone.now() + timedelta(days=1), max_attempts=2)[0]['id']
        mark()
        tap(CHAT, f'qs:{a2}')
        attempt2 = ClassQuizAttempt.objects.filter(assignment_id=a2, student_id=student.id).first()
        tap(CHAT, find_button(last(CHAT), 'qa:')['callback_data'])
        ClassQuizAttempt.objects.filter(id=attempt2.id).update(deadline_at=timezone.now() - timedelta(seconds=3))
        mark()
        tap(CHAT, f'qa:{attempt2.id}:1:0')
        check('Vaqt tugadi' in ' '.join(o['text'] for o in out), 'an answer after the server deadline is refused with a clear message')
        check(ClassQuizAttempt.objects.get(id=attempt2.id).status == 'submitted' and ClassQuizAttempt.objects.get(id=attempt2.id).auto_submitted, 'the expired attempt was scored automatically from answers saved in time')
        ClassQuizAssignment.objects.filter(id=a2).update(deadline=timezone.now() - timedelta(minutes=1))
        mark()
        tap(CHAT, f'qs:{a2}')
        check(not ClassQuizAttempt.objects.filter(assignment_id=a2, student_id=student.id, status='in_progress').exists(), 'a closed quiz cannot be restarted')

        # ---------------------------------------------------------------- through the real HTTP webhook
        http = APIClient()
        hdr = {'HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN': os.environ['TELEGRAM_WEBHOOK_SECRET']}
        mark()
        upd = {'update_id': next(update_ids), 'callback_query': {'id': 'w1', 'from': {'id': int(CHAT)}, 'message': {'message_id': 5, 'chat': {'id': int(CHAT), 'type': 'private'}}, 'data': f'qr:{attempt_id}:0'}}
        r1 = http.post('/v1/telegram/webhook', upd, format='json', **hdr)
        n1 = len(out)
        r2 = http.post('/v1/telegram/webhook', upd, format='json', **hdr)
        check(r1.status_code == 200 and r2.status_code == 200 and n1 >= 1 and len(out) == n1, 'through the HTTP webhook a quiz tap is processed once even when Telegram retries it')
    print(f'\nALL {len(checks)} CHECKS PASSED')
finally:
    with connection.cursor() as cursor:
        cursor.execute('DELETE FROM "ClassQuizAnswer" WHERE attempt_id IN (SELECT id FROM "ClassQuizAttempt" WHERE student_id = ANY(%s))', [users])
        cursor.execute('DELETE FROM "ClassQuizAttempt" WHERE student_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM "ClassQuizAssignment" WHERE group_id = ANY(%s)', [groups_made])
        cursor.execute('DELETE FROM "ClassQuizQuestion" WHERE quiz_id IN (SELECT id FROM "ClassQuiz" WHERE owner_id = ANY(%s))', [users])
        cursor.execute('DELETE FROM "ClassQuiz" WHERE owner_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM core_telegramdialogstate WHERE user_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM core_telegrampreference WHERE user_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM "StudentProfile" WHERE "userId" = ANY(%s)', [users])
        cursor.execute('DELETE FROM "Group" WHERE id = ANY(%s)', [groups_made])
        cursor.execute('DELETE FROM "User" WHERE id = ANY(%s)', [users])
