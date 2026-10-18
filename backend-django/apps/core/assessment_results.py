"""Deterministic assessment scoring and strict provider-result boundary."""
import copy
import math

from common.api.exceptions import ContractAPIException

from .mock_scoring import convert_expert, js_round, multilevel_level, round_half


class ProviderError(Exception):
    def __init__(self, code, transient=False, uncertain=False):
        self.code,self.transient,self.uncertain=code,transient,uncertain
        super().__init__(code)

TEXT=['taskCoverage','grammar','vocabulary','fluencyCohesion','ideaDevelopment','register','spellingPunctuation','position','argumentBalance']
LISTS=['strengths','issues','missedPrompts','usefulPhrases']
TOP=['overallStrengths','priorityImprovements','recommendedPractice']
RESULT=['parts',*TOP,'grammarCorrections','vocabularyUpgrades','improvedExamples','confidence','pronunciationEvidence']

def keys(value):
    return ['taskCoverage','grammar','vocabulary','cohesion','ideaDevelopment'] if value['program']=='MULTILEVEL' else ['ta','cc','lr','gra'] if value['skill']=='writing' else ['fluency','lexical','grammar','pronunciation']

def invalid():raise ProviderError('RESULT_SCHEMA_INVALID')
def exact(value,required):
    if not isinstance(value,dict) or set(value)!=set(required):invalid()
    return value
def text(value):
    if not isinstance(value,str) or len(value.encode('utf-16-le',errors='surrogatepass'))//2>8000:invalid()
    return value
def array(value,maximum=30):
    if not isinstance(value,list) or len(value)>maximum:invalid()
    return value
def texts(value):return [text(v) for v in array(value)]
def number(value,maximum,half=False):
    if type(value) not in (int,float) or not math.isfinite(value) or not 0<=value<=maximum or half and value*2!=js_round(value*2):invalid()
    return value
def objects(value,required):return [{k:text(exact(v,required)[k]) for k in required} for v in array(value)]
def half(value,maximum):return type(value) in (int,float) and math.isfinite(value) and 0<=value<=maximum and value*2==int(value*2)

def validate(value,input):
    from . import assessment_quality as quality
    if isinstance(value, dict) and 'diagnostic_feedback' in value:
        value = {k: v for k, v in value.items() if k != 'diagnostic_feedback'}
    required=RESULT+(['practiceGrade'] if quality.enabled(input) and isinstance(value,dict) and 'practiceGrade' in value else [])
    row=exact(value,required)
    if row['pronunciationEvidence']!=input['pronunciationEvidence']:invalid()
    rows=array(row['parts'],20)
    if len(rows)!=len(input['parts']):invalid()
    seen=set();parts=[];criteria_keys=keys(input)
    for p in rows:
        exact(p,['id','rawScore','criteria','evidence','feedback']+(['evidenceQuotes'] if quality.enabled(input) else []));identifier=text(p['id'])
        spec=next((s for s in input['parts'] if s['id']==identifier),None)
        if spec is None or identifier in seen:invalid()
        seen.add(identifier);criteria=exact(p['criteria'],criteria_keys);evidence=exact(p['evidence'],criteria_keys)
        normalized={};explanations={}
        for key in criteria_keys:
            unavailable=key=='pronunciation' and input['pronunciationEvidence']=='UNAVAILABLE'
            if unavailable and criteria[key] is not None:invalid()
            normalized[key]=None if unavailable else number(criteria[key],spec['max'],True)
            explanations[key]=text(evidence[key])
            if not explanations[key].strip():invalid()
        raw=None if p['rawScore'] is None else number(p['rawScore'],spec['max'],input['program']=='MULTILEVEL')
        if input['program']!='MULTILEVEL':raw=None if None in normalized.values() else sum(normalized.values())/len(normalized)
        elif raw is None:invalid()
        fb=exact(p['feedback'],[*TEXT,*LISTS,'forCovered','againstCovered'])
        feedback={k:text(fb[k]) for k in TEXT};feedback.update({k:texts(fb[k]) for k in LISTS})
        for k in ('forCovered','againstCovered'):
            if fb[k] is not None and type(fb[k]) is not bool:invalid()
            feedback[k]=fb[k]
        if input['program']=='MULTILEVEL' and input['skill']=='speaking' and identifier=='3' and raw==6 and (feedback['forCovered'] is not True or feedback['againstCovered'] is not True):invalid()
        rated=dict(id=identifier,rawScore=raw,criteria=normalized,evidence=explanations,feedback=feedback)
        if quality.enabled(input):
            rated['evidenceQuotes']=copy.deepcopy(p['evidenceQuotes'])
            quality.check(input,spec,rated)
        parts.append(rated)
    examples=objects(row['improvedExamples'],['partId','text'])
    if any(e['partId'] not in seen for e in examples):invalid()
    result=dict(parts=parts,**{k:texts(row[k]) for k in TOP},grammarCorrections=objects(row['grammarCorrections'],['original','corrected','explanation']),
        vocabularyUpgrades=objects(row['vocabularyUpgrades'],['original','alternative','explanation']),improvedExamples=examples,
        confidence=number(row['confidence'],1),pronunciationEvidence=input['pronunciationEvidence'])
    result['diagnostic_feedback'] = format_diagnostic_feedback(result, input)
    return quality.attach_grade(input,result)


