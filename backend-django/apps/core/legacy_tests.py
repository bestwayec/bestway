"""Legacy /tests lifecycle over Prisma tables, deliberately separate from /mock."""
import re
import secrets
import math
from decimal import Decimal
from datetime import timedelta
from django.db import connection, transaction
from django.utils import timezone
from apps.legacy_schema.models import (Test, Question, TestAttempt, Answer, AntiCheatEvent,
    StudentProfile, Notification, ParentStudent)
from . import exam_programs
from .mock_authoring import new_id
from .mock_attempts import aware, fail, assert_view
from .mock_scoring import JS_SPACE, trim

SECTIONS = ('listening','reading','writing','speaking')
MANUAL = ('writing','speaking')


def normalize(value):
    return re.sub('['+JS_SPACE+']+', ' ', trim(value.lower()))


def js_string(value):
    if value is None: return 'null'
    if isinstance(value,bool): return 'true' if value else 'false'
    if isinstance(value,dict): return '[object Object]'
    if isinstance(value,list): return ','.join('' if v is None else js_string(v) for v in value)
    if isinstance(value,(int,float)):
        number=float(value)
        if math.isnan(number): return 'NaN'
        if math.isinf(number): return 'Infinity' if number>0 else '-Infinity'
        if number==0: return '0'
        text=repr(number)
        if 1e-6<=abs(number)<1e21:
            return format(Decimal(text),'f').rstrip('0').rstrip('.') if '.' in format(Decimal(text),'f') else format(Decimal(text),'f')
        if 'e' in text:
            mantissa,exponent=text.split('e'); exponent=int(exponent)
            return mantissa.removesuffix('.0')+'e'+('+' if exponent>=0 else '-')+str(abs(exponent))
        return text.removesuffix('.0')
    return str(value)


def correct(value, key):
    value=normalize(value)
    return bool(value) and bool(key) and any(normalize(k)==value for k in key.split('|'))


def active(actor, requested=None):
    with connection.cursor() as cursor:
        state=exam_programs.state(cursor,actor.id)
    if requested and requested!=state['activeProgram']:
        fail('PROGRAM_CHANGED','Your exam track changed. Refresh and try again.',409)
    return state['activeProgram'] if state['activeProgram'] in state['availablePrograms'] else None


def assert_program(actor, test):
    with connection.cursor() as cursor:
        programs=exam_programs.state(cursor,actor.id)['availablePrograms']
    if ('MULTILEVEL' if test.type=='multilevel' else 'IELTS') not in programs:
        fail('PROGRAM_NOT_ENROLLED','Not enrolled in this exam track',403)


def meta(test):
    return dict(id=test.id,type=test.type,title=test.title,level=test.level,isDemo=test.is_demo,
        isActive=test.is_active,durationMinutes=test.duration_minutes,sectionQuestionCounts=test.section_question_counts,
        questionCount=Question.objects.filter(test_id=test.id).count())


def sanitize(q):
    return dict(id=q.id,section=q.section,type=q.type,prompt=q.prompt,options=q.options,maxScore=q.max_score,
        passageText=q.passage_text,instructions=q.instructions,audioUrl=f'/v1/tests/questions/{q.id}/audio' if q.audio_url else None,hasAudio=bool(q.audio_url))


def raw_question(q):
    value=sanitize(q)
    value.pop('hasAudio')
    value.update(testId=q.test_id,correctAnswer=q.correct_answer,audioUrl=q.audio_url,createdAt=q.created_at)
    return value


def definition(actor, test_id, demo=False):
    test=Test.objects.filter(id=test_id).first()
    if test is None or demo and (not test.is_demo or not test.is_active):
        fail('TEST_NOT_FOUND','Test topilmadi',404)
    value=meta(test)
    # Prisma enum order follows schema declaration, not lexical ordering.
    qs=list(Question.objects.filter(test_id=test.id).order_by('created_at'))
    qs.sort(key=lambda q:SECTIONS.index(q.section))
    if demo:
        value.update(sections=[s for s in SECTIONS if any(q.section==s for q in qs)],questions=[sanitize(q) for q in qs])
    elif actor.role in ('teacher','admin','super_admin'):
        value['questions']=[raw_question(q) for q in qs]
    return value


