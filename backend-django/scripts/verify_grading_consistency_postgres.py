"""Local PostgreSQL teacher/student grading contracts in a rolled-back fixture.

Uses no production connection, external provider or historical project row.
Unlike a Nest parity check, this verifies the intentional legacy-grade ledger
reconciliation introduced for consistent teacher/student result presentation.
"""
import copy
import json
import os
import sys
import wave
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import urlparse
from uuid import uuid4

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
if urlparse(os.environ.get('DATABASE_URL','')).hostname not in ('localhost','127.0.0.1','::1'):
    raise SystemExit('Only a loopback PostgreSQL fixture is allowed')
os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings.local')
os.environ.setdefault('ALLOWED_HOSTS','testserver,localhost,127.0.0.1')
import django

django.setup()
from django.db import connection, transaction
from django.test import override_settings
from django.utils import timezone
from psycopg import sql
from rest_framework.test import APIClient

from apps.core import (
    assessment,
    assessment_results,
    assessment_worker,
    mock_submission_snapshots,
)
from apps.core.multilevel import CURRENT_SPEC
from apps.legacy_schema.models import (
    AssessmentEvaluation,
    AssessmentJob,
    MockAnswer,
    MockAttempt,
    MockExam,
)

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
    if not hasattr(response,'data'):return response.content
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
        check(attempt.status=='grading' and {k:attempt.raw_scores['writing'][k] for k in ('score','max')}==dict(score=12,max=16),'completed Writing stays visible while Speaking is pending')
        check(jobs['writing'].final_score==12 and jobs['writing'].final_score_source=='TEACHER','legacy teacher grading reconciles the Writing assessment ledger')
        for qid,value in zip(speaking,[3,4,5]):request('teacher',grade_path,dict(questionId=qid,score=value),201)
        attempt.refresh_from_db();jobs['speaking'].refresh_from_db()
        check(attempt.status=='completed' and {k:attempt.raw_scores['speaking'][k] for k in ('score','max')}==dict(score=4,max=5),'three Speaking responses produce one mean part score /5')
        check(attempt.overall_score is None and attempt.cefr_level is None and attempt.standard_scores=={},'partial practice has no invented overall or CEFR result')
        student=request('student','/v1/assessment/attempts/'+attempt.id)
        teacher=request('teacher','/v1/assessment/attempts/'+attempt.id)
        check(student==teacher,'teacher and student receive identical authorized final score projections')
        check({j['skill']:j['finalScore'] for j in student['assessments']}==dict(writing=12,speaking=4),'both assessment panels expose the saved teacher raw scores')
        check({j['skill']:j['practiceGrade']['score'] for j in student['assessments']}==dict(writing=46.3,speaking=47),
            'both panels expose the same explicit internal 35-50 policy with native raw marks retained')
        request('teacher','/v1/mock/attempts/'+attempt.id+'/certificate',None,200)
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
        # New configured AI practice uses real ledger/worker paths, with only
        # the two external providers replaced by local deterministic stubs.
        MockExam.objects.filter(id=ids['exam']).update(assessment_policy='PRACTICE_AUTO_AI')
        ai_id=prefix+'-ai-attempt'
        insert('MockAttempt',id=ai_id,examId=ids['exam'],studentId=ids['student'],status='grading',submittedAt=stamp,
            flowMode='partial_practice',specificationVersion=CURRENT_SPEC,mediaState=json.dumps({'__practice_scope':dict(version=1,skills=['writing','speaking'],questionIds=question_ids)}))
        original='I enjoy studying English because it helps me communicate with people and understand different cultures.'
        for qid in question_ids:
            insert('MockAnswer',id=str(uuid4()),attemptId=ai_id,questionId=qid,response=original if qid in writing else '',audioKey=qid+'.wav' if qid in speaking else None,updatedAt=stamp)
        ai_attempt=MockAttempt.objects.select_related('exam').get(id=ai_id)
        mock_submission_snapshots.enqueue(ai_attempt)
        ai_jobs={j.skill:j for j in AssessmentJob.objects.filter(attempt_id=ai_id)}
        check(all(j.policy_mode=='PRACTICE_AUTO_AI' and j.status=='PENDING' for j in ai_jobs.values()),'configured scoped practice queues actual AI assessments')
        with patch.object(assessment_worker, 'run_once') as unauthorized_worker:
            request('other_teacher', '/v1/assessment/attempts/'+ai_id, expected=403)
            check(not unauthorized_worker.called, 'foreign teacher cannot trigger assessment work')
        check(not AssessmentJob.objects.filter(attempt_id=ai_id).exclude(status='PENDING').exists(),
            'unauthorized assessment read leaves all jobs pending')
        def grader(input,role):
            rated=assessment_results.empty(input);rated['confidence']=.95
            for part in rated['parts']:
                source=next(p for p in input['parts'] if p['id']==part['id'])
                excerpt=source['responses'][0].get('transcript') or source['responses'][0]['originalResponse']
                part.update(rawScore=2.5,criteria={k:2.5 for k in assessment_results.keys(input)},
                    evidence={k:'The actual response shows limited development: '+excerpt for k in assessment_results.keys(input)},
                    evidenceQuotes=[dict(criterion=k,responseIndex=0,quote=excerpt) for k in assessment_results.keys(input)])
            return dict(result=rated,provider='local-deepseek-stub',model='local-fixture-model',inputTokens=12,outputTokens=13,latencyMs=1)
        def transcript(*args):return dict(text=original,segments=[],confidence=.95,provider='local-deepgram-stub',model='local-fixture-stt',durationMs=12000,pronunciationEvidence='UNAVAILABLE')
        def run_fixture(job,speech_stub=transcript):
            claimed=assessment.update(job,status='PROCESSING',lease_token=str(uuid4()),lease_expires_at=timezone.now()+__import__('datetime').timedelta(minutes=10),attempt_count=1)
            with patch.object(assessment_worker.service,'claim',return_value=claimed),patch.dict(os.environ,dict(ASSESSMENT_ADJUDICATION_ENABLED='false')):
                assessment_worker.run_once(grader=grader,speech=speech_stub)
            job.refresh_from_db()
        # A low-confidence proposal is stored for teacher review only.
        low_id=prefix+'-low-confidence'
        insert('MockAttempt',id=low_id,examId=ids['exam'],studentId=ids['student'],status='grading',submittedAt=stamp,
            flowMode='partial_practice',specificationVersion=CURRENT_SPEC,mediaState=json.dumps({'__practice_scope':dict(version=1,skills=['writing'],questionIds=writing)}))
        for qid in writing:
            insert('MockAnswer',id=str(uuid4()),attemptId=low_id,questionId=qid,response=original,updatedAt=stamp)
        mock_submission_snapshots.enqueue(MockAttempt.objects.select_related('exam').get(id=low_id))
        low_job=AssessmentJob.objects.get(attempt_id=low_id)
        claimed=assessment.update(low_job,status='PROCESSING',lease_token=str(uuid4()),lease_expires_at=timezone.now()+__import__('datetime').timedelta(minutes=10),attempt_count=1)
        def low_grader(input,role):
            answer=grader(input,role)
            answer['result']['confidence']=0.1
            return answer
        with patch.object(assessment_worker.service,'claim',return_value=claimed),patch.dict(os.environ,dict(ASSESSMENT_ADJUDICATION_ENABLED='false')):
            assessment_worker.run_once(grader=low_grader,speech=transcript)
        low_job.refresh_from_db()
        check(low_job.status=='NEEDS_REVIEW' and low_job.ai_score is not None and low_job.final_score is None
              and low_job.final_result is None and low_job.approved_feedback is None,
              'low-confidence AI remains a proposal without an approved final score')
        check(not MockAnswer.objects.filter(attempt_id=low_id,is_graded=True).exists(),
              'low-confidence AI does not project graded answers')
        view=request('student','/v1/assessment/attempts/'+low_id)
        check(view['overall_band'] is None, 'unapproved AI score is not exposed as overall band')
        MockAttempt.objects.filter(id=low_id).update(status='completed')
        request('student','/v1/mock/attempts/'+low_id+'/certificate',None,409)
        low_review='/v1/assessment/jobs/'+low_job.id+'/review'
        request('teacher',low_review,dict(action='ACCEPT',expectedVersion=low_job.version,reason='Reviewed the actual response'),201)
        low_job.refresh_from_db()
        check(low_job.status=='SUCCEEDED' and low_job.final_score is not None
              and MockAnswer.objects.filter(attempt_id=low_id,is_graded=True).exists(),
              'teacher approval projects the previously unapproved result')

        for job in ai_jobs.values():run_fixture(job)
        ai_attempt.refresh_from_db()
        check(ai_attempt.status=='completed' and all(j.final_score_source=='AI' and j.status=='SUCCEEDED' for j in ai_jobs.values()),'mocked providers finish scoped AI jobs through the real worker and answer projection')
        check(ai_attempt.raw_scores['writing']['score']==7.5 and ai_attempt.raw_scores['speaking']['score']==2.5,'native evidence scores remain distinct from displayed internal policy')
        check(ai_attempt.raw_scores['writing']['practiceGrade']['score']==42 and ai_attempt.raw_scores['speaking']['practiceGrade']['score']==42.5,'student main result stores the same internal grade as the AI ledger')
        check(ai_attempt.overall_score is None and ai_attempt.cefr_level is None,'AI scoped practice never invents overall or CEFR certification')
        ai_student=request('student','/v1/assessment/attempts/'+ai_id)
        ai_teacher=request('teacher','/v1/assessment/attempts/'+ai_id)
        check(ai_student==ai_teacher and all(j['aiPracticeGrade']==j['practiceGrade'] for j in ai_student['assessments']), 'teacher and student see identical persisted AI practice grades')
        check(MockAnswer.objects.get(attempt_id=ai_id,question_id=writing[0]).response==original,'AI grading preserves the original candidate response')
        ai_job=ai_jobs['writing'];review='/v1/assessment/jobs/'+ai_job.id+'/review'
        request('teacher',review,dict(action='OVERRIDE',expectedVersion=ai_job.version,reason='Teacher heard and reviewed the work',parts=[dict(id=p['id'],rawScore=4) for p in ai_job.input_snapshot['parts']]),201)
        ai_job.refresh_from_db();ai_attempt.refresh_from_db()
        final=request('student','/v1/assessment/attempts/'+ai_id)['assessments']
        writing_view=next(j for j in final if j['skill']=='writing')
        check(writing_view['practiceGrade']['score']==46.3 and writing_view['teacherPracticeGrade']==writing_view['practiceGrade'] and writing_view['aiPracticeGrade']['score']==42,
            'teacher native override updates final display policy while preserving the separate AI proposal')
        check(ai_attempt.raw_scores['writing']['practiceGrade']==writing_view['practiceGrade'],'teacher override and student main result share exactly one persisted display grade')
        request('teacher',review,dict(action='REGRADE',expectedVersion=ai_job.version,reason='Obtain an independent proposal without overwriting teacher work'),201)
        later=AssessmentJob.objects.filter(attempt_id=ai_id,skill='writing').order_by('-generation').first()
        run_fixture(later)
        check(later.final_score_source=='TEACHER' and later.final_score==12 and later.final_result['practiceGrade']['score']==46.3,
            'late AI regrade preserves teacher-approved native and practice grades')
        # A zero-amplitude decoded recording proves only that no speech was
        # captured. It cannot distinguish deliberate silence from mic failure.
        # An empty STT response is even weaker evidence. Neither is a grade.
        from apps.core.assessment_local_stt import _decode_audio
        from apps.core.assessment_results import ProviderError
        from apps.legacy_schema.models import SpeechTranscript

        def speech_case(label, audio_kind, stt):
            attempt_id=prefix+'-'+label+'-attempt'
            insert('MockAttempt',id=attempt_id,examId=ids['exam'],studentId=ids['student'],status='grading',submittedAt=stamp,
                flowMode='partial_practice',specificationVersion=CURRENT_SPEC,mediaState=json.dumps({'__practice_scope':dict(version=1,skills=['speaking'],questionIds=speaking)}))
            for qid in speaking:
                key=label+'-'+qid+'.wav'
                if audio_kind == 'silent':
                    with wave.open(str(Path(storage)/key),'wb') as audio:
                        audio.setnchannels(1);audio.setsampwidth(2);audio.setframerate(16000);audio.writeframes(b'\0\0'*16000)
                elif audio_kind == 'recorded':
                    (Path(storage)/key).write_bytes(b'RIFF-local-test-recording')
                insert('MockAnswer',id=str(uuid4()),attemptId=attempt_id,questionId=qid,response='',audioKey=key,updatedAt=stamp)
            mock_submission_snapshots.enqueue(MockAttempt.objects.select_related('exam').get(id=attempt_id))
            job=AssessmentJob.objects.get(attempt_id=attempt_id)
            run_fixture(job,stt)
            return attempt_id,job

        def assert_needs_review(label, audio_kind, stt, code):
            attempt_id,job=speech_case(label,audio_kind,stt)
            check(job.status=='NEEDS_REVIEW' and job.failure_code==code and job.final_score is None,
                label+' is sent to review with no final score')
            check(not MockAnswer.objects.filter(attempt_id=attempt_id,is_graded=True).exists(),
                label+' has no fabricated graded answers')
            check(not AssessmentEvaluation.objects.filter(job_id=job.id,status='SUCCEEDED').exists(),
                label+' has no successful evaluation')
            check(not SpeechTranscript.objects.filter(job_id=job.id,status='SUCCEEDED').exists(),
                label+' has no successful transcript')
            if audio_kind != 'missing':
                check(SpeechTranscript.objects.filter(job_id=job.id,status='FAILED',failure_code=code).exists(),
                    label+' records its specific transcript failure')

        unmeasured_id,unmeasured_job=speech_case('unmeasured-stt-confidence','recorded',
            lambda *args:dict(transcript(*args),confidence=None))
        check(unmeasured_job.status=='NEEDS_REVIEW' and unmeasured_job.failure_code=='STT_CONFIDENCE_INSUFFICIENT'
            and unmeasured_job.final_score is None and unmeasured_job.ai_score is not None,
            'unmeasured STT confidence does not automatically approve a score')
        check(not MockAnswer.objects.filter(attempt_id=unmeasured_id,is_graded=True).exists(),
            'unmeasured STT confidence does not project graded answers')
        unmeasured_view=request('student','/v1/assessment/attempts/'+unmeasured_id)
        check(unmeasured_view['status']=='needs_review' and unmeasured_view['overall_band'] is None,
            'student overview displays the review state without an overall score')

        def silence(path,*args):
            _decode_audio(path,600)  # Real PCM silence is detected before inference.
            raise AssertionError('Expected silent audio to be detected')
        assert_needs_review('verified-acoustic-silence','silent',silence,'STT_NO_SPEECH')
        assert_needs_review('unverified-empty-transcript','recorded',lambda *args:dict(transcript(*args),text=''),'STT_EMPTY_TRANSCRIPT')
        assert_needs_review('microphone-missing-audio','missing',transcript,'STT_AUDIO_UNAVAILABLE')
        def timeout(*args):
            raise ProviderError('STT_LOCAL_TIMEOUT',True,False)
        timeout_id,timeout_job=speech_case('stt-timeout','recorded',timeout)
        check(timeout_job.status=='RETRY' and timeout_job.failure_code=='STT_LOCAL_TIMEOUT' and timeout_job.final_score is None,
            'STT timeout remains retryable without a final score')
        check(not MockAnswer.objects.filter(attempt_id=timeout_id,is_graded=True).exists(),
            'STT timeout has no fabricated graded answers')
        check(not AssessmentEvaluation.objects.filter(job_id=timeout_job.id,status='SUCCEEDED').exists(),
            'STT timeout has no successful evaluation')
        check(SpeechTranscript.objects.filter(job_id=timeout_job.id,status='FAILED',failure_code='STT_LOCAL_TIMEOUT').exists(),
            'STT timeout records the transcript failure for retry')
        ai.assert_not_called();speech.assert_not_called()
        transaction.set_rollback(True)
    check(not MockExam.objects.filter(id=ids['exam']).exists(),'all local fixtures and grading changes rolled back')
    print('GRADING_VALIDATION='+json.dumps(dict(passed=len(checks),checks=checks)))
finally:
    connection.close()
