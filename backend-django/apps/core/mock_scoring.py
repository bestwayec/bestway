"""Deterministic submission compatibility, ported from Nest mock-answer/scoring.

No provider calls or teacher assessment. Stage C can reuse these pure functions.
"""
import json
import math
import re
import unicodedata

# ECMAScript whitespace is not Python's \s/strip set (BOM is whitespace;
# U+0085 and U+001C are not). Keep this direct port separate from authoring.
JS_SPACE = '\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'
SPACE_PATTERN = '[' + JS_SPACE + ']'


def trim(value):
    return value.strip(JS_SPACE)


def strict_answer_text(value):
    return re.sub(SPACE_PATTERN+'+', ' ', trim(unicodedata.normalize('NFKC', value)).lower())


def canonical_decision(value):
    token = re.sub('['+JS_SPACE+'-]+', '_', trim(value).upper())
    return 'NOT_GIVEN' if token in ('NOT_GIVEN','NO_INFORMATION') else token


def choice_index(value, options):
    normalized = strict_answer_text(value)
    for index, option in enumerate(options):
        if strict_answer_text(option)==normalized:
            return index
    if len(normalized)==1 and 'a'<=normalized<='z':
        index=ord(normalized)-ord('a')
        return index if index<len(options) else None
    return None


def respects_answer_rule(value, rule):
    tokens = [token for token in strict_answer_text(value).split(' ') if token]
    numeric = sum(bool(re.fullmatch(r'[+-]?[0-9]+(?:[.,:/-][0-9]+)*%?', token)) for token in tokens)
    def word(token):
        parts=re.split("[-'’]",token)
        return all(part and all(unicodedata.category(c).startswith('L') for c in part) for part in parts)
    words=sum(word(token) for token in tokens)
    if numeric+words!=len(tokens):
        return False
    return len(tokens)==1 and words==1 if rule=='ONE_WORD' else bool(tokens) and words<=1 and numeric<=1

ESTIMATE_VERSION = 'UZBMB_MULTILEVEL_EN_2026_V1_ESTIMATE_V1'
LISTENING = [(39,9),(37,8.5),(35,8),(32,7.5),(30,7),(26,6.5),(23,6),(18,5.5),(16,5),(13,4.5),(11,4),(6,3.5),(4,3),(2,2.5),(0,2)]
ACADEMIC = [(39,9),(37,8.5),(35,8),(33,7.5),(30,7),(27,6.5),(23,6),(19,5.5),(15,5),(13,4.5),(10,4),(6,3.5),(4,3),(2,2.5),(0,2)]
GENERAL = [(40,9),(39,8.5),(37,8),(36,7.5),(34,7),(32,6.5),(30,6),(27,5.5),(23,5),(19,4.5),(15,4),(12,3.5),(9,3),(6,2.5),(3,2),(0,2)]
WRITING = [0,10,14,17,21,25,28,31,33,35,37,38,40,41,43,45,47,48,50,51,53,55,57,59,61,62,63,64,65,67,69,72,75]
SPEAKING = [0,10,11,13,15,17,19,21,23,24,26,27,29,30,32,33,35,37,38,39,40,42,43,45,46,47,49,50,51,52,54,56,57,59,61,63,64,65,67,69,71,73,75]
NUMBER_WORDS = dict(zip('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand first second third fifth eighth ninth twelfth'.split(),
    list(map(str, range(21)))+['30','40','50','60','70','80','90','100','1000','1','2','3','5','8','9','12']))
WORD_BY_NUMBER = {n:w for w,n in NUMBER_WORDS.items()}


def js_round(value):
    return math.floor(value + .5)


def round_half(value):
    return js_round(value*2)/2


def normalize(value):
    value = unicodedata.normalize('NFKC', value).translate(str.maketrans({**{c:"'" for c in '‘’‚‛`´'}, **{c:'"' for c in '“”„‟'}, **{c:'-' for c in '–—―−'}})).lower()
    return trim(re.sub(SPACE_PATTERN+'+', ' ', re.sub(r'[.,/#!$%^&*;:{}=`~()"?\[\]<>+@\\|]', ' ', value)))


def variants(value):
    base = normalize(value)
    if not base:
        return set()
    result = {base}
    if '-' in base: result.add(base.replace('-', ' '))
    if ' ' in base: result.add(base.replace(' ', '-'))
    no_article = re.sub(r'^(a|an|the)\s+', '', base)
    result.add(no_article)
    if '-' in no_article: result.add(no_article.replace('-', ' '))
    for form in (base, no_article):
        if form in NUMBER_WORDS: result.add(NUMBER_WORDS[form])
        if form in WORD_BY_NUMBER: result.add(WORD_BY_NUMBER[form])
    return result


