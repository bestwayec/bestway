"""Single-shot, bounded provider HTTP. Durable ledger owns all retry decisions."""
import json
import math
import os
import re
import socket
import time
from urllib.parse import urlsplit,urlunsplit,urlencode
from urllib.request import Request,build_opener,HTTPRedirectHandler
from urllib.error import HTTPError,URLError
from .assessment_results import ProviderError,validate,schema
from .assessment_prompts import system_prompt
from .mock_scoring import js_round

def provider_url(base,endpoint):
    try:
        url=urlsplit(base)
        if not url.hostname or url.username or url.password or url.query or url.fragment or (url.scheme!='https' and not(url.scheme=='http' and url.hostname in ('localhost','127.0.0.1','::1'))):raise ValueError()
        _=url.port
        return urlunsplit(url._replace(path=url.path.removesuffix('/')+'/'+endpoint))
    except (ValueError,TypeError):raise ProviderError('PROVIDER_CONFIG_INVALID') from None

def bounded(name,fallback,minimum,maximum):
    raw=os.environ.get(name)
    try:value=float(raw) if raw and raw.strip() else (0 if raw else math.nan)
    except ValueError:value=math.nan
    return max(minimum,min(maximum,math.floor(value))) if math.isfinite(value) else fallback

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):raise ProviderError('PROVIDER_NETWORK_FAILURE',True,True)

def provider_json(url,body,headers,timeout_ms):
    try:
        with build_opener(NoRedirect()).open(Request(url,data=body,headers=headers,method='POST'),timeout=timeout_ms/1000) as response:
            limit=2*1024*1024
            length=response.headers.get('Content-Length')
            try:advertised=float(length) if length else 0
            except ValueError:advertised=math.nan
            if advertised>limit:raise ProviderError('PROVIDER_RESPONSE_TOO_LARGE')
            data=response.read(limit+1)
            if len(data)>limit:raise ProviderError('PROVIDER_RESPONSE_TOO_LARGE')
            content=data.decode('utf-8',errors='replace')
            if not content.strip():raise ProviderError('PROVIDER_EMPTY_RESPONSE')
            try:return json.loads(content,parse_constant=lambda _:(_ for _ in ()).throw(ValueError()))
            except ValueError:raise ProviderError('PROVIDER_MALFORMED_JSON') from None
    except ProviderError:raise
    except HTTPError as error:
        status=error.code;error.close()
        if 300<=status<400:raise ProviderError('PROVIDER_NETWORK_FAILURE',True,True) from None
        raise ProviderError('PROVIDER_AUTH_FAILED' if status in (401,403) else 'PROVIDER_RATE_LIMITED' if status==429 else 'PROVIDER_UNAVAILABLE' if status>=500 else 'PROVIDER_REQUEST_REJECTED',status==429 or status>=500,status==408) from None
    except (TimeoutError,socket.timeout):raise ProviderError('PROVIDER_TIMEOUT',True,True) from None
    except URLError as error:raise ProviderError('PROVIDER_TIMEOUT' if isinstance(error.reason,TimeoutError) else 'PROVIDER_NETWORK_FAILURE',True,True) from None
    except Exception:raise ProviderError('PROVIDER_NETWORK_FAILURE',True,True) from None

def record(value):
    if not isinstance(value,dict):raise ProviderError('PROVIDER_RESPONSE_INVALID')
    return value

def assess(input,role):
    key=os.environ.get('DEEPSEEK_API_KEY','').strip();model=os.environ.get('DEEPSEEK_ADJUDICATOR_MODEL' if role=='ADJUDICATOR' else 'DEEPSEEK_MODEL','').strip()
    if not key or not model:raise ProviderError('PROVIDER_NOT_CONFIGURED')
    url=provider_url(os.environ.get('DEEPSEEK_BASE_URL') or 'https://api.deepseek.com','responses')
    payload={k:input[k] for k in ('program','skill','rubricVersion','specificationVersion','speakingProfileVersion','pronunciationEvidence')}
    payload['parts']=[]
    for part in input['parts']:
        projected={k:part[k] for k in ('id','max','task','context')}
        projected['imageEvidence']='UNAVAILABLE_USE_ONLY_SUPPLIED_TEXT_DESCRIPTION' if part.get('imageKeys') else 'NOT_REQUIRED'
        projected.update({k:part[k] for k in ('prepSeconds','responseSeconds') if k in part})
        projected['responses']=[dict(prompt=r['prompt'],partNumber=r['partNumber'],response=(r.get('transcript') or '') if input['skill']=='speaking' else r['originalResponse'],**({ 'durationMs':r['durationMs']} if 'durationMs' in r else {})) for r in part['responses']]
        payload['parts'].append(projected)
    encoded=lambda value:json.dumps(value,ensure_ascii=False,separators=(',',':')).encode()
    body=encoded(dict(model=model,instructions=system_prompt(input),input=[dict(role='user',content=[dict(type='input_text',text=encoded(payload).decode())])],
        text=dict(format=dict(type='json_schema',name='bestway_assessment',schema=schema(input))),reasoning=dict(effort='none'),temperature=.2,stream=False,tool_choice='none',max_output_tokens=bounded('ASSESSMENT_MAX_OUTPUT_TOKENS',8000,2000,16000)))
    if len(body)>512*1024:raise ProviderError('ASSESSMENT_INPUT_TOO_LARGE')
    started=time.monotonic();response=record(provider_json(url,body,{'Authorization':'Bearer '+key,'Content-Type':'application/json'},bounded('ASSESSMENT_PROVIDER_TIMEOUT_MS',90000,1000,180000)))
    if response.get('status')!='completed':raise ProviderError('PROVIDER_TRUNCATED_RESULT')
    if not isinstance(response.get('output'),list):raise ProviderError('PROVIDER_RESPONSE_INVALID')
    messages=[record(v) for v in response['output'] if record(v).get('type')=='message']
    if len(messages)!=1 or messages[0].get('status')!='completed' or messages[0].get('role')!='assistant' or not isinstance(messages[0].get('content'),list):raise ProviderError('PROVIDER_RESPONSE_INVALID')
    content=[record(v) for v in messages[0]['content']]
    if len(content)!=1 or content[0].get('type')!='output_text' or not isinstance(content[0].get('text'),str) or not content[0]['text'].strip():raise ProviderError('PROVIDER_EMPTY_RESPONSE')
    try:parsed=json.loads(content[0]['text'])
    except ValueError:raise ProviderError('PROVIDER_MALFORMED_JSON') from None
    result=validate(parsed,input)
    if any(p.get('imageKeys') for p in input['parts']):result['confidence']=min(result['confidence'],.79)
    usage=record(response['usage']) if response.get('usage') is not None and response['usage'] is not False and response['usage']!=0 and response['usage']!='' else {}
    def token(value):return value if type(value) in (int,float) and math.isfinite(value) and 0<=value<=9007199254740991 and int(value)==value else None
    return dict(result=result,provider='deepseek',model=model,inputTokens=token(usage.get('input_tokens')),outputTokens=token(usage.get('output_tokens')),latencyMs=js_round((time.monotonic()-started)*1000))

