"""Regression tests for the Telegram one-click link, OTP and safe login errors.

Identities, codes and tokens here are synthetic; third-party calls are mocked.
"""
import os
import threading
from contextlib import nullcontext
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.core.cache import cache
from django.db import OperationalError
from django.test import SimpleTestCase
from rest_framework.test import APIClient

from apps.core import telegram_menu, telegram_sso, telegram_views

NOW = datetime(2026, 1, 1, tzinfo=UTC)
USER_ROW = ('user-1', 'Test Student', '+998900000001', 'student', NOW, 'hash', True, '700001', None)


def _db(row=USER_ROW):
    cursor = MagicMock()
    cursor.fetchone.return_value = row
    conn = MagicMock()
    conn.vendor = 'postgresql'
    conn.cursor.return_value.__enter__.return_value = cursor
    return conn, cursor


class TelegramSsoTokenTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def _post(self, body):
        conn, cursor = _db()
        with patch('apps.core.telegram_views.connection', conn), \
             patch('apps.core.telegram_views.transaction.atomic', return_value=nullcontext()), \
             patch('apps.core.auth_service.issue_tokens', return_value={'accessToken': 'at', 'refreshToken': 'rt'}):
            return self.client.post('/v1/auth/telegram-login', body, format='json'), cursor

    def test_link_signs_in_once_and_replay_is_rejected(self):
        token = telegram_sso.issue_sso_token(700001, 'Test')
        first, cursor = self._post({'sso_token': token})
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.data['data']['user']['id'], 'user-1')
        # lookup is by Telegram id only, never by name
        lookups = [c.args for c in cursor.execute.call_args_list if 'telegramChatId"=%s' in c.args[0]]
        self.assertEqual(lookups[0][1], ['700001'])
        replay, _ = self._post({'sso_token': token})
        self.assertEqual(replay.status_code, 401)
        self.assertEqual(replay.data['error']['code'], 'INVALID_TOKEN')

    def test_forged_and_expired_tokens_are_rejected(self):
        self.assertEqual(self._post({'sso_token': 'forged-token'})[0].status_code, 401)
        token = telegram_sso.issue_sso_token(700001)
        cache.delete(telegram_sso.SSO_PREFIX + telegram_sso._digest(token))  # simulate TTL expiry
        self.assertEqual(self._post({'sso_token': token})[0].status_code, 401)

    def test_raw_cache_keys_and_hashes_cannot_be_used_as_tokens(self):
        token = telegram_sso.issue_sso_token(700001)
        digest = telegram_sso._digest(token)
        self.assertEqual(self._post({'sso_token': digest})[0].status_code, 401)
        self.assertEqual(self._post({'sso_token': telegram_sso.SSO_PREFIX + digest})[0].status_code, 401)
        cache.set('some-user-id-key', 'user-1')
        self.assertEqual(self._post({'sso_token': 'some-user-id-key'})[0].status_code, 401)

    def test_concurrent_reuse_signs_in_only_once(self):
        token = telegram_sso.issue_sso_token(700001)
        results = []
        barrier = threading.Barrier(8)

        def worker():
            barrier.wait()
            results.append(telegram_sso.consume_sso_token(token))

        threads = [threading.Thread(target=worker) for _ in range(8)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        self.assertEqual(sum(1 for r in results if r), 1)

    def test_bot_link_contains_only_an_opaque_token(self):
        with patch.dict(os.environ, {'FRONTEND_URL': 'https://example.test'}):
            url = telegram_menu.generate_sso_url(700001, SimpleNamespace(name='Test'))
        self.assertTrue(url.startswith('https://example.test/login?sso_token='))
        self.assertNotIn('700001', url)
        token = url.split('sso_token=')[1]
        self.assertEqual(telegram_sso.consume_sso_token(token)['telegram_id'], '700001')

    def test_browser_get_redirects_to_web_login_without_tokens(self):
        response = self.client.get('/v1/auth/telegram-login', {'sso_token': 'abc', 'evil': 'x'})
        self.assertEqual(response.status_code, 302)
        self.assertTrue(response['Location'].endswith('/login?sso_token=abc'))
        self.assertNotIn('token=at', response['Location'])

    def test_database_outage_returns_safe_503_without_internal_details(self):
        token = telegram_sso.issue_sso_token(700001)
        leak = 'connection to server at "10.0.0.5", port 5432 failed: FATAL: sorry, too many clients already'
        with patch('apps.core.telegram_views.login_or_register', side_effect=OperationalError(leak)):
            response = self.client.post('/v1/auth/telegram-login', {'sso_token': token}, format='json')
        self.assertEqual(response.status_code, 503)
        body = str(response.data)
        self.assertNotIn('10.0.0.5', body)
        self.assertNotIn('FATAL', body)
        self.assertEqual(response.data['error']['code'], 'SERVICE_UNAVAILABLE')

    def test_unexpected_error_does_not_echo_exception_text(self):
        token = telegram_sso.issue_sso_token(700001)
        with patch('apps.core.telegram_views.login_or_register', side_effect=RuntimeError('secret internals')):
            response = self.client.post('/v1/auth/telegram-login', {'sso_token': token}, format='json')
        self.assertEqual(response.status_code, 500)
        self.assertNotIn('secret internals', str(response.data))

    def test_deactivated_account_is_refused(self):
        conn, _ = _db(USER_ROW[:6] + (False,) + USER_ROW[7:])
        token = telegram_sso.issue_sso_token(700001)
        with patch('apps.core.telegram_views.connection', conn), \
             patch('apps.core.telegram_views.transaction.atomic', return_value=nullcontext()):
            response = self.client.post('/v1/auth/telegram-login', {'sso_token': token}, format='json')
        self.assertEqual(response.status_code, 403)


class TelegramOtpTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    def test_codes_are_unique_while_live(self):
        with patch('apps.core.telegram_sso.secrets.randbelow', side_effect=[1, 1, 2]):
            first = telegram_sso.issue_otp(1)
            second = telegram_sso.issue_otp(2)
        self.assertNotEqual(first, second)
        self.assertEqual(cache.get(f'telegram_otp:{first}')['telegram_id'], '1')

    def test_otp_single_use_and_isolated_per_account(self):
        code = telegram_sso.issue_otp(111)
        self.assertEqual(telegram_sso.consume_otp(code)['telegram_id'], '111')
        self.assertIsNone(telegram_sso.consume_otp(code))

    def test_otp_concurrent_reuse_only_once(self):
        code = telegram_sso.issue_otp(111)
        results = []
        barrier = threading.Barrier(6)

        def worker():
            barrier.wait()
            results.append(telegram_sso.consume_otp(code))

        threads = [threading.Thread(target=worker) for _ in range(6)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        self.assertEqual(sum(1 for r in results if r), 1)

    def test_otp_verify_is_throttled(self):
        from common.auth.throttling import SensitiveAuthThrottle
        self.assertIn(SensitiveAuthThrottle, telegram_views.telegram_otp_verify_view.cls.throttle_classes)
        self.assertIn(SensitiveAuthThrottle, telegram_views.telegram_login_view.cls.throttle_classes)


class BackgroundThreadConnectionTests(SimpleTestCase):
    def test_background_thread_closes_its_connections(self):
        from common import background
        with patch.object(background.connections, 'close_all') as close_all:
            background.start_thread(lambda: None).join()
            background.start_thread(lambda: 1 / 0).join()
        self.assertEqual(close_all.call_count, 2)


class DatabaseUnavailableHandlerTests(SimpleTestCase):
    def test_operational_error_becomes_safe_503(self):
        from common.api.exceptions import exception_handler
        response = exception_handler(OperationalError('connection to server at "10.1.2.3" failed: FATAL: sorry, too many clients already'), {})
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('10.1.2.3', str(response.data))
        self.assertEqual(response['Retry-After'], '5')
