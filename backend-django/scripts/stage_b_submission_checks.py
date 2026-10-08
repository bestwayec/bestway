"""Checkpoint 1 fixtures and real PostgreSQL serialization/rollback checks.

Called only inside the disposable differential schemas; no public-schema writes.
"""
import json
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4
from urllib.request import Request, urlopen
from psycopg import sql


def run(call, ids, db, schemas, results):
    from apps.core.mock_submissions import submit
    from apps.core.mock_attempts import save_answers
    from apps.core.multilevel import CURRENT_SPEC
    from apps.legacy_schema.models import MockAnswer, MockAttempt, Notification
    from common.api.exceptions import ContractAPIException
    from django.db import close_old_connections, connections

    def clone(side, table, source, changes):
        schema = sql.Identifier(schemas[side]); name = sql.Identifier(table)
        db.execute(sql.SQL('INSERT INTO {}.{} SELECT (jsonb_populate_record(NULL::{}.{}, to_jsonb(t) || %s::jsonb)).* FROM {}.{} t WHERE id=%s').format(schema,name,schema,name,schema,name),(json.dumps(changes),source))

    # Reuse synthetic templates only, with equal question IDs for hash parity.
    fixture_exam, fixture_section, fixture_group, fixture_question = [str(uuid4()) for _ in range(4)]
    for side in (0,1):
        clone(side,'MockExam',ids[side]['ielts'],dict(id=fixture_exam,type='multilevel',specificationVersion=CURRENT_SPEC,title='Objective submission fixture'))
        clone(side,'MockSection',ids[side]['ielts_section'],dict(id=fixture_section,examId=fixture_exam))
        clone(side,'MockQuestionGroup',ids[side]['ielts_group'],dict(id=fixture_group,sectionId=fixture_section))
        source = db.execute(sql.SQL('SELECT id FROM {}."MockQuestion" WHERE "groupId"=%s').format(sql.Identifier(schemas[side])),(ids[side]['ielts_group'],)).fetchone()[0]
        clone(side,'MockQuestion',source,dict(id=fixture_question,groupId=fixture_group))
        ids[side]['score_q']=fixture_question

    def attempt(name, *, expired=False, response=None):
        aid = str(uuid4())
        for side in (0,1):
            clone(side,'MockAttempt',ids[side]['ielts_attempt'],dict(id=aid,examId=fixture_exam,status='in_progress',specificationVersion=CURRENT_SPEC,
                submittedAt=None,finishedAt=None,rawScores=None,sectionBands=None,overallBand=None,cefrLevel=None,
                standardScores=None,overallScore=None,scoreMethod=None,scoreVersion=None,
                overallDeadlineAt='2000-01-01T00:00:00' if expired else None,deadlineAt=None,sectionDeadlines=None,flowMode=None,currentSkill=None))
            ids[side][name]=aid
            if response is not None:
                db.execute(sql.SQL('INSERT INTO {}."MockAnswer" (id,"attemptId","questionId",response,"isGraded","updatedAt") VALUES (%s,%s,%s,%s,false,NOW())').format(sql.Identifier(schemas[side])),(str(uuid4()),aid,fixture_question,response))
        return aid

    attempt('score_complete',response='original')
    call('POST','/v1/mock/attempts/{score_complete}/submit',dict(skills=['writing']),role='student',label='B:submit:Multilevel-ignores-skill-filter')
    call('POST','/v1/mock/attempts/{score_complete}/submit',{},role='student',label='B:submit:Multilevel-idempotent-completed')
    attempt('score_missing')
    call('POST','/v1/mock/attempts/{score_missing}/submit',{},role='student',label='B:submit:Multilevel-incomplete-denied')
    attempt('score_timeout',expired=True)
    call('POST','/v1/mock/attempts/{score_timeout}/submit',{},role='student',label='B:submit:Multilevel-timeout-partial')
    call('POST','/v1/mock/attempts/{score_timeout}/submit',{},role='student',label='B:submit:Multilevel-timeout-idempotent')
    attempt('score_wrong',response='incorrect')
    call('POST','/v1/mock/attempts/{score_wrong}/submit',{},role='student',label='B:submit:attempted-zero-raw')

    # Full four-skill blueprint, equal question identity and exact snapshot hash.
    full_exam=str(uuid4()); section_maps=[{},{}]; group_maps=[{},{}]; full_questions=[[],[]]
    for side in (0,1):
        clone(side,'MockExam',ids[side]['full'],dict(id=full_exam,title='Four-skill submission fixture'))
    section_rows=[db.execute(sql.SQL('SELECT id,skill FROM {}."MockSection" WHERE "examId"=%s ORDER BY "sortOrder"').format(sql.Identifier(schemas[side])),(ids[side]['full'],)).fetchall() for side in (0,1)]
    for paired_sections in zip(*section_rows):
        sid=str(uuid4())
        for side,(source,skill) in enumerate(paired_sections):
            clone(side,'MockSection',source,dict(id=sid,examId=full_exam))
            section_maps[side][source]=sid
        grouped=[db.execute(sql.SQL('SELECT id FROM {}."MockQuestionGroup" WHERE "sectionId"=%s ORDER BY "sortOrder"').format(sql.Identifier(schemas[side])),(paired_sections[side][0],)).fetchall() for side in (0,1)]
        for paired_groups in zip(*grouped):
            gid=str(uuid4())
            for side,(source,) in enumerate(paired_groups):
                clone(side,'MockQuestionGroup',source,dict(id=gid,sectionId=sid))
                group_maps[side][source]=gid
            question_rows=[db.execute(sql.SQL('SELECT id,type,"correctAnswers",points FROM {}."MockQuestion" WHERE "groupId"=%s ORDER BY "sortOrder",number').format(sql.Identifier(schemas[side])),(paired_groups[side][0],)).fetchall() for side in (0,1)]
            for paired_questions in zip(*question_rows):
                qid=str(uuid4())
                for side,(source,kind,keys,points) in enumerate(paired_questions):
                    clone(side,'MockQuestion',source,dict(id=qid,groupId=gid))
                    full_questions[side].append((qid,skill,kind,keys,points))
    for name, graded in [('full_pending',False),('full_scored',True)]:
        aid=attempt(name,expired=True)
        for side in (0,1):
            db.execute(sql.SQL('UPDATE {}."MockAttempt" SET "examId"=%s,"mediaState"=NULL WHERE id=%s').format(sql.Identifier(schemas[side])),(full_exam,aid))
            for qid,skill,kind,keys,points in full_questions[side]:
                if skill in ('reading','listening') or graded:
                    response=keys[0] if keys else 'Original essay' if skill=='writing' else ''
                    db.execute(sql.SQL('INSERT INTO {}."MockAnswer" (id,"attemptId","questionId",response,"isGraded",score,"updatedAt") VALUES (%s,%s,%s,%s,%s,%s,NOW())').format(sql.Identifier(schemas[side])),
                        (str(uuid4()),aid,qid,response,graded and skill in ('writing','speaking'),4 if graded and skill in ('writing','speaking') else None))
        call('POST','/v1/mock/attempts/{'+name+'}/submit',{},role='student',label='B:submit:four-skills-'+('existing-manual-scores' if graded else 'pending-snapshots'))
        call('POST','/v1/mock/attempts/{'+name+'}/submit',{},role='student',label='B:submit:four-skills-idempotent-'+name)

    # Exact DTO first errors, unauthorized ownership, and enrollment recheck.
    for payload in [dict(skills='reading'),dict(skills=['invalid']),dict(extra=True)]:
        call('POST','/v1/mock/attempts/{score_missing}/submit',payload,role='student',label='B:submit:invalid-DTO')
    foreign=attempt('foreign_owner',expired=True)
    second_student=str(uuid4())
    for side in (0,1):
        clone(side,'User',ids[side]['student'],dict(id=second_student,phone='+submission-second-student'))
        db.execute(sql.SQL('INSERT INTO {}."StudentProfile" ("userId","linkCode","availablePrograms","activeProgram") VALUES (%s,%s,ARRAY[\'IELTS\',\'MULTILEVEL\']::{}."ExamProgram"[],\'IELTS\')').format(sql.Identifier(schemas[side]),sql.Identifier(schemas[side])),(second_student,'submission-second-link'))
        db.execute(sql.SQL('UPDATE {}."MockAttempt" SET "studentId"=%s WHERE id=%s').format(sql.Identifier(schemas[side])),(second_student,foreign))
    call('POST','/v1/mock/attempts/{foreign_owner}/submit',{},role='student',label='B:submit:second-student-IDOR')
    # A nonexistent UUID must be hidden by the ownership lookup too.
    missing=str(uuid4())
    call('POST',f'/v1/mock/attempts/{missing}/submit',{},role='student',label='B:submit:not-found')
    attempt('revoked',expired=True)
    for side in (0,1):
        db.execute(sql.SQL('UPDATE {}."StudentProfile" SET "availablePrograms"=ARRAY[\'IELTS\']::{}."ExamProgram"[] WHERE "userId"=%s').format(sql.Identifier(schemas[side]),sql.Identifier(schemas[side])),(ids[side]['student'],))
    call('POST','/v1/mock/attempts/{revoked}/submit',{},role='student',label='B:submit:revoked-enrollment')
    for side in (0,1):
        db.execute(sql.SQL('UPDATE {}."StudentProfile" SET "availablePrograms"=ARRAY[\'IELTS\',\'MULTILEVEL\']::{}."ExamProgram"[] WHERE "userId"=%s').format(sql.Identifier(schemas[side]),sql.Identifier(schemas[side])),(ids[side]['student'],))

    actor=SimpleNamespace(id=ids[0]['student'])
    # Rollback includes objective answer projections and in-app notification.
    rollback=attempt('score_rollback',response='original')
    before_notifications=Notification.objects.count()
    with patch('apps.core.mock_submission_snapshots.enqueue',side_effect=RuntimeError('synthetic handoff failure')):
        try:
            submit(actor,rollback)
        except RuntimeError:
            pass
        else:
            raise AssertionError('Expected snapshot failure')
    assert MockAttempt.objects.get(id=rollback).status=='in_progress'
    row=MockAnswer.objects.get(attempt_id=rollback)
    assert row.score is None and row.is_correct is None and not row.is_graded
    assert Notification.objects.count()==before_notifications
    call('POST','/v1/mock/attempts/{score_rollback}/submit',{},role='student',label='B:submit:rollback-retry')

    # Competing Django transactions use separate real PostgreSQL connections.
    # The reference's atomic claim may briefly return a grading claim to a
    # loser; sequential API parity above checks the stable persisted contract.
    checks=4
    for timeout in (False,True):
        aid=attempt('score_race',expired=timeout,response='original')
        barrier=Barrier(2)
        before=Notification.objects.count()
        def worker():
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                return submit(actor,aid)
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool:
            values=list(pool.map(lambda _:worker(),range(2)))
        assert values[0]==values[1]
        assert values[0]['status']=='completed' and values[0]['rawScores']['listening']==dict(score=1,max=1)
        assert MockAttempt.objects.get(id=aid).status=='completed'
        assert MockAnswer.objects.get(attempt_id=aid).score==1
        assert Notification.objects.count()==before+1
        nest_barrier=Barrier(2)
        def nest_worker():
            nest_barrier.wait(timeout=10)
            request=Request(call.reference_base+f'/v1/mock/attempts/{aid}/submit',data=b'{}',method='POST',
                headers={'Authorization':'Bearer '+call.reference_student_token,'Content-Type':'application/json'})
            with urlopen(request,timeout=20) as response:
                return dict(status=response.status,body=json.loads(response.read()))
        with ThreadPoolExecutor(max_workers=2) as pool:
            reference_responses=list(pool.map(lambda _:nest_worker(),range(2)))
        assert all(value['status']==201 for value in reference_responses)
        # Retain transient reference claim responses verbatim as evidence.
        results.append(dict(method='PG',path='reference-concurrent-submit',label='B:submit:Nest-'+('timeout' if timeout else 'manual')+'-race',
            status='PASS',database='PASS',responses=reference_responses))
        # Complete the equivalent reference fixture to compare persisted rows.
        call('POST','/v1/mock/attempts/{score_race}/submit',{},role='student',label='B:submit:PG-'+('timeout' if timeout else 'manual')+'-race-persisted-parity')
        checks+=5
    aid=attempt('save_submit_race',response='incorrect')
    barrier=Barrier(2)
    def race(saving):
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            try:
                return save_answers(actor,aid,[dict(questionId=fixture_question,response='original')]) if saving else submit(actor,aid)
            except ContractAPIException as error:
                assert saving and error.contract_code=='MOCK_ATTEMPT_FINISHED'
                return None
        finally:
            connections.close_all()
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(race,[True,False]))
    answer=MockAnswer.objects.get(attempt_id=aid)
    assert answer.is_graded and answer.score==(1 if answer.response=='original' else 0)
    persisted=MockAttempt.objects.get(id=aid)
    assert persisted.status=='completed' and persisted.raw_scores['listening']['score']==answer.score
    # Align the reference input with whichever valid serialization won; no
    # result differences are normalized away.
    db.execute(sql.SQL('UPDATE {}."MockAnswer" SET response=%s WHERE "attemptId"=%s').format(sql.Identifier(schemas[1])),(answer.response,aid))
    call('POST','/v1/mock/attempts/{save_submit_race}/submit',{},role='student',label='B:submit:PG-save-submit-serialization')
    try:
        save_answers(actor,aid,[dict(questionId=fixture_question,response='late rewrite')])
    except ContractAPIException as error:
        assert error.contract_code=='MOCK_ATTEMPT_FINISHED'
    else:
        raise AssertionError('Finalized history changed')
    checks+=3
    results.append(dict(method='PG',path='submission-locks-and-rollback',label='B:submit:postgres-concurrency',status='PASS',database='PASS',checks=checks))
