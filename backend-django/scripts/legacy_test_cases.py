"""Real /tests API fixtures; separate legacy tables, identity and scoring."""
from pathlib import Path
from uuid import uuid4
from psycopg import sql


def run(call,ids,db,schemas,results):
    from django.conf import settings
    from apps.core import legacy_tests as service
    from unittest.mock import patch
    from common.auth.jwt import issue_access
    from django.core.cache import cache
    cache.clear()
    names=['legacy_demo','legacy_private','legacy_inactive','legacy_empty','legacy_q1','legacy_q2','legacy_q3','legacy_w','legacy_audio']
    shared={name:str(uuid4()) for name in names}
    for side in (0,1):
        ids[side].update(shared)
        schema=sql.Identifier(schemas[side])
        for index,name in enumerate(names[:4]):
            db.execute(sql.SQL('INSERT INTO {}."Test" (id,type,title,"isDemo","isActive","durationMinutes","sectionQuestionCounts","createdAt") VALUES (%s,\'ielts\',%s,%s,%s,30,%s::jsonb,%s)').format(schema),
                (shared[name],'Legacy '+name,name=='legacy_demo',name!='legacy_inactive','{"reading":2}','2026-01-0'+str(index+1)))
        for name,section,kind,key,max_score in [('legacy_q1','reading','short_answer','1987|nineteen eighty seven',2),('legacy_q2','reading','multiple_choice','A',3),('legacy_q3','reading','short_answer','ice-cream',4),('legacy_w','writing','essay',None,9),('legacy_audio','listening','short_answer','yes',1)]:
            test=shared['legacy_private'] if name=='legacy_audio' else shared['legacy_demo']
            db.execute(sql.SQL('INSERT INTO {}."Question" (id,"testId",section,type,prompt,options,"correctAnswer","maxScore","passageText",instructions,"audioUrl","createdAt") VALUES (%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s,%s,%s)').format(schema),
                (shared[name],test,section,kind,'Original '+name,'["A","B"]' if kind=='multiple_choice' else None,key,max_score,'Original passage','Original instructions','tests/legacy.wav' if name=='legacy_audio' else None,'2026-02-01'))
        parent=str(uuid4()); ids[side]['parent']=parent
        db.execute(sql.SQL('INSERT INTO {}."User" (id,name,phone,"passwordHash",role,"isActive","createdAt","updatedAt") VALUES (%s,\'parent\',%s,\'unused\',\'parent\',true,NOW(),NOW())').format(schema),(parent,'+legacy-parent'))
        call.tokenmaps[side]['parent']=issue_access(parent,'parent')
        db.execute(sql.SQL('INSERT INTO {}."ParentStudent" ("parentUserId","studentId","createdAt") VALUES (%s,%s,NOW())').format(schema),(parent,ids[side]['student']))
    # Test fixture files only, removed with the runner's validated storage root.
    for folder in (Path(settings.MEDIA_ROOT),Path(settings.MEDIA_ROOT).parent/'nest'):
        (folder/'tests').mkdir(exist_ok=True,parents=True)
        (folder/'tests/legacy.wav').write_bytes(b'RIFF0000WAVElegacy-fixture')
    def remember(name,values):
        for side,value in enumerate(values): ids[side][name]=value['attemptId']
    def change(name,column,value):
        for side in (0,1):
            db.execute(sql.SQL('UPDATE {}."TestAttempt" SET {}=%s WHERE id=%s').format(sql.Identifier(schemas[side]),sql.Identifier(column)),(value,ids[side][name]))
    # Match cryptographic draw inputs, not normalized question selections.
    with patch('apps.core.legacy_tests.secrets.randbelow',return_value=0):
        for role in (None,'student','teacher','admin','super_admin','parent'):
            call('GET','/v1/tests',role=role,label='L:catalogue:'+str(role))
        call('GET','/v1/tests/demo/list',role=None,label='L:demo-list')
        call('GET','/v1/tests/demo/{legacy_demo}',role=None,label='L:demo-detail')
        call('GET','/v1/tests/demo/{legacy_private}',role=None,label='L:not-demo')
        call('GET','/v1/tests/{legacy_demo}',role='student',label='L:student-definition')
        call('GET','/v1/tests/{legacy_demo}',role='admin',label='L:staff-definition')
        call('POST','/v1/tests/demo/{legacy_demo}/submit',dict(answers={'{legacy_q1}':'  NINETEEN   eighty seven ', '{legacy_q2}':'A','{legacy_q3}':'ice cream','{legacy_w}':'Manual original'}),role=None,label='L:stateless-demo-score')
        remember('legacy_attempt',call('POST','/v1/tests/{legacy_demo}/start',{},role='student',label='L:start-selected-pools'))
        call('GET','/v1/tests/attempts/{legacy_attempt}',role='student',label='L:in-progress-key-protection')
        call('POST','/v1/tests/attempts/{legacy_attempt}/answer',dict(questionId='{legacy_q2}',answer=' A '),role='student',label='L:save')
        call('POST','/v1/tests/attempts/{legacy_attempt}/answer',dict(questionId='{legacy_q2}',answer='B'),role='student',label='L:autosave-upsert')
        call('POST','/v1/tests/attempts/{legacy_attempt}/answer',dict(questionId='{legacy_q2}',answer='A'),role='student',label='L:duplicate-save')
        call('POST','/v1/tests/attempts/{legacy_attempt}/marks',dict(questionId='{legacy_q2}',highlights=[' x ',' original highlight ','z'*400],note=' Original note '),role='student',label='L:marks-trim-cap')
        call('POST','/v1/tests/attempts/{legacy_attempt}/marks',dict(questionId='{legacy_q3}',highlights=[' Original selection ']),role='student',label='L:marks-only-answer-created')
        call('POST','/v1/tests/{legacy_demo}/start',{},role='student',label='L:resume-selection-clock-marks')
        call('POST','/v1/tests/attempts/{legacy_attempt}/answer',dict(questionId='{legacy_q1}',answer='1987'),role='student',label='L:unselected-question-denied')
        call('POST','/v1/tests/attempts/{legacy_attempt}/flag-cheat',dict(event='tab_switch'),role='student',label='L:cheat')
        call('GET','/v1/tests/attempts/{legacy_attempt}',role='teacher',label='L:unassigned-teacher-denied')
        call('GET','/v1/tests/attempts/{legacy_attempt}',role='parent',label='L:linked-parent-no-marks-or-keys')
        call('GET','/v1/tests/attempts/{legacy_attempt}/certificate',role='student',label='L:unfinished-certificate-denied')
        call('POST','/v1/tests/attempts/{legacy_attempt}/submit',{},role='student',label='L:objective-submit')
        call('GET','/v1/tests/attempts/{legacy_attempt}',role='student',label='L:completed-result-review')
        call('GET','/v1/tests/attempts/{legacy_attempt}',role='admin',label='L:staff-review-cheat-events')
        call('GET','/v1/tests/attempts/{legacy_attempt}/certificate',role='student',label='L:completed-certificate')
        call('POST','/v1/tests/attempts/{legacy_attempt}/submit',{},role='student',label='L:duplicate-submit-denied')
        call('POST','/v1/tests/attempts/{legacy_attempt}/answer',dict(questionId='{legacy_q2}',answer='late'),role='student',label='L:completed-answer-immutable')
        call('POST','/v1/tests/attempts/{legacy_attempt}/marks',dict(questionId='{legacy_q2}',note='late'),role='student',label='L:completed-marks-immutable')
        call('GET','/v1/tests/attempts/mine',role='student',label='L:own-history')
        call('GET','/v1/tests/attempts',role='admin',label='L:staff-queue')
        call('GET','/v1/tests/attempts',role='teacher',label='L:unassigned-teacher-queue')
        remember('legacy_manual',call('POST','/v1/tests/{legacy_demo}/start',{},role='student',label='L:new-after-completion'))
        call('POST','/v1/tests/attempts/{legacy_manual}/answer',dict(questionId='{legacy_w}',answer='Original essay awaiting assessment.'),role='student',label='L:manual-answer')
        call('POST','/v1/tests/attempts/{legacy_manual}/submit',{},role='student',label='L:manual-grading-no-fabricated-score')
        call('GET','/v1/tests/attempts/{legacy_manual}',role='student',label='L:pending-hides-keys')
        call('GET','/v1/tests/attempts/{legacy_manual}/certificate',role='student',label='L:pending-certificate-denied')
        remember('legacy_timed',call('POST','/v1/tests/{legacy_private}/start',{},role='student',label='L:private-start'))
        call('GET','/v1/tests/questions/{legacy_audio}/audio',role='student',label='L:attempt-bound-audio-compatible-client')
        for range_value in ('bytes=0-3','bytes=4-','bytes=-3','bytes=900-999','invalid'):
            call('GET','/v1/tests/questions/{legacy_audio}/audio',role='student',extra_headers={'Range':range_value},label='L:audio-range:'+range_value)
        change('legacy_timed','startedAt','2000-01-01T00:00:00')
        call('POST','/v1/tests/{legacy_private}/start',{},role='student',label='L:expired-resume-no-reset')
        call('POST','/v1/tests/attempts/{legacy_timed}/answer',dict(questionId='{legacy_audio}',answer='yes'),role='student',label='L:expired-save-denied')
        call('POST','/v1/tests/attempts/{legacy_timed}/submit',{},role='student',label='L:timeout-submit-unanswered-completes')
        for role,status in [(None,401),('student',404)]:
            call('GET','/v1/tests/questions/{legacy_audio}/audio',role=role,label='L:approved-security:non-demo-audio-'+str(role))
            difference=results[-1]
            if difference.get('django',{}).get('status')!=status or difference.get('nest',{}).get('status')!=200:
                raise AssertionError('Unexpected legacy media result: '+str(difference))
            difference['approvedSecurityDifference']='Approved attempt-bound media policy: Nest serves non-demo legacy audio publicly and after submission; Django requires a live own selected attempt. Tauri uses authenticated media and requires no source change.'
        for target in ('legacy_inactive','legacy_empty'):
            call('POST','/v1/tests/{'+target+'}/start',{},role='student',label='L:start-denied:'+target)
        for path in ('/v1/tests?page=0','/v1/tests?limit=101','/v1/tests?type=invalid','/v1/tests?program=INVALID','/v1/tests?extra=1','/v1/tests/attempts/mine?status=invalid','/v1/tests/attempts/mine?program=MULTILEVEL'):
            call('GET',path,role='student',label='L:query-validation')
        for endpoint,data in [('answer',{}),('answer',dict(questionId='{legacy_q2}',answer=5)),('marks',dict(questionId='{legacy_q2}',highlights=[5])),('marks',dict(questionId='{legacy_q2}',note='n'*2001)),('flag-cheat',dict(event=''))]:
            call('POST','/v1/tests/attempts/{legacy_timed}/'+endpoint,data,role='student',label='L:invalid-body')
        routes=[('GET','/v1/tests/{legacy_demo}',None),('POST','/v1/tests/{legacy_demo}/start',{}),('GET','/v1/tests/attempts/mine',None),('GET','/v1/tests/attempts',None),('GET','/v1/tests/attempts/{legacy_attempt}',None),('POST','/v1/tests/attempts/{legacy_attempt}/answer',dict(questionId='{legacy_q2}',answer='A')),('POST','/v1/tests/attempts/{legacy_attempt}/marks',dict(questionId='{legacy_q2}')),('POST','/v1/tests/attempts/{legacy_attempt}/flag-cheat',dict(event='blur')),('POST','/v1/tests/attempts/{legacy_attempt}/submit',{}),('GET','/v1/tests/attempts/{legacy_attempt}/certificate',None)]
        for method,path,data in routes:
            for role in (None,'teacher','admin','super_admin'):
                call(method,path,data,role=role,label='L:role:'+str(role))
        for side in (0,1):
            schema=sql.Identifier(schemas[side]); other=str(uuid4()); ids[side]['other_student']=other
            db.execute(sql.SQL('INSERT INTO {}."User" (id,name,phone,"passwordHash",role,"isActive","createdAt","updatedAt") VALUES (%s,\'other student\',\'+legacy-other\',\'unused\',\'student\',true,NOW(),NOW())').format(schema),(other,))
            db.execute(sql.SQL('INSERT INTO {}."StudentProfile" ("userId","linkCode","availablePrograms","activeProgram") VALUES (%s,\'legacy-other-link\',ARRAY[\'IELTS\']::{}."ExamProgram"[],\'IELTS\')').format(schema,schema),(other,))
            call.tokenmaps[side]['other_student']=issue_access(other,'student')
        for endpoint in ('answer','marks','submit','flag-cheat'):
            payload=dict(questionId='{legacy_q2}',answer='A') if endpoint=='answer' else dict(questionId='{legacy_q2}') if endpoint=='marks' else dict(event='blur') if endpoint=='flag-cheat' else {}
            call('POST','/v1/tests/attempts/{legacy_attempt}/'+endpoint,payload,role='other_student',label='L:cross-student:'+endpoint)
        for endpoint in ('','/certificate'):
            call('GET','/v1/tests/attempts/{legacy_attempt}'+endpoint,role='other_student',label='L:cross-student:review'+endpoint)
        for side in (0,1):
            schema=sql.Identifier(schemas[side]); gid=str(uuid4())
            db.execute(sql.SQL('INSERT INTO {}."Group" (id,name,"teacherId","createdAt") VALUES (%s,\'Legacy assigned group\',%s,NOW())').format(schema),(gid,ids[side]['teacher']))
            db.execute(sql.SQL('UPDATE {}."StudentProfile" SET "groupId"=%s WHERE "userId"=%s').format(schema),(gid,ids[side]['student']))
        call('GET','/v1/tests/attempts/{legacy_attempt}',role='teacher',label='L:assigned-teacher-review')
        call('GET','/v1/tests/attempts',role='teacher',label='L:assigned-teacher-queue')
        call('GET','/v1/tests/attempts/{legacy_attempt}/certificate',role='parent',label='L:linked-parent-certificate')
        remember('legacy_pending_notify',call('POST','/v1/tests/{legacy_demo}/start',{},role='student',label='L:assigned-group-start'))
        call('POST','/v1/tests/attempts/{legacy_pending_notify}/answer',dict(questionId='{legacy_w}',answer='Original teacher-pending essay'),role='student')
        call('POST','/v1/tests/attempts/{legacy_pending_notify}/submit',{},role='student',label='L:teacher-pending-notification')
        for side in (0,1):
            schema=sql.Identifier(schemas[side])
            db.execute(sql.SQL('UPDATE {}."StudentProfile" SET "availablePrograms"=ARRAY[\'MULTILEVEL\']::{}."ExamProgram"[],"activeProgram"=\'MULTILEVEL\' WHERE "userId"=%s').format(schema,schema),(ids[side]['student'],))
        call('POST','/v1/tests/{legacy_private}/start',{},role='student',label='L:revoked-start-denied')
        for side in (0,1):
            schema=sql.Identifier(schemas[side])
            db.execute(sql.SQL('UPDATE {}."StudentProfile" SET "availablePrograms"=ARRAY[\'IELTS\',\'MULTILEVEL\']::{}."ExamProgram"[],"activeProgram"=\'IELTS\' WHERE "userId"=%s').format(schema,schema),(ids[side]['student'],))
        # No alternate scoring guesses: stateless coercion is the reference's.
        call('POST','/v1/tests/demo/{legacy_demo}/submit',dict(answers={'{legacy_q1}':1987.0,'{legacy_q2}':['A']}),role=None,label='L:demo-coercion')
        from legacy_test_postgres import run as verify_pg
        verify_pg(call,ids,db,schemas,results)
        # Compare the real Nest route's 30/min throttle, including invalid DTO hits.
        for index in range(32):
            call('POST','/v1/tests/attempts/{legacy_attempt}/flag-cheat',dict(event='blur'),role='student',label='L:route-throttle:'+str(index))
