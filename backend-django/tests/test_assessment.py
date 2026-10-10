import copy
import json
import os
from unittest.mock import patch
from django.test import SimpleTestCase
from apps.core import assessment_results as service,assessment_providers as providers,assessment_prompts,assessment_worker

def fixture(program='IELTS_ACADEMIC',skill='writing'):
    input=dict(program=program,skill=skill,pronunciationEvidence='UNAVAILABLE',rubricVersion='fixture',specificationVersion=None,speakingProfileVersion=None,
        parts=[dict(id='task1',max=9 if program!='MULTILEVEL' else 5,task='Describe',context='',responses=[dict(questionId='private-id',audioKey='private/key',audioHash='private-hash',prompt='Prompt',partNumber=1,originalResponse='Original essay')])])
    result=service.empty(input);part=result['parts'][0];part.update(rawScore=3 if program=='MULTILEVEL' else 9,
        criteria={k:None if k=='pronunciation' else 6 if program!='MULTILEVEL' else 3 for k in service.keys(input)},evidence={k:'Demonstrated evidence' for k in service.keys(input)})
    result['confidence']=.95
    return input,result

class AssessmentResultsTests(SimpleTestCase):
    def test_ielts_discards_model_arithmetic(self):
        input,result=fixture();validated=service.validate(result,input)
        self.assertEqual(validated['parts'][0]['rawScore'],6)
        self.assertEqual(service.score(input,validated)['score'],6)
    def test_half_band_weighted_rounding(self):
        input,result=fixture();input['parts'].append(dict(input['parts'][0],id='task2'))
        result['parts'].append(dict(copy.deepcopy(result['parts'][0]),id='task2',criteria={k:6.5 for k in service.keys(input)}))
        self.assertEqual(service.score(input,result)['score'],6.5)
    def test_asr_cannot_fabricate_pronunciation(self):
        input,result=fixture(skill='speaking');validated=service.validate(result,input)
        self.assertIsNone(service.score(input,validated)['score'])
        result['parts'][0]['criteria']['pronunciation']=6
        with self.assertRaises(service.ProviderError):service.validate(result,input)
    def test_strict_result_keys_booleans_evidence_and_unknown_parts(self):
        input,result=fixture()
        for change in ('extra','bool','blank','unknown'):
            next=copy.deepcopy(result)
            if change=='extra':next['overallBand']=9
            elif change=='bool':next['confidence']=True
            elif change=='blank':next['parts'][0]['evidence']['ta']=' '
            else:next['parts'][0]['id']='unknown'
            with self.subTest(change=change),self.assertRaises(service.ProviderError):service.validate(next,input)
    def test_multilevel_halfpoints_and_top_part3_both_sides(self):
        input,result=fixture('MULTILEVEL','speaking');input['parts'][0].update(id='3',max=6);result['parts'][0].update(id='3',rawScore=6)
        with self.assertRaises(service.ProviderError):service.validate(result,input)
        result['parts'][0]['feedback'].update(forCovered=True,againstCovered=True)
        self.assertEqual(service.validate(result,input)['parts'][0]['rawScore'],6)
        result['parts'][0]['rawScore']=5.1
        with self.assertRaises(service.ProviderError):service.validate(result,input)
    def test_teacher_override_can_supply_real_pronunciation(self):
        input,result=fixture(skill='speaking');next=service.teacher_result(input,result,[dict(id='task1',criteria={k:6.5 for k in service.keys(input)})])
        self.assertEqual(next['pronunciationEvidence'],'ACOUSTIC');self.assertEqual(service.score(input,next)['score'],6.5)
    def test_adjudication_and_schema(self):
        input,result=fixture();self.assertFalse(service.adjudicate(input,result));result['confidence']=.8;self.assertTrue(service.adjudicate(input,result))
        self.assertFalse(service.schema(input)['additionalProperties'])
        self.assertEqual(service.combine(service.validate(result,input),service.validate(result,input),input)['parts'][0]['rawScore'],6)

class AssessmentProviderTests(SimpleTestCase):
    def test_provider_urls_reject_credentials_and_nonlocal_http(self):
        for url in ('http://example.com','https://user:secret@example.com','https://example.com?a=1','https://example.com#x'):
            with self.subTest(url=url),self.assertRaises(service.ProviderError):providers.provider_url(url,'responses')
        self.assertEqual(providers.provider_url('http://127.0.0.1:9999/v1/','listen'),'http://127.0.0.1:9999/v1/listen')
    def test_configuration_failure_does_not_call_http(self):
        input,_=fixture()
        with patch.dict(os.environ,{},clear=True),patch.object(providers,'provider_json') as http:
            with self.assertRaises(service.ProviderError):providers.assess(input,'PRIMARY')
            http.assert_not_called()
    def test_deepseek_payload_redacts_identity_and_storage_and_caps_unseen_images(self):
        input,result=fixture();input['parts'][0]['imageKeys']=['private/image']
        output=dict(status='completed',output=[dict(type='message',status='completed',role='assistant',content=[dict(type='output_text',text=json.dumps(result))])],usage=dict(input_tokens=12,output_tokens=13))
        with patch.dict(os.environ,dict(DEEPSEEK_API_KEY='fixture-key',DEEPSEEK_MODEL='fixture-model')),patch.object(providers,'provider_json',return_value=output) as http:
            value=providers.assess(input,'PRIMARY');body=json.loads(http.call_args.args[1]);payload=body['input'][0]['content'][0]['text']
            for private in ('private-id','private/key','private-hash','private/image'):self.assertNotIn(private,payload)
            self.assertEqual(value['result']['confidence'],.79);self.assertEqual(value['inputTokens'],12)
            self.assertEqual(body['reasoning'],dict(effort='none'));self.assertEqual(body['tool_choice'],'none')
    def test_candidate_content_never_enters_system_prompt(self):
        input,_=fixture();input['parts'][0]['task']='SECRET_CANDIDATE_INJECTION'
        self.assertNotIn('SECRET_CANDIDATE_INJECTION',assessment_prompts.system_prompt(input))
    def test_tick_disabled_and_busy_never_claim(self):
        with patch.dict(os.environ,dict(ASSESSMENT_WORKER_ENABLED='false')),patch.object(assessment_worker,'run_once') as run:
            assessment_worker.tick();run.assert_not_called()
