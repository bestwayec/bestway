"""Durable assessment ledger, authorized projections and serialized review."""
import os
from datetime import timedelta
from urllib.parse import quote
from uuid import uuid4
from django.db import transaction,connection
from django.db.models import Q,F
from django.utils import timezone
from apps.legacy_schema.models import AssessmentJob,AssessmentEvaluation,SpeechTranscript,MockAttempt,MockAnswer,AuditLog
from .mock_attempts import fail,aware
from .points import assert_can_view
from .content_media import storage_path
from . import assessment_results as results

def setting(name,fallback,low,high):
    try:value=float(os.environ.get(name,'nan'))
    except ValueError:return fallback
    return value if low<=value<=high else fallback
def threshold():return setting('ASSESSMENT_CONFIDENCE_THRESHOLD',.85,.5,1)
def max_attempts():return setting('ASSESSMENT_MAX_ATTEMPTS',3,1,3)
def get(identifier):
    job=AssessmentJob.objects.filter(id=identifier).first()
    if job is None:fail('ASSESSMENT_NOT_FOUND','Assessment not found',404)
    return job
def authorize(actor,job):
    assert_can_view(actor,job.student_id)
    if actor.role=='student':assert_program(actor,job.attempt)

def assert_program(actor,attempt):
    from .exam_programs import state
    with connection.cursor() as cursor:value=state(cursor,actor.id)
    if ('MULTILEVEL' if attempt.exam.type=='multilevel' else 'IELTS') not in value['availablePrograms']:
        fail('PROGRAM_NOT_ENROLLED','Not enrolled in this exam track',403)

def for_attempt(actor,identifier):
    attempt=MockAttempt.objects.filter(id=identifier).select_related('exam').first()
    if attempt is None:fail('MOCK_ATTEMPT_NOT_FOUND','Attempt not found',404)
    assert_can_view(actor,attempt.student_id)
    if actor.role=='student':assert_program(actor,attempt)
    rows=AssessmentJob.objects.filter(attempt_id=identifier).order_by('-generation','-created_at');seen=set();values=[]
    for job in rows:
        if job.skill in seen:continue
        seen.add(job.skill);input=job.input_snapshot
        evaluations=list(AssessmentEvaluation.objects.filter(job_id=job.id,status='SUCCEEDED').order_by('-completed_at'))
        transcripts=list(SpeechTranscript.objects.filter(job_id=job.id,status='SUCCEEDED').order_by('-completed_at'))
        evaluation=next((e for e in evaluations if e.id==job.selected_evaluation_id),evaluations[0] if evaluations else None)
        value={key:getattr(job,attr) for key,attr in dict(id='id',skill='skill',program='program',status='status',policyMode='policy_mode',version='version',aiScore='ai_score',teacherScore='teacher_score',finalScore='final_score',finalScoreSource='final_score_source',confidence='confidence',rubricVersion='rubric_version',promptVersion='prompt_version',failureCode='failure_code',finalResult='final_result',approvedFeedback='approved_feedback').items()}
        value.update(teacherReviewed=job.final_score_source=='TEACHER' or job.approved_feedback is not None,
            evaluation=dict(result=evaluation.result,provider=evaluation.provider,model=evaluation.model) if evaluation and evaluation.result else None,
            parts=[{k:p[k] for k in ('id','max','task','context')} for p in input['parts']],submissions=[])
        for part in input['parts']:
            for r in part['responses']:
                transcript=next((t for t in transcripts if t.question_id==r['questionId'] and t.audio_hash==r.get('audioHash')),None)
                value['submissions'].append(dict(questionId=r['questionId'],partId=part['id'],partNumber=r['partNumber'],prompt=r['prompt'],context=part['context'],originalResponse=r['originalResponse'],wordCount=len(r['originalResponse'].split()),
                    audioUrl=(os.environ.get('PUBLIC_URL','http://localhost:3001')+'/v1/assessment/jobs/'+job.id+'/audio/'+quote(r['questionId'],safe="~()*!.'-")) if r.get('audioKey') else None,
                    transcript=dict(text=transcript.text,confidence=transcript.confidence,segments=transcript.segments,pronunciationEvidence=transcript.pronunciation_evidence) if transcript else None))
        values.append(value)
    return dict(attemptId=identifier,assessments=values)

def audio(actor,identifier,question_id):
    job=get(identifier);authorize(actor,job)
    r=next((r for p in job.input_snapshot['parts'] for r in p['responses'] if r['questionId']==question_id),None)
    if not r or not r.get('audioKey') or not storage_path(r['audioKey']).is_file():fail('FILE_NOT_FOUND','Audio not found',404)
    return r['audioKey']

