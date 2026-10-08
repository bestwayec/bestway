"""Checkpoint 3 actual Nest/Django contracts in disposable local schemas."""
import json
from datetime import datetime,timedelta
from uuid import uuid4
from psycopg import sql


def run(call,ids,db,schemas,results):
    # Existing cloned templates share startedAt. Control equivalent fixture
    # inputs so reference ORDER BY startedAt has a unique, observable order;
    # never reorder returned arrays or normalize their semantic contents.
    for index,name in enumerate(sorted(set(ids[0]) & set(ids[1]))):
        for side in (0,1):
            db.execute(sql.SQL('UPDATE {}."MockAttempt" SET "startedAt"=%s WHERE id=%s').format(sql.Identifier(schemas[side])),(datetime(2026,4,1)+timedelta(seconds=index),ids[side][name]))
    attempt_sequence=0
    def clone(side,table,source,changes):
        schema=sql.Identifier(schemas[side]); name=sql.Identifier(table)
        db.execute(sql.SQL('INSERT INTO {}.{} SELECT (jsonb_populate_record(NULL::{}.{},to_jsonb(t)||%s::jsonb)).* FROM {}.{} t WHERE id=%s').format(schema,name,schema,name,schema,name),(json.dumps(changes),source))
    def attempt(name,source='score_missing',**changes):
        nonlocal attempt_sequence
        attempt_sequence+=1
        key=str(uuid4())
        for side in (0,1):
            clone(side,'MockAttempt',ids[side][source],dict(id=key,startedAt=(datetime(2026,5,1)+timedelta(seconds=attempt_sequence)).isoformat(),**changes)); ids[side][name]=key
            jobs=db.execute(sql.SQL('SELECT id FROM {}."AssessmentJob" WHERE "attemptId"=%s').format(sql.Identifier(schemas[side])),(ids[side][source],)).fetchall()
            for (jid,) in jobs: clone(side,'AssessmentJob',jid,dict(id=str(uuid4()),attemptId=key))
        return key
    paid=str(uuid4()); section,group,question=[str(uuid4()) for _ in range(3)]
    for side in (0,1):
        clone(side,'MockExam',ids[side]['ielts'],dict(id=paid,title='Paid entitlement fixture',isDemo=False,isPublished=True,price=120,isFreeForApproved=False))
        ids[side]['support_paid']=paid
        clone(side,'MockSection',ids[side]['ielts_section'],dict(id=section,examId=paid))
        clone(side,'MockQuestionGroup',ids[side]['ielts_group'],dict(id=group,sectionId=section,audioKey=None))
        source=db.execute(sql.SQL('SELECT id FROM {}."MockQuestion" WHERE "groupId"=%s').format(sql.Identifier(schemas[side])),(ids[side]['ielts_group'],)).fetchone()[0]
        clone(side,'MockQuestion',source,dict(id=question,groupId=group))
    def call_c(method,path,body=None,role='admin',label='case'):
        return call(method,path,body,role=role,label='C:'+label)
    call_c('GET','/v1/mock/purchases',label='initial-purchases')
    call_c('POST','/v1/mock/exams/{support_paid}/start',{},'student','unpaid-start-denied')
    call_c('POST','/v1/mock/exams/{support_paid}/purchase',{},'student','request')
    call_c('POST','/v1/mock/exams/{support_paid}/purchase',{},'student','repeat-request-one-row')
    call_c('POST','/v1/mock/exams/{support_paid}/start',{},'student','pending-start-denied')
    call_c('GET','/v1/mock/purchases?status=pending_confirmation',label='pending-list')
    call_c('POST','/v1/mock/exams/{support_paid}/reject-purchase',dict(userId='{student}'),label='reject')
    call_c('POST','/v1/mock/exams/{support_paid}/reject-purchase',dict(userId='{student}'),label='reject-again-denied')
    call_c('POST','/v1/mock/exams/{support_paid}/purchase',{},'student','request-after-reject')
    call_c('POST','/v1/mock/exams/{support_paid}/confirm-purchase',dict(userId='{student}'),label='confirm')
    call_c('POST','/v1/mock/exams/{support_paid}/confirm-purchase',dict(userId='{student}'),label='repeat-confirm-retains-amount')
    call_c('POST','/v1/mock/exams/{support_paid}/purchase',{},'student','already-accessible')
    call_c('POST','/v1/mock/exams/{support_paid}/reject-purchase',dict(userId='{student}'),label='purchased-not-rejectable')
    call_c('GET','/v1/mock/purchases?status=purchased&page=1&limit=1',label='purchased-list')
    values=call_c('POST','/v1/mock/exams/{support_paid}/start',{},'student','confirmed-start')
    for side,value in enumerate(values): ids[side]['support_access_attempt']=value['attemptId']
    call_c('GET','/v1/mock/attempts/{support_access_attempt}',role='student',label='entitled-own-safe-detail')
    # Reference allows requests without enrollment, but never start without it.
    for side in (0,1):
        schema=sql.Identifier(schemas[side])
        db.execute(sql.SQL('UPDATE {}."StudentProfile" SET "availablePrograms"=ARRAY[\'MULTILEVEL\']::{}."ExamProgram"[],"activeProgram"=\'MULTILEVEL\' WHERE "userId"=%s').format(schema,schema),(ids[side]['student'],))
    call_c('POST','/v1/mock/exams/{support_paid}/purchase',{},'student','unenrolled-reference-purchase')
    call_c('POST','/v1/mock/exams/{support_paid}/start',{},'student','purchased-still-enrollment-required')
    for side in (0,1):
        schema=sql.Identifier(schemas[side])
        db.execute(sql.SQL('UPDATE {}."StudentProfile" SET "availablePrograms"=ARRAY[\'IELTS\',\'MULTILEVEL\']::{}."ExamProgram"[],"activeProgram"=\'IELTS\' WHERE "userId"=%s').format(schema,schema),(ids[side]['student'],))
    for suffix in ('','?status=completed','?program=MULTILEVEL','?program=IELTS','?studentId={student}','?examId={support_paid}'):
        for role in ('admin','teacher'):
            call_c('GET','/v1/mock/attempts'+suffix,role=role,label='scoped-list:'+role+suffix)
    fresh=attempt('support_extend',deadlineAt='2026-01-01T10:00:00',overallDeadlineAt='2026-01-01T11:00:00',sectionDeadlines={'listening':'2026-01-01T10:00:00.000Z','reading':'2026-01-01T11:00:00.000Z'})
    call_c('POST','/v1/mock/attempts/{support_extend}/extend',dict(minutes='15'),'teacher','assigned-teacher-extend')
    for side in (0,1):
        value=db.execute(sql.SQL('SELECT "deadlineAt","overallDeadlineAt","sectionDeadlines" FROM {}."MockAttempt" WHERE id=%s').format(sql.Identifier(schemas[side])),(fresh,)).fetchone()
        assert value[0].hour==10 and value[0].minute==15 and value[1].hour==11 and value[1].minute==15
        assert value[2]=={'listening':'2026-01-01T10:15:00.000Z','reading':'2026-01-01T11:15:00.000Z'}
    call_c('POST','/v1/mock/attempts/{score_missing}/extend',dict(minutes=1),label='null-clocks-stay-null')
    call_c('POST','/v1/mock/attempts/{score_complete}/extend',dict(minutes=1),label='completed-extend-denied')
    call_c('POST','/v1/mock/attempts/{score_complete}/reopen',{},label='completed-reopen-denied')
    call_c('POST','/v1/mock/attempts/{score_missing}/reopen',{},label='in-progress-reopen-denied')
    attempt('support_reopen','full_pending')
    call_c('GET','/v1/mock/attempts/{support_reopen}/certificate',role='student',label='pending-certificate-denied')
    call_c('POST','/v1/mock/attempts/{support_reopen}/reopen',{},'teacher','grading-reopen')
    call_c('GET','/v1/mock/attempts/{support_reopen}',role='student',label='reopen-preserved-results')
    attempt('support_force')
    call_c('POST','/v1/mock/attempts/{support_force}/force-submit',{},'teacher','force-incomplete-objective')
    call_c('POST','/v1/mock/attempts/{support_force}/force-submit',{},label='force-repeat-denied')
    call_c('POST','/v1/mock/attempts/{support_force}/answer',dict(questionId='{score_q}',response='late'),'student','force-finalized-immutable')
    for name in ('support_force','score_complete','full_scored'):
        for role in ('student','admin','parent','teacher'):
            call_c('GET','/v1/mock/attempts/{'+name+'}/certificate',role=role,label='certificate:'+name+':'+role)
    attempt('support_ielts','ielts_attempt',status='in_progress')
    call_c('POST','/v1/mock/attempts/{support_ielts}/force-submit',{},label='ielts-force')
    call_c('GET','/v1/mock/attempts/{support_ielts}/certificate',role='student',label='ielts-certificate')
    attempt('support_pending_force','full_pending',status='in_progress',submittedAt=None,rawScores=None,standardScores=None)
    call_c('POST','/v1/mock/attempts/{support_pending_force}/force-submit',{},label='force-pending-snapshots')
    call_c('GET','/v1/mock/attempts/{support_pending_force}/certificate',role='student',label='force-no-fabricated-completion')
    # Role guard runs before resource lookup. All ten endpoints included.
    missing=str(uuid4())
    routes=[('POST',f'/v1/mock/exams/{missing}/purchase',{}),('GET','/v1/mock/purchases',None),('POST',f'/v1/mock/exams/{missing}/confirm-purchase',dict(userId='{student}')),('POST',f'/v1/mock/exams/{missing}/reject-purchase',dict(userId='{student}')),('GET','/v1/mock/attempts',None),('POST',f'/v1/mock/attempts/{missing}/force-submit',{}),('POST',f'/v1/mock/attempts/{missing}/extend',dict(minutes=1)),('POST',f'/v1/mock/attempts/{missing}/reopen',{}),('DELETE',f'/v1/mock/attempts/{missing}',None),('GET',f'/v1/mock/attempts/{missing}/certificate',None)]
    for method,path,payload in routes:
        for role in (None,'student','teacher','admin','super_admin','parent'):
            call_c(method,path,payload,role,'role:'+str(role))
    for minutes in (None,0,181,1.5,'bad',True,'0x10',''):
        call_c('POST','/v1/mock/attempts/{score_missing}/extend',dict(minutes=minutes),label='minutes:'+str(minutes))
    for payload in ({},{'userId':5},{'userId':''},{'userId':'unknown'},{'userId':'unknown','extra':1}):
        call_c('POST','/v1/mock/exams/{support_paid}/confirm-purchase',payload,label='confirm-invalid')
    for path in ('/v1/mock/purchases?status=bad','/v1/mock/purchases?limit=101','/v1/mock/purchases?limit=bad','/v1/mock/attempts?page=0','/v1/mock/attempts?page=bad','/v1/mock/attempts?program=bad','/v1/mock/attempts?extra=1'):
        call_c('GET',path,label='query-invalid')
    for path in ('/v1/mock/attempts/{support_force}','/v1/mock/attempts/{support_force}/certificate'):
        call_c('GET',path,role='other_student',label='second-student-IDOR')
    # Wrong teacher cannot administer a student's attempt.
    for side in (0,1):
        db.execute(sql.SQL('UPDATE {}."Group" SET "teacherId"=NULL WHERE "teacherId"=%s').format(sql.Identifier(schemas[side])),(ids[side]['teacher'],))
    for suffix,payload in [('extend',dict(minutes=1)),('reopen',{}),('force-submit',{})]:
        call_c('POST','/v1/mock/attempts/{support_reopen}/'+suffix,payload,'teacher','unassigned-teacher:'+suffix)
    call_c('GET','/v1/mock/attempts/{support_force}/certificate',role='teacher',label='unassigned-teacher-certificate')
    call_c('GET','/v1/mock/attempts',role='teacher',label='unassigned-empty-queue')
    attempt('support_delete','support_pending_force')
    call_c('DELETE','/v1/mock/attempts/{support_delete}',role='admin',label='delete-ledger-cascade')
    for side in (0,1):
        assert db.execute(sql.SQL('SELECT count(*) FROM {}."AssessmentJob" WHERE "attemptId"=%s').format(sql.Identifier(schemas[side])),(ids[side]['support_delete'],)).fetchone()[0]==0
    call_c('GET','/v1/mock/attempts/{support_delete}',role='student',label='deleted-not-found')
    from mock_support_postgres import run as run_pg
    run_pg(call,ids,db,schemas,results,clone,attempt)
    states=[]
    actions=['mock.purchase.request','mock.purchase.confirm','mock.purchase.reject','mock.attempt.force_submit','mock.attempt.extend','mock.attempt.reopen','mock.attempt.delete']
    for side in (0,1):
        rows=db.execute(sql.SQL('SELECT row_to_json(t) FROM {}."AuditLog" t WHERE action=ANY(%s)').format(sql.Identifier(schemas[side])),(actions,)).fetchall()
        states.append(sorted([call.normalize(r[0]) for r in rows],key=lambda r:json.dumps(r,sort_keys=True)))
    assert states[0]==states[1], 'Checkpoint 3 audit mismatch'
    results.append(dict(method='PG',path='support-audit-records',label='C:PG:audit-parity',status='PASS',database='PASS',checks=len(states[0])))
