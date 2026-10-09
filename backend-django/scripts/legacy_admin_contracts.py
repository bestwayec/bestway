"""Real legacy administration requests through both isolated APIs."""
def verify_legacy(call):
    routes=[('POST','/v1/tests',{}),('PATCH','/v1/tests/missing',{}),
        ('POST','/v1/tests/missing/questions',{}),('PATCH','/v1/tests/questions/missing',{}),
        ('DELETE','/v1/tests/questions/missing'),('POST','/v1/tests/questions/import/preview',{}),
        ('POST','/v1/tests/missing/questions/import',{}),('POST','/v1/tests/questions/missing/audio'),
        ('POST','/v1/tests/attempts/missing/grade',{})]
    for role in (None,'student','parent','teacher','admin','super_admin'):
        for route in routes:call(*route,role=role,label='legacy-admin-role:'+str(role))
    base=dict(type='ielts',title='Legacy fixture',isDemo=True,durationMinutes='20')
    for key,value in [('type','bad'),('title','a'),('durationMinutes',0),('durationMinutes',601),('isDemo','true'),('extra',1)]:
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
