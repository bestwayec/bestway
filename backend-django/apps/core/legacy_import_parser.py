"""Pure port of tests/test-import-parser.ts (preview and transactional import)."""
import re


def parse(text,default_section=None):
    errors=[];warnings=[];drafts=[];answers={};seen={}
    section=default_section;instructions='';passage='';shared=None;current=None;answer_key=False
    def finish():
        nonlocal current
        if current is not None: drafts.append(current);current=None
    def match(pattern,line): return re.match(pattern,line,re.I)
    for index,raw in enumerate(re.sub(r'\r\n?','\n',text).split('\n'),1):
        line=raw.rstrip()
        if not line.strip():continue
        found=match(r'^\s*(?:\[|#{1,3}\s*)?(listening|reading|writing|speaking)(?:\]|\s+section)?\s*:?\s*$',line) or match(r'^\s*section\s*:\s*(listening|reading|writing|speaking)\s*$',line)
        if found:
            finish();section=found[1].lower();instructions='';passage='';shared=None;answer_key=False;continue
        if match(r'^\s*(?:answer\s*key|answers?)\s*:?[\s-]*$',line):
            finish();answer_key=True;shared=None;continue
        if answer_key:
            key=match(r'^\s*(\d{1,3})\s*[:.)-]\s*(.+?)\s*$',line)
            if not key:errors.append(dict(line=index,message='Answer key line not understood. Use “1: B”.'));continue
            number=int(key[1])
            if number in answers:errors.append(dict(line=index,message=f'Answer for question {number} is repeated.'))
            answers[number]=dict(value=key[2].strip(),line=index);continue
        question=match(r'^\s*(?:q(?:uestion)?\s*)?(\d{1,3})\s*[.)\]:-]\s*(.*)$',line)
        if question:
            finish();number=int(question[1]);current=dict(number=number,line=index,section=section,prompt=[question[2].strip()] if question[2].strip() else [],options=[],instructions=instructions,passageText=passage);shared=None
            if number in seen:errors.append(dict(line=index,message=f'Question number {number} is repeated (first used on line {seen[number]}).'))
            else:seen[number]=index
            continue
        if current is None:
            instruction=match(r'^\s*instructions?\s*:\s*(.*)$',line);passage_line=match(r'^\s*passage\s*:\s*(.*)$',line)
            if instruction:instructions=instruction[1].strip();shared='instructions'
            elif passage_line:passage=passage_line[1].strip();shared='passage'
            elif shared=='instructions':instructions=(instructions+'\n'+line.strip()).strip()
            elif shared=='passage':passage=(passage+'\n'+line.strip()).strip()
            else:warnings.append(dict(line=index,message='Text before the first question was ignored. Prefix it with “Instructions:” or “Passage:”.'))
            continue
        option=match(r'^\s*\(?([A-H])\)?[.)\]:-]\s*(.+)$',line)
        answer=match(r'^\s*(?:answer|correct answer)\s*:\s*(.+)$',line)
        kind=match(r'^\s*type\s*:\s*(multiple[_ -]?choice|short[_ -]?answer|essay|speaking[_ -]?prompt)\s*$',line)
        score=match(r'^\s*(?:score|points?)\s*:\s*(\d+)\s*$',line)
        if option:current['options'].append(option[2].strip())
        elif answer:current['answer']=answer[1].strip()
        elif kind:current['type']=re.sub(r'[ -]','_',kind[1].lower())
        elif score:current['maxScore']=int(score[1])
        else:current['prompt'].append(line.strip())
    finish()
    if not drafts:errors.append(dict(message='No numbered questions found. Use “1. Question text”.'))
    if len(drafts)>200:errors.append(dict(message='A single import can contain at most 200 questions.'))
    questions=[];counts={}
    for draft in drafts:
        number=draft['number'];line=draft['line'];section=draft['section'] or default_section
        prompt=re.sub(r'\s+',' ',' '.join(draft['prompt'])).strip();options=draft['options']
        kind=draft.get('type', 'essay' if section=='writing' else 'speaking_prompt' if section=='speaking' else 'multiple_choice' if len(options)>=2 else 'short_answer')
        raw=draft.get('answer',answers.get(number,{}).get('value'));resolved=[]
        if raw and raw.strip():
            for part in raw.split('|'):
                value=part.strip()
                if re.fullmatch('[A-H]',value,re.I):
                    i=ord(value.upper())-65;value=options[i] if i<len(options) else value
                if value:resolved.append(value)
        correct='|'.join(resolved)
        def error(message):errors.append(dict(line=line,message=message))
        if not section:error(f'Question {number} has no section. Add [READING] or choose a default section.')
        if len(prompt)<3:error(f'Question {number} needs at least 3 characters.')
        if kind=='multiple_choice' and len(options)<2:error(f'Question {number} needs at least two options.')
        if section in ('listening','reading') and not correct:error(f'Question {number} needs an answer.')
        score=draft.get('maxScore',1)
        if not 1<=score<=100:error(f'Question {number} score must be 1–100.')
        question=dict(number=number,line=line,section=section or 'reading',type=kind,prompt=prompt,maxScore=score)
        if options:question['options']=options
        if correct:question['correctAnswer']=correct
        for field in ('passageText','instructions'):
            if draft[field]:question[field]=draft[field]
        questions.append(question);counts[question['section']]=counts.get(question['section'],0)+1
    for number,answer in answers.items():
        if number not in seen:warnings.append(dict(line=answer['line'],message=f'Answer {number} has no matching question and will be ignored.'))
    return dict(questions=questions,errors=errors,warnings=warnings,sectionCounts=counts)
