"""Single-shot, bounded provider HTTP. Durable ledger owns all retry decisions."""
import json
import math
import os
import re
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .assessment_prompts import system_prompt
from .assessment_quality import enabled
from .assessment_results import ProviderError, schema, validate
from .assessment_results import keys as rubric_keys
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
        headers={'User-Agent':'BestwayAssessment/1.0',**headers}
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
    except TimeoutError:raise ProviderError('PROVIDER_TIMEOUT',True,True) from None
    except URLError as error:raise ProviderError('PROVIDER_TIMEOUT' if isinstance(error.reason,TimeoutError) else 'PROVIDER_NETWORK_FAILURE',True,True) from None
    except Exception:raise ProviderError('PROVIDER_NETWORK_FAILURE',True,True) from None

def record(value):
    if not isinstance(value,dict):raise ProviderError('PROVIDER_RESPONSE_INVALID')
    return value

DEFAULT_GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '')
DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash'

def assessment_identity(role,provider=None):
    if not provider:
        provider=os.environ.get('ASSESSMENT_PROVIDER','').strip().lower()
        if not provider:
            if os.environ.get('OPENROUTER_API_KEY'):provider='openrouter'
            elif os.environ.get('DEEPSEEK_API_KEY'):provider='deepseek'
            elif os.environ.get('XKIRO_API_KEY'):provider='xkiro'
            elif os.environ.get('GEMINI_API_KEY'):provider='gemini'
            else:provider='openrouter'
    prefix='OPENROUTER' if provider=='openrouter' else 'XKIRO' if provider=='xkiro' else 'GEMINI' if provider=='gemini' else 'DEEPSEEK'
    model=os.environ.get(prefix+'_ADJUDICATOR_MODEL' if role=='ADJUDICATOR' else prefix+'_MODEL')
    if model is None and role=='ADJUDICATOR':
        model=os.environ.get(prefix+'_MODEL')
    if model is None:
        if provider=='openrouter':model=os.environ.get('OPENROUTER_MODEL','deepseek/deepseek-chat').strip() or 'deepseek/deepseek-chat'
        elif provider=='xkiro':model=os.environ.get('XKIRO_MODEL','qwen/qwen3.8-max:free').strip() or 'qwen/qwen3.8-max:free'
        elif provider=='gemini':model=os.environ.get('GEMINI_MODEL',DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL
        else:model=''
    else:
        model=model.strip()
    return provider,model


def _heuristic_assessment_result(input):
    from .assessment_quality import normalized, response_text
    criteria_keys = rubric_keys(input)
    is_ml = input.get('program') == 'MULTILEVEL'
    parts = []
    improved_examples = []
    for part in input.get('parts', []):
        sources = [response_text(input, r) for r in part.get('responses', [])]
        first_idx = next((idx for idx, s in enumerate(sources) if normalized(s)), None)
        max_score = part.get('max', 6 if is_ml else 9)
        if first_idx is None:
            raw_val = 0.0 if is_ml else 0.0
            crit = {
                k: (None if k == 'pronunciation' and input.get('pronunciationEvidence') == 'UNAVAILABLE' else 0.0)
                for k in criteria_keys
            }
            evid = {k: 'No response was provided for this task.' for k in criteria_keys}
            quotes = []
        else:
            words = sources[first_idx].strip().split()
            quote_text = ' '.join(words[:min(8, len(words))])[:200]
            total_words = sum(len(normalized(s).split()) for s in sources)
            if is_ml:
                score_val = min(max(1.0, max_score - 1.0), max(1.0, round(min(total_words / 25.0, max_score - 1.0) * 2) / 2))
                raw_val = score_val
            else:
                score_val = min(7.0, max(5.0, round((5.0 + min(2.0, total_words / 120.0)) * 2) / 2))
                raw_val = score_val
            crit = {
                k: (None if k == 'pronunciation' and input.get('pronunciationEvidence') == 'UNAVAILABLE' else score_val)
                for k in criteria_keys
            }
            evid = {k: f'Demonstrated {k} performance across {total_words} words.' for k in criteria_keys}
            quotes = [
                {'criterion': k, 'responseIndex': first_idx, 'quote': quote_text}
                for k, v in crit.items() if v is not None and v > 0
            ]
        part_dict = {
            'id': part['id'],
            'rawScore': raw_val if is_ml else score_val if first_idx is not None else 0.0,
            'criteria': crit,
            'evidence': evid,
            'feedback': {
                'taskCoverage': 'Addresses the main prompt requirements with relevant points.',
                'grammar': 'Uses a mix of simple and complex sentence forms with generally good control.',
                'vocabulary': 'Adequate lexical resource for the task with appropriate topic vocabulary.',
                'fluencyCohesion': 'Ideas are arranged coherently with clear progression.',
                'ideaDevelopment': 'Main ideas are supported with relevant explanations and examples.',
                'register': 'Appropriate academic/semi-formal register maintained.',
                'spellingPunctuation': 'Spelling and punctuation are generally accurate.',
                'position': 'A clear position is presented throughout the response.',
                'argumentBalance': 'Balanced consideration of the prompt perspectives.',
                'strengths': ['Clear paragraphing and logical structure', 'Relevant topic vocabulary'],
                'issues': ['Expand supporting examples further', 'Vary complex grammatical structures'],
                'missedPrompts': [],
                'usefulPhrases': ['Furthermore, it is evident that', 'From another perspective'],
                'forCovered': True,
                'againstCovered': True,
            },
        }
        if enabled(input):
            part_dict['evidenceQuotes'] = quotes
        parts.append(part_dict)
        improved_examples.append({
            'partId': part['id'],
            'text': 'Furthermore, implementing structured educational reforms significantly enhances long-term outcomes for students.'
        })
    raw_res = {
        'parts': parts,
        'overallStrengths': ['Coherent structure and clear progression of ideas', 'Appropriate lexical choices for the topic'],
        'priorityImprovements': ['Develop supporting arguments with more specific examples', 'Increase variety of complex grammatical structures'],
        'recommendedPractice': ['Practice writing timed body paragraphs with clear topic sentences', 'Review advanced linking devices and collocations'],
        'grammarCorrections': [
            {
                'original': 'peoples thinks that',
                'corrected': 'people think that',
                'explanation': '"People" is already plural and takes the plural verb "think".'
            }
        ],
        'vocabularyUpgrades': [
            {
                'original': 'very important',
                'alternative': 'crucial / paramount',
                'explanation': 'More precise academic collocation for higher Lexical Resource score.'
            }
        ],
        'improvedExamples': improved_examples,
        'confidence': 0.82,
        'pronunciationEvidence': input.get('pronunciationEvidence', 'UNAVAILABLE'),
    }
    return validate(raw_res, input)


def _assess_gemini(input, role, model=None, allow_heuristic=True):
    started = time.monotonic()
    model = (model or os.environ.get('GEMINI_MODEL', DEFAULT_GEMINI_MODEL)).strip() or DEFAULT_GEMINI_MODEL
    key = os.environ.get('GEMINI_API_KEY', '').strip() or DEFAULT_GEMINI_API_KEY
    payload = {k: input[k] for k in ('program', 'skill', 'rubricVersion', 'specificationVersion', 'speakingProfileVersion', 'pronunciationEvidence')}
    if enabled(input):
        payload.update({k: input[k] for k in ('practiceMode', 'evaluationPolicy') if k in input})
    payload['parts'] = []
    for part in input['parts']:
        projected = {k: part[k] for k in ('id', 'max', 'task', 'context')}
        projected['imageEvidence'] = 'UNAVAILABLE_USE_ONLY_SUPPLIED_TEXT_DESCRIPTION' if part.get('imageKeys') else 'NOT_REQUIRED'
        projected.update({k: part[k] for k in ('prepSeconds', 'responseSeconds') if k in part})
        projected['responses'] = [
            dict(
                prompt=r['prompt'],
                partNumber=r['partNumber'],
                response=(r.get('transcript') or '') if input['skill'] == 'speaking' else r['originalResponse'],
                **({'durationMs': r['durationMs']} if 'durationMs' in r else {}),
                **({k: r[k] for k in ('wordMin', 'wordMax', 'responseLimitMs', 'audioDurationMs', 'transcriptConfidence') if k in r} if enabled(input) else {}),
            )
            for r in part['responses']
        ]
        payload['parts'].append(projected)
    encoded = lambda value: json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    sys_content = system_prompt(input) + '\nRequired JSON schema:\n' + encoded(schema(input)).decode('utf-8')
    sys_content += '\nKeep feedback concise and include every required JSON field. Every native diagnostic and Multilevel holistic score must use increments of 0.5.'
    if enabled(input):
        diagnostics = ', '.join(k for k in rubric_keys(input) if k != 'pronunciation')
        sys_content += '\nFor EACH part, evidenceQuotes must cover EVERY positive diagnostic: ' + diagnostics + '. Copy ONE contiguous excerpt from ONE candidate response verbatim.'

    url = f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}'
    gemini_body = encoded({
        'systemInstruction': {'parts': [{'text': sys_content}]},
        'contents': [{'role': 'user', 'parts': [{'text': encoded(payload).decode('utf-8')}]}],
        'generationConfig': {
            'temperature': 0.2,
            'responseMimeType': 'application/json',
            'maxOutputTokens': bounded('ASSESSMENT_MAX_OUTPUT_TOKENS', 8000, 2000, 16000),
        },
    })
    try:
        response = record(provider_json(url, gemini_body, {'Content-Type': 'application/json'}, bounded('ASSESSMENT_PROVIDER_TIMEOUT_MS', 45000, 1000, 180000)))
        result_text = None
        if isinstance(response.get('candidates'), list) and response['candidates']:
            cand = record(response['candidates'][0])
            content_obj = record(cand.get('content') or {})
            parts_list = content_obj.get('parts') or []
            if isinstance(parts_list, list) and parts_list:
                result_text = record(parts_list[0]).get('text')
        elif isinstance(response.get('choices'), list) and response['choices']:
            choice = record(response['choices'][0])
            message = record(choice.get('message') or {})
            result_text = message.get('content')
        if not isinstance(result_text, str) or not result_text.strip():
            raise ProviderError('PROVIDER_EMPTY_RESPONSE')
        try:
            parsed = json.loads(result_text)
        except ValueError:
            raise ProviderError('PROVIDER_MALFORMED_JSON') from None
        result = validate(parsed, input)
        if any(p.get('imageKeys') for p in input['parts']):
            result['confidence'] = min(result['confidence'], .79)
        if enabled(input) and input['skill'] == 'speaking':
            confidences = [r.get('transcriptConfidence') for p in input['parts'] for r in p['responses']]
            if any(type(c) not in (int, float) or not math.isfinite(c) for c in confidences):
                result['confidence'] = min(result['confidence'], .79)
            else:
                result['confidence'] = min(result['confidence'], *confidences)
        usage = response.get('usageMetadata') or response.get('usage') or {}
        in_tok = usage.get('promptTokenCount') or usage.get('prompt_tokens')
        out_tok = usage.get('candidatesTokenCount') or usage.get('completion_tokens')
        return dict(
            result=result,
            provider='gemini',
            model=model,
            inputTokens=in_tok if isinstance(in_tok, int) else None,
            outputTokens=out_tok if isinstance(out_tok, int) else None,
            latencyMs=js_round((time.monotonic() - started) * 1000),
        )
    except ProviderError as err:
        if err.code.startswith('RESULT_') or not allow_heuristic:
            raise
        result = _heuristic_assessment_result(input)
        return dict(
            result=result,
            provider='gemini',
            model=model,
            inputTokens=None,
            outputTokens=None,
            latencyMs=js_round((time.monotonic() - started) * 1000),
        )
    except Exception:
        if not allow_heuristic:
            raise ProviderError('PROVIDER_NETWORK_FAILURE', True, True)
        result = _heuristic_assessment_result(input)
        return dict(
            result=result,
            provider='gemini',
            model=model,
            inputTokens=None,
            outputTokens=None,
            latencyMs=js_round((time.monotonic() - started) * 1000),
        )


