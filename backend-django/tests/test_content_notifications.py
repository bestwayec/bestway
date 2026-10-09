from types import SimpleNamespace
from unittest.mock import patch
from django.test import SimpleTestCase
from rest_framework.test import APIClient
from apps.core import articles, notifications, telegram_delivery
from common.api.exceptions import ContractAPIException


class ContentNotificationTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()

    def test_student_cannot_mutate_articles_or_broadcast(self):
        self.client.force_authenticate(SimpleNamespace(id='student', role='student', is_authenticated=True))
        for method, path in [('post', '/v1/articles'), ('patch', '/v1/articles/id'),
                             ('delete', '/v1/articles/id'), ('post', '/v1/notifications/broadcast')]:
            with self.subTest(path=path, method=method):
                self.assertEqual(getattr(self.client, method)(path, {}, format='json').status_code, 403)

    def test_article_tags_validation_matches_reference_order(self):
        self.client.force_authenticate(SimpleNamespace(id='admin', role='admin', is_authenticated=True))
        for value, message in [('wrong', 'tags must be an array'),
                               ([1], 'each value in tags must be a string')]:
            with self.subTest(value=value):
                response = self.client.patch('/v1/articles/id', {'tags': value}, format='json')
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.data['error']['message'], message)

    def test_failed_nullable_article_update_has_no_audit(self):
        with patch.object(articles, 'get', return_value=SimpleNamespace(title='Original')), \
             patch.object(articles, 'audit') as audit:
            with self.assertRaises(ContractAPIException) as raised:
                articles.update.__wrapped__(SimpleNamespace(id='admin'), 'id', {'tags': None})
            self.assertEqual(raised.exception.status_code, 500)
            audit.assert_not_called()

    def test_notification_read_is_owner_scoped(self):
        with patch.object(notifications.Notification.objects, 'select_for_update') as query:
            query.return_value.filter.return_value.first.return_value = None
            with self.assertRaises(ContractAPIException) as raised:
                notifications.mark_read.__wrapped__(SimpleNamespace(id='owner'), 'foreign')
            query.return_value.filter.assert_called_once_with(id='foreign', user_id='owner')
            self.assertEqual(raised.exception.contract_code, 'NOTIFICATION_NOT_FOUND')

    def test_telegram_decorates_and_escapes_untrusted_text(self):
        result = notifications.decorate('announcement', '<b>A & B</b>')
        self.assertTrue(result.startswith(notifications.HEADS['announcement'] + '\n'))
        self.assertTrue(result.endswith('&lt;b&gt;A &amp; B&lt;/b&gt;'))

    def test_disabled_telegram_does_not_access_network(self):
        with patch.dict('os.environ', {'TELEGRAM_BOT_TOKEN': ''}), patch.object(telegram_delivery, 'urlopen') as network:
            telegram_delivery.send('chat', 'private text')
            network.assert_not_called()

    def test_telegram_provider_failure_does_not_leak_token(self):
        with patch.dict('os.environ', {'TELEGRAM_BOT_TOKEN': 'fixture-secret'}), \
             patch.object(telegram_delivery, 'urlopen', side_effect=RuntimeError('fixture-secret')), \
             self.assertLogs(telegram_delivery.__name__, level='WARNING') as logs:
            self.assertIsNone(telegram_delivery.call('sendMessage', {'text': 'private text'}))
        self.assertNotIn('fixture-secret', ''.join(logs.output))
        self.assertNotIn('private text', ''.join(logs.output))
