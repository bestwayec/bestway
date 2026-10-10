"""Legacy row-lock, rollback and actual persisted lifecycle verification."""
import json
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4
from psycopg import sql
from urllib.request import Request,urlopen


def run(call,ids,db,schemas,results):
    from apps.core import legacy_tests as service
    from apps.legacy_schema.models import TestAttempt,Answer,Notification
    from common.api.exceptions import ContractAPIException
    from django.db import close_old_connections,connections
    actor=SimpleNamespace(id=ids[0]['student'])
    def reference_submit(attempt_id,score):
        request=Request(call.reference_base+f'/v1/tests/attempts/{attempt_id}/submit',data=b'{}',method='POST',headers={'Authorization':'Bearer '+call.reference_student_token,'Content-Type':'application/json'})
        with urlopen(request,timeout=20) as response:
            assert response.status==201
            assert json.loads(response.read())==dict(success=True,data=dict(status='completed',autoScore=score))
    def clone(side,name,source,changes):
        schema=sql.Identifier(schemas[side]); table=sql.Identifier(name)
        db.execute(sql.SQL('INSERT INTO {}.{} SELECT (jsonb_populate_record(NULL::{}.{},to_jsonb(t)||%s::jsonb)).* FROM {}.{} t WHERE id=%s').format(schema,table,schema,table,schema,table),(json.dumps(changes),source))
    test_id=str(uuid4()); qid=str(uuid4())
    for side in (0,1):
        clone(side,'Test',ids[side]['legacy_private'],dict(id=test_id,title='Legacy lock fixture',durationMinutes=None))
        clone(side,'Question',ids[side]['legacy_audio'],dict(id=qid,testId=test_id,audioUrl=None))
        ids[side]['legacy_lock_test']=test_id; ids[side]['legacy_lock_q']=qid
    def parallel(functions):
        barrier=Barrier(len(functions))
        def worker(function):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                try: return function()
                except ContractAPIException as error: return dict(error=error.contract_code)
            finally: connections.close_all()
        with ThreadPoolExecutor(max_workers=len(functions)) as pool:
            return list(pool.map(worker,functions))
    # Concurrent fresh starts return one durable selection and original clock.
    starts=parallel([lambda:service.start(actor,test_id)]*2)
    assert starts[0]['attemptId']==starts[1]['attemptId']
    assert sorted(v['resumed'] for v in starts)==[False,True]
    assert TestAttempt.objects.filter(test_id=test_id).count()==1
    selected=starts[0]['attemptId']
    row=db.execute(sql.SQL('SELECT row_to_json(t) FROM {}."TestAttempt" t WHERE id=%s').format(sql.Identifier(schemas[0])),(selected,)).fetchone()[0]
    row['studentId']=ids[1]['student']
    schema=sql.Identifier(schemas[1])
    db.execute(sql.SQL('INSERT INTO {}."TestAttempt" SELECT (jsonb_populate_record(NULL::{}."TestAttempt",%s::jsonb)).*').format(schema,schema),(json.dumps(row),))
    ids[0]['legacy_lock_attempt']=selected; ids[1]['legacy_lock_attempt']=selected
    call('POST','/v1/tests/{legacy_lock_test}/start',{},role='student',label='L:PG:start-serialization-resume')
    # Duplicate saves serialize to one Answer row.
    values=parallel([lambda:service.save(actor,selected,dict(questionId=qid,answer='yes'))]*2)
    assert values==[dict(saved=True)]*2 and Answer.objects.filter(attempt_id=selected).count()==1
    call('POST','/v1/tests/attempts/{legacy_lock_attempt}/answer',dict(questionId='{legacy_lock_q}',answer='yes'),role='student',label='L:PG:duplicate-save-persisted')
    before=Notification.objects.count()
    with patch('apps.core.legacy_tests.notify',side_effect=RuntimeError('synthetic crash')):
        try: service.submit(actor,selected)
        except RuntimeError: pass
        else: raise AssertionError('Expected injected failure')
    assert TestAttempt.objects.get(id=selected).status=='in_progress'
    answer=Answer.objects.get(attempt_id=selected)
    assert answer.score is None and not answer.is_graded and Notification.objects.count()==before
    submits=parallel([lambda:service.submit(actor,selected)]*2)
    assert sum(v.get('status')=='completed' for v in submits)==1
    assert sum(v.get('error')=='ATTEMPT_FINISHED' for v in submits)==1
    assert TestAttempt.objects.get(id=selected).total_score==1 and Answer.objects.get(attempt_id=selected).score==1
    assert Notification.objects.count()==before+2  # student and linked parent
    reference_submit(selected,1)
    call('GET','/v1/tests/attempts/{legacy_lock_attempt}',role='student',label='L:PG:concurrent-submit-persisted')
    # Timeout versus submit still claims/finalizes only once.
    aid=str(uuid4())
    for side in (0,1):
        clone(side,'TestAttempt',ids[side]['legacy_timed'],dict(id=aid,testId=ids[side]['legacy_private'],status='in_progress',finishedAt=None,autoScore=None,manualScore=None,totalScore=None))
        ids[side]['legacy_timeout_race']=aid
    values=parallel([lambda:service.submit(actor,aid)]*2)
    assert sum(v.get('status')=='completed' for v in values)==1 and sum(v.get('error')=='ATTEMPT_FINISHED' for v in values)==1
    reference_submit(aid,0)
    call('GET','/v1/tests/attempts/{legacy_timeout_race}',role='student',label='L:PG:timeout-submit-claim')
    # Save vs submit yields either a saved score or a denied late mutation.
    aid=str(uuid4())
    for side in (0,1):
        clone(side,'TestAttempt',ids[side]['legacy_lock_attempt'],dict(id=aid,status='in_progress',finishedAt=None,autoScore=None,manualScore=None,totalScore=None))
        ids[side]['legacy_save_race']=aid
    values=parallel([lambda:service.save(actor,aid,dict(questionId=qid,answer='yes')),lambda:service.submit(actor,aid)])
    answer=Answer.objects.filter(attempt_id=aid).first(); attempt=TestAttempt.objects.get(id=aid)
    assert attempt.status=='completed' and attempt.total_score==(answer.score if answer else 0)
    if answer:
        db.execute(sql.SQL('INSERT INTO {}."Answer" (id,"attemptId","questionId",answer,"isGraded","updatedAt") VALUES (%s,%s,%s,\'yes\',false,NOW())').format(sql.Identifier(schemas[1])),(str(uuid4()),aid,qid))
    reference_submit(aid,attempt.total_score)
    call('GET','/v1/tests/attempts/{legacy_save_race}',role='student',label='L:PG:save-submit-serialization')
    try: service.save(actor,aid,dict(questionId=qid,answer='late'))
    except ContractAPIException as error: assert error.contract_code=='ATTEMPT_FINISHED'
    else: raise AssertionError('Submitted answers mutated')
    results.append(dict(method='PG',path='legacy-lifecycle-locks',label='L:PG:concurrency-rollback',status='PASS',database='PASS',checks=16))