def catalogue(actor, query, demo=False):
    rows=Test.objects.all()
    if query.get('type'): rows=rows.filter(type=query['type'])
    staff=actor and actor.role in ('teacher','admin','super_admin')
    if demo or not staff: rows=rows.filter(is_active=True)
    if demo or not actor or actor.role=='parent': rows=rows.filter(is_demo=True)
    if not demo and actor and actor.role=='student':
        program=active(actor,query.get('program'))
        rows=rows.filter(type='multilevel' if program=='MULTILEVEL' else 'ielts') if program else rows.none()
    total=rows.count(); page,limit=query['page'],query['limit']
    items=[]
    for test in rows.order_by('-created_at')[(page-1)*limit:page*limit]:
        sections=set(Question.objects.filter(test_id=test.id).values_list('section',flat=True))
        value=meta(test); value.pop('sectionQuestionCounts')
        value['sections']=[s for s in SECTIONS if s in sections]; items.append(value)
    return items,dict(page=page,limit=limit,total=total)


def shape_marks(rows):
    marks={}
    for answer in rows:
        highlights=[h for h in answer.highlights if isinstance(h,str)] if isinstance(answer.highlights,list) else []
        if highlights or answer.note:
            marks[answer.question_id]=dict(highlights=highlights,note=answer.note)
    return marks


def shuffle(rows):
    result=list(rows)
    for i in range(len(result)-1,0,-1):
        j=secrets.randbelow(i+1); result[i],result[j]=result[j],result[i]
    return result


@transaction.atomic
def start(actor,test_id):
    if not StudentProfile.objects.filter(user_id=actor.id).exists():
        fail('NOT_A_STUDENT',"Faqat o'quvchi test topshira oladi",403)
    # Serialize fresh starts without adding a uniqueness constraint/migration.
    test=Test.objects.select_for_update().filter(id=test_id,is_active=True).first()
    if test is None: fail('TEST_NOT_FOUND','Test topilmadi',404)
    assert_program(actor,test)
    attempt=TestAttempt.objects.filter(test_id=test.id,student_id=actor.id,status='in_progress').first()
    qs=list(Question.objects.filter(test_id=test.id))
    if attempt:
        by_id={q.id:q for q in qs}; rows=list(Answer.objects.filter(attempt_id=attempt.id))
        return dict(attemptId=attempt.id,resumed=True,durationMinutes=test.duration_minutes,startedAt=attempt.started_at,
            questions=[sanitize(by_id[qid]) for qid in attempt.question_order if qid in by_id],
            savedAnswers={a.question_id:a.answer for a in rows},savedMarks=shape_marks(rows))
    chosen=[]; counts=test.section_question_counts or {}
    for section in SECTIONS:
        pool=shuffle([q for q in qs if q.section==section]); limit=counts.get(section)
        # Reference JSON may contain fractional/string numbers; JS slice truncates.
        try: take=min(int(float(limit)),len(pool)) if limit and float(limit)>0 else len(pool)
        except (ValueError,TypeError): take=len(pool)
        chosen.extend(pool[:take])
    if not chosen: fail('TEST_EMPTY',"Bu testda hali savollar yo'q")
    attempt=TestAttempt.objects.create(id=new_id(),student_id=actor.id,test_id=test.id,status='in_progress',
        question_order=[q.id for q in chosen],anti_cheat_count=0,started_at=timezone.now())
    return dict(attemptId=attempt.id,resumed=False,durationMinutes=test.duration_minutes,startedAt=attempt.started_at,questions=[sanitize(q) for q in chosen])


def own(actor,attempt_id,lock=False):
    rows=TestAttempt.objects.select_for_update() if lock else TestAttempt.objects
    attempt=rows.filter(id=attempt_id).first()
    if attempt is None or attempt.student_id!=actor.id: fail('ATTEMPT_NOT_FOUND','Urinish topilmadi',404)
    return attempt


def assert_editable(attempt,question_id):
    if attempt.status!='in_progress': fail('ATTEMPT_FINISHED','Bu urinish allaqachon yakunlangan')
    assert_time(attempt)
    if question_id not in attempt.question_order: fail('QUESTION_NOT_IN_ATTEMPT','Savol bu urinishga tegishli emas')


def assert_time(attempt):
    minutes=attempt.test.duration_minutes
    if minutes and minutes>0 and timezone.now()>aware(attempt.started_at)+timedelta(minutes=minutes):
        fail('TEST_TIME_UP','Vaqt tugadi — imtihonni yakunlang')


