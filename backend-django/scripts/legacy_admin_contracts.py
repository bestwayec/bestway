"""Real legacy administration requests through both isolated APIs."""
def verify_legacy(call,db,schemas,ids,state,checks):
    routes=[('POST','/v1/tests',{}),('PATCH','/v1/tests/missing',{}),
        ('POST','/v1/tests/missing/questions',{}),('PATCH','/v1/tests/questions/missing',{}),
        ('DELETE','/v1/tests/questions/missing'),('POST','/v1/tests/questions/import/preview',{}),
        ('POST','/v1/tests/missing/questions/import',{}),('POST','/v1/tests/questions/missing/audio'),
        ('POST','/v1/tests/attempts/missing/grade',{})]
    for role in (None,'student','parent','teacher','admin','super_admin'):
        for route in routes:call(*route,role=role,label='legacy-admin-role:'+str(role))
    base=dict(type='ielts',title='Legacy fixture',isDemo=True,durationMinutes='20')
    for key,value in [('type','bad'),('title','a'),('title','😀'*101),('durationMinutes',0),('durationMinutes',601),('isDemo','true'),('extra',1)]:
        call('POST','/v1/tests',dict(base,**{key:value}))
    call('POST','/v1/tests',base,capture='legacy_test')
    call('PATCH','/v1/tests/{legacy_test}',dict(title='Changed legacy',durationMinutes=None,sectionQuestionCounts={'reading':2}))
    question=dict(section='reading',type='multiple_choice',prompt='Which answer?',options=['A','B'],correctAnswer='A',maxScore=2)
    for changes in [dict(correctAnswer=''),dict(options=['A']),dict(section='bad'),dict(maxScore=0),dict(extra=1)]:
        call('POST','/v1/tests/{legacy_test}/questions',dict(question,**changes))
    call('POST','/v1/tests/{legacy_test}/questions',question,capture='legacy_question')
    call('PATCH','/v1/tests/questions/{legacy_question}',dict(options=None,correctAnswer=None,passageText='New context'))
    for text in ['abc','Reading\n1. Question?\nA) One\nB) Two\nAnswer: A',
        'Writing\n1. Discuss the topic.', 'Reading\n1. Question?\nAnswer: yes\n1. Duplicate?\nAnswer: no',
        'Listening\nPassage: Context\nInstructions: Choose one\n1. Question?\nA. One\nB. Two\nAnswer key\n1 B',
        '1. Missing key?', 'Speaking\n1. Speak about your day.']:
        call('POST','/v1/tests/questions/import/preview',dict(text=text))
        call('POST','/v1/tests/{legacy_test}/questions/import',dict(text=text))
    call('POST','/v1/tests/questions/{legacy_question}/audio')
    call('POST','/v1/tests/questions/{legacy_question}/audio',files={'audio':('bad.html',b'bad','audio/mpeg')})
    call('POST','/v1/tests/questions/{legacy_question}/audio',files={'audio':('sound.mp3',b'local-audio','audio/mpeg')})
    call('POST','/v1/tests/questions/{legacy_question}/audio',files={'audio':('sound.wav',b'new-audio','audio/wav')})
    call('DELETE','/v1/tests/questions/{legacy_question}')
    call('DELETE','/v1/tests/questions/{legacy_question}')
    call('POST','/v1/tests/{legacy_test}/questions',dict(section='writing',type='essay',prompt='Discuss the topic.',maxScore=10),capture='legacy_essay')
    from uuid import uuid4
    from psycopg import sql
    for side in (0,1):
        ids[side]['legacy_attempt']=str(uuid4())
        db.execute(sql.SQL('UPDATE {}."StudentProfile" SET "groupId"=%s WHERE "userId"=%s').format(sql.Identifier(schemas[side])),(ids[side]['group'],ids[side]['student']))
        db.execute(sql.SQL('INSERT INTO {}."TestAttempt" (id,"studentId","testId",status,"questionOrder","autoScore","finishedAt") VALUES (%s,%s,%s,\'grading\',%s,2,NOW())').format(sql.Identifier(schemas[side])),
            (ids[side]['legacy_attempt'],ids[side]['student'],ids[side]['legacy_test'],'[]'))
    for role in ('other_teacher','teacher','admin','super_admin'):
        for score in (-1,11,7.5):call('POST','/v1/tests/attempts/{legacy_attempt}/grade',dict(questionId='{legacy_essay}',score=score,comment='Teacher review'),role=role)
    call('GET','/v1/tests/attempts/{legacy_attempt}',role='student')
    checks.append('Legacy: teacher ownership, half-point scoring, upsert of a same-test question outside questionOrder and completed-attempt regrade preserve reference result/notification behavior')
    # Database mutation fault is injected inside the real serializable import;
    # every partially inserted question and its audit must disappear.
    from apps.core import legacy_authoring
    from types import SimpleNamespace
    from unittest.mock import patch
    before=state(0);original=legacy_authoring.Question.objects.create;count=0
    def failing_insert(*args,**kwargs):
        nonlocal count
        count+=1
        if count==2:raise RuntimeError('local import rollback fault')
        return original(*args,**kwargs)
    with patch.object(legacy_authoring.Question.objects,'create',side_effect=failing_insert):
        try:legacy_authoring.import_questions(SimpleNamespace(id=ids[0]['super_admin']),ids[0]['legacy_test'],dict(text='Writing\n1. First essay.\n2. Second essay.'))
        except RuntimeError:pass
        else:raise AssertionError('Import fault was not exercised')
    assert before==state(0)
    checks.append('Legacy: failed second import insert rolls back all question writes and emits no audit')
