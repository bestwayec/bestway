"""Loopback-only verification of Telegram bot 2.0 on the real PostgreSQL schema (network delivery is mocked).

Milestone 1: webhook secret + update de-duplication (sequential and concurrent), super-admin identity boundaries,
no auto-provisioning, fail-closed OCR/AI. Later milestones append their checks here. Every fixture row is removed.
"""
import os
import sys
import threading
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
os.environ['TELEGRAM_WEBHOOK_SECRET'] = 'verify-secret-' + uuid4().hex
os.environ['TELEGRAM_BOT_TOKEN'] = '000000:verify-token-never-sent'
os.environ.pop('SUPERADMIN_TELEGRAM_ID', None)
import django

django.setup()
from django.db import connection
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core import telegram_bot as bot
from apps.core import telegram_delivery, telegram_menu
from apps.core.models import TelegramUpdateReceipt
from apps.legacy_schema.models import User

run = uuid4().hex[:8]
checks, created_users = [], []
sent = []


def check(value, message):
    if not value:
        raise AssertionError('FAIL ' + message)
    checks.append(message)
    print('PASS ' + message)


def mk_user(role, chat=None, active=True):
    now = timezone.now()
    uid = f'tg-{role}-{uuid4().hex[:6]}-{run}'
    User.objects.create(id=uid, name=f'tg {role}', phone='+99873' + uuid4().hex[:7], role=role, password_hash='x', is_active=active,
                        telegram_chat_id=chat, created_at=now, updated_at=now)
    created_users.append(uid)
    return uid


def update(uid, chat, text='/help'):
    return {'update_id': uid, 'message': {'chat': {'id': chat}, 'from': {'id': chat, 'first_name': 'T'}, 'text': text}}


def capture():
    sent.clear()
    return patch.multiple(telegram_delivery, send=lambda cid, txt, reply_markup=None: sent.append((str(cid), txt)),
                          menu=lambda cid, txt, kb: sent.append((str(cid), txt)),
                          contact_request=lambda cid, txt: sent.append((str(cid), txt)),
                          call=lambda *a, **k: {})


