"""Local PostgreSQL teacher/student grading contracts in a rolled-back fixture.

Uses no production connection, external provider or historical project row.
Unlike a Nest parity check, this verifies the intentional legacy-grade ledger
reconciliation introduced for consistent teacher/student result presentation.
"""
import copy
import json
import os
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from urllib.parse import urlparse
from uuid import uuid4
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
if urlparse(os.environ.get('DATABASE_URL','')).hostname not in ('localhost','127.0.0.1','::1'):
    raise SystemExit('Only a loopback PostgreSQL fixture is allowed')
os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings.local')
os.environ.setdefault('ALLOWED_HOSTS','testserver,localhost,127.0.0.1')
import django
django.setup()
from django.db import connection,transaction
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from psycopg import sql
from apps.core import mock_submission_snapshots
from apps.core.multilevel import CURRENT_SPEC
from apps.legacy_schema.models import AssessmentJob,AssessmentEvaluation,MockAttempt,MockAnswer,MockExam

prefix='grading-'+uuid4().hex[:12]
ids={name:prefix+'-'+name for name in ('teacher','other_teacher','student','group','exam','attempt')}
actors={name:SimpleNamespace(id=ids[name],role='teacher' if 'teacher' in name else 'student',is_authenticated=True) for name in ('teacher','other_teacher','student')}
checks=[]

def check(value,message):
    if not value:raise AssertionError(message)
    checks.append(message);print('PASS '+message)

def insert(table,**values):
    with connection.cursor() as cursor:
        query=sql.SQL('INSERT INTO {} ({}) VALUES ({})').format(sql.Identifier(table),
            sql.SQL(',').join(map(sql.Identifier,values)),sql.SQL(',').join(sql.Placeholder() for _ in values))
        cursor.execute(query,list(values.values()))

def request(actor,path,data=None,expected=200):
    client=APIClient();client.force_authenticate(user=actors[actor])
    response=client.get(path) if data is None else client.post(path,data,format='json')
    check(response.status_code==expected,f'{actor} {path.rsplit("/",1)[-1]} HTTP {expected}: {getattr(response,"data",None) if response.status_code!=expected else "OK"}')
    return response.data.get('data') if response.status_code<400 else response.data

