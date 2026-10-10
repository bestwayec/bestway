"""Deterministic assessment scoring and strict provider-result boundary."""
import copy
import math
from common.api.exceptions import ContractAPIException
from .mock_scoring import convert_expert, multilevel_level, round_half, js_round

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
    row=exact(value,RESULT)
    if row['pronunciationEvidence']!=input['pronunciationEvidence']:invalid()
    rows=array(row['parts'],20)
    if len(rows)!=len(input['parts']):invalid()
    seen=set();parts=[];criteria_keys=keys(input)
    for p in rows:
        exact(p,['id','rawScore','criteria','evidence','feedback']);identifier=text(p['id'])
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
        parts.append(dict(id=identifier,rawScore=raw,criteria=normalized,evidence=explanations,feedback=feedback))
    examples=objects(row['improvedExamples'],['partId','text'])
    if any(e['partId'] not in seen for e in examples):invalid()
    return dict(parts=parts,**{k:texts(row[k]) for k in TOP},grammarCorrections=objects(row['grammarCorrections'],['original','corrected','explanation']),
        vocabularyUpgrades=objects(row['vocabularyUpgrades'],['original','alternative','explanation']),improvedExamples=examples,
        confidence=number(row['confidence'],1),pronunciationEvidence=input['pronunciationEvidence'])

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
        raw=sum(p['score'] for p in parts);value=convert_expert(input['skill'],raw)
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
    return result

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
    return obj(dict(parts=dict(type='array',minItems=len(input['parts']),maxItems=len(input['parts']),items=obj(dict(
        id=dict(type='string',enum=[p['id'] for p in input['parts']]),rawScore=dict(type=['number','null'],minimum=0,maximum=maximum),
        criteria=obj(criteria),evidence=obj({k:string for k in keys(input)}),feedback=obj(dict(**{k:string for k in TEXT},**{k:strings for k in LISTS},forCovered=dict(type=['boolean','null']),againstCovered=dict(type=['boolean','null'])))))),
        **{k:strings for k in TOP},grammarCorrections=rows(['original','corrected','explanation']),vocabularyUpgrades=rows(['original','alternative','explanation']),
        improvedExamples=rows(['partId','text']),confidence=dict(type='number',minimum=0,maximum=1),pronunciationEvidence=dict(type='string',enum=[input['pronunciationEvidence']])))