def transcribe(path,mime,language='en',duration_ms=None):
    provider=os.environ.get('STT_PROVIDER','').strip().lower();key=os.environ.get('STT_API_KEY','').strip();model=os.environ.get('STT_MODEL','').strip()
    if provider!='deepgram' or not key or not model:raise ProviderError('STT_NOT_CONFIGURED')
    url=provider_url(os.environ.get('STT_BASE_URL') or 'https://api.deepgram.com/v1','listen')
    if not re.fullmatch(r'audio/(webm|ogg|wav|mpeg|mp4|x-wav|x-m4a)(;.*)?',mime,re.I) or not re.fullmatch(r'[a-z]{2,3}(-[a-z]{2,4})?',language,re.I):raise ProviderError('STT_INPUT_INVALID')
    try:
        if not path.is_file() or not 0<path.stat().st_size<=25*1024*1024:raise ProviderError('STT_INPUT_INVALID')
        audio=path.read_bytes()
    except OSError:raise ProviderError('STT_AUDIO_UNAVAILABLE') from None
    url+='?'+urlencode(dict(model=model,language=language,punctuate='true',filler_words='true',mip_opt_out='true'))
    response=record(provider_json(url,audio,{'Authorization':'Token '+key,'Content-Type':mime},bounded('ASSESSMENT_STT_TIMEOUT_MS',90000,1000,180000)))
    results=record(response.get('results'));channels=results.get('channels')
    if not isinstance(channels,list) or len(channels)!=1:raise ProviderError('STT_RESPONSE_INVALID')
    alternatives=record(channels[0]).get('alternatives')
    if not isinstance(alternatives,list) or not alternatives:raise ProviderError('STT_RESPONSE_INVALID')
    alternative=record(alternatives[0]);text=alternative.get('transcript')
    if not isinstance(text,str) or not text.strip():raise ProviderError('STT_EMPTY_TRANSCRIPT')
    words=alternative.get('words')
    if len(text.encode('utf-16-le'))//2>100000 or not isinstance(words,list) or len(words)>20000:raise ProviderError('STT_RESPONSE_INVALID')
    def finite(value):return type(value) in (int,float) and math.isfinite(value)
    def confidence(value):
        if value is None:return None
        if not finite(value) or not 0<=value<=1:raise ProviderError('STT_RESPONSE_INVALID')
        return value
    metadata=record(response['metadata']) if response.get('metadata') is not None and response['metadata'] is not False and response['metadata']!=0 and response['metadata']!='' else {};duration=metadata.get('duration')
    if 'duration' in metadata and (not finite(duration) or duration<=0):raise ProviderError('STT_RESPONSE_INVALID')
    segments=[]
    for item in words:
        word=record(item);start,end=word.get('start'),word.get('end')
        if not finite(start) or not finite(end) or start<0 or end<start or duration is not None and end>duration+1:raise ProviderError('STT_RESPONSE_INVALID')
        value=word.get('punctuated_word') if word.get('punctuated_word') is not None else word.get('word')
        if not isinstance(value,str) or not value.strip() or len(value.encode('utf-16-le'))//2>1000:raise ProviderError('STT_RESPONSE_INVALID')
        segments.append(dict(start=start,end=end,text=value,confidence=confidence(word.get('confidence'))))
    return dict(text=text,confidence=confidence(alternative.get('confidence')),segments=segments,provider='deepgram',model=model,durationMs=js_round(duration*1000) if duration is not None else duration_ms,pronunciationEvidence='UNAVAILABLE')