def correct(kind, response, keys, *, word_limit=None, accepted_variants=None, answer_rule=None, options=None):
    if not response or not trim(response) or not keys:
        return False
    if answer_rule in ('ONE_WORD', 'ONE_WORD_AND_OR_NUMBER'):
        return respects_answer_rule(response, answer_rule) and any(strict_answer_text(response) == strict_answer_text(k) for k in keys+(accepted_variants or []))
    if kind in ('true_false_notgiven', 'yes_no_notgiven'):
        return any(canonical_decision(response) == canonical_decision(k) for k in keys)
    if options and kind in ('multiple_choice','matching','matching_headings','map_labelling'):
        chosen = choice_index(response, options)
        expected = [choice_index(k, options) for k in keys]
        if chosen is not None and None not in expected:
            return chosen in expected
    if options and kind == 'multi_select':
        if trim(response).startswith('['):
            try: parts = json.loads(response)
            except ValueError: return False
            if not isinstance(parts, list) or not all(isinstance(p,str) for p in parts): return False
        elif choice_index(response, options) is not None:
            parts = [response]
        else:
            parts = [trim(p) for p in re.split(r'[,;]+', response) if trim(p)]
        if len(parts) == 1 and re.fullmatch('[a-z](?:'+SPACE_PATTERN+'+[a-z])+', parts[0], re.I|re.ASCII):
            parts = re.split(SPACE_PATTERN+'+',parts[0])
        chosen, expected = [choice_index(p, options) for p in parts], [choice_index(k, options) for k in keys]
        if None not in chosen and None not in expected:
            return set(chosen) == set(expected)
    if word_limit is not None and word_limit > 0 and len([p for p in normalize(response).split(' ') if p]) > word_limit:
        return False
    if kind == 'multi_select':
        choices = lambda value: {normalize(p) for p in re.split('[,;'+JS_SPACE+']+', value) if normalize(p)}
        return choices(response) == set().union(*(choices(k) for k in keys))
    expected = set().union(*(variants(k) for k in keys+(accepted_variants or [])))
    return bool(variants(response) & expected)


def duplicate_matching(questions, responses):
    selected = {}
    for q in questions:
        if q['type'] not in ('matching','matching_headings','map_labelling'): continue
        index = choice_index(responses.get(q['id'], ''), q.get('options') or [])
        if index is not None: selected.setdefault(index, []).append(q['id'])
    return {qid for items in selected.values() if len(items)>1 for qid in items}


def parse_band_table(raw):
    if not isinstance(raw, list) or not raw: raise ValueError('Empty band table')
    result = {}
    for row in raw:
        if not isinstance(row, (list,tuple)) or len(row)!=2: raise ValueError('Invalid band row')
        minimum, band = row
        if type(minimum) not in (int,float) or not math.isfinite(minimum) or minimum != int(minimum) or not 0<=minimum<=40: raise ValueError('Invalid raw minimum')
        if type(band) not in (int,float) or not math.isfinite(band) or not 0<=band<=9 or band*2!=js_round(band*2): raise ValueError('Invalid band')
        # Nest's stable sort retains the first duplicate (despite its comment).
        result.setdefault(minimum, band)
    if 0 not in result: raise ValueError('Missing zero row')
    return sorted(result.items(), reverse=True)


def band_from_raw(skill, exam_type, score, maximum, tables=None, attempted=True):
    if maximum<=0 or not attempted: return 0
    key = 'listening' if skill=='listening' else 'readingGeneral' if exam_type=='ielts_general' else 'readingAcademic'
    table = (tables or {}).get(key, LISTENING if key=='listening' else GENERAL if key=='readingGeneral' else ACADEMIC)
    scaled = js_round(max(0,min(score,maximum))/maximum*40)
    return next((band for minimum,band in table if scaled>=minimum),0)


def estimate_objective(raw, maximum):
    if type(maximum) not in (int,float) or maximum != int(maximum) or maximum<1 or not math.isfinite(raw) or not 0<=raw<=maximum: raise ValueError('Invalid objective score')
    scaled = raw*35/maximum
    anchors = [(0,0),(9,37),(10,38),(17,50),(18,51),(27,64),(28,65),(35,75)]
    right = next(i for i,(x,_) in enumerate(anchors) if x>=scaled)
    x1,y1 = anchors[max(0,right-1)]; x2,y2 = anchors[right]
    value = y1 if x1==x2 else y1+(scaled-x1)*(y2-y1)/(x2-x1)
    return dict(rawCorrect=raw,questionCount=maximum,estimatedStandardScore=js_round(value*100)/100,scoreMethod='ESTIMATED',scoreVersion=ESTIMATE_VERSION,isOfficial=False)


def convert_expert(skill, raw):
    table = WRITING if skill=='writing' else SPEAKING
    if not math.isfinite(raw) or raw<0 or raw*2!=js_round(raw*2) or raw*2>=len(table): raise ValueError('Invalid expert raw score')
    return table[int(raw*2)]