def format_diagnostic_feedback(result, input=None):
    if not isinstance(result, dict):
        return None
    CRIT_NAMES = {
        'ta': 'Task Achievement / Response',
        'cc': 'Coherence & Cohesion',
        'lr': 'Lexical Resource',
        'gra': 'Grammatical Range & Accuracy',
        'taskCoverage': 'Task Coverage & Content',
        'grammar': 'Grammatical Accuracy & Range',
        'vocabulary': 'Lexical Resource & Vocabulary',
        'cohesion': 'Coherence & Organization',
        'ideaDevelopment': 'Idea Development & Relevance',
        'fluency': 'Fluency & Spontaneous Speech',
        'lexical': 'Lexical Variety & Phrasing',
        'pronunciation': 'Pronunciation & Intonation'
    }
    criteria_scores = []
    parts = result.get('parts') or []
    seen_crit = set()
    for p in parts:
        crit = p.get('criteria') or {}
        evid = p.get('evidence') or {}
        for k, score in crit.items():
            if score is not None and k not in seen_crit:
                seen_crit.add(k)
                criteria_scores.append({
                    'criterion': CRIT_NAMES.get(k, k.replace('_', ' ').title()),
                    'score': score,
                    'comment': evid.get(k, '')
                })
    if not criteria_scores and parts:
        p = parts[0]
        if p.get('rawScore') is not None:
            criteria_scores.append({
                'criterion': 'Overall Demonstrated Score',
                'score': p.get('rawScore'),
                'comment': p.get('feedback', {}).get('taskCoverage', '')
            })

    mistakes_and_fixes = []
    for item in result.get('grammarCorrections') or []:
        mistakes_and_fixes.append({
            'original': item.get('original', ''),
            'corrected': item.get('corrected', ''),
            'explanation': item.get('explanation', '')
        })

    vocabulary_upgrades = []
    for item in result.get('vocabularyUpgrades') or []:
        vocabulary_upgrades.append({
            'original': item.get('original', ''),
            'alternative': item.get('alternative', ''),
            'explanation': item.get('explanation', '')
        })

    action_plan = []
    for item in result.get('priorityImprovements') or []:
        if item and item not in action_plan:
            action_plan.append(item)
    for item in result.get('recommendedPractice') or []:
        if item and item not in action_plan:
            action_plan.append(item)

    improved = result.get('improvedExamples') or []
    band_8_rewrite = "\n\n".join(e.get('text', '') for e in improved if e.get('text'))
    if not band_8_rewrite and parts:
        band_8_rewrite = parts[0].get('feedback', {}).get('register', '')

    return {
        'criteria_scores': criteria_scores,
        'mistakes_and_fixes': mistakes_and_fixes,
        'vocabulary_upgrades': vocabulary_upgrades,
        'action_plan': action_plan,
        'band_8_rewrite': band_8_rewrite
    }

