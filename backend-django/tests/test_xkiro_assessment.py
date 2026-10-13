"""Free Qwen transport must retain source evidence and honest provenance."""
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