def utf16_slice(value,count):
    return value.encode('utf-16-le','surrogatepass')[:count*2].decode('utf-16-le','surrogatepass')


@transaction.atomic
def save(actor,attempt_id,data,marks=False):
    attempt=own(actor,attempt_id,True); qid=data['questionId']; assert_editable(attempt,qid)
    update=dict(updated_at=timezone.now())
    if marks:
        highlights=[trim(h) for h in data.get('highlights') or [] if isinstance(h,str)]
        update['highlights']=[utf16_slice(h,300) for h in highlights if len(h.encode('utf-16-le','surrogatepass'))>=4][:50]
        if 'note' in data:
            update['note']=utf16_slice(trim(data['note']),2000) or None
    else: update['answer']=data['answer']
    answer=Answer.objects.filter(attempt_id=attempt.id,question_id=qid).first()
    if answer:
        Answer.objects.filter(id=answer.id).update(**update)
    else:
        defaults=dict(answer='')|update
        Answer.objects.create(id=new_id(),attempt_id=attempt.id,question_id=qid,is_graded=False,**defaults)
    return dict(saved=True)


@transaction.atomic
def cheat(actor,attempt_id,event):
    attempt=own(actor,attempt_id,True)
    if attempt.status!='in_progress' or AntiCheatEvent.objects.filter(attempt_id=attempt.id).count()>=50:
        return dict(saved=True)
    AntiCheatEvent.objects.create(id=new_id(),attempt_id=attempt.id,event=event,created_at=timezone.now())
    attempt.anti_cheat_count+=1; attempt.save(update_fields=['anti_cheat_count'])
    return dict(saved=True)


def notify(attempt):
    def create(user_id,text):
        Notification.objects.create(id=new_id(),user_id=user_id,type='test_result',text=text,read=False,created_at=timezone.now())
    student=attempt.student; title=attempt.test.title
    if attempt.status=='grading':
        if student.group_id and student.group.teacher_id:
            create(student.group.teacher_id,f'{student.user.name} "{title}" testini topshirdi — Writing/Speaking baholashingiz kutilmoqda.')
    else:
        score=format(attempt.total_score,'.15g')
        create(student.user_id,f'Test natijangiz tayyor: "{title}" — {score} ball.')
        for parent in set(ParentStudent.objects.filter(student_id=student.user_id).values_list('parent_user_id',flat=True)):
            create(parent,f'Farzandingizning "{title}" test natijasi: {score} ball.')


@transaction.atomic
def submit(actor,attempt_id):
    attempt=own(actor,attempt_id,True)
    if attempt.status!='in_progress': fail('ATTEMPT_FINISHED','Bu urinish allaqachon topshirilgan')
    total=0; manual=False
    for answer in Answer.objects.filter(attempt_id=attempt.id).select_related('question'):
        q=answer.question
        if q.section in MANUAL:
            manual=manual or bool(trim(answer.answer)); continue
        score=q.max_score if correct(answer.answer,q.correct_answer) else 0; total+=score
        Answer.objects.filter(id=answer.id).update(score=score,is_graded=True,updated_at=timezone.now())
    attempt.status='grading' if manual else 'completed'; attempt.auto_score=total
    attempt.manual_score=None if manual else 0; attempt.total_score=None if manual else total
    attempt.finished_at=timezone.now()
    attempt.save(update_fields=['status','auto_score','manual_score','total_score','finished_at'])
    notify(attempt)
    return dict(status=attempt.status,autoScore=total)


def summary(attempt,student_name=False):
    value=dict(id=attempt.id,studentId=attempt.student_id,testId=attempt.test_id,testTitle=attempt.test.title,
        testType=attempt.test.type,status=attempt.status,autoScore=attempt.auto_score,manualScore=attempt.manual_score,
        totalScore=attempt.total_score,antiCheatCount=attempt.anti_cheat_count,startedAt=attempt.started_at,finishedAt=attempt.finished_at)
    if student_name: value['studentName']=attempt.student.user.name
    return value