def fail(message):raise ContractAPIException('ASSESSMENT_INVALID_SCORE',message,400)
def score(input,result):
    by_id={p['id']:p for p in result['parts']}
    if len(by_id)!=len(input['parts']) or len(result['parts'])!=len(input['parts']):fail('Incomplete rubric')
    parts=[]
    for part in input['parts']:
        rated=by_id.get(part['id'])
        if rated is None:fail('Missing rubric part')
        if input['program']=='MULTILEVEL':
            value=rated['rawScore']
            if not half(value,part['max']):fail('Raw score must use half points within the task maximum')
        else:
            required=['ta','cc','lr','gra'] if input['skill']=='writing' else ['fluency','lexical','grammar','pronunciation']
            if input['skill']=='speaking' and rated['criteria'].get('pronunciation','missing') is None:value=None
            else:
                if not all(half(rated['criteria'].get(k),9) for k in required):fail('Four criterion bands are required')
                value=sum(rated['criteria'][k] for k in required)/4
        parts.append(dict(id=part['id'],score=value))
    if any(p['score'] is None for p in parts):return dict(score=None,rawTotal=None,level=None,parts=parts)
    if input['program']=='MULTILEVEL':
        raw=sum(p['score'] for p in parts)
        if input.get('practiceMode')=='PARTIAL':return dict(score=raw,rawTotal=raw,level=None,parts=parts)
        value=convert_expert(input['skill'],raw)
        return dict(score=value,rawTotal=raw,level=multilevel_level(value),parts=parts)
    weights=[p.get('weight',2 if p['id'].startswith('task2') else 1) if input['skill']=='writing' else 1 for p in input['parts']]
    return dict(score=round_half(sum(p['score']*w for p,w in zip(parts,weights))/sum(weights)),rawTotal=None,level=None,parts=parts)

def combine(a,b,input):
    result=copy.deepcopy(b);result['confidence']=min(a['confidence'],b['confidence'])
    for part in result['parts']:
        previous=next((p for p in a['parts'] if p['id']==part['id']),None)
        if previous is None:invalid()
        def mean(x,y):return None if x is None or y is None else js_round(x+y)/2
        part['rawScore']=mean(previous['rawScore'],part['rawScore'])
        part['criteria']={k:mean(previous['criteria'][k],v) for k,v in part['criteria'].items()}
    return validate(result,input)

def empty(input):
    return dict(parts=[dict(id=p['id'],rawScore=0 if input['program']=='MULTILEVEL' else None,criteria={},evidence={},
        feedback=dict(**{k:'' for k in TEXT},**{k:[] for k in LISTS},forCovered=None,againstCovered=None)) for p in input['parts']],
        **{k:[] for k in TOP},grammarCorrections=[],vocabularyUpgrades=[],improvedExamples=[],confidence=0,pronunciationEvidence='UNAVAILABLE')

