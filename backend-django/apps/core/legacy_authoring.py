"""Legacy Test/Question administration, independent from mock authoring."""
from pathlib import Path
from uuid import uuid4
from django.db import transaction,connection
from django.db.models import Value,JSONField
from django.utils import timezone
from apps.legacy_schema.models import Test,Question,TestAttempt,Answer
from . import legacy_tests as service
from .legacy_import_parser import parse
from .system_settings import audit
from .domain_contracts import invalid,js_length
from .game_points_views import bounded
from .content_media import storage_path,delete_file
from .points import assert_can_view

TEST_FIELDS=dict(isDemo='is_demo',isActive='is_active',durationMinutes='duration_minutes',sectionQuestionCounts='section_question_counts')
QUESTION_FIELDS=dict(correctAnswer='correct_answer',maxScore='max_score',passageText='passage_text',audioUrl='audio_url')


def validate(data,question=False,update=False,importing=False):
    if not update and not importing:
        enums={'section':service.SECTIONS,'type':('multiple_choice','short_answer','essay','speaking_prompt')} if question else {'type':('ielts','multilevel')}
        for key,values in enums.items():
            if data.get(key) not in values:invalid(f'{key} must be one of the following values: '+', '.join(values))
    strings={'text':(3,100000)} if importing else {'prompt':(3,None),'correctAnswer':(0,None),'passageText':(0,10000),'instructions':(0,2000),'audioUrl':(0,500)} if question else {'title':(3,200),'level':(0,50)}
    for key,(minimum,maximum) in strings.items():
        required=not update and key in ('text','prompt','title')
        if (key not in data or data[key] is None) and not required:continue
        value=data.get(key)
        if maximum and (not isinstance(value,str) or js_length(value)>maximum):invalid(f'{key} must be shorter than or equal to {maximum} characters')
        if not isinstance(value,str) or js_length(value)<minimum:invalid(f'{key} must be longer than or equal to {minimum} characters')
    enums={'defaultSection':service.SECTIONS} if importing else {'section':service.SECTIONS,'type':('multiple_choice','short_answer','essay','speaking_prompt')} if question else {'type':('ielts','multilevel')}
    for key,values in enums.items():
        if (importing or update) and (key not in data or data[key] is None):continue
        if data.get(key) not in values:invalid(f'{key} must be one of the following values: '+', '.join(values))
    for key in ('isDemo','isActive'):
        if key in data and data[key] is not None and not isinstance(data[key],bool):invalid(f'{key} must be a boolean value')
    for key,low,high in [('durationMinutes',1,600),('maxScore',1,100)]:bounded(data,key,low,high)
    if 'sectionQuestionCounts' in data and data['sectionQuestionCounts'] is not None and not isinstance(data['sectionQuestionCounts'],dict):invalid('sectionQuestionCounts must be an object')
    if 'options' in data and data['options'] is not None:
        if not isinstance(data['options'],list) or any(not isinstance(v,str) for v in data['options']):invalid('each value in options must be a string')
    return data


def raw_test(row):
    return dict(id=row.id,type=row.type,title=row.title,level=row.level,isDemo=row.is_demo,isActive=row.is_active,
        durationMinutes=row.duration_minutes,sectionQuestionCounts=row.section_question_counts,createdAt=row.created_at)


def get(model,identifier):
    row=model.objects.filter(id=identifier).first()
    if row is None:service.fail('TEST_NOT_FOUND' if model is Test else 'QUESTION_NOT_FOUND','Test topilmadi' if model is Test else 'Savol topilmadi',404)
    return row


def mutate_test(actor,data,identifier=None):
    old=get(Test,identifier) if identifier else None
    values={TEST_FIELDS.get(key,key):value for key,value in data.items()}
    if old:
        if values.get('section_question_counts','absent') is None:values['section_question_counts']=Value(None,output_field=JSONField())
        Test.objects.filter(id=identifier).update(**values);row=get(Test,identifier)
    else:
        for field,default in [('level',None),('is_demo',False),('is_active',True),('duration_minutes',None),('section_question_counts',None)]:values.setdefault(field,default)
        if values['is_demo'] is None:values['is_demo']=False
        row=Test.objects.create(id=str(uuid4()),created_at=timezone.now(),**values)
    audit(actor,'test.update' if old else 'test.create','test',row.id,new=data if old else dict(title=row.title,type=row.type))
    return raw_test(row)