try:
    with TemporaryDirectory(prefix='bestway-grading-') as storage,override_settings(MEDIA_ROOT=storage),\
            patch('apps.core.assessment_providers.assess') as ai,patch('apps.core.assessment_providers.transcribe') as speech,transaction.atomic():
        stamp=timezone.now()
        for actor in actors.values():
            insert('User',id=actor.id,name='Local grading fixture',phone=actor.id,passwordHash='unused',role=actor.role,updatedAt=stamp)
        insert('Group',id=ids['group'],name='Local grading group',teacherId=ids['teacher'])
        with connection.cursor() as cursor:
            cursor.execute('INSERT INTO "StudentProfile" ("userId","availablePrograms","activeProgram","isApproved","groupId","linkCode") VALUES (%s,ARRAY[\'MULTILEVEL\']::"ExamProgram"[],\'MULTILEVEL\',true,%s,%s)',[ids['student'],ids['group'],prefix])
        insert('MockExam',id=ids['exam'],type='multilevel',title='Local partial W/S practice',profile='practice',specificationVersion=CURRENT_SPEC,assessmentPolicy='MANUAL_ONLY',updatedAt=stamp)
        question_ids=[];writing=[];speaking=[]
        for skill,maxima in [('writing',[5,5,6]),('speaking',[5])]:
            section=prefix+'-'+skill;insert('MockSection',id=section,examId=ids['exam'],skill=skill,sortOrder=0 if skill=='writing' else 1)
            for index,maximum in enumerate(maxima):
                group=section+'-'+str(index);insert('MockQuestionGroup',id=group,sectionId=section,title='Authored task',sortOrder=index,maxScore=maximum,stimulusRef='original-source' if skill=='writing' and index<2 else None)
                for qi in range(3 if skill=='speaking' else 1):
                    qid=group+'-q'+str(qi);question_ids.append(qid)
                    (writing if skill=='writing' else speaking).append(qid)
                    insert('MockQuestion',id=qid,groupId=group,number=qi+1,sortOrder=qi,type='speaking_task' if skill=='speaking' else 'essay_task2' if index==2 else 'essay_task1',prompt='Describe an experience with reasons.',points=9)
        insert('MockAttempt',id=ids['attempt'],examId=ids['exam'],studentId=ids['student'],status='grading',submittedAt=stamp,
            flowMode='partial_practice',specificationVersion=CURRENT_SPEC,mediaState=json.dumps({'__practice_scope':dict(version=1,skills=['writing','speaking'],questionIds=question_ids)}))
        for qid in question_ids:
            key=None
            if qid in speaking:
                key=qid+'.wav';(Path(storage)/key).write_bytes(b'RIFF-local-test-recording')
            insert('MockAnswer',id=str(uuid4()),attemptId=ids['attempt'],questionId=qid,response='Original candidate work' if qid in writing else '',audioKey=key,updatedAt=stamp)
        attempt=MockAttempt.objects.select_related('exam').get(id=ids['attempt'])
        before=dict(MockExam.objects.filter(id=ids['exam']).values().get())
        mock_submission_snapshots.enqueue(attempt)
        jobs={j.skill:j for j in AssessmentJob.objects.filter(attempt_id=attempt.id)}
        check(set(jobs)=={'writing','speaking'},'only Writing/Speaking assessment jobs exist')
        check(all(j.policy_mode=='MANUAL_ONLY' and j.status=='NEEDS_REVIEW' for j in jobs.values()),'partial practice never queues an external AI assessment')
        grade_path='/v1/mock/attempts/'+attempt.id+'/grade'
        request('other_teacher',grade_path,dict(questionId=writing[0],score=3),403)
        request('student',grade_path,dict(questionId=writing[0],score=3),403)
        for qid,value in zip(writing,[3,4,5]):request('teacher',grade_path,dict(questionId=qid,score=value,feedback='Teacher comments'),201)
        attempt.refresh_from_db();jobs['writing'].refresh_from_db()
        check(attempt.status=='grading' and attempt.raw_scores['writing']==dict(score=12,max=16),'completed Writing stays visible while Speaking is pending')
        check(jobs['writing'].final_score==12 and jobs['writing'].final_score_source=='TEACHER','legacy teacher grading reconciles the Writing assessment ledger')
        for qid,value in zip(speaking,[3,4,5]):request('teacher',grade_path,dict(questionId=qid,score=value),201)
        attempt.refresh_from_db();jobs['speaking'].refresh_from_db()
        check(attempt.status=='completed' and attempt.raw_scores['speaking']==dict(score=4,max=5),'three Speaking responses produce one mean part score /5')
        check(attempt.overall_score is None and attempt.cefr_level is None and attempt.standard_scores=={},'partial practice has no invented overall or CEFR result')
        student=request('student','/v1/assessment/attempts/'+attempt.id)
        teacher=request('teacher','/v1/assessment/attempts/'+attempt.id)
        check(student==teacher,'teacher and student receive identical authorized final score projections')
        check({j['skill']:j['finalScore'] for j in student['assessments']}==dict(writing=12,speaking=4),'both assessment panels expose the saved teacher raw scores')
        request('teacher','/v1/mock/attempts/'+attempt.id+'/certificate',None,400)
        jobs['writing'].refresh_from_db();job=jobs['writing']
        approved=copy.deepcopy(job.final_result);approved['priorityImprovements']=['Develop each reason with an example.']
        review_path='/v1/assessment/jobs/'+job.id+'/review'
        request('teacher',review_path,dict(action='EDIT_FEEDBACK',expectedVersion=job.version,reason='Give feedback after manual grading',feedback=approved),201)
        job.refresh_from_db();check(job.approved_feedback['priorityImprovements']==approved['priorityImprovements'],'manual teacher feedback can be edited without fabricated AI rubric evidence')
        malformed=copy.deepcopy(job.approved_feedback);malformed['parts'][0]['feedback']['grammar']=False
        request('teacher',review_path,dict(action='EDIT_FEEDBACK',expectedVersion=job.version,reason='Reject invalid feedback text',feedback=malformed),400)
        edited=copy.deepcopy(job.approved_feedback);edited['parts'][0]['rawScore']=5
        request('teacher',review_path,dict(action='EDIT_FEEDBACK',expectedVersion=job.version,reason='A feedback edit cannot change scores',feedback=edited),400)
        request('teacher',review_path,dict(action='OVERRIDE',expectedVersion=job.version-1,reason='Stale teacher request',parts=[]),409)
        request('teacher',review_path,dict(action='OVERRIDE',expectedVersion=job.version,reason='Update holistic teacher scores',parts=[dict(id=p['id'],rawScore=4) for p in job.input_snapshot['parts']]),201)
        attempt.refresh_from_db();job.refresh_from_db()
        check(job.final_score==12 and attempt.raw_scores['writing']['score']==12,'assessment review and answer-based result use one raw score')
        version=job.version
        with patch('apps.core.assessment.record_legacy_grade',side_effect=RuntimeError('Fixture ledger failure')):
            request('teacher',grade_path,dict(questionId=writing[0],score=5),500)
        attempt.refresh_from_db();job.refresh_from_db()
        check(job.version==version and job.final_score==12 and attempt.raw_scores['writing']['score']==12
            and MockAnswer.objects.get(attempt_id=attempt.id,question_id=writing[0]).score==4,
            'failed ledger reconciliation rolls back the teacher answer and result atomically')
        check(before==MockExam.objects.filter(id=ids['exam']).values().get(),'grading does not rewrite the historical exam definition')
        check(not AssessmentEvaluation.objects.filter(job__attempt_id=attempt.id).exists(),'manual grades never fabricate an AI provider evaluation')
        ai.assert_not_called();speech.assert_not_called()
        transaction.set_rollback(True)
    check(not MockExam.objects.filter(id=ids['exam']).exists(),'all local fixtures and grading changes rolled back')
    print('GRADING_VALIDATION='+json.dumps(dict(passed=len(checks),checks=checks)))
finally:
    connection.close()