def feedback_edit(value,base):
    """Validate editable feedback without manufacturing manual rubric evidence."""
    row=exact(value,RESULT+(['practiceGrade'] if 'practiceGrade' in base else []));parts=array(row['parts'],20)
    if row.get('practiceGrade')!=base.get('practiceGrade'):invalid()
    if len(parts)!=len(base['parts']):invalid()
    seen=set();rated=[]
    for part in parts:
        original=next((p for p in base['parts'] if p['id']==part.get('id')),None) if isinstance(part,dict) else None
        exact(part,['id','rawScore','criteria','evidence','feedback']+(['evidenceQuotes'] if original and 'evidenceQuotes' in original else []));identifier=text(part['id'])
        if original and part.get('evidenceQuotes')!=original.get('evidenceQuotes'):invalid()
        if identifier in seen or not any(p['id']==identifier for p in base['parts']):invalid()
        seen.add(identifier);fb=exact(part['feedback'],[*TEXT,*LISTS,'forCovered','againstCovered'])
        feedback={k:text(fb[k]) for k in TEXT};feedback.update({k:texts(fb[k]) for k in LISTS})
        for key in ('forCovered','againstCovered'):
            if fb[key] is not None and type(fb[key]) is not bool:invalid()
            feedback[key]=fb[key]
        rated.append(dict(part,feedback=feedback))
    examples=objects(row['improvedExamples'],['partId','text'])
    if any(e['partId'] not in seen for e in examples):invalid()
    return dict(row,parts=rated,**{k:texts(row[k]) for k in TOP},
        grammarCorrections=objects(row['grammarCorrections'],['original','corrected','explanation']),
        vocabularyUpgrades=objects(row['vocabularyUpgrades'],['original','alternative','explanation']),improvedExamples=examples)

def teacher_result(input,base,parts):
    if len(parts)!=len(input['parts']) or len({p['id'] for p in parts})!=len(parts):fail('Provide each formal part once')
    result=copy.deepcopy(base);rated=[]
    for part in input['parts']:
        override=next((p for p in parts if p['id']==part['id']),None);original=next((p for p in base['parts'] if p['id']==part['id']),None)
        if override is None or original is None:fail('Unknown rubric part')
        rated.append(dict(original,rawScore=override.get('rawScore') if input['program']=='MULTILEVEL' else None,criteria=original['criteria'] if input['program']=='MULTILEVEL' else override.get('criteria') or {}))
    result['parts']=rated
    if input['program']!='MULTILEVEL' and input['skill']=='speaking':result['pronunciationEvidence']='ACOUSTIC'
    if score(input,result)['score'] is None:fail('A complete teacher score is required')
    from .assessment_quality import attach_grade
    return attach_grade(input,result)

def adjudicate(input,result,threshold=.85):
    if result['confidence']<threshold:return True
    value=score(input,result)['score']
    return input['program']=='MULTILEVEL' and value is not None and any(abs(value-boundary)<=1 for boundary in (38,51,65))

def schema(input):
    string=dict(type='string',maxLength=8000);strings=dict(type='array',maxItems=30,items=string)
    def obj(properties):return dict(type='object',additionalProperties=False,properties=properties,required=list(properties))
    def rows(required):return dict(type='array',maxItems=30,items=obj({k:string for k in required}))
    maximum=6 if input['program']=='MULTILEVEL' else 9
    criteria={k:dict(type='null') if k=='pronunciation' and input['pronunciationEvidence']=='UNAVAILABLE' else dict(type='number',minimum=0,maximum=maximum,multipleOf=.5) for k in keys(input)}
    from .assessment_quality import enabled
    anchors=dict(evidenceQuotes=dict(type='array',maxItems=50,items=obj(dict(criterion=dict(type='string',enum=keys(input)),responseIndex=dict(type='integer',minimum=0),quote=dict(type='string',minLength=1,maxLength=500))))) if enabled(input) else {}
    part_schema=dict(id=dict(type='string',enum=[p['id'] for p in input['parts']]),rawScore=dict(type=['number','null'],minimum=0,maximum=maximum),
        criteria=obj(criteria),evidence=obj({k:string for k in keys(input)}),feedback=obj(dict(**{k:string for k in TEXT},**{k:strings for k in LISTS},forCovered=dict(type=['boolean','null']),againstCovered=dict(type=['boolean','null']))),**anchors)
    return obj(dict(parts=dict(type='array',minItems=len(input['parts']),maxItems=len(input['parts']),items=obj(part_schema)),
        **{k:strings for k in TOP},grammarCorrections=rows(['original','corrected','explanation']),vocabularyUpgrades=rows(['original','alternative','explanation']),
        improvedExamples=rows(['partId','text']),confidence=dict(type='number',minimum=0,maximum=1),pronunciationEvidence=dict(type='string',enum=[input['pronunciationEvidence']])))