def mutate_question(actor,data,test_id=None,identifier=None):
    old=get(Question,identifier) if identifier else None
    if not old:
        get(Test,test_id)
        if data['section'] not in service.MANUAL and not data.get('correctAnswer'):service.fail('CORRECT_ANSWER_REQUIRED',"Listening/Reading savollari uchun to'g'ri javob majburiy (avtomatik baholash)")
        if data['type']=='multiple_choice' and (not data.get('options') or len(data['options'])<2):service.fail('OPTIONS_REQUIRED',"Variantlar kamida 2 ta bo'lsin")
    values={QUESTION_FIELDS.get(key,key):value for key,value in data.items()}
    if old:
        if values.get('options','absent') is None:values['options']=Value(None,output_field=JSONField())
        Question.objects.filter(id=identifier).update(**values);row=get(Question,identifier)
    else:
        values.setdefault('max_score',1)
        if values['max_score'] is None:values['max_score']=1
        row=Question.objects.create(id=str(uuid4()),test_id=test_id,created_at=timezone.now(),**values)
    audit(actor,'question.update' if old else 'question.create','question',row.id,new=data if old else dict(testId=test_id,section=row.section))
    return service.raw_question(row)


def remove_question(actor,identifier):
    row=get(Question,identifier)
    delete_file(row.audio_url)
    row.delete()
    audit(actor,'question.delete','question',identifier,old=dict(testId=row.test_id,prompt=row.prompt))
    return dict(deleted=True)


def import_questions(actor,test_id,data):
    result=parse(data['text'],data.get('defaultSection'))
    if result['errors']:service.fail('TEST_IMPORT_INVALID',result['errors'][0]['message'])
    with transaction.atomic():
        with connection.cursor() as cursor:cursor.execute('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE')
        get(Test,test_id)
        for question in result['questions']:
            values={QUESTION_FIELDS.get(key,key):value for key,value in question.items() if key not in ('number','line')}
            Question.objects.create(id=str(uuid4()),test_id=test_id,created_at=timezone.now(),**values)
    out=dict(added=len(result['questions']),sectionCounts=result['sectionCounts'])
    audit(actor,'questions.import','test',test_id,new=out)
    return out


def upload_audio(actor,identifier,file):
    key=None
    if file:
        if not file.content_type.startswith('audio/') or Path(file.name).suffix.lower() not in {'.mp3','.m4a','.wav','.ogg','.aac','.webm','.mp4'}:service.fail('INVALID_FILE_TYPE','Audio fayl yuklang (mp3, m4a, wav, ogg)')
        if file.size>50*1024*1024:service.fail('PAYLOAD_TOO_LARGE','File too large',413)
        key=f'tests/{uuid4()}{Path(file.name).suffix.lower()}';target=storage_path(key);target.parent.mkdir(parents=True,exist_ok=True)
        with target.open('wb') as out:
            for chunk in file.chunks():out.write(chunk)
    row=get(Question,identifier)
    if not file:service.fail('NO_FILE','Audio fayl yuklanmadi')
    delete_file(row.audio_url)
    Question.objects.filter(id=identifier).update(audio_url=key)
    audit(actor,'question.audio.upload','question',identifier,new=dict(audioUrl=key))
    return dict(id=identifier,audioUrl=key,audioEndpoint=f'/v1/tests/questions/{identifier}/audio',hasAudio=True)


def grade(actor,identifier,data):
    attempt=TestAttempt.objects.filter(id=identifier).select_related('test','student__user','student__group').first()
    if attempt is None:service.fail('ATTEMPT_NOT_FOUND','Urinish topilmadi',404)
    if attempt.status=='in_progress':service.fail('ATTEMPT_NOT_SUBMITTED','Test hali topshirilmagan')
    assert_can_view(actor,attempt.student_id)
    question=Question.objects.filter(id=data['questionId'],test_id=attempt.test_id).first()
    if question is None:service.fail('QUESTION_NOT_IN_ATTEMPT','Savol bu urinishga tegishli emas')
    if question.section not in service.MANUAL:service.fail('NOT_MANUAL_QUESTION','Bu savol avtomatik baholanadi')
    if data['score']>question.max_score:service.fail('SCORE_OUT_OF_RANGE',f"Ball 0 dan {question.max_score} gacha bo'lishi kerak")
    Answer.objects.update_or_create(attempt_id=identifier,question_id=question.id,
        defaults=dict(score=data['score'],is_graded=True,graded_by_id=actor.id,comment=data.get('comment'),updated_at=timezone.now()),
        create_defaults=dict(id=str(uuid4()),attempt_id=identifier,question_id=question.id,answer='',score=data['score'],is_graded=True,graded_by_id=actor.id,comment=data.get('comment'),updated_at=timezone.now()))
    if attempt.status=='grading':
        manual=list(Answer.objects.filter(attempt_id=identifier,question__section__in=service.MANUAL))
        if all(r.is_graded for r in manual):
            attempt.status='completed';attempt.manual_score=sum(r.score or 0 for r in manual);attempt.total_score=(attempt.auto_score or 0)+attempt.manual_score
            attempt.save(update_fields=['status','manual_score','total_score']);service.notify(attempt)
    return dict(saved=True)