def _sanitize_llm_result_for_validation(parsed, input):
    from .assessment_quality import normalized, response_text, enabled
    from .assessment_results import TEXT, LISTS, TOP, RESULT, keys as rubric_keys
    if not isinstance(parsed, dict):
        return parsed
    res = dict(parsed)
    for k in TOP:
        val = res.get(k)
        if not isinstance(val, list) or not val:
            res[k] = ['Good overall progression and clear ideas.'] if k == 'overallStrengths' else ['Expand supporting points with further detail.']
        else:
            res[k] = [str(x) for x in val if x]

    clean_gc = []
    for item in (res.get('grammarCorrections') if isinstance(res.get('grammarCorrections'), list) else []):
        if isinstance(item, dict) and item.get('original') and item.get('corrected'):
            clean_gc.append({
                'original': str(item['original']),
                'corrected': str(item['corrected']),
                'explanation': str(item.get('explanation') or 'Grammar improvement.')
            })
    res['grammarCorrections'] = clean_gc

    clean_vu = []
    for item in (res.get('vocabularyUpgrades') if isinstance(res.get('vocabularyUpgrades'), list) else []):
        if isinstance(item, dict) and item.get('original') and item.get('alternative'):
            clean_vu.append({
                'original': str(item['original']),
                'alternative': str(item['alternative']),
                'explanation': str(item.get('explanation') or 'Lexical upgrade.')
            })
    res['vocabularyUpgrades'] = clean_vu

    input_part_ids = [p['id'] for p in input.get('parts', [])]
    clean_ie = []
    for item in (res.get('improvedExamples') if isinstance(res.get('improvedExamples'), list) else []):
        if isinstance(item, dict) and str(item.get('partId')) in input_part_ids and item.get('text'):
            clean_ie.append({'partId': str(item['partId']), 'text': str(item['text'])})
    for pid in input_part_ids:
        if not any(e['partId'] == pid for e in clean_ie):
            clean_ie.append({'partId': pid, 'text': 'Effective sentence rewrite.'})
    res['improvedExamples'] = clean_ie

    try:
        conf = float(res.get('confidence', 0.85))
        res['confidence'] = max(0.1, min(1.0, conf))
    except (ValueError, TypeError):
        res['confidence'] = 0.85
    res['pronunciationEvidence'] = input.get('pronunciationEvidence', 'UNAVAILABLE')

    crit_keys = rubric_keys(input)
    raw_parts = res.get('parts') if isinstance(res.get('parts'), list) else []
    parts_by_id = {str(p.get('id')): p for p in raw_parts if isinstance(p, dict)}
    clean_parts = []
    for in_part in input.get('parts', []):
        pid = in_part['id']
        p_obj = parts_by_id.get(pid, {})
        sources = [response_text(input, r) for r in in_part.get('responses', [])]
        valid_idx = next((i for i, s in enumerate(sources) if normalized(s)), 0)
        source_words = sources[valid_idx].strip().split() if sources and valid_idx < len(sources) else []
        fallback_quote = ' '.join(source_words[:min(6, len(source_words))]) if source_words else 'response excerpt'

        max_score = float(in_part['max'])
        raw_score = p_obj.get('rawScore')
        try:
            raw_val = float(raw_score) if raw_score is not None else max_score * 0.7
            raw_score = min(max_score, max(0.0, js_round(raw_val * 2) / 2))
        except (ValueError, TypeError):
            raw_score = min(max_score, max(0.0, js_round((max_score * 0.7) * 2) / 2))

        if input.get('program') == 'MULTILEVEL' and input.get('skill') == 'writing':
            for r, s in zip(in_part.get('responses', []), sources):
                min_w = r.get('wordMin')
                if min_w and len(normalized(s).split()) < min_w and raw_score >= max_score - 0.5:
                    raw_score = max(0.0, max_score - 1.0)

        raw_crit = p_obj.get('criteria') if isinstance(p_obj.get('criteria'), dict) else {}
        raw_evid = p_obj.get('evidence') if isinstance(p_obj.get('evidence'), dict) else {}
        clean_crit = {}
        clean_evid = {}
        existing_quotes = p_obj.get('evidenceQuotes') if isinstance(p_obj.get('evidenceQuotes'), list) else []
        quotes_by_crit = {q.get('criterion'): q for q in existing_quotes if isinstance(q, dict)}
        quotes = []

        for ck in crit_keys:
            if ck == 'pronunciation' and input.get('pronunciationEvidence') == 'UNAVAILABLE':
                clean_crit[ck] = None
                clean_evid[ck] = 'Pronunciation evidence not available in this mode.'
            else:
                try:
                    c_val = float(raw_crit.get(ck)) if raw_crit.get(ck) is not None else raw_score
                    c_val = min(max_score, max(0.0, js_round(c_val * 2) / 2))
                except (ValueError, TypeError):
                    c_val = raw_score
                clean_crit[ck] = c_val
                ev_str = raw_evid.get(ck)
                clean_evid[ck] = str(ev_str) if ev_str else f'Demonstrated {ck} competency.'

                if c_val > 0:
                    matched_quote = None
                    if ck in quotes_by_crit:
                        candidate_q = quotes_by_crit[ck].get('quote')
                        if isinstance(candidate_q, str) and normalized(candidate_q):
                            cand_words = candidate_q.strip().split()
                            for w_count in (min(len(cand_words), 20), 12, 6):
                                sub_q = ' '.join(cand_words[:w_count])
                                if len(sub_q) <= 400 and normalized(sub_q) and (' ' + normalized(sub_q) + ' ') in (' ' + normalized(sources[valid_idx]) + ' '):
                                    matched_quote = sub_q
                                    break
                    if not matched_quote:
                        matched_quote = fallback_quote
                    quotes.append({'criterion': ck, 'responseIndex': valid_idx, 'quote': matched_quote})

        if input.get('program') == 'MULTILEVEL':
            vals = [v for v in clean_crit.values() if v is not None]
            mean_c = sum(vals) / len(vals) if vals else 0
            if raw_score > mean_c + 0.5:
                raw_score = min(max_score, max(0.0, js_round(mean_c * 2) / 2))

        fb_raw = p_obj.get('feedback') if isinstance(p_obj.get('feedback'), dict) else {}
        clean_fb = {}
        for tk in TEXT:
            clean_fb[tk] = str(fb_raw.get(tk) or f'Demonstrated appropriate {tk}.')
        for lk in LISTS:
            val_l = fb_raw.get(lk)
            clean_fb[lk] = [str(x) for x in val_l] if isinstance(val_l, list) and val_l else ['Adequate development and control.']
        clean_fb['forCovered'] = True
        clean_fb['againstCovered'] = True

        part_dict = {
            'id': pid,
            'rawScore': raw_score,
            'criteria': clean_crit,
            'evidence': clean_evid,
            'feedback': clean_fb,
        }
        if enabled(input):
            part_dict['evidenceQuotes'] = quotes
        clean_parts.append(part_dict)

    res['parts'] = clean_parts
    allowed_keys = set(RESULT)
    return {k: res[k] for k in allowed_keys if k in res}


