"""Free-first OpenRouter routing and validated score transport."""
import copy
import json
import os
from unittest.mock import patch

from django.test import SimpleTestCase

from apps.core import assessment_providers as providers
from apps.core import assessment_results as results
from apps.core.assessment_results import ProviderError
from apps.core.mock_scoring import convert_expert
from tests.test_assessment_quality import fixture


class FreeAssessmentProviderTests(SimpleTestCase):
    route = {'ASSESSMENT_PROVIDER': 'openrouter', 'OPENROUTER_API_KEY': 'fixture',
             'OPENROUTER_ALLOWED_PROVIDERS': 'configured-route', 'ASSESSMENT_EXTERNAL_AI_ALLOWED': 'true'}
    local = {**route, 'OPENROUTER_BASE_URL': 'http://localhost'}

    def answer(self, result, finish='stop'):
        return {'choices': [{'finish_reason': finish, 'message': {'role': 'assistant', 'content': json.dumps(result)}}],
                'usage': {'prompt_tokens': 120, 'completion_tokens': 50}}

    def test_transport_records_provenance_and_minimizes_student_data(self):
        for skill in ('writing', 'speaking'):
            input, result = fixture(skill)
            with self.subTest(skill=skill), patch.dict(os.environ, self.route, clear=True), \
                    patch.object(providers.policy, 'reserve_request') as reserve, \
                    patch.object(providers, 'provider_json', return_value=self.answer(result)) as http:
                output = providers.assess(input, 'PRIMARY')
                self.assertEqual((output['provider'], output['model']), ('openrouter', providers.policy.FREE_MODEL))
                self.assertNotIn('practiceGrade', output['result'])
                url, data, headers, _ = http.call_args.args
                body = json.loads(data)
                self.assertEqual(url, 'https://openrouter.ai/api/v1/chat/completions')
                self.assertEqual(body['response_format'], {'type': 'json_object'})
                self.assertEqual(headers['Authorization'], 'Bearer fixture')
                self.assertEqual(body['provider']['only'], ['configured-route'])
                self.assertTrue(body['provider']['zdr'])
                self.assertEqual(body['provider']['data_collection'], 'deny')
                self.assertFalse(body['provider']['allow_fallbacks'])
                self.assertEqual(body['provider']['max_price']['completion'], 0)
                self.assertNotIn('private-id', body['messages'][1]['content'])
                self.assertNotIn('private/key', body['messages'][1]['content'])
                self.assertEqual(output['inputTokens'], 120)
                reserve.assert_called_once_with('openrouter', providers.policy.FREE_MODEL, paid_microusd=0)

    def test_missing_credentials_consent_or_approved_route_block_dispatch(self):
        input, _ = fixture()
        configs = [
            ({**self.route, 'OPENROUTER_API_KEY': ''}, 'PROVIDER_NOT_CONFIGURED'),
            ({**self.route, 'ASSESSMENT_EXTERNAL_AI_ALLOWED': 'false'}, 'ASSESSMENT_EXTERNAL_AI_DISABLED'),
            ({**self.route, 'OPENROUTER_ALLOWED_PROVIDERS': ''}, 'PROVIDER_PRIVACY_ROUTE_REQUIRED'),
            ({**self.route, 'OPENROUTER_MODEL': 'unapproved/model:free'}, 'ASSESSMENT_FREE_MODEL_REQUIRED'),
            ({**self.route, 'ASSESSMENT_PROVIDER': 'unknown'}, 'PROVIDER_CONFIG_INVALID'),
            ({**self.route, 'ASSESSMENT_PROVIDER': 'xkiro', 'XKIRO_API_KEY': 'fixture'}, 'PROVIDER_PRIVACY_ROUTE_REQUIRED'),
        ]
        for config, code in configs:
            with self.subTest(code=code), patch.dict(os.environ, config, clear=True), patch.object(providers, 'provider_json') as http:
                with self.assertRaisesRegex(ProviderError, code):
                    providers.assess(input, 'PRIMARY')
                http.assert_not_called()

    def test_adjudicator_cannot_redirect_key_or_use_paid_variant_without_approval(self):
        input, _ = fixture()
        with patch.dict(os.environ, {**self.route, 'OPENROUTER_BASE_URL': 'https://not-approved.invalid'}, clear=True), \
             patch.object(providers, 'provider_json') as http:
            with self.assertRaisesRegex(ProviderError, 'PROVIDER_PRIVACY_ROUTE_REQUIRED'):
                providers.assess(input, 'ADJUDICATOR')
        http.assert_not_called()

    def test_unvalidated_or_truncated_output_cannot_become_a_grade(self):
        input, result = fixture()
        result['parts'][0]['evidenceQuotes'][0]['quote'] = 'Invented evidence'
        for finish, code in [('stop', 'RESULT_EVIDENCE_INVALID'), ('length', 'PROVIDER_TRUNCATED_RESULT')]:
            with self.subTest(finish=finish), patch.dict(os.environ, self.local, clear=True), \
                    patch.object(providers, 'provider_json', return_value=self.answer(result, finish)):
                with self.assertRaisesRegex(ProviderError, code):
                    providers.assess(input, 'PRIMARY')

    def test_quota_outage_and_uncertain_outcomes_do_not_switch_to_other_providers(self):
        input, _ = fixture('speaking')
        config = {**self.local, 'XKIRO_API_KEY': 'fixture', 'GEMINI_API_KEY': 'fixture',
                  'ASSESSMENT_ALLOW_PAID_FALLBACK': 'true', 'ASSESSMENT_FALLBACK_MODEL': 'deepseek/deepseek-v4.1-flash'}
        cases = ['PROVIDER_RATE_LIMITED', 'PROVIDER_UNAVAILABLE', 'PROVIDER_NETWORK_FAILURE', 'PROVIDER_TIMEOUT']
        for code in cases:
            with self.subTest(code=code), patch.dict(os.environ, config, clear=True), \
                    patch.object(providers, 'provider_json', side_effect=ProviderError(code, True)) as http:
                with self.assertRaisesRegex(ProviderError, code):
                    providers.assess(input, 'PRIMARY')
                http.assert_called_once()

    def test_paid_fallback_defaults_to_disabled(self):
        input, _ = fixture()
        config = {**self.local, 'ASSESSMENT_FALLBACK_MODEL': 'deepseek/deepseek-v4.1-flash'}
        with patch.dict(os.environ, config, clear=True), patch.object(
                providers, 'provider_json', side_effect=ProviderError('PROVIDER_MODEL_UNAVAILABLE')) as http:
            with self.assertRaisesRegex(ProviderError, 'PROVIDER_MODEL_UNAVAILABLE'):
                providers.assess(input, 'PRIMARY')
            http.assert_called_once()

    def test_explicit_paid_fallback_reserves_money_before_transmitting(self):
        input, result = fixture()
        paid = 'deepseek/deepseek-v4.1-flash'
        config = {**self.route, 'ASSESSMENT_ALLOW_PAID_FALLBACK': 'true', 'ASSESSMENT_FALLBACK_MODEL': paid,
                  'OPENROUTER_MAX_PROMPT_PRICE': '0.5', 'OPENROUTER_MAX_COMPLETION_PRICE': '1'}
        with patch.dict(os.environ, config, clear=True), patch.object(providers.policy, 'reserve_request') as reserve, \
                patch.object(providers, 'provider_json', side_effect=[
                    ProviderError('PROVIDER_MODEL_UNAVAILABLE'), self.answer(result),
                ]) as http:
            output = providers.assess(input, 'PRIMARY')
            self.assertEqual(output['model'], paid)
            self.assertEqual(http.call_count, 2)
            self.assertGreater(reserve.call_args.kwargs['paid_microusd'], 0)

    def test_multilevel_native_scoring_and_evidence_are_preserved(self):
        input, result = fixture('writing')
        invalid = copy.deepcopy(result)
        invalid['parts'][0]['evidenceQuotes'][0]['quote'] = 'This was never said.'
        with patch.dict(os.environ, self.local, clear=True), patch.object(
                providers, 'provider_json', side_effect=[self.answer(result), self.answer(invalid)]):
            output = providers.assess(input, 'PRIMARY')
            native = results.score(input, output['result'])
            self.assertEqual(native['score'], convert_expert(input['skill'], native['rawTotal'])
                             if input.get('practiceMode') != 'PARTIAL' else native['rawTotal'])
            with self.assertRaisesRegex(ProviderError, 'RESULT_EVIDENCE_INVALID'):
                providers.assess(input, 'PRIMARY')
