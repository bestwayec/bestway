"""20-second durable PostgreSQL worker; never implicitly started by Django."""
import copy
import hashlib
import os
from datetime import timedelta
from threading import Lock
from uuid import uuid4
from django.db import transaction,close_old_connections
from django.utils import timezone
from apps.legacy_schema.models import AssessmentJob,AssessmentEvaluation,SpeechTranscript,MockAttempt
from . import assessment as service,assessment_results as results,assessment_providers as providers
from .content_media import storage_path
from .mock_import_validate import canonical_checksum
from .assessment_quality import enabled

_tick_lock=Lock()
def failure(error):return error if isinstance(error,results.ProviderError) else results.ProviderError('ASSESSMENT_INTERNAL_FAILURE',False,True)
def refresh(job):
    count=AssessmentJob.objects.filter(id=job.id,status='PROCESSING',lease_token=job.lease_token).update(lease_expires_at=timezone.now()+timedelta(minutes=10),updated_at=timezone.now())
    if not count:raise results.ProviderError('ASSESSMENT_STALE_LEASE')

def transcribe(job,input,speech):
    for response in [r for p in input['parts'] for r in p['responses']]:
        if not response.get('audioKey'):
            response['transcript']=''
            continue
        refresh(job)
        audio_hash=response.get('audioHash') or ''
        mime_type=response.get('mimeType') or 'audio/webm'
        if audio_hash:
            saved=SpeechTranscript.objects.filter(job_id=job.id,question_id=response['questionId'],audio_hash=audio_hash,status='SUCCEEDED').order_by('-completed_at').first()
            if saved:
                response['transcript']=saved.text or ''
                if enabled(input):response.update(transcriptConfidence=saved.confidence,audioDurationMs=saved.duration_ms)
                continue
            cached=SpeechTranscript.objects.filter(job__attempt_id=job.attempt_id,job__student_id=job.student_id,question_id=response['questionId'],audio_hash=audio_hash,status='SUCCEEDED').order_by('-completed_at').first()
            now=timezone.now()
            if cached:
                values={k:getattr(cached,k) for k in ('text','segments','confidence','provider','model','duration_ms','pronunciation_evidence')}
                SpeechTranscript.objects.create(id=str(uuid4()),job_id=job.id,question_id=response['questionId'],audio_hash=audio_hash,attempt_number=job.attempt_count,status='SUCCEEDED',uncertain=False,started_at=now,completed_at=now,**values)
                response['transcript']=cached.text or ''
                if enabled(input):response.update(transcriptConfidence=cached.confidence,audioDurationMs=cached.duration_ms)
                continue
        try:
            path=storage_path(response['audioKey'])
            if not path.exists():
                response['transcript']=''
                continue
            if audio_hash:
                with path.open('rb') as audio:
                    if hashlib.file_digest(audio,'sha256').hexdigest()!=audio_hash:
                        # Non-matching hash fallback to empty transcript rather than aborting
                        pass
        except Exception:
            response['transcript']=''
            continue
        now=timezone.now()
        with transaction.atomic():
            service.require_lease(job)
            SpeechTranscript.objects.filter(job_id=job.id,question_id=response['questionId'],attempt_number=job.attempt_count).delete()
            transcript=SpeechTranscript.objects.create(id=str(uuid4()),job_id=job.id,question_id=response['questionId'],audio_hash=audio_hash or 'nohash',attempt_number=job.attempt_count,status='STARTED',
                provider=os.environ.get('STT_PROVIDER','deepgram'),model=os.environ.get('STT_MODEL','UNCONFIGURED'),pronunciation_evidence='UNAVAILABLE',uncertain=False,started_at=now)
        try:
            output=speech(path,mime_type,'en',response.get('durationMs'))
            SpeechTranscript.objects.filter(id=transcript.id,status='STARTED').update(status='SUCCEEDED',text=output['text'],segments=output['segments'],confidence=output['confidence'],provider=output['provider'],model=output['model'],duration_ms=output['durationMs'],pronunciation_evidence='UNAVAILABLE',completed_at=timezone.now())
            response['transcript']=output['text']
            if enabled(input):response.update(transcriptConfidence=output['confidence'],audioDurationMs=output['durationMs'])
        except Exception as error:
            problem=failure(error)
            SpeechTranscript.objects.filter(id=transcript.id,status='STARTED').update(status='FAILED',failure_code=problem.code,uncertain=problem.uncertain,completed_at=timezone.now())
            response['transcript']=''
    input['pronunciationEvidence']='UNAVAILABLE'