def multilevel_level(score):
    if not math.isfinite(score) or not 0<=score<=75: raise ValueError('Invalid standard score')
    return 'C1' if score>=65 else 'B2' if score>=51 else 'B1' if score>=38 else 'BELOW_B1'


def cefr_band(band):
    return 'C1' if band>=8 else 'B2' if band>=6.5 else 'B1' if band>=5 else 'A2' if band>=4 else 'A1'


def cefr_percent(percent):
    return next((level for minimum,level in [(90,'C1'),(75,'B2'),(60,'B1'),(45,'A2'),(30,'A1')] if percent>=minimum),'Below A1')


def calculate(exam_type, sections, answers, *, versioned=False, full_test=False, tables=None):
    """Return exact result and answer-score projections, without mutating inputs."""
    aggregates, projections = [], {}
    ielts = exam_type in ('ielts_academic','ielts_general')
    versioned = versioned and not ielts
    for section in sections:
        skill = section['skill']; auto = skill in ('listening','reading')
        agg = dict(skill=skill,score=0,max=0,pending=False,answered=0,tasks=[])
        for group in section['groups']:
            qs = group['questions']; group_scores = []
            duplicate = duplicate_matching(qs,{qid:a.get('response','') for qid,a in answers.items()}) if group.get('optionsReusable') is False else set()
            for q in qs:
                agg['max'] += q['points']; answer = answers.get(q['id'])
                if auto:
                    if answer and trim(answer.get('response','')): agg['answered'] += 1
                    matches = bool(answer) and q['id'] not in duplicate and correct(q['type'],answer['response'],q.get('correctAnswers') or [],word_limit=q.get('wordLimit'),accepted_variants=q.get('acceptedVariants'),answer_rule=q.get('answerRule'),options=q.get('options'))
                    score = q['points'] if matches else 0
                    agg['score'] += score
                    if answer: projections[q['id']] = dict(isCorrect=matches,score=score,isGraded=True)
                elif answer and answer.get('isGraded'):
                    score = answer.get('score') or 0
                    agg['score'] += score; group_scores.append(score); agg['tasks'].append((q['type'],score))
                else: agg['pending'] = True
            if versioned and skill=='speaking':
                agg['score'] -= sum(group_scores)
                if group_scores and len(group_scores)==len(qs): agg['score'] += round_half(sum(group_scores)/len(group_scores))
        if versioned and not auto:
            agg['max'] = sum(g.get('maxScore') if g.get('maxScore') is not None else g['questions'][0]['points'] if g['questions'] else 0 for g in section['groups'])
        aggregates.append(agg)
    pending = any(a['pending'] for a in aggregates)
    raw = {a['skill']:dict(score=a['score'],max=a['max']) for a in aggregates}
    bands, overall, cefr, standards, overall_score = None,None,None,None,None
    if ielts:
        bands = {}
        for a in aggregates:
            if not a['max']: continue
            skill = a['skill']
            if skill in ('listening','reading'): bands[skill] = band_from_raw(skill,exam_type,a['score'],a['max'],tables,a['answered']>0)
            elif not a['pending']:
                tasks = a['tasks']; t1 = next((s for t,s in tasks if t=='essay_task1'),None); t2 = next((s for t,s in tasks if t=='essay_task2'),None)
                bands[skill] = round_half((t1+2*t2)/3) if skill=='writing' and t1 is not None and t2 is not None else round_half(sum(s for _,s in tasks)/len(tasks)) if tasks else 0
        if not pending and bands:
            overall = round_half(sum(bands.values())/(4 if full_test else len(bands))); cefr = cefr_band(overall)
    elif versioned:
        standards = {}
        for a in aggregates:
            if not a['max'] or a['pending']: continue
            skill = a['skill']
            standards[skill] = estimate_objective(a['score'],a['max']) if skill in ('listening','reading') else dict(rawScore=a['score'],rawMax=a['max'],estimatedStandardScore=convert_expert(skill,a['score']),scoreMethod='ESTIMATED',scoreVersion=ESTIMATE_VERSION,isOfficial=False,gradingSource='HUMAN')
        if all(s in standards for s in ('listening','reading','writing','speaking')):
            overall_score = sum(standards[s]['estimatedStandardScore'] for s in ('listening','reading','writing','speaking'))/4; cefr = multilevel_level(overall_score)
    elif not pending:
        total = sum(a['max'] for a in aggregates)
        cefr = cefr_percent(sum(a['score'] for a in aggregates)/total*100 if total else 0)
    result = dict(status='grading' if pending else 'completed',rawScores=raw,sectionBands=bands,overallBand=overall,cefrLevel=cefr)
    if versioned: result.update(standardScores=standards,overallScore=overall_score,scoreMethod='ESTIMATED',scoreVersion=ESTIMATE_VERSION,isOfficial=False)
    return result, projections