def update(job,**values):
    values['updated_at']=timezone.now();AssessmentJob.objects.filter(id=job.id).update(**values);job.refresh_from_db();return job

def project(job,result,actor_id):
    score=results.score(job.input_snapshot,result)
    for part in job.input_snapshot['parts']:
        rated=next(p for p in result['parts'] if p['id']==part['id']);value=next(p['score'] for p in score['parts'] if p['id']==part['id'])
        if value is None:results.fail('Incomplete rubric cannot be finalized')
        for r in part['responses']:
            values=dict(score=value,is_graded=True,graded_by_id=actor_id,rubric_scores=rated['criteria'],updated_at=timezone.now())
            MockAnswer.objects.update_or_create(attempt_id=job.attempt_id,question_id=r['questionId'],defaults=values,
                create_defaults=dict(values,id=str(uuid4()),response=r['originalResponse'],audio_key=r.get('audioKey')))

def feedback_only(next,previous):
    def facts(value):return dict(confidence=value['confidence'],pronunciationEvidence=value['pronunciationEvidence'],parts=sorted([{k:p[k] for k in ('id','rawScore','criteria','evidence')} for p in value['parts']],key=lambda p:p['id']))
    from .mock_import_validate import canonical_checksum
    return canonical_checksum(facts(next))==canonical_checksum(facts(previous))

def review(actor,identifier,data):
    if actor.role not in ('teacher','admin','super_admin'):fail('FORBIDDEN','Staff access required',403)
    if not data['reason'].strip():fail('ASSESSMENT_REASON_REQUIRED','Review reason is required')
    before=get(identifier);authorize(actor,before)
    with transaction.atomic():
        attempt=MockAttempt.objects.select_for_update().get(id=before.attempt_id)
        job=AssessmentJob.objects.select_for_update().get(id=identifier)
        if job.version!=data['expectedVersion']:fail('ASSESSMENT_STALE_VERSION','Assessment changed; refresh before reviewing',409)
        if attempt.status=='in_progress':fail('MOCK_ATTEMPT_NOT_SUBMITTED','Attempt has been reopened',409)
        latest=AssessmentJob.objects.filter(attempt_id=job.attempt_id,skill=job.skill).order_by('-generation','-created_at').first()
        if latest.id!=job.id:fail('ASSESSMENT_STALE_VERSION','A newer assessment exists',409)
        evaluations=list(AssessmentEvaluation.objects.filter(job_id=job.id,status='SUCCEEDED').order_by('-completed_at'))
        evaluated=next((e for e in evaluations if e.id==job.selected_evaluation_id),evaluations[0] if evaluations else None)
        input=job.input_snapshot;base=job.final_result if job.final_result is not None else evaluated.result if evaluated else None;action=data['action']
        old=dict(finalScore=job.final_score,teacherScore=job.teacher_score,source=job.final_score_source,version=job.version,status=job.status)
        if action=='REGRADE':
            if job.policy_mode=='MANUAL_ONLY':fail('ASSESSMENT_MANUAL_POLICY','Enable an AI policy before requesting a regrade')
            if AssessmentJob.objects.filter(attempt_id=job.attempt_id,skill=job.skill,status__in=('PENDING','PROCESSING','RETRY')).exists():fail('ASSESSMENT_ALREADY_RUNNING','An assessment is already queued',409)
            now=timezone.now()
            updated=AssessmentJob.objects.create(id=str(uuid4()),attempt_id=job.attempt_id,student_id=job.student_id,program=job.program,skill=job.skill,input_hash=job.input_hash,input_snapshot=input,
                generation=job.generation+1,rubric_version=job.rubric_version,prompt_version=job.prompt_version,policy_mode=job.policy_mode,status='PENDING',version=1,attempt_count=0,
                teacher_score=job.teacher_score,final_score=job.final_score,final_score_source=job.final_score_source,final_result=job.final_result,created_at=now,updated_at=now)
            update(job,version=F('version')+1)
        elif action=='NEEDS_REVIEW':updated=update(job,status='NEEDS_REVIEW',failure_code='TEACHER_REVIEW_REQUESTED',lease_token=None,lease_expires_at=None,version=F('version')+1)
        elif action=='EDIT_FEEDBACK':
            if not base or not data.get('feedback'):fail('ASSESSMENT_NO_RESULT','Feedback is not available')
            approved=results.validate(data['feedback'],dict(input,pronunciationEvidence=data['feedback'].get('pronunciationEvidence')))
            if not feedback_only(approved,base):fail('ASSESSMENT_FEEDBACK_SCORE_CHANGE','Use score override to change rubric evidence or scores')
            updated=update(job,approved_feedback=approved,version=F('version')+1)
        else:
            if action=='ACCEPT':
                if not base or job.ai_score is None or job.status not in ('SUCCEEDED','NEEDS_REVIEW') or not evaluated or not evaluated.result:fail('ASSESSMENT_NO_COMPLETE_AI_RESULT','A complete AI result is required')
                if evaluated.role=='ADJUDICATOR':
                    primary=next((e for e in evaluations if e.role=='PRIMARY'),None)
                    if not primary or not primary.result:fail('ASSESSMENT_NO_COMPLETE_AI_RESULT','Both independent results are required')
                    result=results.combine(primary.result,evaluated.result,input)
                else:result=results.validate(evaluated.result,input)
            else:result=results.teacher_result(input,base or results.empty(input),data.get('parts') or [])
            score=results.score(input,result)['score']
            if score is None:results.fail('Complete rubric scores are required')
            source='TEACHER' if action=='OVERRIDE' else 'ADJUDICATED' if any(e.role=='ADJUDICATOR' for e in evaluations) else 'AI'
            project(job,result,actor.id)
            values=dict(status='SUCCEEDED',failure_code=None,final_score=score,final_score_source=source,final_result=result,approved_feedback=result,lease_token=None,lease_expires_at=None,completed_at=timezone.now(),version=F('version')+1)
            if action=='OVERRIDE':values['teacher_score']=score
            updated=update(job,**values)
            from .mock_grading import recompute
            recompute(job.attempt_id)
        # Unlike best-effort administration audit, review audit belongs to the
        # caller-owned transaction and must roll back the entire review on error.
        AuditLog.objects.create(id=str(uuid4()),user_id=actor.id,action='assessment.'+action.lower(),entity='AssessmentJob',entity_id=job.id,old_value=old,
            new_value=dict(finalScore=updated.final_score,teacherScore=updated.teacher_score,source=updated.final_score_source,version=updated.version,reason=data['reason'],newJobId=updated.id),created_at=timezone.now())
        return dict(saved=True,jobId=updated.id,version=updated.version,status=updated.status)

