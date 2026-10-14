"""Free Qwen transport must retain source evidence and honest provenance."""
import copy
import json
import os
from unittest.mock import patch
from django.test import SimpleTestCase
from apps.core import assessment_providers as providers
from apps.core.assessment_results import ProviderError
from tests.test_assessment_quality import fixture


class XkiroAssessmentTests(SimpleTestCase):
    config={'ASSESSMENT_PROVIDER':'xkiro','XKIRO_API_KEY':'test-only-key',
            'XKIRO_MODEL':'qwen/qwen3.8-max:free'}

    def test_chat_transport_validates_writing_and_transcript_and_records_xkiro(self):
        for skill in ('writing','speaking'):
            input,result=fixture(skill)
            response={'choices':[{'finish_reason':'stop','message':{'role':'assistant','content':json.dumps(result)}}],
                      'usage':{'prompt_tokens':120,'completion_tokens':50}}
            with self.subTest(skill=skill),patch.dict(os.environ,self.config,clear=True),patch.object(providers,'provider_json',return_value=response) as http:
                output=providers.assess(input,'PRIMARY')
                self.assertEqual((output['provider'],output['model']),('xkiro',self.config['XKIRO_MODEL']))
                self.assertEqual(output['result']['practiceGrade']['score'], 28.0 if skill == 'writing' else 19.0)
                args=http.call_args.args;body=json.loads(args[1])
                self.assertEqual(args[0],'https://api.xkiro.com/v1/chat/completions')
                self.assertEqual(body['response_format'],{'type':'json_object'})
                self.assertEqual(body['reasoning_effort'],'none')
                self.assertNotIn('private-id',body['messages'][1]['content'])
                self.assertNotIn('private/key',body['messages'][1]['content'])
                self.assertEqual(output['inputTokens'],120)

    def test_paid_models_unknown_provider_and_missing_key_never_call_http(self):
        input,_=fixture()
        for config,code in [({**self.config,'XKIRO_MODEL':'qwen/qwen3.8-max'},'PROVIDER_CONFIG_INVALID'),
                            ({**self.config,'XKIRO_MODEL':'other/model:free'},'PROVIDER_CONFIG_INVALID'),
                            ({**self.config,'XKIRO_API_KEY':''},'PROVIDER_NOT_CONFIGURED'),
                            ({**self.config,'ASSESSMENT_PROVIDER':'unknown'},'PROVIDER_CONFIG_INVALID')]:
            with self.subTest(config=config),patch.dict(os.environ,config,clear=True),patch.object(providers,'provider_json') as http:
                with self.assertRaisesRegex(ProviderError,code):providers.assess(input,'PRIMARY')
                http.assert_not_called()

    def test_adjudicator_uses_same_free_model_and_cannot_redirect_key(self):
        input,result=fixture()
        response={'choices':[{'finish_reason':'stop','message':{'role':'assistant','content':json.dumps(result)}}]}
        with patch.dict(os.environ,{**self.config,'XKIRO_BASE_URL':'https://untrusted.invalid'},clear=True),patch.object(providers,'provider_json',return_value=response) as http:
            self.assertEqual(providers.assess(input,'ADJUDICATOR')['model'],self.config['XKIRO_MODEL'])
            self.assertTrue(http.call_args.args[0].startswith('https://api.xkiro.com/'))

    def test_unvalidated_or_truncated_output_cannot_become_a_grade(self):
        input,result=fixture();result['parts'][0]['evidenceQuotes'][0]['quote']='Invented evidence'
        for reason,code in [('stop','RESULT_EVIDENCE_INVALID'),('length','PROVIDER_TRUNCATED_RESULT')]:
            response={'choices':[{'finish_reason':reason,'message':{'role':'assistant','content':json.dumps(result)}}]}
            with self.subTest(reason=reason),patch.dict(os.environ,self.config,clear=True),patch.object(providers,'provider_json',return_value=response):
                with self.assertRaisesRegex(ProviderError,code):providers.assess(input,'PRIMARY')

    def test_openrouter_transport_evaluates_and_attaches_headers(self):
        input,result=fixture('writing')
        response={'choices':[{'finish_reason':'stop','message':{'role':'assistant','content':json.dumps(result)}}],
                  'usage':{'prompt_tokens':150,'completion_tokens':60}}
        openrouter_config={
            'ASSESSMENT_PROVIDER':'openrouter',
            'OPENROUTER_API_KEY':'sk-or-v1-test',
            'OPENROUTER_MODEL':'deepseek/deepseek-chat'
        }
        with patch.dict(os.environ,openrouter_config,clear=True),patch.object(providers,'provider_json',return_value=response) as http:
            output=providers.assess(input,'PRIMARY')
            self.assertEqual(output['provider'],'openrouter')
            self.assertEqual(output['model'],'deepseek/deepseek-chat')
            args=http.call_args.args
            self.assertEqual(args[0],'https://openrouter.ai/api/v1/chat/completions')
            headers=args[2]
            self.assertEqual(headers['Authorization'],'Bearer sk-or-v1-test')
            self.assertEqual(headers['HTTP-Referer'],'https://bestwayec.uz')
            self.assertEqual(headers['X-Title'],'BestWay Exam')

    def test_primary_openrouter_falls_back_to_xkiro_on_rate_limit(self):
        input,result=fixture('writing')
        xkiro_response={'choices':[{'finish_reason':'stop','message':{'role':'assistant','content':json.dumps(result)}}],
                        'usage':{'prompt_tokens':100,'completion_tokens':40}}
        dual_config={
            'ASSESSMENT_PROVIDER':'openrouter',
            'OPENROUTER_API_KEY':'sk-or-v1-test',
            'OPENROUTER_MODEL':'deepseek/deepseek-chat',
            'XKIRO_API_KEY':'sk-xt-test',
            'XKIRO_MODEL':'qwen/qwen3-max:free'
        }
        def fake_provider_json(url, body, headers, timeout):
            if 'openrouter.ai' in url:
                raise ProviderError('PROVIDER_RATE_LIMITED', True, True)
            return xkiro_response

        with patch.dict(os.environ,dual_config,clear=True),patch.object(providers,'provider_json',side_effect=fake_provider_json):
            output=providers.assess(input,'PRIMARY')
            self.assertEqual(output['provider'],'xkiro')
            self.assertEqual(output['model'],'qwen/qwen3-max:free')

    def test_primary_openrouter_falls_back_to_xkiro_on_server_and_network_errors(self):
        input,result=fixture('speaking')
        xkiro_response={'choices':[{'finish_reason':'stop','message':{'role':'assistant','content':json.dumps(result)}}],
                        'usage':{'prompt_tokens':110,'completion_tokens':45}}
        dual_config={
            'ASSESSMENT_PROVIDER':'openrouter',
            'OPENROUTER_API_KEY':'sk-or-v1-test',
            'OPENROUTER_MODEL':'deepseek/deepseek-chat',
            'XKIRO_API_KEY':'sk-xt-test',
            'XKIRO_MODEL':'qwen/qwen3.8-max:free'
        }
        error_cases = [
            ProviderError('PROVIDER_REQUEST_REJECTED', False, True),  # HTTP 408 timeout
            ProviderError('PROVIDER_UNAVAILABLE', True, False),       # HTTP 5xx
            ProviderError('PROVIDER_NETWORK_FAILURE', True, True),     # Network error
            ProviderError('PROVIDER_TIMEOUT', True, True),             # Socket/read timeout
        ]
        for error in error_cases:
            def fake_provider_json(url, body, headers, timeout, err=error):
                if 'openrouter.ai' in url:
                    raise err
                return xkiro_response

            with self.subTest(error_code=error.code),patch.dict(os.environ,dual_config,clear=True),patch.object(providers,'provider_json',side_effect=fake_provider_json):
                output=providers.assess(input,'PRIMARY')
                self.assertEqual(output['provider'],'xkiro')
                self.assertEqual(output['model'],'qwen/qwen3.8-max:free')
                self.assertEqual(output['result']['practiceGrade']['score'], 19.0)

    def test_fallback_defaults_to_qwen38_free_when_xkiro_model_omitted(self):
        input,result=fixture('writing')
        xkiro_response={'choices':[{'finish_reason':'stop','message':{'role':'assistant','content':json.dumps(result)}}]}
        dual_config_no_model={
            'ASSESSMENT_PROVIDER':'openrouter',
            'OPENROUTER_API_KEY':'sk-or-v1-test',
            'OPENROUTER_MODEL':'deepseek/deepseek-chat',
            'XKIRO_API_KEY':'sk-xt-test'
        }
        def fake_provider_json(url, body, headers, timeout):
            if 'openrouter.ai' in url:
                raise ProviderError('PROVIDER_RATE_LIMITED', True, False)
            return xkiro_response

        with patch.dict(os.environ,dual_config_no_model,clear=True),patch.object(providers,'provider_json',side_effect=fake_provider_json):
            output=providers.assess(input,'PRIMARY')
            self.assertEqual(output['provider'],'xkiro')
            self.assertEqual(output['model'],'qwen/qwen3.8-max:free')

    def test_fallback_preserves_multilevel_75_point_and_evidence_verification(self):
        input,result=fixture('writing')
        dual_config={
            'ASSESSMENT_PROVIDER':'openrouter',
            'OPENROUTER_API_KEY':'sk-or-v1-test',
            'XKIRO_API_KEY':'sk-xt-test',
        }
        # 1. Valid response preserves Multi-Level 75-point system rules and 0.5 increments
        valid_response={'choices':[{'finish_reason':'stop','message':{'role':'assistant','content':json.dumps(result)}}]}
        def fake_fallback_valid(url, body, headers, timeout):
            if 'openrouter.ai' in url:
                raise ProviderError('PROVIDER_RATE_LIMITED', True, False)
            return valid_response

        with patch.dict(os.environ,dual_config,clear=True),patch.object(providers,'provider_json',side_effect=fake_fallback_valid):
            output=providers.assess(input,'PRIMARY')
            self.assertEqual(output['provider'],'xkiro')
            practice_grade=output['result']['practiceGrade']
            self.assertEqual(practice_grade['scaleMax'],75)
            self.assertEqual(practice_grade['rangeMax'],55)
            self.assertLessEqual(practice_grade['score'],55.0)
            self.assertEqual(practice_grade['score'],28.0)
            # Verify 0.5 increments
            for part in output['result']['parts']:
                self.assertEqual(part['rawScore']*2, int(part['rawScore']*2))
                for c_val in part['criteria'].values():
                    self.assertEqual(c_val*2, int(c_val*2))

        # 2. Fabricated evidence on fallback to xKiro must be strictly rejected
        invalid_result=copy.deepcopy(result)
        invalid_result['parts'][0]['evidenceQuotes'][0]['quote']='This was never said by candidate.'
        invalid_response={'choices':[{'finish_reason':'stop','message':{'role':'assistant','content':json.dumps(invalid_result)}}]}
        def fake_fallback_invalid(url, body, headers, timeout):
            if 'openrouter.ai' in url:
                raise ProviderError('PROVIDER_RATE_LIMITED', True, False)
            return invalid_response

        with patch.dict(os.environ,dual_config,clear=True),patch.object(providers,'provider_json',side_effect=fake_fallback_invalid):
            with self.assertRaisesRegex(ProviderError,'RESULT_EVIDENCE_INVALID'):
                providers.assess(input,'PRIMARY')


