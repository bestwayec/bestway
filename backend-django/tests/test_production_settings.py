"""Regressions for values shared across multiple API and scheduler processes."""
from unittest.mock import patch

from django.test import SimpleTestCase

from apps.core.system_settings import numeric_settings
from common.api.throttling import GlobalAPIThrottle
from rest_framework.test import APIRequestFactory
from django.core.exceptions import ImproperlyConfigured
from common.deployment_config import require_public_origin


class PublicOriginTests(SimpleTestCase):
    def test_valid_api_origin(self):
        self.assertEqual(require_public_origin('https://api.bestwayec.uz/'), 'https://api.bestwayec.uz')

    def test_invalid_media_origins_fail_before_startup(self):
        for value in ('', 'http://api.bestwayec.uz', 'https://api.bestwayec.uz/v1',
                      'https://user:secret@api.bestwayec.uz', 'https://api.bestwayec.uz?token=secret',
                      'https://api.bestwayec.uz#fragment', 'https://api.bestwayec.uz:bad'):
            with self.subTest(value=value), self.assertRaises(ImproperlyConfigured):
                require_public_origin(value)


class NumericSettingsConsistencyTests(SimpleTestCase):
    def test_a_later_read_observes_other_process_updates(self):
        with patch('apps.core.system_settings.Setting.objects.filter') as query:
            query.return_value.values_list.side_effect = [
                [('teacherPointLimit', 20)], [('teacherPointLimit', 5)],
            ]
            self.assertEqual(numeric_settings()['teacherPointLimit'], 20)
            self.assertEqual(numeric_settings()['teacherPointLimit'], 5)
            self.assertEqual(query.call_count, 2)

    def test_defaults_and_javascript_numeric_conversion(self):
        with patch('apps.core.system_settings.Setting.objects.filter') as query:
            query.return_value.values_list.return_value = [
                ('teacherPointLimit', None), ('monthlyFee', '125000'),
                ('gameThreshold', {'invalid': True}),
            ]
            self.assertEqual(numeric_settings(), {
                'teacherPointLimit': 0, 'initialPoints': 100,
                'monthlyFee': 125000, 'gameThreshold': None,
            })


class GlobalThrottleTests(SimpleTestCase):
    def test_one_source_ip_cannot_reset_budget_with_a_different_user(self):
        class SmallBudget(GlobalAPIThrottle):
            rate = '3/min'
            scope = 'production-regression-test'

        factory = APIRequestFactory()
        requests = [factory.get('/v1/health', REMOTE_ADDR='192.0.2.85') for _ in range(4)]
        for index, request in enumerate(requests):
            request.user = type('User', (), {'pk': index, 'is_authenticated': True})()
        throttle = SmallBudget()
        key = throttle.get_cache_key(requests[0], None)
        throttle.cache.delete(key)
        try:
            self.assertEqual([SmallBudget().allow_request(request, None) for request in requests],
                             [True, True, True, False])
            other_ip = factory.get('/v1/health', REMOTE_ADDR='192.0.2.86')
            self.assertTrue(SmallBudget().allow_request(other_ip, None))
            throttle.cache.delete(throttle.get_cache_key(other_ip, None))
        finally:
            throttle.cache.delete(key)