@transaction.atomic
def claim():
    now=timezone.now()
    for job in AssessmentJob.objects.filter(status='PROCESSING',lease_expires_at__lt=now)[:20]:
        uncertain=AssessmentEvaluation.objects.filter(job_id=job.id).filter(Q(status='STARTED')|Q(uncertain=True)).exists() or SpeechTranscript.objects.filter(job_id=job.id).filter(Q(status='STARTED')|Q(uncertain=True)).exists()
        exhausted=job.attempt_count>=max_attempts();retry=not uncertain and not exhausted
        values=dict(status='RETRY' if retry else 'NEEDS_REVIEW',failure_code='PROVIDER_OUTCOME_UNCERTAIN' if uncertain else 'ASSESSMENT_ATTEMPTS_EXHAUSTED' if exhausted else 'WORKER_RESTARTED',lease_token=None,lease_expires_at=None,retry_at=now if retry else None,version=F('version')+1,updated_at=now)
        if not retry:values['completed_at']=now
        AssessmentJob.objects.filter(id=job.id,status='PROCESSING',lease_expires_at__lt=now).update(**values)
    # Prisma's raw Date parameter is timestamptz, compared to legacy timestamp
    # columns using its session timezone. Django pins its connection to UTC;
    # preserve the reference connection default rather than silently repairing
    # local-time retry eligibility. An explicit override supports role settings.
    with connection.cursor() as cursor:
        zone=os.environ.get('REFERENCE_DB_TIMEZONE')
        if zone is None:
            cursor.execute("SELECT reset_val FROM pg_settings WHERE name='TimeZone'")
            zone=cursor.fetchone()[0]
        cursor.execute('''SELECT id FROM "AssessmentJob" WHERE status IN ('PENDING','RETRY')
            AND ("retryAt" IS NULL OR "retryAt" <= (%s::timestamptz AT TIME ZONE %s))
            ORDER BY "createdAt" ASC FOR UPDATE SKIP LOCKED LIMIT 1''',[now,zone])
        row=cursor.fetchone()
    job=AssessmentJob.objects.get(id=row[0]) if row else None
    return update(job,status='PROCESSING',lease_token=str(uuid4()),lease_expires_at=now+timedelta(minutes=10),started_at=now,attempt_count=F('attempt_count')+1,version=F('version')+1) if job else None

