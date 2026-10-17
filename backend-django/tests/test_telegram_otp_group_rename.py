from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.core.cache import cache
from django.test import SimpleTestCase
from rest_framework.test import APIClient

from apps.core import telegram_menu, telegram_views, groups


class TelegramOtpAndGroupRenameTests(SimpleTestCase):

    def setUp(self):
        self.client = APIClient()
        cache.clear()

    def test_send_otp_code_caches_6_digit_and_sends_telegram(self):
        with patch.object(telegram_menu.api, 'send') as mock_send:
            telegram_menu.send_otp_code(
                12345678,
                from_user={'id': 12345678, 'first_name': 'Jasur', 'last_name': 'Aliyev', 'username': 'jasur'}
            )
            mock_send.assert_called_once()
            args, _ = mock_send.call_args
            chat_id, text = args
            self.assertEqual(chat_id, 12345678)
            self.assertIn("Sizning kirish kodingiz:", text)
            self.assertIn("5 daqiqa davomida amal qiladi", text)

    def test_telegram_otp_verify_invalid_code_formats(self):
        response = self.client.post('/v1/auth/telegram-otp/verify', {'code': '123'}, format='json')
        self.assertEqual(response.status_code, 400)

        response = self.client.post('/v1/auth/telegram-otp/verify', {'code': 'abcdef'}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_telegram_otp_verify_nonexistent_or_expired(self):
        response = self.client.post('/v1/auth/telegram-otp/verify', {'code': '999999'}, format='json')
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.data['error']['code'], 'INVALID_CREDENTIALS')

    def test_telegram_otp_verify_existing_user_success(self):
        cache.set('telegram_otp:654321', {
            'telegram_id': 99112233,
            'first_name': 'Dilshod',
            'last_name': 'Toshmatov',
            'username': 'dilshod_t',
        }, timeout=300)

        now = datetime.now(timezone.utc)
        mock_user = ('u1', 'Dilshod Toshmatov', '+998901234567', 'student', now, 'hash', True, '99112233')

        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = mock_user

        mock_conn = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor

        with patch('apps.core.telegram_views.connection', mock_conn), \
             patch('apps.core.auth_service.issue_tokens', return_value={'accessToken': 'at_test', 'refreshToken': 'rt_test'}):
            response = self.client.post('/v1/auth/telegram-otp/verify/', {'code': '654321'}, format='json')
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.data['success'])
            data = response.data['data']
            self.assertEqual(data['accessToken'], 'at_test')
            self.assertEqual(data['refreshToken'], 'rt_test')
            self.assertEqual(data['user']['name'], 'Dilshod Toshmatov')

            # Single-use check: code should be deleted from cache
            self.assertIsNone(cache.get('telegram_otp:654321'))

    def test_teacher_can_rename_own_group_via_groups_and_assessment_endpoints(self):
        teacher = SimpleNamespace(id='teacher-1', role='teacher', is_authenticated=True)
        self.client.force_authenticate(teacher)

        group_obj = SimpleNamespace(
            id='group-1',
            name='IELTS 8.0 Morning',
            teacher_id='teacher-1',
            schedule=[],
            created_at=None,
        )

        with patch('apps.core.groups.get_group', return_value=group_obj), \
             patch('apps.core.groups.update', return_value={'id': 'group-1', 'name': 'IELTS 8.5 Masterclass'}) as mock_update:
            # 1. PATCH via /v1/assessment/groups/<id>/
            patch_res = self.client.patch(
                f'/v1/assessment/groups/{group_obj.id}/',
                {'name': 'IELTS 8.5 Masterclass'},
                format='json'
            )
            self.assertEqual(patch_res.status_code, 200)
            mock_update.assert_called_with(teacher, 'group-1', {'name': 'IELTS 8.5 Masterclass'})

            # 2. PATCH via /v1/groups/<id>
            patch_res2 = self.client.patch(
                f'/v1/groups/{group_obj.id}',
                {'name': 'IELTS 8.5 Masterclass'},
                format='json'
            )
            self.assertEqual(patch_res2.status_code, 200)

    def test_teacher_cannot_rename_other_teachers_group(self):
        teacher1 = SimpleNamespace(id='teacher-1', role='teacher', is_authenticated=True)
        group_other = SimpleNamespace(id='group-other', name='Group Other', teacher_id='teacher-2')

        self.client.force_authenticate(teacher1)
        with patch('apps.core.groups.get_group', return_value=group_other):
            res = self.client.patch(f'/v1/assessment/groups/{group_other.id}', {'name': 'Hacked Name'}, format='json')
            self.assertEqual(res.status_code, 403)
            self.assertEqual(res.data['error']['code'], 'FORBIDDEN')

    def test_group_export_returns_csv_attachment(self):
        teacher = SimpleNamespace(id='teacher-exp', role='teacher', is_authenticated=True)
        group = SimpleNamespace(id='group-exp', name='Group Alpha', teacher_id='teacher-exp')

        self.client.force_authenticate(teacher)
        with patch('apps.core.groups.get_group', return_value=group), \
             patch('apps.core.statistics.group_results_csv', return_value='Ism;Telefon\nAli;+998901234567'):
            res = self.client.get(f'/v1/assessment/groups/{group.id}/export')
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res['Content-Type'], 'text/csv; charset=utf-8')
            self.assertIn('attachment;', res['Content-Disposition'])
            self.assertIn('guruh-Group_Alpha-natijalar.csv', res['Content-Disposition'])
