"""Real local assessment review, grading and worker PostgreSQL fixtures."""
import copy
import json
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4
from psycopg import sql
from unittest.mock import patch

def verify_assessment(call,db,schemas,ids,state,control,normalize,checks,media_roots):
    from apps.core import assessment,assessment_results as rubric,assessment_worker as worker
    from apps.core.mock_import_validate import canonical_checksum
    from apps.legacy_schema.models import AssessmentJob,AssessmentEvaluation
    shared={label:str(uuid4()) for label in ('assessment_exam','assessment_section','assessment_group','assessment_question','assessment_attempt','assessment_job')}
    for side in (0,1):
        ids[side].update(shared)
        schema=sql.Identifier(schemas[side])
        def execute(query,params):return db.execute(sql.SQL(query).format(schema),params)
        execute('INSERT INTO {}."MockExam" (id,type,title,"updatedAt") VALUES (%s,\'ielts_academic\',\'Assessment fixture\',NOW())',[shared['assessment_exam']])
        execute('INSERT INTO {}."MockSection" (id,"examId",skill) VALUES (%s,%s,\'writing\')',[shared['assessment_section'],shared['assessment_exam']])
        execute('INSERT INTO {}."MockQuestionGroup" (id,"sectionId",title) VALUES (%s,%s,\'Task 1\')',[shared['assessment_group'],shared['assessment_section']])
        execute('INSERT INTO {}."MockQuestion" (id,"groupId",number,type,prompt,points) VALUES (%s,%s,1,\'essay_task1\',\'Describe the task\',9)',[shared['assessment_question'],shared['assessment_group']])
        execute('INSERT INTO {}."MockAttempt" (id,"examId","studentId",status,"submittedAt") VALUES (%s,%s,%s,\'grading\',NOW())',[shared['assessment_attempt'],shared['assessment_exam'],ids[side]['student']])
        execute('UPDATE {}."StudentProfile" SET "groupId"=%s WHERE "userId"=%s',[ids[side]['group'],ids[side]['student']])
    input=dict(program='IELTS_ACADEMIC',skill='writing',specificationVersion=None,speakingProfileVersion=None,rubricVersion='IELTS_WRITING_RUBRIC_V1',promptVersion='BESTWAY_ASSESSMENT_PROMPT_2026_V1',pronunciationEvidence='UNAVAILABLE',
        parts=[dict(id='task1:'+shared['assessment_question'],max=9,weight=1,task='Describe the task',context='',responses=[dict(questionId=shared['assessment_question'],prompt='Describe the task',originalResponse='Original candidate essay',partNumber=1)])])
    result=rubric.empty(input);result['confidence']=.95
    result['parts'][0].update(rawScore=6,criteria={k:6 for k in rubric.keys(input)},evidence={k:'Demonstrated evidence' for k in rubric.keys(input)})
    def seed_job(identifier='assessment_job',policy='PRACTICE_AUTO_AI',status='PENDING',snapshot=None,**values):
        snapshot=snapshot or input
        if identifier not in shared:
            shared[identifier]=str(uuid4())
            for side in ids:side[identifier]=shared[identifier]
        for side in (0,1):
            fields=dict(id=shared[identifier],attemptId=shared['assessment_attempt'],studentId=ids[side]['student'],program=snapshot['program'],skill=snapshot['skill'],inputHash=canonical_checksum(snapshot),inputSnapshot=json.dumps(snapshot),
                rubricVersion=snapshot['rubricVersion'],promptVersion=snapshot['promptVersion'],policyMode=policy,status=status,**values)
            columns=sql.SQL(',').join(map(sql.Identifier,fields));placeholders=sql.SQL(',').join(sql.Placeholder() for _ in fields)
            db.execute(sql.SQL('INSERT INTO {}."AssessmentJob" ({},"updatedAt") VALUES ({},NOW())').format(sql.Identifier(schemas[side]),columns,placeholders),list(fields.values()))
    seed_job()
    routes=[('GET','/v1/assessment/attempts/missing'),('POST','/v1/assessment/jobs/missing/review',{}),('GET','/v1/assessment/jobs/missing/audio/missing'),('POST','/v1/mock/attempts/missing/grade',{})]
    for role in (None,'student','parent','teacher','admin','super_admin'):
        for route in routes:call(*route,role=role,label='assessment-role:'+str(role))
    for role in ('student','other_student','parent','other_parent','teacher','other_teacher','admin','super_admin'):
        call('GET','/v1/assessment/attempts/{assessment_attempt}',role=role)
        call('GET','/v1/assessment/jobs/{assessment_job}/audio/{assessment_question}',role=role)
    for data in ({},dict(action='bad',expectedVersion=1,reason='Review'),dict(action='ACCEPT',expectedVersion=0,reason='Review'),dict(action='ACCEPT',expectedVersion=1,reason=''),dict(action='ACCEPT',expectedVersion=1,reason=' ',extra=1)):
        call('POST','/v1/assessment/jobs/{assessment_job}/review',data)
    call('POST','/v1/assessment/jobs/{assessment_job}/review',dict(action='ACCEPT',expectedVersion=1,reason='No AI result'))
    call('POST','/v1/assessment/jobs/{assessment_job}/review',dict(action='OVERRIDE',expectedVersion=1,reason='Bad rubric',parts=[]))
    def run_worker(output=result,error=None,transcript=None):
        calls=[]
        def grader(input,role):
            calls.append(dict(type='assess',role=role,input=input))
            if error:raise rubric.ProviderError(**error)
            return dict(result=copy.deepcopy(output),provider='fixture',model='fixture-model',inputTokens=10,outputTokens=20,latencyMs=1)
        def speech(path,mime,language,duration):
            calls.append(dict(type='transcribe',input=dict(audioPath=path.name,mimeType=mime,language=language,**(dict(durationMs=duration) if duration is not None else {}))))
            return copy.deepcopy(transcript)
        ran=worker.run_once(grader=grader,speech=speech)
        outcome=control('assessmentWorker',result=output,failure=error,transcript=transcript)
        assert outcome['ok'],outcome
        reference=outcome['result']
        assert ran==reference['ran'] and normalize(calls)==normalize(reference['calls']),(calls,reference)
        states=[state(0),state(1)]
        if states[0]!=states[1]:
            from collections import Counter
            differences={}
            for table in states[0]:
                a,b=[Counter(json.dumps(v,sort_keys=True) for v in side[table]) for side in states]
                if a!=b:differences[table]=dict(django=list((a-b).items())[:2],nest=list((b-a).items())[:2])
            print('DIFFERENCE worker '+json.dumps(differences),flush=True)
            raise AssertionError('Worker persisted semantic difference')
    run_worker()
    checks.append('Assessment: primary worker validates immutable hash, persists token ledger and automatically projects practice IELTS rubric/attempt in one finalization transaction')
    call('GET','/v1/assessment/attempts/{assessment_attempt}',role='student')
    call('POST','/v1/assessment/jobs/{assessment_job}/review',dict(action='OVERRIDE',expectedVersion=1,reason='Stale reviewer',parts=[]))
    call('POST','/v1/assessment/jobs/{assessment_job}/review',dict(action='OVERRIDE',expectedVersion=3,reason='Teacher override',parts=[dict(id=input['parts'][0]['id'],criteria={k:7 for k in rubric.keys(input)})]),role='other_teacher')
    call('POST','/v1/assessment/jobs/{assessment_job}/review',dict(action='OVERRIDE',expectedVersion=3,reason='Teacher override',parts=[dict(id=input['parts'][0]['id'],criteria={k:7 for k in rubric.keys(input)})]),role='teacher')
    call('GET','/v1/assessment/attempts/{assessment_attempt}',role='parent')
    call('POST','/v1/assessment/jobs/{assessment_job}/review',dict(action='ACCEPT',expectedVersion=4,reason='Accept original AI result'))
    call('POST','/v1/assessment/jobs/{assessment_job}/review',dict(action='NEEDS_REVIEW',expectedVersion=5,reason='Review requested'))
    call('POST','/v1/assessment/jobs/{assessment_job}/review',dict(action='REGRADE',expectedVersion=6,reason='Independent regrade'))
    run_worker()
    call('GET','/v1/assessment/attempts/{assessment_attempt}')
    # Legacy grading is deliberately the existing non-atomic teacher endpoint.
    for changes in [dict(score=10),dict(rubricScores={'unknown':6}),dict(rubricScores={'ta':6.1}),dict(rubricScores={}),dict(rubricScores=None),dict(score=None),dict(score=6.5,feedback='Teacher feedback')]:
        call('POST','/v1/mock/attempts/{assessment_attempt}/grade',dict(questionId='{assessment_question}',**changes),role='teacher')
    # Leave no earlier pending jobs before testing the durable retry decisions.
    seed_job('assessment_retry',generation=10)
    run_worker(error=dict(code='PROVIDER_RATE_LIMITED',transient=True,uncertain=False))
    checks.append('Assessment: explicit rate limit persists FAILED provider call plus bounded RETRY; raw claim retains reference database-session-timezone eligibility')
    seed_job('assessment_uncertain',generation=11)
    run_worker(error=dict(code='PROVIDER_TIMEOUT',transient=True,uncertain=True))
    checks.append('Assessment: uncertain billed timeout is NEEDS_REVIEW, never automatic retry')
    seed_job('assessment_manual',policy='MANUAL_ONLY',status='NEEDS_REVIEW',generation=12,failureCode='MANUAL_POLICY')
    call('POST','/v1/assessment/jobs/{assessment_manual}/review',dict(action='REGRADE',expectedVersion=1,reason='Manual cannot regrade'))
    before=state(0)
    with patch('apps.core.assessment.AuditLog.objects.create',side_effect=RuntimeError('local review audit fault')):
        try:assessment.review(SimpleNamespace(id=ids[0]['super_admin'],role='super_admin'),shared['assessment_manual'],dict(action='OVERRIDE',expectedVersion=1,reason='Audit rollback',parts=[dict(id=input['parts'][0]['id'],criteria={k:8 for k in rubric.keys(input)})]))
        except RuntimeError:pass
        else:raise AssertionError('Review audit fault was not exercised')
    assert before==state(0)
    checks.append('Assessment: failed transactional review audit rolls back final ledger score, answer projection and attempt recomputation completely')
    # Recovery of a billed STARTED call must not replay it after a process crash.
    for side in (0,1):
        db.execute(sql.SQL('UPDATE {}."AssessmentJob" SET status=\'NEEDS_REVIEW\',"leaseToken"=NULL,"leaseExpiresAt"=NULL WHERE status IN (\'PENDING\',\'RETRY\',\'PROCESSING\')').format(sql.Identifier(schemas[side])))
    seed_job('assessment_expired',status='PROCESSING',generation=13,attemptCount=1,leaseToken='expired-lease',leaseExpiresAt='2000-01-01')
    for side in (0,1):
        db.execute(sql.SQL('INSERT INTO {}."AssessmentEvaluation" (id,"jobId",role,"attemptNumber","inputHash",provider,model) VALUES (%s,%s,\'PRIMARY\',1,%s,\'fixture\',\'fixture-model\')').format(sql.Identifier(schemas[side])),(str(uuid4()),shared['assessment_expired'],canonical_checksum(input)))
    assert assessment.claim() is None
    reference=control('assessmentClaim');assert reference['ok'] and reference['result'] is None
    assert state(0)==state(1)
    checks.append('Assessment: expired lease with STARTED provider ledger becomes NEEDS_REVIEW/PROVIDER_OUTCOME_UNCERTAIN and is never re-claimed')
    seed_job('assessment_adjudicated',generation=14)
    uncertain_result=copy.deepcopy(result);uncertain_result['confidence']=.8
    run_worker(output=uncertain_result)
    checks.append('Assessment: low-confidence primary invokes an independent adjudicator, combines validated criteria and preserves prior teacher answer grades')
    import hashlib
    for name in ('speaking_section','speaking_group','speaking_question'):
        shared[name]=str(uuid4())
        for side in ids:side[name]=shared[name]
    audio=b'local-speaking-recording';audio_key='tests/assessment-speaking.wav'
    speaking_input=dict(input,skill='speaking',rubricVersion='IELTS_SPEAKING_RUBRIC_V1',parts=[dict(id='speaking',max=9,task='IELTS Speaking',context='',responses=[dict(questionId=shared['speaking_question'],prompt='Speak about your day',originalResponse='',partNumber=1,audioKey=audio_key,audioHash=hashlib.sha256(audio).hexdigest(),mimeType='audio/wav')])])
    for side in (0,1):
        schema=sql.Identifier(schemas[side]);path=Path(media_roots[side])/audio_key;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(audio)
        db.execute(sql.SQL('INSERT INTO {}."MockSection" (id,"examId",skill,"sortOrder") VALUES (%s,%s,\'speaking\',1)').format(schema),(shared['speaking_section'],shared['assessment_exam']))
        db.execute(sql.SQL('INSERT INTO {}."MockQuestionGroup" (id,"sectionId") VALUES (%s,%s)').format(schema),(shared['speaking_group'],shared['speaking_section']))
        db.execute(sql.SQL('INSERT INTO {}."MockQuestion" (id,"groupId",number,type,prompt,points) VALUES (%s,%s,1,\'speaking_task\',\'Speak about your day\',9)').format(schema),(shared['speaking_question'],shared['speaking_group']))
    seed_job('assessment_speech',generation=15,snapshot=speaking_input)
    speech_result=rubric.empty(speaking_input);speech_result['confidence']=.95
    speech_result['parts'][0].update(rawScore=None,criteria={k:None if k=='pronunciation' else 6 for k in rubric.keys(speaking_input)},evidence={k:'Transcript evidence; pronunciation unavailable' for k in rubric.keys(speaking_input)})
    transcript=dict(text='Original spoken transcript',segments=[dict(start=0,end=1,text='Original',confidence=.9)],confidence=.9,provider='fixture-stt',model='fixture-stt-model',durationMs=1000,pronunciationEvidence='UNAVAILABLE')
    run_worker(output=speech_result,transcript=transcript)
    call('GET','/v1/assessment/attempts/{assessment_attempt}',role='student')
    call('GET','/v1/assessment/jobs/{assessment_speech}/audio/{speaking_question}',role='parent')
    call('GET','/v1/assessment/jobs/{assessment_speech}/audio/{speaking_question}',role='other_student')
    checks.append('Assessment: real local immutable audio checksum, STARTED/SUCCEEDED STT ledger and transcript-to-rater handoff match; ASR never fabricates pronunciation or a complete IELTS speaking score')
    seed_job('assessment_claim_a',generation=20);seed_job('assessment_claim_b',generation=21)
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from django.db import connections
    barrier=Barrier(2)
    def claim_once(_):
        barrier.wait(timeout=10)
        try:
            job=assessment.claim();return job.id,job.attempt_count
        finally:connections.close_all()
    with ThreadPoolExecutor(max_workers=2) as pool:claimed=list(pool.map(claim_once,range(2)))
    expected=[shared['assessment_claim_a'],shared['assessment_claim_b']]
    assert sorted(x[0] for x in claimed)==sorted(expected) and all(x[1]==1 for x in claimed)
    reference=control('assessmentConcurrentClaims');assert reference['ok']
    assert sorted(x['id'] for x in reference['result'])==sorted(expected) and all(x['attemptCount']==1 for x in reference['result'])
    assert state(0)==state(1)
    checks.append('Assessment: two concurrent real PostgreSQL SKIP LOCKED claims select distinct jobs exactly once in both Django and NestJS')