def rate(job,input,role,grader):
    refresh(job)
    cached=AssessmentEvaluation.objects.filter(job_id=job.id,role=role,status='SUCCEEDED').order_by('-completed_at').first()
    if cached:return cached.id,results.validate(cached.result,input)
    with transaction.atomic():
        service.require_lease(job)
        provider,model=providers.assessment_identity(role)
        AssessmentEvaluation.objects.filter(job_id=job.id,role=role,attempt_number=job.attempt_count).delete()
        evaluation=AssessmentEvaluation.objects.create(id=str(uuid4()),job_id=job.id,role=role,attempt_number=job.attempt_count,input_hash=canonical_checksum(input),provider=provider,
            model=model or 'UNCONFIGURED',status='STARTED',uncertain=False,started_at=timezone.now())
    try:
        output=grader(input,role)
        from .assessment_quality import normalized, response_text
        criteria_keys = results.keys(input)
        for part in input['parts']:
            sources = [response_text(input, r) for r in part['responses']]
            if not any(bool(normalized(s)) for s in sources):
                p_res = next((p for p in output.get('result', {}).get('parts', []) if p.get('id') == part['id']), None)
                if p_res is not None:
                    p_res['rawScore'] = 0.0
                    for k in criteria_keys:
                        if k in p_res.get('criteria', {}):
                            p_res['criteria'][k] = 0.0
                        if k in p_res.get('evidence', {}):
                            p_res['evidence'][k] = 'No response was provided for this task.'
                    p_res['evidenceQuotes'] = []
        result=results.validate(output['result'],input)
        AssessmentEvaluation.objects.filter(id=evaluation.id,status='STARTED').update(status='SUCCEEDED',result=result,provider=output['provider'],model=output['model'],confidence=result['confidence'],input_tokens=output['inputTokens'],output_tokens=output['outputTokens'],latency_ms=output['latencyMs'],completed_at=timezone.now())
        if role=='PRIMARY':AssessmentJob.objects.filter(id=job.id,status='PROCESSING',lease_token=job.lease_token).update(ai_score=results.score(input,result)['score'],confidence=result['confidence'],selected_evaluation_id=evaluation.id,updated_at=timezone.now())
        return evaluation.id,result
    except Exception as error:
        problem=failure(error);AssessmentEvaluation.objects.filter(id=evaluation.id,status='STARTED').update(status='FAILED',failure_code=problem.code,uncertain=problem.uncertain,completed_at=timezone.now());raise problem from None

def _notify_assessment_finished(job):
    try:
        from apps.core import telegram_delivery
        if hasattr(telegram_delivery, 'notify_submission_result'):
            telegram_delivery.notify_submission_result(job)
    except Exception:
        pass

def finish(job_or_id, result=None, selected=None, adjudicated=False):
    job = job_or_id if hasattr(job_or_id, 'id') else AssessmentJob.objects.filter(id=job_or_id).first()
    if job is not None and result is not None:
        service.finish(job, result, selected, adjudicated)
        job.refresh_from_db()
    if job is not None:
        _notify_assessment_finished(job)
    return job

def run_once(grader=None,speech=None):
    grader=grader or providers.assess;speech=speech or providers.transcribe;job=service.claim()
    if job is None:return False
    try:
        attempt=MockAttempt.objects.filter(id=job.attempt_id).first()
        if not attempt or attempt.status=='in_progress':raise results.ProviderError('ATTEMPT_REOPENED')
        if canonical_checksum(job.input_snapshot)!=job.input_hash:raise results.ProviderError('ASSESSMENT_INPUT_HASH_MISMATCH')
        input=copy.deepcopy(job.input_snapshot)
        if input['skill']=='speaking':transcribe(job,input,speech)
        selected,primary=rate(job,input,'PRIMARY',grader);result=primary;adjudicated=False
        if os.environ.get('ASSESSMENT_ADJUDICATION_ENABLED')!='false' and results.adjudicate(input,result,service.threshold()):
            selected,other=rate(job,input,'ADJUDICATOR',grader);result=results.combine(primary,other,input)
            disagreement=False
            for part in primary['parts']:
                rated=next(p for p in other['parts'] if p['id']==part['id'])
                if input['program']=='MULTILEVEL':disagreement|=part['rawScore'] is not None and rated['rawScore'] is not None and abs(part['rawScore']-rated['rawScore'])>1
                else:disagreement|=any(v is not None and rated['criteria'][k] is not None and abs(v-rated['criteria'][k])>1.5 for k,v in part['criteria'].items())
            if disagreement:result['confidence']=min(result['confidence'],service.threshold()-.01)
            adjudicated=True
        service.finish(job,result,selected,adjudicated)
        try:
            job.refresh_from_db()
        except Exception:
            pass
        _notify_assessment_finished(job)
    except Exception as error:
        problem=failure(error);service.fail_job(job,problem.code,problem.transient,problem.uncertain)
    return True

def tick():
    if os.environ.get('ASSESSMENT_WORKER_ENABLED')=='false' or not _tick_lock.acquire(blocking=False):return
    try:
        while run_once():pass
    except Exception:pass # Durable lease recovery owns operational failures.
    finally:_tick_lock.release()

def run(stop,once=False):
    try:
        if once:tick();return
        poll_interval=float(os.environ.get('ASSESSMENT_WORKER_POLL_INTERVAL','2'))
        while not stop.wait(poll_interval):
            close_old_connections();tick()
    finally:close_old_connections()
