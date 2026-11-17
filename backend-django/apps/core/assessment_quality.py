"""Versioned evidence checks for AI Writing/Speaking assessment."""
import copy
import re

PROMPT_VERSION = 'BESTWAY_ASSESSMENT_PROMPT_2026_V3'
EVIDENCE_POLICY = 'EVIDENCE_V2'


def enabled(input):
    return input.get('evaluationPolicy') == EVIDENCE_POLICY


def manual_result_skills(attempt):
    """Writing/Speaking sections of a Multilevel attempt that carry a result (these get the internal result
    certificate, and only once a teacher has confirmed them). The score is always the AI's or teacher's own."""
    return {skill:raw for skill,raw in (getattr(attempt,'raw_scores',None) or {}).items()
        if skill in ('writing','speaking') and isinstance(raw,dict)}


def normalized(value):
    return ' '.join(re.findall(r"[\w]+(?:['’][\w]+)?", value.casefold()))


def response_text(input, response):
    return response.get('transcript', '') if input['skill'] == 'speaking' else response.get('originalResponse', '')


def evidence_input(snapshot, transcripts):
    value=copy.deepcopy(snapshot)
    if value['skill']=='speaking':
        for part in value['parts']:
            for response in part['responses']:
                saved=next((t for t in transcripts if t.status=='SUCCEEDED' and
                    t.question_id==response['questionId'] and t.audio_hash==response.get('audioHash')),None)
                if saved:
                    response['transcript']=saved.text or ''
                    if enabled(value):response.update(transcriptConfidence=saved.confidence,audioDurationMs=saved.duration_ms)
    return value


def check(input, part, rated):
    """Reject fabricated support; never silently replace an inflated grade."""
    from .assessment_results import ProviderError
    sources = [response_text(input, response) for response in part['responses']]
    has_any = any(bool(normalized(source)) for source in sources)
    if not has_any:
        if (rated.get('rawScore') or 0) > 0 or any((v or 0) > 0 for v in (rated.get('criteria') or {}).values()):
            raise ProviderError('ASSESSMENT_RESPONSE_EVIDENCE_MISSING')
        return

    anchors = rated.get('evidenceQuotes')
    if not isinstance(anchors, list) or len(anchors) > 50:
        raise ProviderError('RESULT_EVIDENCE_INVALID')
    supported = set()
    for anchor in anchors:
        if not isinstance(anchor, dict) or set(anchor) != {'criterion', 'responseIndex', 'quote'}:
            raise ProviderError('RESULT_EVIDENCE_INVALID')
        index = anchor['responseIndex']; quote = anchor['quote']; criterion = anchor['criterion']
        if type(index) is not int or not 0 <= index < len(sources) or not isinstance(criterion,str) or criterion not in rated['criteria'] or not isinstance(quote, str):
            raise ProviderError('RESULT_EVIDENCE_INVALID')
        excerpt = normalized(quote)
        source_normalized = normalized(sources[index])
        if not excerpt or len(quote) > 500 or not source_normalized or (' '+excerpt+' ') not in (' '+source_normalized+' '):
            raise ProviderError('RESULT_EVIDENCE_INVALID')
        supported.add(criterion)
    if any(value is not None and value > 0 and key not in supported for key, value in rated['criteria'].items()):
        raise ProviderError('RESULT_EVIDENCE_INVALID')
    if input['program'] == 'MULTILEVEL':
        values = [value for value in rated['criteria'].values() if value is not None]
        mean = sum(values)/len(values) if values else 0
        if rated.get('rawScore') is not None and (rated['rawScore'] > mean+.5 or ('taskCoverage' in rated.get('criteria', {}) and rated['criteria']['taskCoverage'] is not None and rated['rawScore'] > rated['criteria']['taskCoverage']+.5)):
            raise ProviderError('RESULT_SCORE_EVIDENCE_CONFLICT')
    high = rated['rawScore'] is not None and rated['rawScore'] >= part['max']-.5
    if high:
        # A sentence fragment cannot establish upper-band language range.
        answered_sources = [s for s in sources if normalized(s)]
        if any(len(normalized(source).split()) < 5 for source in answered_sources):
            raise ProviderError('RESULT_INSUFFICIENT_RESPONSE_EVIDENCE')
        if input['skill'] == 'writing':
            for response, source in zip(part['responses'], sources):
                minimum = response.get('wordMin')
                if minimum and len(normalized(source).split()) < minimum:
                    raise ProviderError('RESULT_INSUFFICIENT_RESPONSE_EVIDENCE')


def attach_grade(input, result):
    if enabled(input):
        result=copy.deepcopy(result)
        if any(part.get('imageKeys') for part in input['parts']):result['confidence']=min(result['confidence'],.79)
        if input['skill']=='speaking':
            confidences=[response.get('transcriptConfidence') for part in input['parts'] for response in part['responses']]
            from math import isfinite
            if any(type(value) not in (int,float) or not isfinite(value) or not 0<=value<=1 for value in confidences):result['confidence']=min(result['confidence'],.79)
            else:result['confidence']=min(result['confidence'],*confidences)
    return result
