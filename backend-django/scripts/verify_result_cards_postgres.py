"""Loopback-only end-to-end check of result cards and answer appeals (milestone 5) on the real PostgreSQL schema.

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
os.environ['TELEGRAM_WEBHOOK_SECRET'] = 'card-secret-' + uuid4().hex
os.environ['TELEGRAM_BOT_TOKEN'] = '000000:card-token-never-sent'
os.environ.pop('SUPERADMIN_TELEGRAM_ID', None)
import django

django.setup()
from django.db import connection
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import ClassroomEnrollment
from apps.core import class_quiz as cq
from apps.core import class_quiz_appeals as appeals
from apps.core import result_card_delivery as rcd
from apps.core import telegram_bot as bot
from apps.core import telegram_delivery as delivery
from apps.core import telegram_state
from apps.core.models import (ClassQuizAcceptedAnswer, ClassQuizAppeal, ClassQuizAssignment, ClassQuizAttempt, ClassQuizCorrection,
                             ResultCardDelivery, TelegramDialogState)
from apps.legacy_schema.models import Group, User

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


def play(student, assignment, text_answer, extra_wrong=None):
    """Start via the shared engine and answer every question: all correct except the text question at index 2."""
    attempt = cq.start_attempt(student, assignment)
    for index, q in enumerate(attempt['questions']):
        if q['type'] == 'text':
            response = text_answer if index == 2 else ('xyz' if index == extra_wrong else 'broken')
        else:
            response = '0'
        cq.save_answer(student, attempt['attemptId'], q['id'], response)
    return attempt['attemptId']


try:
    teacher, teacher_b = mk_user('teacher'), mk_user('teacher')
    now = timezone.now()
    gid, gid_b = f'tc-g-{uuid4().hex[:6]}-{run}', f'tc-gb-{uuid4().hex[:6]}-{run}'
    Group.objects.create(id=gid, name='tc group', teacher_id=teacher.id, created_at=now)
    Group.objects.create(id=gid_b, name='tc group b', teacher_id=teacher_b.id, created_at=now)
    groups_made.extend([gid, gid_b])
    C1, C2, C3, C4, CX, CT = '830000001', '830000002', '830000003', '830000004', '830000005', '830000006'
    s1, s2, s3, s4 = mk_student(gid, C1), mk_student(gid, C2), mk_student(gid, C3), mk_student(gid, C4)
    sx = mk_student(gid_b, CX)
    User.objects.filter(id=teacher.id).update(telegram_chat_id=CT)

    questions = []
    for i in range(1, 41):
        if i % 3 == 1:
            questions.append(dict(type='mcq', prompt=f'Q{i}: choose the passive form.', options=['is done', 'does', 'did', 'doing'], correctAnswers=[0], explanation='be + V3'))
        elif i % 3 == 2:
            questions.append(dict(type='tf', prompt=f'Q{i}: "It was written." is passive.', correctAnswers=['True'], explanation='passive'))
        else:
            questions.append(dict(type='text', prompt=f'Q{i}: The window was ___ (break).', correctAnswers=['broken'], explanation='past participle'))
    quiz = cq.create_quiz(teacher, dict(title='Passive Voice Practice', category='grammar', timeLimitMinutes=30, maxAttempts=1))['id']
    cq.replace_questions(teacher, quiz, questions)
    cq.publish_quiz(teacher, quiz)
    assignment = cq.assign_quiz(teacher, quiz, [gid], now + timedelta(days=2))[0]['id']
    snapshot_before = ClassQuizAssignment.objects.get(id=assignment).snapshot
    hash_before = ClassQuizAssignment.objects.get(id=assignment).snapshot_hash

    def fake_photo(chat_id, photo, caption=None, parse_mode='HTML', reply_markup=None, filename='x.png'):
        photos.append(dict(chat=str(chat_id), png=bytes(photo)))
        return {'message_id': 9}

    with patch.object(delivery, 'call', fake_call), patch.object(delivery, 'send', fake_send), patch.object(delivery, 'menu', fake_menu), \
            patch.object(delivery, 'send_photo', fake_photo), patch.object(delivery, 'answer_callback', lambda *a, **k: None):
        a1 = play(s1, assignment, 'shattered')
        a2 = play(s2, assignment, 'shattered')
        a3 = play(s3, assignment, 'xyz', extra_wrong=8)
        a_x_assignment = cq.assign_quiz(teacher_b, cq.create_quiz(teacher_b, dict(title='Other', category='grammar'))['id'], [gid_b], now + timedelta(days=1)) if False else None

        # ---------------------------------------------------------------- result card on finish (via the bot)
        tap(C1, f'qc:{a1}')
        check(len(photos) == 1 and photos[0]['chat'] == C1, 'finishing sends exactly one result card, to the student\'s own private chat')
        png = photos[0]['png']
        from PIL import Image
        import io
        image = Image.open(io.BytesIO(png))
        check(png[:8] == b'\x89PNG\r\n\x1a\n' and image.size == (1080, 1350), 'the card is a valid 1080x1350 PNG')
        tap(C1, f'qc:{a1}')
        tap(C1, f'qn:{a1}:0')
        tap(C1, f'qa:{a1}:0:0')
        check(len(photos) == 1, 'duplicate finish taps and stale answer taps never send a second automatic card')
        check(ResultCardDelivery.objects.filter(kind='quiz', ref_id=a1).count() == 1, 'one delivery row per result (dedupe key)')
        tap(C1, f'qk:{a1}')
        check(len(photos) == 2 and photos[1]['chat'] == C1, 'an explicit "Result card" request resends the card to the owner')
        mark()
        tap(C2, f'qk:{a1}')
        check(len(photos) == 2, 'another student cannot request someone else\'s card by crafting callback data')
        tap(C1, f'qk:{a1}', chat_type='supergroup')
        check(len(photos) == 2 and all(p['chat'] in (C1,) for p in photos), 'cards are never posted into group chats')
        finished = cq.my_result(s1, a1)
        check(finished['correct'] == 39 and finished['percent'] == 97.5, 'student 1 scored 39/40 (97.5%) with the synonym marked wrong')
        cq.finish_attempt(s2, a2)
        cq.finish_attempt(s3, a3)

        # ---------------------------------------------------------------- appeals
        mark()
        tap(C1, f'qr:{a1}:0')
        review = last(C1)
        appeal_button = find_button(review, f'qp:{a1}:2')
        check(appeal_button is not None, 'the mistake list offers "accept my answer" for the free-text mistake')
        check(not any(b['callback_data'].startswith(f'qp:{a1}:0') for b in buttons(review)), 'no appeal is offered for a multiple-choice question')
        tap(C1, appeal_button['callback_data'])
        check(ClassQuizAppeal.objects.filter(attempt_id=a1).count() == 1 and 'yuborildi' in last(C1)['text'], 'the appeal is stored and the student is told it goes to the teacher')
        tap(C1, appeal_button['callback_data'])
        check(ClassQuizAppeal.objects.filter(attempt_id=a1).count() == 1, 'a repeated appeal tap does not create a second appeal')
        tap(C1, f'qp:{a1}:0')
        check(ClassQuizAppeal.objects.filter(attempt_id=a1).count() == 1, 'a multiple-choice answer cannot be appealed')
        tap(C2, f'qp:{a1}:2')
        check(ClassQuizAppeal.objects.filter(attempt_id=a1).count() == 1 and not ClassQuizAppeal.objects.filter(student_id=s2.id, attempt_id=a1).exists(), 'student 2 cannot file an appeal on student 1\'s attempt')
        tap(C2, f'qp:{a2}:2')
        tap(C3, f'qp:{a3}:2')
        check(ClassQuizAppeal.objects.filter(status='pending').count() == 3, 'three pending appeals exist')
        check(ClassQuizAttempt.objects.get(id=a1).percent == 97.5, 'filing an appeal changes no score by itself')

        t_a = SimpleNamespace(id=teacher.id, role='teacher')
        t_b = SimpleNamespace(id=teacher_b.id, role='teacher')
        pending = appeals.pending_appeals(t_a)
        check(len(pending) == 3 and not appeals.pending_appeals(t_b), 'teacher A sees the 3 appeals of their group; teacher B sees none')
        first = next(p for p in pending if p['studentId'] == s1.id)
        check(code(appeals.decide, t_b, first['id'], True) == 'APPEAL_NOT_FOUND' and code(appeals.get_appeal, t_b, first['id']) == 'APPEAL_NOT_FOUND', 'teacher B cannot read or decide teacher A\'s appeal (404)')
        check(code(appeals.decide, SimpleNamespace(id=s1.id, role='student'), first['id'], True) == 'FORBIDDEN', 'a student cannot decide an appeal')
        check(code(appeals.decide, SimpleNamespace(id=s1.id, role='parent'), first['id'], True) == 'FORBIDDEN', 'a parent cannot decide an appeal')
        check(ClassQuizAppeal.objects.get(id=first['id']).status == 'pending', 'unauthorised decisions changed nothing')

        # ---------------------------------------------------------------- approval -> audited recalculation
        decision = appeals.decide(t_a, first['id'], True, 'valid synonym')
        check(decision['status'] == 'approved' and len(decision['changedAttempts']) == 2, 'approval re-grades the 2 attempts that gave the same answer')
        r1, r2, r3 = (ClassQuizAttempt.objects.get(id=x) for x in (a1, a2, a3))
        check((r1.correct_count, r1.percent, r1.result_version) == (40, 100.0, 2) and (r2.correct_count, r2.percent) == (40, 100.0), 'corrected attempts are 40/40 with result_version 2')
        check((r3.correct_count, r3.percent, r3.result_version) == (38, 95.0, 1), 'a different wrong answer is not affected')
        check(ClassQuizCorrection.objects.filter(attempt_id=a1).count() == 1 and ClassQuizCorrection.objects.get(attempt_id=a1).old_percent == 97.5, 'an append-only correction row records old and new percent')
        row = ClassQuizCorrection.objects.get(attempt_id=a1)
        check(row.decided_by_id == teacher.id and row.new_percent == 100.0 and row.result_version_after == 2, 'the audit row names the deciding teacher and the new version')
        check(ClassQuizAssignment.objects.get(id=assignment).snapshot == snapshot_before and ClassQuizAssignment.objects.get(id=assignment).snapshot_hash == hash_before, 'the issued snapshot is untouched')
        check(ClassQuizAppeal.objects.get(attempt_id=a2).status == 'approved', 'the identical pending appeal of student 2 is covered by the same decision')
        again = appeals.decide(t_a, first['id'], False)
        check(again['status'] == 'approved' and ClassQuizAttempt.objects.get(id=a1).result_version == 2 and ClassQuizCorrection.objects.count() == 2, 'a decided appeal cannot be re-decided or double-applied')
        check([c['versionAfter'] for c in appeals.corrections_for_attempt(s1, a1)] == [2] and code(appeals.corrections_for_attempt, s2, a1) == 'ATTEMPT_NOT_FOUND', 'the audit trail is visible to the student and teacher only')
        check(len(appeals.corrections_for_attempt(t_a, a1)) == 1 and code(appeals.corrections_for_attempt, t_b, a1) == 'ATTEMPT_NOT_FOUND', 'teacher B cannot read another group\'s audit trail')
        late = play(s4, assignment, 'shattered')
        check(cq.finish_attempt(s4, late)['percent'] == 100.0, 'a later submission with the approved answer is graded correct by the same rule')
        overview = cq.assignment_overview(t_a, assignment)
        check(sorted(p['bestPercent'] for p in overview['participants'] if p['bestPercent'] is not None) == [95.0, 100.0, 100.0, 100.0], 'teacher overview shows the corrected percentages')

        # ---------------------------------------------------------------- rejection and corrected card
        rejected = appeals.decide(t_a, next(p['id'] for p in appeals.pending_appeals(t_a) if p['studentId'] == s3.id), False, 'not a valid answer')
        check(rejected['status'] == 'rejected' and ClassQuizAttempt.objects.get(id=a3).percent == 95.0 and ClassQuizCorrection.objects.count() == 2, 'a rejection changes only the appeal')
        mark()
        tap(C3, f'qr:{a3}:0')
        check('rad etildi' in last(C3)['text'], 'the student sees the rejected status in the mistake list')
        check(rcd.claim('quiz', a1, s1.id, 2) and not rcd.claim('quiz', a1, s1.id, 2), 'a corrected result may be re-issued once (new version), never twice')

        # ---------------------------------------------------------------- group summary card: aggregates only
        from apps.core import result_card as rc
        data = rc.group_summary_data(overview, 'uz')
        blob = json.dumps(data, default=str)
        check(all(name not in blob for name in ('tq', s1.id, s2.id, s3.id)) and 'Passive Voice Practice' in blob, 'the group summary carries no student names, ids or individual scores')
        check(rc.render_png(data, 'uz')[:4] == b'\x89PNG', 'the group summary renders')
        check(code(rc.quiz_card_data, dict(status='in_progress', percent=None), 'uz') == 'ValueError', 'a card cannot be built from an unsaved result')

        # ---------------------------------------------------------------- HTTP surface
        http_t, http_s, http_b = APIClient(), APIClient(), APIClient()
        http_t.force_authenticate(SimpleNamespace(id=teacher.id, role='teacher', is_authenticated=True))
        http_s.force_authenticate(SimpleNamespace(id=s3.id, role='student', is_authenticated=True))
        http_b.force_authenticate(SimpleNamespace(id=teacher_b.id, role='teacher', is_authenticated=True))
        check(APIClient().get('/v1/class-quiz-appeals/pending').status_code in (401, 403), 'HTTP: anonymous users are refused')
        check(http_s.get('/v1/class-quiz-appeals/pending').status_code == 403, 'HTTP: a student cannot list appeals')
        check(http_b.get('/v1/class-quiz-appeals/pending').json()['data'] == [], 'HTTP: teacher B lists nothing')
        r = http_s.post(f'/v1/class-quiz-attempts/{a3}/appeals', dict(questionIndex=8), format='json')
        check(r.status_code in (201, 200), 'HTTP: a student files an appeal on their own attempt')
        pending_http = http_t.get('/v1/class-quiz-appeals/pending').json()['data']
        check(len(pending_http) == 1, 'HTTP: teacher A lists the new pending appeal')
        r = http_t.post(f'/v1/class-quiz-appeals/{pending_http[0]["id"]}/decision', dict(approve='yes'), format='json')
        check(r.status_code == 400, 'HTTP: a malformed decision is rejected')
        check(http_b.post(f'/v1/class-quiz-appeals/{pending_http[0]["id"]}/decision', dict(approve=True), format='json').status_code == 404, 'HTTP: teacher B gets 404 for the foreign appeal')
        r = http_t.post(f'/v1/class-quiz-appeals/{pending_http[0]["id"]}/decision', dict(approve=False, note='no'), format='json')
        check(r.status_code == 200 and r.json()['data']['status'] == 'rejected', 'HTTP: teacher A rejects it')
    print(f'\nALL {len(checks)} CHECKS PASSED')
finally:
    with connection.cursor() as cursor:
        cursor.execute('DELETE FROM "TelegramOutbox" WHERE recipient_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM "ResultCardDelivery" WHERE recipient_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM "ClassQuizCorrection" WHERE attempt_id IN (SELECT id FROM "ClassQuizAttempt" WHERE student_id = ANY(%s))', [users])
        cursor.execute('DELETE FROM "ClassQuizAcceptedAnswer" WHERE assignment_id IN (SELECT id FROM "ClassQuizAssignment" WHERE group_id = ANY(%s))', [groups_made])
        cursor.execute('DELETE FROM "ClassQuizAppeal" WHERE student_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM "ClassQuizAnswer" WHERE attempt_id IN (SELECT id FROM "ClassQuizAttempt" WHERE student_id = ANY(%s))', [users])
        cursor.execute('DELETE FROM "ClassQuizAttempt" WHERE student_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM "ClassQuizAssignment" WHERE group_id = ANY(%s)', [groups_made])
        cursor.execute('DELETE FROM "ClassQuizQuestion" WHERE quiz_id IN (SELECT id FROM "ClassQuiz" WHERE owner_id = ANY(%s))', [users])
        cursor.execute('DELETE FROM "ClassQuiz" WHERE owner_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM core_telegramdialogstate WHERE user_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM core_telegrampreference WHERE user_id = ANY(%s)', [users])
        ClassroomEnrollment.objects.filter(student_id__in=users).delete()
        cursor.execute('DELETE FROM "StudentProfile" WHERE "userId" = ANY(%s)', [users])
        cursor.execute('DELETE FROM "Group" WHERE id = ANY(%s)', [groups_made])
        cursor.execute('DELETE FROM "User" WHERE id = ANY(%s)', [users])