def require_lease(job):
    current=AssessmentJob.objects.filter(id=job.id).first()
    if not current or current.status!='PROCESSING' or current.lease_token!=job.lease_token or not current.lease_expires_at or aware(current.lease_expires_at)<timezone.now():fail('ASSESSMENT_STALE_LEASE','Worker lease is no longer active',409)
    return current

@transaction.atomic
def finish(job,result,selected,adjudicated):
    attempt=MockAttempt.objects.select_for_update().get(id=job.attempt_id);current=require_lease(job);input=job.input_snapshot;score=results.score(input,result)['score']
    teacher_touched=MockAnswer.objects.filter(attempt_id=job.attempt_id,question_id__in=[r['questionId'] for p in input['parts'] for r in p['responses']],graded_by_id__isnull=False).exists()
    auto=current.final_score_source!='TEACHER' and not teacher_touched and attempt.status!='in_progress' and job.policy_mode=='PRACTICE_AUTO_AI' and result['confidence']>=threshold() and score is not None
    if auto:project(current,result,None)
    values=dict(status='SUCCEEDED' if auto or current.final_score_source=='TEACHER' else 'NEEDS_REVIEW',failure_code='PRONUNCIATION_EVIDENCE_UNAVAILABLE' if score is None else None if auto else 'TEACHER_CONFIRMATION_REQUIRED',ai_score=score,confidence=result['confidence'],selected_evaluation_id=selected,
        lease_token=None,lease_expires_at=None,completed_at=timezone.now(),version=F('version')+1)
    if current.final_score_source!='TEACHER':values['final_result']=result
    if auto:values.update(final_score=score,final_score_source='ADJUDICATED' if adjudicated else 'AI',approved_feedback=result)
    update(current,**values)
    if auto:
        from .mock_grading import recompute
        recompute(job.attempt_id)

def fail_job(job,code,transient,uncertain):
    retry=transient and not uncertain and job.attempt_count<max_attempts();now=timezone.now()
    values=dict(status='RETRY' if retry else 'NEEDS_REVIEW',failure_code=code,retry_at=now+timedelta(milliseconds=min(300000,15000*2**(job.attempt_count-1))) if retry else None,lease_token=None,lease_expires_at=None,version=F('version')+1,updated_at=now)
    if not retry:values['completed_at']=now
    return AssessmentJob.objects.filter(id=job.id,status='PROCESSING',lease_token=job.lease_token).update(**values)

def record_legacy_grade(attempt_id,question_id):
    """Caller-owned transaction hook, not silently added to the legacy route."""
    from .mock_scoring import round_half
    jobs=AssessmentJob.objects.filter(attempt_id=attempt_id).order_by('-generation','-created_at')
    job=next((j for j in jobs if any(r['questionId']==question_id for p in j.input_snapshot['parts'] for r in p['responses'])),None)
    if job is None:return
    input=job.input_snapshot
    answers={a.question_id:a for a in MockAnswer.objects.filter(attempt_id=attempt_id,question_id__in=[r['questionId'] for p in input['parts'] for r in p['responses']])}
    if any(r['questionId'] not in answers or not answers[r['questionId']].is_graded for p in input['parts'] for r in p['responses']):return
    import copy
    result=copy.deepcopy(job.final_result or results.empty(input));parts=[]
    required=['ta','cc','lr','gra'] if input['skill']=='writing' else ['fluency','lexical','grammar','pronunciation']
    for part in input['parts']:
        selected=[answers[r['questionId']] for r in part['responses']];previous=next(p for p in result['parts'] if p['id']==part['id'])
        mean=sum(a.score or 0 for a in selected)/len(selected)
        criteria={k:round_half(sum((a.rubric_scores or {}).get(k,a.score or 0) for a in selected)/len(selected)) for k in required}
        parts.append(dict(previous,rawScore=round_half(mean) if input['program']=='MULTILEVEL' else None,criteria=previous['criteria'] if input['program']=='MULTILEVEL' else criteria))
    result['parts']=parts;score=results.score(input,result)['score']
    update(job,teacher_score=score,final_score=score,final_score_source='TEACHER',final_result=result,status='SUCCEEDED',failure_code=None,lease_token=None,lease_expires_at=None,completed_at=timezone.now(),version=F('version')+1)