try:
    base_id = int(uuid4().int % 10**9) + 10**10
    # ---------------------------------------------------------------- webhook secret
    client = APIClient()
    body = update(base_id, 700000001)
    check(client.post('/v1/telegram/webhook', body, format='json').status_code == 403, 'webhook without the secret header is refused (403)')
    check(client.post('/v1/telegram/webhook', body, format='json', HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN='wrong').status_code == 403, 'webhook with a wrong secret is refused (403)')
    good = {'HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN': os.environ['TELEGRAM_WEBHOOK_SECRET']}
    check(not TelegramUpdateReceipt.objects.filter(update_id=base_id).exists(), 'a refused webhook call leaves no receipt (nothing processed)')
    with capture():
        first = client.post('/v1/telegram/webhook', body, format='json', **good)
        n_first = len(sent)
        second = client.post('/v1/telegram/webhook', body, format='json', **good)
        n_second = len(sent)
    check(first.status_code == 200 and second.status_code == 200, 'a valid webhook call and its retry both answer 200')
    check(n_first >= 1 and n_second == n_first, f'a duplicate update_id is processed once ({n_first} message(s), none added by the retry)')
    check(TelegramUpdateReceipt.objects.filter(update_id=base_id).count() == 1, 'exactly one receipt row per update_id')

    # ---------------------------------------------------------------- concurrent duplicates
    from apps.core import telegram_state
    racer = base_id + 1
    results = []
    barrier = threading.Barrier(8)

    def claim():
        django.db.close_old_connections()
        barrier.wait()
        try:
            results.append(telegram_state.claim_update({'update_id': racer, 'message': {}}))
        finally:
            connection.close()
    threads = [threading.Thread(target=claim) for _ in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    check(results.count(True) == 1 and results.count(False) == 7, f'8 simultaneous deliveries of one update: exactly one wins ({results.count(True)} True)')
    check(telegram_state.claim_update({'message': {}}) is True, 'an update without update_id is processed as before')

    # ---------------------------------------------------------------- restart safety (polling re-delivers unconfirmed updates)
    with capture():
        bot.handle(update(base_id + 2, 700000002))
        after_first = len(sent)
        bot.handle(update(base_id + 2, 700000002))  # same update re-delivered after a restart
    check(len(sent) == after_first and after_first >= 1, 'an update re-delivered after a restart is not processed twice')

    # ---------------------------------------------------------------- identity boundaries
    OLD_DEFAULT = '5582178765'
    # A local fixture DB may already have an account legitimately linked to that id: detach it for the "unlinked" cases.
    detached = list(User.objects.filter(telegram_chat_id=OLD_DEFAULT).values_list('id', flat=True))
    User.objects.filter(id__in=detached).update(telegram_chat_id=None)
    before = User.objects.count()
    check(not telegram_menu.is_superadmin(chat_id=OLD_DEFAULT), 'the former built-in id is NOT a super admin when nobody linked it')
    check(telegram_menu.ensure_superadmin_user(OLD_DEFAULT) is None and User.objects.count() == before, 'no account is auto-provisioned for that id')
    with capture():
        bot.handle(update(base_id + 3, int(OLD_DEFAULT), '/superadmin'))
    check(User.objects.count() == before, '/superadmin from an unlinked chat creates nothing')
    check(not any('Superadmin Panel' in text or 'Paneli' in text for _c, text in sent), '/superadmin from an unlinked chat shows no admin panel')

    student = mk_user('student', chat='700000010')
    check(not telegram_menu.is_superadmin(chat_id='700000010'), 'a linked student is not a super admin')
    with capture():
        bot.handle(update(base_id + 4, 700000010, '/superadmin'))
    check(User.objects.get(id=student).role == 'student', 'a student sending admin commands is never promoted')
    old_user = mk_user('student', chat=OLD_DEFAULT)
    check(not telegram_menu.is_superadmin(chat_id=OLD_DEFAULT) and User.objects.get(id=old_user).role == 'student',
          'a student linked to the former built-in id stays a student (no promotion, no elevated access)')

    admin = mk_user('super_admin', chat='700000020')
    check(telegram_menu.is_superadmin(chat_id='700000020') and telegram_menu.ensure_superadmin_user('700000020').id == admin,
          'a validly linked, active super_admin account IS recognised (server-side role)')
    inactive = mk_user('super_admin', chat='700000021', active=False)
    check(not telegram_menu.is_superadmin(chat_id='700000021'), 'a deactivated super_admin is not recognised')
    teacher = mk_user('teacher', chat='700000030')
    with capture(), patch('apps.core.telegram_menu.generate_sso_url') as sso:
        telegram_menu.send_web_admin_login('700000030')
        telegram_menu.send_web_admin_login('700000010')
    check(not sso.called, 'web-admin SSO is never issued to a teacher or a student chat')

    # ---------------------------------------------------------------- linking: private chats only, single use under concurrency
    from types import SimpleNamespace
    from apps.core import telegram_links
    from apps.legacy_schema.models import TelegramLinkToken
    linker = mk_user('student')
    with patch.object(telegram_delivery, 'username', lambda: 'verify_bot'):
        token = telegram_links.create_token(SimpleNamespace(id=linker))['token']
    with capture():
        bot.handle({'update_id': base_id + 5, 'message': {'chat': {'id': -1007000001, 'type': 'supergroup'}, 'from': {'id': 700000040, 'first_name': 'T'},
                                                          'text': f'/start {token}'}})
    check(User.objects.get(id=linker).telegram_chat_id is None and TelegramLinkToken.objects.get(user_id=linker).used_at is None,
          'a link token sent in a GROUP chat links nothing (the group would see the student\'s data) and stays usable')
    racers = [str(700000050 + i) for i in range(6)]
    link_barrier = threading.Barrier(len(racers))

    def link_race(chat):
        django.db.close_old_connections()
        link_barrier.wait()
        try:
            telegram_links.consume(token, chat)
        finally:
            connection.close()
    with capture():
        threads = [threading.Thread(target=link_race, args=(c,)) for c in racers]
        [t.start() for t in threads]
        [t.join() for t in threads]
    linked_chats = list(User.objects.filter(telegram_chat_id__in=racers).values_list('telegram_chat_id', flat=True))
    check(len(linked_chats) == 1 and User.objects.get(id=linker).telegram_chat_id == linked_chats[0],
          f'one link token consumed by {len(racers)} chats at once links exactly one chat ({len(linked_chats)} linked)')
    legacy_group_link = mk_user('student', chat='-1007000002')       # a group chat linked before this rule existed
    with capture():
        bot.handle({'update_id': base_id + 6, 'message': {'chat': {'id': -1007000002, 'type': 'group'}, 'from': {'id': 700000041, 'first_name': 'T'}, 'text': '/tests'}})
    check(sent and all('shaxsiy' in text for _c, text in sent), '/tests in a group chat never lists a student\'s tests there')

    # ---------------------------------------------------------------- fail-closed OCR / AI (no network)
    from apps.core import writing_ocr
    with patch.dict(os.environ, {'OPENROUTER_API_KEY': '', 'XKIRO_API_KEY': '', 'GEMINI_API_KEY': ''}), patch.object(writing_ocr, '_post_json', side_effect=RuntimeError('offline')):
        res = writing_ocr.extract_and_evaluate_images([(b'\x89PNG' + bytes(300), 'image/png')])
    check(res['ocrText'] == '' and res['overall_band'] is None and res['available'] is False, 'OCR + AI offline: no text, no band, available=False')
    print(f'\nALL {len(checks)} CHECKS PASSED')
finally:
    TelegramUpdateReceipt.objects.filter(update_id__gte=base_id - 1, update_id__lte=base_id + 10).delete()
    from apps.legacy_schema.models import TelegramLinkToken as _Tok
    _Tok.objects.filter(user_id__in=created_users).delete()
    User.objects.filter(id__in=created_users).delete()  # fixtures first: one of them held the detached id
    if 'detached' in globals() and detached:
        User.objects.filter(id__in=detached).update(telegram_chat_id='5582178765')
