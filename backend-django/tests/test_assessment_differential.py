"""Pure scoring/result/provider contracts compared directly to NestJS functions."""
import copy
import json
import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
from unittest.mock import patch
from django.test import SimpleTestCase
from common.api.exceptions import ContractAPIException
from apps.core import assessment_results as results,assessment_providers as providers,assessment_prompts
from tests.test_assessment import fixture

class AssessmentDifferentialTests(SimpleTestCase):
    def compare(self,cases):
        root=Path(__file__).resolve().parents[1]
        reference=subprocess.run(['node',str(root/'scripts/assessment_reference.cjs')],input=json.dumps(cases),capture_output=True,text=True,encoding='utf-8',timeout=30,check=True)
        expected=json.loads(reference.stdout)
        for row,wanted in zip(cases,expected):
            with self.subTest(action=row['action'],program=row.get('input',{}).get('program')):
                try:
                    action=row['action'];input=row.get('input');result=row.get('result')
                    if action=='validate':value=results.validate(result,input)
                    elif action=='score':value=results.score(input,result)
                    elif action=='schema':value=results.schema(input)
                    elif action=='prompt':value=assessment_prompts.system_prompt(input)
                    elif action=='teacher':value=results.teacher_result(input,result,row['parts'])
                    elif action=='combine':value=results.combine(result,row['other'],input)
                    elif action=='adjudicate':value=results.adjudicate(input,result,row.get('threshold',.85))
                    elif action=='url':value=providers.provider_url(row['base'],row['endpoint'])
                    else:
                        calls=[]
                        def http(url,body,headers,timeout):
                            import base64
                            calls.append(dict(url=url,headers=headers,body=json.loads(body) if action=='deepseek' else base64.b64encode(body).decode()))
                            status=row.get('status',200)
                            if status>=400:raise results.ProviderError('PROVIDER_AUTH_FAILED' if status in (401,403) else 'PROVIDER_RATE_LIMITED' if status==429 else 'PROVIDER_UNAVAILABLE' if status>=500 else 'PROVIDER_REQUEST_REJECTED',status==429 or status>=500,status==408)
                            return copy.deepcopy(row['response'])
                        try:
                            with patch.dict(os.environ,row['config'],clear=True),patch.object(providers,'provider_json',side_effect=http):
                                value=providers.assess(input,row.get('role','PRIMARY')) if action=='deepseek' else providers.transcribe(Path(input['audioPath']),input['mimeType'],input['language'],input.get('durationMs'))
                            if 'latencyMs' in value:self.assertGreaterEqual(value.pop('latencyMs'),0)
                            value=dict(value=value,calls=calls)
                        except results.ProviderError as error:
                            self.assertEqual(dict(error=error.code,transient=error.transient,uncertain=error.uncertain,calls=calls),wanted);continue
                    self.assertEqual(dict(value=value),wanted)
                except results.ProviderError as error:self.assertEqual(dict(error=error.code),wanted)
                except ContractAPIException as error:self.assertEqual(dict(error=error.contract_code),wanted)

    def test_scoring_validation_prompts_and_json_schema_exact_reference(self):
        cases=[]
        for program in ('IELTS_ACADEMIC','IELTS_GENERAL','MULTILEVEL'):
            for skill in ('writing','speaking'):
                input,result=fixture(program,skill)
                for action in ('validate','score','schema','prompt','adjudicate'):cases.append(dict(action=action,input=input,result=copy.deepcopy(result)))
                for score in (0,.5,1,2.5,5,5.1,6,8.5,9,9.5,None,True):
                    candidate=copy.deepcopy(result)
                    if program=='MULTILEVEL':candidate['parts'][0]['rawScore']=score
                    else:candidate['parts'][0]['criteria']={k:score for k in results.keys(input)}
                    for action in ('validate','score'):cases.append(dict(action=action,input=input,result=candidate))
                for confidence in (0,.84,.85,1,1.01,None,True):cases.append(dict(action='validate',input=input,result=dict(result,confidence=confidence)))
                other=copy.deepcopy(result)
                for action in ('combine','teacher'):
                    cases.append(dict(action=action,input=input,result=result,other=other,parts=[dict(id='task1',rawScore=3,criteria={k:7 for k in results.keys(input)})]))
        self.compare(cases)

    def test_deepseek_http_payload_result_and_sanitized_failures(self):
        input,result=fixture();config=dict(DEEPSEEK_API_KEY='fixture-key',DEEPSEEK_MODEL='fixture-model',DEEPSEEK_ADJUDICATOR_MODEL='fixture-adjudicator',DEEPSEEK_BASE_URL='http://127.0.0.1:9999/v1')
        response=dict(status='completed',output=[dict(type='message',status='completed',role='assistant',content=[dict(type='output_text',text=json.dumps(result))])],usage=dict(input_tokens=12,output_tokens=13))
        cases=[dict(action='deepseek',input=input,response=response,config=config,role=role) for role in ('PRIMARY','ADJUDICATOR')]
        for status in (401,403,408,429,500):cases.append(dict(action='deepseek',input=input,response={'private':'discard'},config=config,status=status))
        for response in ({'status':'incomplete'},{'status':'completed','output':[]},{'status':'completed','output':[{'type':'message','status':'completed','role':'assistant','content':[]}]}):cases.append(dict(action='deepseek',input=input,response=response,config=config))
        self.compare(cases)

    def test_deepgram_bytes_metadata_words_and_pronunciation_exact_reference(self):
        with TemporaryDirectory() as directory:
            path=Path(directory)/'fixture.wav';path.write_bytes(b'local-recording')
            input=dict(audioPath=str(path),mimeType='audio/wav',language='en')
            config=dict(STT_PROVIDER='deepgram',STT_API_KEY='fixture-key',STT_MODEL='fixture-model',STT_BASE_URL='http://127.0.0.1:9999/v1')
            alternative=dict(transcript='Original transcript.',confidence=.91,words=[dict(start=0,end=.8,word='Original',confidence=.9),dict(start=.8,end=1.2,punctuated_word='transcript.',confidence=.92)])
            response=dict(results=dict(channels=[dict(alternatives=[alternative])]),metadata=dict(duration=1.2345))
            cases=[dict(action='deepgram',input=input,config=config,response=response)]
            for status in (401,408,429,500):cases.append(dict(action='deepgram',input=input,config=config,response={},status=status))
            for next in ({'results':{'channels':[]}},dict(response,metadata=dict(duration=-1)),dict(response,results=dict(channels=[dict(alternatives=[dict(alternative,transcript='')])]))):cases.append(dict(action='deepgram',input=input,config=config,response=next))
            for mime in ('text/html','audio/aac'):cases.append(dict(action='deepgram',input=dict(input,mimeType=mime),config=config,response=response))
            self.compare(cases)