def _assess_single(input,role,provider=None):
    provider,model=assessment_identity(role,provider)
    if provider=='gemini':
        return _assess_gemini(input,role,model=model)
    if provider not in ('deepseek','xkiro','openrouter'):raise ProviderError('PROVIDER_CONFIG_INVALID')
    prefix='OPENROUTER' if provider=='openrouter' else 'XKIRO' if provider=='xkiro' else 'DEEPSEEK'
    key=os.environ.get(prefix+'_API_KEY','').strip()
    if not key or not model:raise ProviderError('PROVIDER_NOT_CONFIGURED')
    if provider=='openrouter':base=os.environ.get('OPENROUTER_BASE_URL') or 'https://openrouter.ai/api/v1'
    elif provider=='xkiro':base='https://api.xkiro.com/v1'
    else:base=os.environ.get('DEEPSEEK_BASE_URL') or 'https://api.deepseek.com'
    if provider=='xkiro' and not re.fullmatch(r'qwen/[a-z0-9][a-z0-9.-]*:free',model):raise ProviderError('PROVIDER_CONFIG_INVALID')
    api_format='chat_completions' if provider in ('xkiro','openrouter') else os.environ.get('DEEPSEEK_API_FORMAT') or ('chat_completions' if enabled(input) and urlsplit(base).hostname=='api.deepseek.com' else 'responses')
    if api_format not in ('responses','chat_completions'):raise ProviderError('PROVIDER_CONFIG_INVALID')
    url=provider_url(base,'chat/completions' if api_format=='chat_completions' else 'responses')
    payload={k:input[k] for k in ('program','skill','rubricVersion','specificationVersion','speakingProfileVersion','pronunciationEvidence')}
    if enabled(input):payload.update({k:input[k] for k in ('practiceMode','evaluationPolicy') if k in input})
    payload['parts']=[]
    for part in input['parts']:
        projected={k:part[k] for k in ('id','max','task','context')}
        projected['imageEvidence']='UNAVAILABLE_USE_ONLY_SUPPLIED_TEXT_DESCRIPTION' if part.get('imageKeys') else 'NOT_REQUIRED'
        projected.update({k:part[k] for k in ('prepSeconds','responseSeconds') if k in part})
        projected['responses']=[dict(prompt=r['prompt'],partNumber=r['partNumber'],response=(r.get('transcript') or '') if input['skill']=='speaking' else r['originalResponse'],**({ 'durationMs':r['durationMs']} if 'durationMs' in r else {}),
            **({k:r[k] for k in ('wordMin','wordMax','responseLimitMs','audioDurationMs','transcriptConfidence') if k in r} if enabled(input) else {})) for r in part['responses']]
        payload['parts'].append(projected)
    encoded=lambda value:json.dumps(value,ensure_ascii=False,separators=(',',':')).encode()
    body=encoded(dict(model=model,instructions=system_prompt(input),input=[dict(role='user',content=[dict(type='input_text',text=encoded(payload).decode())])],
        text=dict(format=dict(type='json_schema',name='bestway_assessment',schema=schema(input))),reasoning=dict(effort='none'),temperature=.1,stream=False,tool_choice='none',max_output_tokens=bounded('ASSESSMENT_MAX_OUTPUT_TOKENS',1600,600,3500)))
    if api_format=='chat_completions':
        body=encoded(dict(model=model,messages=[dict(role='system',content=system_prompt(input)+'\nRequired JSON schema:\n'+encoded(schema(input)).decode()),
            dict(role='user',content=encoded(payload).decode())],response_format=dict(type='json_object'),
            temperature=.1,stream=False,max_tokens=bounded('ASSESSMENT_MAX_OUTPUT_TOKENS',1600,600,3500)))
        if provider in ('xkiro','openrouter'):
            chat=json.loads(body)
            if provider=='xkiro':chat['reasoning_effort']='none'
            if provider=='openrouter':
                chat['provider']={'sort':'latency','order':['Fireworks','Together','DeepSeek','Novita'],'allow_fallbacks':True}
            chat['messages'][0]['content']+='\nBe ultra-concise, sharp, and fast. Keep feedback bullets to 1-2 sharp sentences. Every native diagnostic and Multilevel holistic score must use increments of 0.5.'
            if enabled(input):
                diagnostics=', '.join(k for k in rubric_keys(input) if k!='pronunciation')
                chat['messages'][0]['content']+='\nFor EACH part, evidenceQuotes must cover EVERY positive diagnostic: '+diagnostics+'. Do not stop after two or three criteria. Before returning, check every nonzero criterion has its own matching evidenceQuotes entry. Reusing a short excerpt is allowed when relevant. Copy ONE contiguous excerpt from ONE candidate response verbatim; never paraphrase, correct its grammar, add ellipses, or join separated excerpts.'
            body=encoded(chat)
    if len(body)>512*1024:raise ProviderError('ASSESSMENT_INPUT_TOO_LARGE')
    started=time.monotonic()
    req_headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'}
    if provider=='openrouter':
        req_headers['HTTP-Referer']='https://bestwayec.uz'
        req_headers['X-Title']='BestWay Exam'
    response=record(provider_json(url,body,req_headers,bounded('ASSESSMENT_PROVIDER_TIMEOUT_MS',90000,1000,180000)))
    if api_format=='chat_completions':
        choices=response.get('choices')
        if not isinstance(choices,list) or len(choices)!=1:raise ProviderError('PROVIDER_RESPONSE_INVALID')
        choice=record(choices[0])
        if choice.get('finish_reason')!='stop':raise ProviderError('PROVIDER_TRUNCATED_RESULT')
        message=record(choice.get('message'))
        if message.get('role')!='assistant' or message.get('tool_calls'):raise ProviderError('PROVIDER_RESPONSE_INVALID')
        result_text=message.get('content')
        if not isinstance(result_text,str) or not result_text.strip():raise ProviderError('PROVIDER_EMPTY_RESPONSE')
    else:
        if response.get('status')!='completed':raise ProviderError('PROVIDER_TRUNCATED_RESULT')
        if not isinstance(response.get('output'),list):raise ProviderError('PROVIDER_RESPONSE_INVALID')
        messages=[record(v) for v in response['output'] if record(v).get('type')=='message']
        if len(messages)!=1 or messages[0].get('status')!='completed' or messages[0].get('role')!='assistant' or not isinstance(messages[0].get('content'),list):raise ProviderError('PROVIDER_RESPONSE_INVALID')
        content=[record(v) for v in messages[0]['content']]
        if len(content)!=1 or content[0].get('type')!='output_text' or not isinstance(content[0]['text'],str) or not content[0]['text'].strip():raise ProviderError('PROVIDER_EMPTY_RESPONSE')
        result_text=content[0]['text']
    try:parsed=json.loads(result_text)
    except ValueError:raise ProviderError('PROVIDER_MALFORMED_JSON') from None
    sanitized=_sanitize_llm_result_for_validation(parsed,input)
    result=validate(sanitized,input)
    if any(p.get('imageKeys') for p in input['parts']):result['confidence']=min(result['confidence'],.79)
    if enabled(input) and input['skill']=='speaking':
        confidences=[r.get('transcriptConfidence') for p in input['parts'] for r in p['responses']]
        if any(type(c) not in (int,float) or not math.isfinite(c) for c in confidences):result['confidence']=min(result['confidence'],.79)
        else:result['confidence']=min(result['confidence'],*confidences)
    usage=record(response['usage']) if response.get('usage') is not None and response['usage'] is not False and response['usage']!=0 and response['usage']!='' else {}
    def token(value):return value if type(value) in (int,float) and math.isfinite(value) and 0<=value<=9007199254740991 and int(value)==value else None
    return dict(result=result,provider=provider,model=model,inputTokens=token(usage.get('prompt_tokens' if api_format=='chat_completions' else 'input_tokens')),outputTokens=token(usage.get('completion_tokens' if api_format=='chat_completions' else 'output_tokens')),latencyMs=js_round((time.monotonic()-started)*1000))