def history(actor,query,mine=False):
    rows=TestAttempt.objects.select_related('test','student__user')
    for key,field in [('status','status'),('testId','test_id')]:
        if query.get(key): rows=rows.filter(**{field:query[key]})
    if mine:
        program=active(actor,query.get('program')); rows=rows.filter(student_id=actor.id)
        rows=rows.filter(test__type='multilevel' if program=='MULTILEVEL' else 'ielts') if program else rows.none()
    else:
        if query.get('studentId'): rows=rows.filter(student_id=query['studentId'])
        if actor.role=='teacher': rows=rows.filter(student__group__teacher_id=actor.id)
    total=rows.count(); page,limit=query['page'],query['limit']
    return [summary(a,not mine) for a in rows.order_by('-started_at')[(page-1)*limit:page*limit]],dict(page=page,limit=limit,total=total)


def detail(actor,attempt_id,certificate=False):
    attempt=TestAttempt.objects.select_related('test','student__user').filter(id=attempt_id).first()
    if attempt is None: fail('ATTEMPT_NOT_FOUND','Urinish topilmadi',404)
    assert_view(actor,attempt.student_id)
    answers={a.question_id:a for a in Answer.objects.filter(attempt_id=attempt.id)}
    questions={q.id:q for q in Question.objects.filter(test_id=attempt.test_id)}
    if certificate:
        if attempt.status!='completed': fail('ATTEMPT_NOT_COMPLETED','Natija hali tayyor emas')
        sections={}
        for qid in attempt.question_order:
            if qid not in questions: continue
            q=questions[qid]; a=answers.get(qid); entry=sections.setdefault(q.section,dict(section=q.section,score=0,maxScore=0))
            entry['maxScore']+=q.max_score; entry['score']+=a.score or 0 if a else 0
        return dict(studentName=attempt.student.user.name,testTitle=attempt.test.title,testType=attempt.test.type,level=attempt.test.level,
            finishedAt=attempt.finished_at or timezone.now(),attemptId=attempt.id,sections=list(sections.values()),totalScore=attempt.total_score or 0,
            totalMax=sum(s['maxScore'] for s in sections.values()))
    staff=actor.role in ('teacher','admin','super_admin'); owner=actor.id==attempt.student_id
    show=staff or owner and attempt.status=='completed'; items=[]
    for index,qid in enumerate(attempt.question_order):
        if qid not in questions: continue
        q=questions[qid]; a=answers.get(qid); value=sanitize(q); value.pop('id')
        value.update(order=index+1,questionId=qid,answer=a.answer if a else None,score=a.score if a else None,isGraded=a.is_graded if a else False,comment=a.comment if a else None)
        if show and q.section not in MANUAL:
            value['correctAnswer']=q.correct_answer
            if q.correct_answer: value['isCorrect']=correct(a.answer if a else '',q.correct_answer)
        if owner or staff:
            value.update(highlights=[h for h in a.highlights if isinstance(h,str)] if a and isinstance(a.highlights,list) else [],note=a.note if a else None)
        items.append(value)
    value=summary(attempt,True); value['questions']=items
    if staff: value['cheatEvents']=[dict(event=e.event,date=e.created_at) for e in AntiCheatEvent.objects.filter(attempt_id=attempt.id).order_by('created_at')]
    return value


def demo_score(test_id,answers):
    test=Test.objects.filter(id=test_id,is_demo=True,is_active=True).first()
    if test is None: fail('TEST_NOT_FOUND','Test topilmadi',404)
    items=[]; total=0; maximum=0; auto_max=0
    for q in Question.objects.filter(test_id=test.id):
        manual=q.section in MANUAL; raw=answers.get(q.id,'')
        # JS String coercion is deliberately distinct from the strict save DTO.
        raw='' if raw is None else js_string(raw)
        matches=None if manual else correct(raw,q.correct_answer); score=q.max_score if matches else 0
        maximum+=q.max_score; total+=score
        if not manual: auto_max+=q.max_score
        items.append(dict(questionId=q.id,section=q.section,isCorrect=matches,score=score,maxScore=q.max_score,isGraded=not manual))
    by_section=[dict(section=s,score=sum(q['score'] for q in items if q['section']==s),max=sum(q['maxScore'] for q in items if q['section']==s),count=sum(q['section']==s for q in items)) for s in SECTIONS if any(q['section']==s for q in items)]
    return dict(testId=test.id,autoScore=total,totalScore=total,totalMax=maximum,autoMax=auto_max,correctCount=sum(q['isCorrect'] is True for q in items),autoCount=sum(q['isGraded'] for q in items),perQuestion=items,bySection=by_section)
