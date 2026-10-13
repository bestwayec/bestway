"""Versioned evidence checks and the explicitly internal practice grade."""
import copy
import re

PROMPT_VERSION = 'BESTWAY_ASSESSMENT_PROMPT_2026_V2'
EVIDENCE_POLICY = 'EVIDENCE_V2'
GRADE_POLICY = 'BESTWAY_MULTILEVEL_PRACTICE_75_CAP55_V1'


def enabled(input):
    return input.get('evaluationPolicy') == EVIDENCE_POLICY


def attempt_practice_grades(attempt):
    return {skill:grade for skill,raw in (getattr(attempt,'raw_scores',None) or {}).items()
        if isinstance(raw,dict) and isinstance(grade:=raw.get('practiceGrade'),dict)
        and grade.get('policyId')==GRADE_POLICY}


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
    if not sources or any(not normalized(source) for source in sources):
        raise ProviderError('ASSESSMENT_RESPONSE_EVIDENCE_MISSING')
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
        if not excerpt or len(quote) > 500 or (' '+excerpt+' ') not in (' '+normalized(sources[index])+' '):
            raise ProviderError('RESULT_EVIDENCE_INVALID')
        supported.add(criterion)
    if any(value is not None and value > 0 and key not in supported for key, value in rated['criteria'].items()):
        raise ProviderError('RESULT_EVIDENCE_INVALID')
    if input['program'] == 'MULTILEVEL':
        values = [value for value in rated['criteria'].values() if value is not None]
        mean = sum(values)/len(values)
        # Holistic marks may differ by half a point, but cannot contradict the
        # diagnostic evidence or turn an off-task response into a top grade.
        if rated['rawScore'] > mean+.5 or rated['rawScore'] > rated['criteria']['taskCoverage']+.5:
            raise ProviderError('RESULT_SCORE_EVIDENCE_CONFLICT')
    high = rated['rawScore'] is not None and rated['rawScore'] >= part['max']-.5
    if high:
        # A sentence fragment cannot establish upper-band language range. These
        # checks request review instead of inventing a lower numerical mark.
        if any(len(normalized(source).split()) < 5 for source in sources):
            raise ProviderError('RESULT_INSUFFICIENT_RESPONSE_EVIDENCE')
        if input['skill'] == 'writing':
            for response, source in zip(part['responses'], sources):
                minimum = response.get('wordMin')
                if minimum and len(normalized(source).split()) < minimum:
                    raise ProviderError('RESULT_INSUFFICIENT_RESPONSE_EVIDENCE')


def practice_grade(input, result):
    if input['program']!='MULTILEVEL' or (input.get('gradingPolicy') or {}).get('id') != GRADE_POLICY:
        return None
    from .assessment_results import score
    from .mock_scoring import convert_expert, js_round
    value = score(input, result)
    if value['score'] is None:
        return None
    raw = value['rawTotal'] if input['program'] == 'MULTILEVEL' else value['score']
    maximum = sum(part['max'] for part in input['parts']) if input['program'] == 'MULTILEVEL' else 9
    if maximum <= 0:
        return None
    standard = convert_expert(input['skill'], raw)
    calibrated_score = min(55.0, float(standard))
    return dict(policyId=GRADE_POLICY, score=js_round(calibrated_score * 10) / 10, scaleMax=75,
        rangeMax=55, rawScore=raw, rawMax=maximum, isOfficial=False)


def attach_grade(input, result):
    if enabled(input):
        result=copy.deepcopy(result)
        if any(part.get('imageKeys') for part in input['parts']):result['confidence']=min(result['confidence'],.79)
        if input['skill']=='speaking':
            confidences=[response.get('transcriptConfidence') for part in input['parts'] for response in part['responses']]
            from math import isfinite
            if any(type(value) not in (int,float) or not isfinite(value) or not 0<=value<=1 for value in confidences):result['confidence']=min(result['confidence'],.79)
            else:result['confidence']=min(result['confidence'],*confidences)
    if enabled(input) and input['program']=='MULTILEVEL':
        result['practiceGrade'] = practice_grade(input, result)
    return result