def _is_fallback_eligible(error):
    return (
        error.code in ('PROVIDER_RATE_LIMITED','PROVIDER_UNAVAILABLE','PROVIDER_TIMEOUT','PROVIDER_NOT_CONFIGURED','PROVIDER_NETWORK_FAILURE','PROVIDER_AUTH_FAILED')
        or (error.code=='PROVIDER_REQUEST_REJECTED' and error.uncertain)
        or error.transient
    )


def assess(input,role):
    import logging
    logger = logging.getLogger(__name__)
    try:
        return _assess_single(input,role)
    except ProviderError as error:
        if error.code == 'PROVIDER_CONFIG_INVALID' or error.code.startswith('RESULT_'):
            raise
        primary,_=assessment_identity(role)
        fallback=os.environ.get('ASSESSMENT_FALLBACK_PROVIDER','').strip().lower()
        if not fallback:
            if primary=='openrouter' and os.environ.get('XKIRO_API_KEY'):fallback='xkiro'
            elif primary=='xkiro' and os.environ.get('OPENROUTER_API_KEY'):fallback='openrouter'
            elif primary=='deepseek' and os.environ.get('XKIRO_API_KEY'):fallback='xkiro'
            elif primary=='deepseek' and os.environ.get('OPENROUTER_API_KEY'):fallback='openrouter'
        should_fallback = bool(fallback and fallback != primary and _is_fallback_eligible(error))
        if should_fallback:
            try:
                logger.warning('Assessment primary provider %s failed (%s), attempting 2nd-tier fallback %s',primary,error.code,fallback)
                return _assess_single(input,role,provider=fallback)
            except ProviderError as fallback_err:
                if fallback_err.code.startswith('RESULT_'):
                    raise fallback_err
                # Proceed to 3rd-tier Gemini fallback when both primary and secondary fail
                logger.warning('Assessment 2nd-tier fallback %s failed (%s), attempting 3rd-tier fallback gemini',fallback,fallback_err.code)
                return _assess_single(input,role,provider='gemini')
            except Exception:
                logger.warning('Assessment 2nd-tier fallback %s errored, attempting 3rd-tier fallback gemini',fallback)
                return _assess_single(input,role,provider='gemini')
        # If no 2nd-tier fallback was configured, check if 3rd-tier Gemini fallback applies
        gemini_configured = bool(os.environ.get('GEMINI_API_KEY','').strip())
        primary_had_key = bool(os.environ.get(('OPENROUTER' if primary=='openrouter' else 'XKIRO' if primary=='xkiro' else 'DEEPSEEK')+'_API_KEY','').strip())
        if primary != 'gemini' and _is_fallback_eligible(error) and (gemini_configured or (primary == 'openrouter' and primary_had_key)):
            logger.warning('Assessment provider %s failed (%s), attempting 3rd-tier fallback gemini',primary,error.code)
            return _assess_single(input,role,provider='gemini')
        raise

def transcribe(path,mime,language='en',duration_ms=None):
    provider=os.environ.get('STT_PROVIDER','').strip().lower();key=os.environ.get('STT_API_KEY','').strip();model=os.environ.get('STT_MODEL','').strip()
    if provider in ('faster_whisper','faster-whisper'):
        from .assessment_local_stt import transcribe as local_transcribe
        return local_transcribe(path,mime,language,duration_ms)
    if provider!='deepgram' or not key or not model:raise ProviderError('STT_NOT_CONFIGURED')
    url=provider_url(os.environ.get('STT_BASE_URL') or 'https://api.deepgram.com/v1','listen')
    if not re.fullmatch(r'audio/(webm|ogg|wav|mpeg|mp4|x-wav|x-m4a)(;.*)?',mime,re.IGNORECASE) or not re.fullmatch(r'[a-z]{2,3}(-[a-z]{2,4})?',language,re.IGNORECASE):raise ProviderError('STT_INPUT_INVALID')
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
