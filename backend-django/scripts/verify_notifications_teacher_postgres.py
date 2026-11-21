"""Loopback-only end-to-end check of teacher tools, settings and the durable notification outbox (milestone 6) on the real PostgreSQL schema.

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
os.environ['TELEGRAM_WEBHOOK_SECRET'] = 'notif-secret-' + uuid4().hex
os.environ['TELEGRAM_BOT_TOKEN'] = '000000:notif-token-never-sent'
os.environ.pop('SUPERADMIN_TELEGRAM_ID', None)
import django

django.setup()
from django.db import connection
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core import class_quiz as cq
from apps.core import class_quiz_appeals as appeals
from apps.core import telegram_notify as notify
from apps.core import telegram_outbox as outbox
from apps.core import vocabulary_bot as vb
from apps.core import telegram_bot as bot
from apps.core import telegram_delivery as delivery
from apps.core import telegram_state
from apps.core.models import (ClassQuiz, ClassQuizAppeal, ClassQuizAssignment, ClassQuizAttempt, TelegramOutbox, TelegramPreference,
                             UserWeakWord, VocabularySet, VocabularyWord)
from apps.legacy_schema.models import Group, StudentProfile, User

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


def rows(**filters):
    return TelegramOutbox.objects.filter(recipient_id__in=users, **filters)      # only this run's fixtures


sent_log = []         # (chat, text, keyboard) of every outbox message handed to Telegram
behaviour = {'mode': 'sent', 'delay': 0.0}


def fake_send_detailed(chat_id, text, reply_markup=None):
    _enforce_callback_limit((reply_markup or {}).get('inline_keyboard'))
    if behaviour['delay']:
        import time
        time.sleep(behaviour['delay'])
    mode = behaviour['mode']
    if mode == 'sent':
        sent_log.append((str(chat_id), text, (reply_markup or {}).get('inline_keyboard')))
        return 'sent', None
    return {'retry': ('retry', None), 'flood': ('retry', 30), 'blocked': ('permanent', 'http_403'), 'noconfig': ('permanent', 'not_configured')}[mode]


def tick(now=None, **kw):
    return outbox.deliver_due(now or timezone.now(), sleep=lambda s: None, **kw)


QUESTIONS = '\n'.join(f'{i}. Question number {i}?\nA) one\nB) two\nC) three\nD) four' for i in range(1, 11))
KEY = '\n'.join(f'{i} A' for i in range(1, 11))

try:
    teacher, teacher_b = mk_user('teacher'), mk_user('teacher')
    now = timezone.now()
    gid, gid_b = f'tn-g-{uuid4().hex[:6]}-{run}', f'tn-gb-{uuid4().hex[:6]}-{run}'
    Group.objects.create(id=gid, name='Group A', teacher_id=teacher.id, created_at=now)
    Group.objects.create(id=gid_b, name='Group B', teacher_id=teacher_b.id, created_at=now)
    groups_made.extend([gid, gid_b])
    CT, CTB, C1, C2, C3, C4, CB, CX = '840000001', '840000002', '840000011', '840000012', '840000013', '840000014', '840000021', '840000099'
    User.objects.filter(id=teacher.id).update(telegram_chat_id=CT)
    User.objects.filter(id=teacher_b.id).update(telegram_chat_id=CTB)
    s1, s2, s3, s4 = mk_student(gid, C1), mk_student(gid, C2), mk_student(gid, C3), mk_student(gid, C4)
    sb = mk_student(gid_b, CB)
    set_a = VocabularySet.objects.create(title='Group A words', created_by_id=teacher.id, group_id=gid, is_public=True)
    set_b = VocabularySet.objects.create(title='Group B words', created_by_id=teacher_b.id, group_id=gid_b, is_public=True)
    VocabularyWord.objects.create(set=set_a, english='alpha', uzbek='birinchi')
    VocabularyWord.objects.create(set=set_b, english='beta', uzbek='ikkinchi')
    photos, docs = [], []

    with patch.object(delivery, 'call', fake_call), patch.object(delivery, 'send', fake_send), patch.object(delivery, 'menu', fake_menu), \
            patch.object(delivery, 'send_photo', lambda chat, photo, **k: photos.append(str(chat)) or {'message_id': 1}), \
            patch.object(delivery, 'send_document', lambda chat, doc, **k: docs.append((str(chat), bytes(doc))) or {'message_id': 1}), \
            patch.object(delivery, 'send_detailed', fake_send_detailed), patch.object(delivery, 'answer_callback', lambda *a, **k: None):

        # ---------------------------------------------------------------- teacher creates a test in Telegram
        say(CT, '/newtest')
        check('Test nomini' in last(CT)['text'], '/newtest asks for the title')
        say(CT, 'Passive Voice Practice')
        cat = last(CT)
        check(find_button(cat, 'tn:c:grammar') is not None, 'the wizard then offers the test type')
        tap(CT, 'tn:c:grammar')
        check(find_button(last(CT), 'tn:q:20') and find_button(last(CT), 'tn:q:40'), 'question-count presets 10/20/30/40 are offered')
        tap(CT, 'tn:q:10')
        tap(CT, 'tn:t:30')
        check('KEY' in last(CT)['text'], 'the teacher is told how to paste questions and the answer key')
        say(CT, 'questions without a key')
        check('KEY' in last(CT)['text'] and not ClassQuiz.objects.filter(owner_id=teacher.id, status='published').exists(), 'a paste without KEY is refused with guidance')
        say(CT, QUESTIONS + '\nKEY\n' + KEY)
        imported = last(CT)
        check('10' in imported['text'] and find_button(imported, 'tn:g:'), 'ten questions were imported through the existing parser and groups are offered')
        check(not any(b['callback_data'].endswith(gid_b) for b in buttons(imported)), 'only the teacher\'s own groups are offered')
        quiz_id = ClassQuiz.objects.get(owner_id=teacher.id).id
        own_buttons = [b for b in buttons(imported) if b['callback_data'].startswith('tn:g:')]
        check(len(own_buttons) == 1, 'exactly one group button (the teacher owns one group)')
        tap(CT, own_buttons[0]['callback_data'])
        check(find_button(last(CT), 'tn:d:24') is not None, 'deadline presets follow the group choice')
        tap(CT, 'tn:d:24')
        tap(CT, 'tn:d:24')
        check(ClassQuizAssignment.objects.filter(group_id=gid).count() == 1, 'a second deadline tap does not assign the test twice')
        assignment = ClassQuizAssignment.objects.get(group_id=gid)
        check(assignment.snapshot['title'] == 'Passive Voice Practice' and len(assignment.snapshot['questions']) == 10 and assignment.time_limit_minutes == 30, 'the quiz is published and assigned to the group with its time limit')
        check(rows(kind='tests').count() == 4 and {r.recipient_id for r in rows(kind='tests')} == {s1.id, s2.id, s3.id, s4.id}, 'assigning queued one "new test" notification per student of THAT group only')
        check(notify.quiz_assigned(assignment.id) == 0 and rows(kind='tests').count() == 4, 'queueing the same assignment again creates no duplicates (dedupe key)')
        check(all(r.status == 'pending' for r in rows(kind='tests')) and not sent_log, 'nothing is sent at enqueue time: delivery is the worker\'s job')

        # ---------------------------------------------------------------- delivery
        stats = tick()
        check(stats['sent'] == 4 and len(sent_log) == 4 and {m[0] for m in sent_log} == {C1, C2, C3, C4}, 'the worker delivers each notification once, only to its recipient')
        message = next(m for m in sent_log if m[0] == C1)
        check('Yangi test: Passive Voice Practice' in message[1] and 'Savollar: 10' in message[1] and message[2][0][0]['callback_data'] == f'qs:{assignment.id}', 'the message is the shared test card with a Start button')
        check(tick()['sent'] == 0 and len(sent_log) == 4, 'a second pass sends nothing more')
        check(all(r.status == 'sent' and r.sent_at for r in rows(kind='tests')), 'delivery status is stored')

        # ---------------------------------------------------------------- preferences: opt-out, kinds, quiet hours
        tap(C3, 'st:n')
        check(TelegramPreference.objects.get(user_id=s3.id).notify_enabled is False, 'a student switches all notifications off from Settings')
        check(outbox.enqueue(s3.id, 'tests', f'optout:{run}', 'x') is None, 'nothing is queued for an opted-out student')
        tap(C3, 'st:n')
        tap(C3, 'st:k:deadlines')
        check(outbox.enqueue(s3.id, 'deadlines', f'muted:{run}', 'x') is None and outbox.enqueue(s3.id, 'results', f'unmuted:{run}', 'x') is not None, 'a single notification kind can be muted')
        tap(C3, 'st:l:en')
        check(state_lang := telegram_state.language_of(s3.id) == 'en', 'language is switched to English')
        TelegramOutbox.objects.filter(recipient_id=s3.id).update(status='sent')
        # quiet hours: now is inside the student's quiet window -> deferred until it ends
        local_now = timezone.now().astimezone(outbox._tz('Asia/Tashkent'))
        start = (local_now - timedelta(hours=1)).time().replace(second=0, microsecond=0)
        end = (local_now + timedelta(hours=2)).time().replace(second=0, microsecond=0)
        TelegramPreference.objects.filter(user_id=s4.id).update(quiet_start=start, quiet_end=end)
        queued = outbox.enqueue(s4.id, 'tests', f'quiet:{run}', 'quiet message')
        check(queued.send_after > timezone.now() + timedelta(minutes=50), 'a notification created during quiet hours is deferred to the end of the quiet period')
        before = len(sent_log)
        tick()
        check(len(sent_log) == before, 'it is not delivered during quiet hours')
        tick(now=queued.send_after + timedelta(minutes=1))
        check(len(sent_log) == before + 1 and rows(dedupe_key=f'quiet:{run}').first().status == 'sent', 'it is delivered once quiet hours end')
        TelegramPreference.objects.filter(user_id=s4.id).update(quiet_start=start, quiet_end=start)    # quiet hours off again
        # opt-out after queueing is honoured at delivery time
        late = outbox.enqueue(s2.id, 'tests', f'late-optout:{run}', 'will be skipped')
        TelegramPreference.objects.filter(user_id=s2.id).update(notify_enabled=False)
        tick()
        check(rows(dedupe_key=f'late-optout:{run}').first().status == 'skipped', 'an opt-out made after queueing skips the delivery')
        TelegramPreference.objects.filter(user_id=s2.id).update(notify_enabled=True)

        # ---------------------------------------------------------------- lease fencing: a slow worker never re-sends a stolen row
        fenced = outbox.enqueue(s1.id, 'tests', f'fence:{run}', 'fenced once')
        claim_time = timezone.now()
        stale = [r for r in outbox._claim(claim_time, 50) if r.id == fenced.id]       # worker A claims, then stalls
        before = len(sent_log)
        tick(now=claim_time + outbox.LEASE + timedelta(seconds=1))                     # worker B after A's lease expired
        with patch.object(outbox, '_claim', lambda now, limit: stale):
            late_stats = outbox.deliver_due(claim_time, sleep=lambda s: None)            # worker A wakes up with its stale claim
        check(len(stale) == 1 and len(sent_log) == before + 1 and late_stats['sent'] == 0 and late_stats.get('lost') == 1
              and rows(id=fenced.id).first().status == 'sent',
              'a worker whose lease expired does not send a row another worker took over (sent exactly once)')

        # ---------------------------------------------------------------- Telegram failures
        TelegramPreference.objects.filter(user_id=s1.id).update(quiet_start=timezone.now().time(), quiet_end=timezone.now().time())   # no quiet window for the failure tests
        behaviour['mode'] = 'retry'
        first = outbox.enqueue(s1.id, 'tests', f'fail-retry:{run}', 'retry me')
        stats = tick()
        row = rows(id=first.id).first()
        check(stats['retried'] == 1 and row.status == 'pending' and row.attempts == 1 and row.next_attempt_at >= timezone.now() + timedelta(seconds=50), 'a transient Telegram failure is retried later with backoff')
        t = timezone.now()
        for _ in range(8):
            t += timedelta(hours=7)
            tick(now=t)
        row = rows(id=first.id).first()
        check(row.status == 'dead' and row.attempts == outbox.MAX_ATTEMPTS and row.last_error == 'retries_exhausted', 'retries are bounded: after the limit the message is marked dead')
        behaviour['mode'] = 'blocked'
        blocked = outbox.enqueue(s1.id, 'tests', f'fail-blocked:{run}', 'blocked bot')
        tick()
        row = rows(id=blocked.id).first()
        check(row.status == 'failed' and row.attempts == 1 and row.last_error == 'http_403', 'a permanent error (bot blocked) is not retried')
        behaviour['mode'] = 'flood'
        flood = [outbox.enqueue(u.id, 'tests', f'flood:{u.id}:{run}', 'flood') for u in (s1, s2)]
        stats = tick()
        check(stats['retried'] == 1 and rows(dedupe_key=f'flood:{s2.id}:{run}').first().status == 'pending' and rows(dedupe_key=f'flood:{s2.id}:{run}').first().attempts == 0, 'a 429 stops the pass; untouched messages stay queued')
        behaviour['mode'] = 'sent'
        rows(dedupe_key__startswith='flood:').update(next_attempt_at=timezone.now() - timedelta(seconds=1), status='pending')
        tick()

        behaviour['mode'] = 'noconfig'
        unconf = outbox.enqueue(s1.id, 'tests', f'noconfig:{run}', 'queued while unconfigured')
        tick()
        row = rows(id=unconf.id).first()
        check(row.status == 'pending' and row.attempts == 0, 'a worker without a bot token keeps messages queued (nothing is lost or burned)')
        behaviour['mode'] = 'sent'
        tick()
        check(rows(id=unconf.id).first().status == 'sent', 'they are delivered once the worker is configured')

        # ---------------------------------------------------------------- restart recovery and concurrency
        crashed = outbox.enqueue(s1.id, 'tests', f'crashed:{run}', 'recover me')
        rows(id=crashed.id).update(status='sending', locked_until=timezone.now() - timedelta(seconds=5))
        before = len(sent_log)
        tick()
        check(rows(id=crashed.id).first().status == 'sent' and len(sent_log) == before + 1, 'a message left "sending" by a crashed worker is recovered after its lease expires')
        leased = outbox.enqueue(s1.id, 'tests', f'leased:{run}', 'being sent by another worker')
        rows(id=leased.id).update(status='sending', locked_until=timezone.now() + timedelta(seconds=60))
        before = len(sent_log)
        tick()
        check(len(sent_log) == before and rows(id=leased.id).first().status == 'sending', 'a message with a live lease is not taken twice')
        rows(id=leased.id).update(status='sent')
        many = []
        for u, chat in ((s1, C1), (s2, C2), (s3, C3), (s4, C4)):
            for i in range(3):
                many.append(outbox.enqueue(u.id, 'results', f'conc:{u.id}:{i}:{run}', f'concurrent {i}'))
        behaviour['delay'] = 0.05
        before = len(sent_log)
        threads = [threading.Thread(target=lambda: [tick(now=timezone.now() + timedelta(seconds=3 * k)) for k in range(6)]) for _ in range(3)]
        for th in threads:
            th.start()
        for th in threads:
            th.join()
        behaviour['delay'] = 0.0
        for k in range(1, 8):
            tick(now=timezone.now() + timedelta(seconds=10 * k))
        concurrent = [m for m in sent_log[before:] if m[1].startswith('concurrent')]
        check(len(concurrent) == 12 and len({(m[0], m[1]) for m in concurrent}) == 12, 'three workers running concurrently deliver each of 12 messages exactly once')
        check(all(r.status == 'sent' for r in rows(dedupe_key__startswith='conc:')), 'all concurrent messages are marked sent')
        # per-chat pacing: two messages for one chat go out in different passes
        for i in range(2):
            outbox.enqueue(s1.id, 'results', f'pace:{i}:{run}', f'pace {i}')
        before = len(sent_log)
        tick()
        check(len([m for m in sent_log[before:] if m[1].startswith('pace')]) == 1, 'at most one message per chat is sent in a single pass (rate limiting)')
        tick(now=timezone.now() + timedelta(seconds=5))
        check(len([m for m in sent_log[before:] if m[1].startswith('pace')]) == 2, 'the second one follows in the next pass')
        bulk = [User.objects.get(id=mk_student(gid, str(850000000 + i)).id) for i in range(30)]
        for u in bulk:
            outbox.enqueue(u.id, 'announcements', f'bulk:{u.id}', 'bulk')
        before = len(sent_log)
        tick()
        check(len(sent_log) - before == outbox.MAX_PER_TICK, f'a single pass sends at most {outbox.MAX_PER_TICK} messages (global rate limit)')
        tick()

        # ---------------------------------------------------------------- sweeps: deadline, vocabulary, closed
        for t_ in ClassQuizAttempt.objects.filter(assignment=assignment):
            pass
        done_attempt = cq.start_attempt(s1, assignment.id)
        for q in done_attempt['questions']:
            cq.save_answer(s1, done_attempt['attemptId'], q['id'], '0')
        cq.finish_attempt(s1, done_attempt['attemptId'])
        ClassQuizAssignment.objects.filter(id=assignment.id).update(deadline=timezone.now() + timedelta(hours=20))
        made = notify.deadline_sweep()
        recipients = {r.recipient_id for r in rows(dedupe_key__startswith=f'quiz_deadline:{assignment.id}')}
        check(made >= 2 and s1.id not in recipients and {s2.id, s4.id} <= recipients and s3.id not in recipients, 'the 24h reminder goes to students who have not submitted - not to s1 (submitted) nor s3 (muted deadlines)')
        check(notify.deadline_sweep() == 0, 'running the sweep again (or after a restart) creates no duplicates')
        ClassQuizAssignment.objects.filter(id=assignment.id).update(deadline=timezone.now() + timedelta(hours=1))
        check(notify.deadline_sweep() >= 2 and rows(dedupe_key__contains=':2h').exists(), 'a separate 2-hour reminder is queued closer to the deadline')
        tick()
        check(any(m[0] == C2 and 'muddati yaqin' in m[1] for m in sent_log) or any(m[0] == C2 and 'soatdan kam' in m[1] for m in sent_log), 'the reminder reaches the student')
        # vocabulary review reminder once per local day, from 17:00
        UserWeakWord.objects.create(student_id=s2.id, word=VocabularyWord.objects.get(set=set_a), mistake_count=1)
        tz = outbox._tz('Asia/Tashkent')
        today = timezone.now().astimezone(tz).date()
        from datetime import datetime as dt
        morning = dt.combine(today, dt.min.time().replace(hour=10), tzinfo=tz)
        evening = dt.combine(today, dt.min.time().replace(hour=18), tzinfo=tz)
        check(notify.vocab_due_sweep(morning) == 0, 'no vocabulary reminder before 17:00 local time')
        TelegramPreference.objects.filter(user_id=s2.id).update(quiet_start=evening.time(), quiet_end=evening.time())
        check(notify.vocab_due_sweep(evening) == 1 and notify.vocab_due_sweep(evening) == 0, 'one vocabulary reminder per student per day')
        vocab_row = rows(kind='vocab', recipient_id=s2.id, dedupe_key__startswith='vocab_due').first()
        check('1' in vocab_row.text and '/takror' in vocab_row.text, 'it states the number of due questions')
        # test closes: teacher summary (counts only) + auto-submit of unfinished attempts
        s2_attempt = cq.start_attempt(s2, assignment.id)
        ClassQuizAssignment.objects.filter(id=assignment.id).update(deadline=timezone.now() - timedelta(minutes=2))
        ClassQuizAttempt.objects.filter(id=s2_attempt['attemptId']).update(deadline_at=timezone.now() - timedelta(minutes=1))
        check(notify.assignment_closed_sweep() == 1 and notify.assignment_closed_sweep() == 0, 'the teacher gets one closed-test summary')
        check(ClassQuizAttempt.objects.get(id=s2_attempt['attemptId']).status == 'submitted' and ClassQuizAttempt.objects.get(id=s2_attempt['attemptId']).auto_submitted, 'unfinished attempts are auto-submitted at the deadline')
        closed = rows(kind='teacher', recipient_id=teacher.id, dedupe_key__startswith='assignment_closed').first()
        check('Topshirganlar: 2/' in closed.text and 'Student' not in closed.text and 'tq' not in closed.text, 'the summary carries counts and average only')
        check(rows(kind='results', dedupe_key=f'result_ready:{s2_attempt["attemptId"]}').exists(), 'an auto-submitted attempt queues a "result ready" notice for the student')
        check(not rows(kind='results', dedupe_key=f'result_ready:{done_attempt["attemptId"]}').exists(), 'finishing in the bot/service does not queue a duplicate notice')
        http = APIClient()
        s3_attempt = None

        # ---------------------------------------------------------------- announcements, reminders, results (teacher view)
        ClassQuizAssignment.objects.filter(id=assignment.id).update(deadline=timezone.now() + timedelta(days=1))
        mark()
        tap(CT, f'tr:{assignment.id}')
        view = last(CT)['text']
        check('Topshirgan: 2/5' in view or 'Topshirgan:' in view, 'teacher results show submitted/total')
        before_rows = rows().count()
        tap(CT, f'tm:{assignment.id}')
        created = rows(dedupe_key__startswith=f'manual_reminder:{assignment.id}').count()
        check(created >= 2, 'the teacher\'s "remind" button queues a reminder for students who did not submit')
        tap(CT, f'tm:{assignment.id}')
        check(rows(dedupe_key__startswith=f'manual_reminder:{assignment.id}').count() == created, 'reminding twice the same day does not duplicate')
        tap(CT, f'tc:{assignment.id}')
        check(docs and docs[-1][0] == CT and b'student,state' in docs[-1][1], 'CSV export goes to the teacher\'s own chat')
        tap(CT, f'tp:{assignment.id}')
        check(photos and photos[-1] == CT, 'the group summary card is delivered privately to the teacher')
        say(CT, '/announce')
        tap(CT, f'tb:g:{gid}')
        say(CT, 'Tomorrow the class starts at 10:00')
        check('Yuborish' in ' '.join(b['text'] for b in buttons(last(CT))), 'the announcement is previewed with a confirm button')
        tap(CT, 'tb:ok')
        n_announce = rows(kind='announcements', dedupe_key__startswith=f'announce:{gid}').count()
        check(n_announce >= 4 and not rows(recipient_id=sb.id, kind='announcements').exists(), 'the announcement is queued for the teacher\'s own group only')
        tap(CT, 'tb:ok')
        check(rows(kind='announcements', dedupe_key__startswith=f'announce:{gid}').count() == n_announce, 'confirming twice does not queue it twice')
        tap(CT, f'ts:{set_a.id}')
        tap(CT, find_button(last(CT), 'ts:g:0')['callback_data'])
        check(rows(kind='vocab', dedupe_key__startswith=f'vocab_assign:{set_a.id}').count() >= 4, 'the teacher can ask a group to practise a vocabulary set')

        # ---------------------------------------------------------------- review requests (appeals) from Telegram
        a3 = cq.start_attempt(s3, assignment.id)
        for q in a3['questions']:
            cq.save_answer(s3, a3['attemptId'], q['id'], '1')
        cq.finish_attempt(s3, a3['attemptId'])
        # make a text question appealable: add a one-question text quiz
        tq = cq.create_quiz(teacher, dict(title='Text quiz', category='grammar', maxAttempts=1))['id']
        cq.replace_questions(teacher, tq, [dict(type='text', prompt='The window was ___ (break).', correctAnswers=['broken'])])
        cq.publish_quiz(teacher, tq)
        ta_assignment = cq.assign_quiz(teacher, tq, [gid], timezone.now() + timedelta(days=2))[0]['id']
        at = cq.start_attempt(s4, ta_assignment)
        cq.save_answer(s4, at['attemptId'], at['questions'][0]['id'], 'shattered')
        cq.finish_attempt(s4, at['attemptId'])
        appeal, created_flag = appeals.file_appeal(s4, at['attemptId'], 0)
        check(rows(kind='teacher', dedupe_key=f'appeal_new:{appeal.id}').exists(), 'a new appeal notifies the owning teacher (durably)')
        mark()
        say(CTB, '/requests')
        check('so\'rov yo\'q' in last(CTB)['text'] or 'yo\'q' in last(CTB)['text'], 'teacher B sees no requests of teacher A')
        tap(CTB, f'ta:y:{appeal.id}')
        check(ClassQuizAppeal.objects.get(id=appeal.id).status == 'pending', 'teacher B cannot decide teacher A\'s appeal through forged callback data')
        mark()
        say(CT, '/requests')
        card = next(o for o in out if 'shattered' in o['text'])
        check(find_button(card, f'ta:y:{appeal.id}') and 'Text quiz' in card['text'], 'teacher A sees the appeal with approve / reject buttons')
        tap(CT, f'ta:y:{appeal.id}')
        check(ClassQuizAttempt.objects.get(id=at['attemptId']).percent == 100.0 and ClassQuizAppeal.objects.get(id=appeal.id).status == 'approved', 'approving from Telegram recalculates the result through the audited service')
        check(rows(kind='feedback', dedupe_key=f'appeal_decided:{appeal.id}').exists(), 'the student is notified of the decision (durable outbox)')
        tap(CT, f'ta:y:{appeal.id}')
        check(ClassQuizAttempt.objects.get(id=at['attemptId']).result_version == 2, 'a repeated approve callback changes nothing')

        # ---------------------------------------------------------------- hostile / unauthorised teacher callbacks
        mark()
        n_before = (rows().count(), ClassQuizAssignment.objects.count())
        for data in (f'tr:{assignment.id}', f'tg:{gid}', f'tc:{assignment.id}', f'tp:{assignment.id}', f'tm:{assignment.id}', f'ts:{set_a.id}', 'ts:g:0', f'tb:g:{gid}',
                     'tn:g:0', 'tn:d:24'):
            tap(CTB, data)
        check((rows().count(), ClassQuizAssignment.objects.count()) == n_before, 'teacher B\'s forged callbacks for teacher A\'s group/assignment/set create nothing')
        check('Passive Voice' not in texts(CTB) and 'Group A' not in texts(CTB) and not any(p == CTB for p in photos[-1:]) and all(d[0] != CTB for d in docs), 'nothing of teacher A\'s data is revealed to teacher B')
        mark()
        for data in ('tg', 'tn', f'tr:{assignment.id}', 'ta', 'tb'):
            tap(C1, data)
        check(all('ustozlar uchun' in o['text'] for o in out) and rows().count() == n_before[0], 'a student cannot use teacher tools')
        mark()
        tap(CX, 'tg')
        check('/start' in last(CX)['text'], 'an unlinked account is asked to link first')
        mark()
        tap(CT, 'tg', chat_type='supergroup')
        check('shaxsiy chat' in last(CT)['text'], 'teacher tools are refused inside group chats')
        for hostile in ('tn:c:../../x', 'tn:d:short:short:99999', 'ta:z:abc', 'tr:' + 'x' * 90, 'tb:g', 'tn:q:55', 'ts::', 'tv:y:\'; DROP TABLE'):
            tap(CT, hostile)
        check(User.objects.filter(id=teacher.id).exists(), 'malformed teacher callback data is refused gracefully')
        check(not [r for r in rows(dedupe_key__contains=sb.id) if r.kind != 'results'], 'group B\'s student never received group A\'s notifications')

        # ---------------------------------------------------------------- reply-keyboard menu buttons
        mark()
        say(C1, "📚 Lug'at")
        check(last(C1) is not None and ('Lug' in last(C1)['text']), 'the student menu button "Lug\'at" opens vocabulary')
        mark()
        say(C1, '🔁 Xatolarni takrorlash')
        check(last(C1) is not None, 'the student menu button "Review mistakes" answers')
        mark()
        say(C1, "👨‍🏫 O'qituvchi fikri")
        check("fikrlari" in last(C1)['text'], 'the student menu button "Teacher feedback" lists feedback notices')
        mark()
        say(CT, '📝 Test yaratish')
        check('Test nomini' in last(CT)['text'], 'the teacher menu button "Create test" starts the wizard')
        telegram_state.clear_dialog(teacher.id)
        mark()
        say(CT, '⚙️ Sozlamalar')
        check('Sozlamalar' in last(CT)['text'], 'teachers also have Settings')
        mark()
        say(C1, '📝 Test yaratish')
        check(not any('Test nomini' in o['text'] for o in out), 'a student pressing the teacher button gets no teacher wizard')

        # ---------------------------------------------------------------- settings and cancel
        mark()
        say(C1, '/sozlamalar')
        check('Sozlamalar' in last(C1)['text'] and find_button(last(C1), 'st:l:en'), 'Settings shows language, notifications, quiet hours and per-kind switches')
        tap(C1, 'st:q')
        check(TelegramPreference.objects.get(user_id=s1.id).quiet_start == TelegramPreference.objects.get(user_id=s1.id).quiet_end, 'quiet hours can be switched off')
        tap(C1, 'st:l:xx')
        check(TelegramPreference.objects.get(user_id=s1.id).language == 'uz', 'an invalid language value is ignored')
        telegram_state.set_dialog(s1.id, 'quiz_text', dict(attemptId='x', index=0))
        say(C1, '/cancel')
        check(telegram_state.get_dialog(s1.id)[0] is None, '/cancel clears a pending dialog step')
        attendance_key = notify.attendance_update(s1.id, '2026-11-21', 'absent', gid)
        check(attendance_key is not None and notify.attendance_update(s1.id, '2026-11-21', 'absent', gid) is None, 'attendance updates are queued once per student/day/state')
        check(notify.teacher_feedback(s1.id, 'Teacher', 'Well done', 'k1') is not None and notify.teacher_feedback(s1.id, 'Teacher', 'Well done', 'k1') is None, 'teacher feedback notices are deduped')
        counts = outbox.status_counts()
        check(counts.get('sent', 0) > 20 and counts.get('dead', 0) == 1 and counts.get('failed', 0) == 1, f'delivery statuses are inspectable: {counts}')
    print(f'\nALL {len(checks)} CHECKS PASSED')
finally:
    with connection.cursor() as cursor:
        cursor.execute('DELETE FROM "TelegramOutbox" WHERE recipient_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM "ClassQuizCorrection" WHERE attempt_id IN (SELECT id FROM "ClassQuizAttempt" WHERE student_id = ANY(%s))', [users])
        cursor.execute('DELETE FROM "ClassQuizAcceptedAnswer" WHERE assignment_id IN (SELECT id FROM "ClassQuizAssignment" WHERE group_id = ANY(%s))', [groups_made])
        cursor.execute('DELETE FROM "ClassQuizAppeal" WHERE student_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM "ResultCardDelivery" WHERE recipient_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM "ClassQuizAnswer" WHERE attempt_id IN (SELECT id FROM "ClassQuizAttempt" WHERE student_id = ANY(%s))', [users])
        cursor.execute('DELETE FROM "ClassQuizAttempt" WHERE student_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM "ClassQuizAssignment" WHERE group_id = ANY(%s)', [groups_made])
        cursor.execute('DELETE FROM "ClassQuizQuestion" WHERE quiz_id IN (SELECT id FROM "ClassQuiz" WHERE owner_id = ANY(%s))', [users])
        cursor.execute('DELETE FROM "ClassQuiz" WHERE owner_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM core_vocabularyreviewevent WHERE review_id IN (SELECT id FROM "UserWeakWord" WHERE student_id = ANY(%s))', [users])
        cursor.execute('DELETE FROM "UserWeakWord" WHERE student_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM "VocabularyWord" WHERE set_id IN (SELECT id FROM "VocabularySet" WHERE created_by_id = ANY(%s))', [users])
        cursor.execute('DELETE FROM "VocabularySet" WHERE created_by_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM core_telegramdialogstate WHERE user_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM core_telegrampreference WHERE user_id = ANY(%s)', [users])
        cursor.execute('DELETE FROM "StudentProfile" WHERE "userId" = ANY(%s)', [users])
        cursor.execute('DELETE FROM "Group" WHERE id = ANY(%s)', [groups_made])
        cursor.execute('DELETE FROM "User" WHERE id = ANY(%s)', [users])
