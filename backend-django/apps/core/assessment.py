"""Durable assessment ledger, authorized projections and serialized review."""
import math
import os
from random import uniform
from datetime import timedelta
from urllib.parse import quote
from uuid import uuid4

from django.db import connection, transaction
from django.db.models import F, Q
from django.utils import timezone

from apps.legacy_schema.models import (
    AssessmentEvaluation,
    AssessmentJob,
    AuditLog,
    MockAnswer,
    MockAttempt,
    SpeechTranscript,
)

from . import assessment_results as results
from .content_media import storage_path
from .handwriting import handwriting_fields, page_urls
from .mock_attempts import aware, fail
from .classroom_results import assert_attempt_access
from .points import assert_can_view


def setting(name,fallback,low,high):
    try:value=float(os.environ.get(name,'nan'))
    except ValueError:return fallback
    return value if low<=value<=high else fallback
def threshold():return setting('ASSESSMENT_CONFIDENCE_THRESHOLD',.70,.5,1)
def max_attempts():return setting('ASSESSMENT_MAX_ATTEMPTS',3,1,3)
def get(identifier):
    job=AssessmentJob.objects.filter(id=identifier).first()
    if job is None:fail('ASSESSMENT_NOT_FOUND','Assessment not found',404)
    return job
def authorize_attempt(actor, attempt, *, grade=False):
    if actor.role == "teacher":
        assert_attempt_access(actor, attempt, grade=grade)
    else:
        assert_can_view(actor, attempt.student_id)


def authorize(actor,job):
    authorize_attempt(actor, job.attempt)
    if actor.role=='student':assert_program(actor,job.attempt)

def assert_program(actor,attempt):
    from .exam_programs import state
    with connection.cursor() as cursor:value=state(cursor,actor.id)
    if ('MULTILEVEL' if attempt.exam.type=='multilevel' else 'IELTS') not in value['availablePrograms']:
        fail('PROGRAM_NOT_ENROLLED','Not enrolled in this exam track',403)

def for_attempt(actor,identifier):
    attempt=MockAttempt.objects.filter(id=identifier).select_related('exam').first()
    if attempt is None:fail('MOCK_ATTEMPT_NOT_FOUND','Attempt not found',404)
    authorize_attempt(actor, attempt)
    if actor.role=='student':assert_program(actor,attempt)
    answers_map = {a.question_id: a for a in MockAnswer.objects.filter(attempt_id=identifier)}
    rows=list(AssessmentJob.objects.filter(attempt_id=identifier).order_by('-generation','-created_at'))
    staff = actor.role in ('teacher', 'admin', 'super_admin')
    final_actions = ('assessment.accept', 'assessment.override')
    actions = (*final_actions, 'assessment.save_draft', 'assessment.correct_transcript') if staff else final_actions
    history = AuditLog.objects.filter(entity='AssessmentJob', entity_id__in=[j.id for j in rows],
        action__in=actions).order_by('-created_at')
    reviewed_ids = set()
    latest_reviews = {}
    finalized_reviews = {}
    job_skills = {job.id: job.skill for job in rows}
    corrections = {}
    for entry in history:
        saved = entry.new_value or {}
        if entry.action == 'assessment.correct_transcript':
            corrections.setdefault((entry.entity_id, saved.get('transcriptId')), saved)
        else:
            latest_reviews.setdefault(entry.entity_id, entry)
        if entry.action in final_actions:
            reviewed_ids.add(entry.entity_id)
            finalized_reviews.setdefault(job_skills[entry.entity_id], entry)
    seen=set();values=[];latest=[]
    for job in rows:
        if job.skill in seen:continue
        seen.add(job.skill);latest.append(job);input=job.input_snapshot
        evaluations=list(AssessmentEvaluation.objects.filter(job_id=job.id,status='SUCCEEDED').order_by('-completed_at'))
        transcripts=list(SpeechTranscript.objects.filter(job_id=job.id).order_by('-started_at')) if staff and job.skill=='speaking' else []
        evaluation=next((e for e in evaluations if e.id==job.selected_evaluation_id),evaluations[0] if evaluations else None)
        final_visible = job.status == 'SUCCEEDED' or job.final_score_source == 'TEACHER'
        visible_result = staff or final_visible
        if not staff:
            evaluation = None
        value={key:getattr(job,attr) for key,attr in dict(id='id',skill='skill',program='program',status='status',policyMode='policy_mode',version='version',aiScore='ai_score',teacherScore='teacher_score',finalScore='final_score',finalScoreSource='final_score_source',confidence='confidence',rubricVersion='rubric_version',promptVersion='prompt_version',failureCode='failure_code',finalResult='final_result',approvedFeedback='approved_feedback').items()}
        if not visible_result:
            for field in ('aiScore', 'teacherScore', 'finalScore', 'finalScoreSource', 'confidence', 'finalResult', 'approvedFeedback'):
                value[field] = None
        if not staff:
            value['aiScore'] = value['confidence'] = value['failureCode'] = None
        latest_review = latest_reviews.get(job.id)
        if staff and latest_review and latest_review.action == 'assessment.save_draft':
            saved = latest_review.new_value
            value['teacherDraft'] = dict(parts=saved['parts'], reason=saved['reason'], comment=saved.get('comment', ''))
        final_review = finalized_reviews.get(job.skill)
        if final_visible and final_review:
            value['teacherComment'] = (final_review.new_value or {}).get('comment')
            value['teacherReviewedAt'] = final_review.created_at
        value.update(teacherReviewed=final_visible and (job.final_score_source=='TEACHER' or job.id in reviewed_ids),
            evaluation=dict(result=evaluation.result,provider=evaluation.provider,model=evaluation.model) if evaluation and evaluation.result else None,
            parts=[{k:p[k] for k in ('id','max','task','context','imageGroupId') if k in p} for p in input['parts']],submissions=[])
        if input.get('practiceMode')=='PARTIAL':value.update(practiceMode='PARTIAL',rawMax=sum(p['max'] for p in input['parts']))
        active_res = value['approvedFeedback'] or value['finalResult'] or (evaluation.result if evaluation else None)
        if active_res:
            value['diagnosticFeedback'] = results.format_diagnostic_feedback(active_res, input)
        for part in input['parts']:
            for r in part['responses']:
                ledger=next((t for t in transcripts if r.get('audioHash')
                    and t.question_id==r['questionId'] and t.audio_hash==r['audioHash']),None)
                transcript = ledger if ledger and ledger.status == 'SUCCEEDED' and isinstance(ledger.text, str) and ledger.text.strip() else None
                ans = answers_map.get(r['questionId'])
                img_keys = []
                ocr_text = r.get('originalResponse') or ''
                if ans and isinstance(ans.rubric_scores, dict):
                    img_keys = list(ans.rubric_scores.get('imageKeys') or [])
                    if ans.rubric_scores.get('ocrText'):
                        ocr_text = ans.rubric_scores['ocrText']
                elif isinstance(r.get('rubricScores'), dict):
                    img_keys = list(r['rubricScores'].get('imageKeys') or [])
                img_urls = page_urls(identifier, r["questionId"], img_keys)
                audio_link = None
                if r.get('audioKey'):
                    qid_quoted = quote(r['questionId'], safe="~()*!.'-")
                    audio_link = f"/api/v1/assessment/jobs/{job.id}/audio/{qid_quoted}"

                t_text = transcript.text if transcript else None

                # Older transcript records can contain heuristic diagnostics with
                # no acoustic provenance. Do not present them as measured speech.
                speech_diag = None

                t_dict = dict(
                    text=t_text,
                    correctedText=corrections.get((job.id, transcript.id), {}).get('text'),
                    provider=transcript.provider, model=transcript.model, durationMs=transcript.duration_ms,
                    language=r.get('transcriptionLanguage', 'en'),
                    confidence=transcript.confidence,
                    segments=transcript.segments if (transcript and transcript.segments) else [],
                    pronunciationEvidence='AVAILABLE' if (speech_diag and speech_diag.get('mispronounced_words')) else 'UNAVAILABLE',
                    speechDiagnostics=speech_diag
                ) if t_text else None

                value['submissions'].append(dict(
                    questionId=r['questionId'],partId=part['id'],partNumber=r['partNumber'],prompt=r['prompt'],context=part['context'],
                    originalResponse=r['originalResponse'],wordCount=results.count_words(r['originalResponse']),
                    imageKeys=img_keys,imageUrls=img_urls,ocrText=ocr_text,
                    audioUrl=audio_link,
                    audioDurationMs=(transcript.duration_ms if transcript else r.get('durationMs')) if staff else None,
                    teacherScore=ans.score if (visible_result and ans and ans.graded_by_id) else None,
                    teacherFeedback=ans.feedback if visible_result and ans else None,
                    transcriptStatus=ledger.status if ledger else None,
                    transcript=t_dict,
                    speechDiagnostics=speech_diag))
        value['speechDiagnostics'] = {submission['questionId']: submission['speechDiagnostics']
            for submission in value['submissions'] if submission['speechDiagnostics']}
        values.append(value)
    CRIT_MAP = {
        'ta': 'task_achievement',
        'cc': 'coherence_cohesion',
        'lr': 'lexical_resource',
        'gra': 'grammatical_range',
        'taskCoverage': 'task_achievement',
        'grammar': 'grammatical_range',
        'vocabulary': 'lexical_resource',
        'cohesion': 'coherence_cohesion',
        'ideaDevelopment': 'idea_development',
        'fluency': 'fluency_coherence',
        'lexical': 'lexical_resource',
        'pronunciation': 'pronunciation'
    }
    top_status = 'completed' if attempt.status == 'completed' else 'pending'
    if any(j.status in ('PENDING', 'PROCESSING', 'RETRY') and j.final_score_source != 'TEACHER' for j in latest):
        top_status = 'grading'
    elif any(j.status == 'NEEDS_REVIEW' and j.final_score_source != 'TEACHER' for j in latest):
        top_status = 'needs_review'
    elif any(j.status == 'FAILED' and j.final_score_source != 'TEACHER' for j in latest):
        top_status = 'failed'
    elif attempt.status == 'completed' and latest and all(j.status == 'SUCCEEDED' for j in latest):
        top_status = 'completed'

    overall_band = None
    if attempt.status == 'completed' and attempt.overall_band is not None and all(j.status == 'SUCCEEDED' or j.final_score_source == 'TEACHER' for j in latest):
        try: overall_band = float(attempt.overall_band)
        except (ValueError, TypeError): pass

    conf = None
    for result in values:
        if result['confidence'] is not None:
            try:
                conf = float(result['confidence'])
                break
            except (ValueError, TypeError): pass

    teacher_confirmed = attempt.status == 'completed' and bool(latest) and all(j.final_score_source=='TEACHER' or (j.status=='SUCCEEDED' and j.id in reviewed_ids) for j in latest)

    criteria_scores = {}
    criteria_by_part = {}
    strengths = []
    weaknesses = []
    mistakes_and_fixes = []
    vocabulary_upgrades = []
    improved_rewrites = []
    next_actions = []

    for val in values:
        active_res = val.get('approvedFeedback') or val.get('finalResult') or (val.get('evaluation') or {}).get('result')
        if not active_res:
            continue
        criteria_by_part[val['skill']] = results.criteria_by_part(active_res, dict(program=val.get('program')))
        for p in active_res.get('parts', []):
            crit = p.get('criteria') or {}
            evid = p.get('evidence') or {}
            for k, score in crit.items():
                mapped_k = CRIT_MAP.get(k, k)
                if score is not None and mapped_k not in criteria_scores:
                    criteria_scores[mapped_k] = {
                        'score': score,
                        'comment': evid.get(k, '')
                    }
            for s in (p.get('feedback') or {}).get('strengths', []):
                if s and s not in strengths: strengths.append(s)
            for iss in (p.get('feedback') or {}).get('issues', []):
                if iss and iss not in weaknesses: weaknesses.append(iss)

        for s in active_res.get('overallStrengths') or []:
            if s and s not in strengths: strengths.append(s)
        for w in active_res.get('priorityImprovements') or []:
            if w and w not in weaknesses: weaknesses.append(w)

        for g in active_res.get('grammarCorrections') or []:
            mistakes_and_fixes.append({
                'mistake': g.get('original', ''),
                'fix': g.get('corrected', ''),
                'original': g.get('original', ''),
                'corrected': g.get('corrected', ''),
                'explanation': g.get('explanation', '')
            })

        for v in active_res.get('vocabularyUpgrades') or []:
            vocabulary_upgrades.append({
                'original': v.get('original', ''),
                'alternative': v.get('alternative', ''),
                'explanation': v.get('explanation', '')
            })

        for imp in active_res.get('improvedExamples') or []:
            if imp.get('text'):
                improved_rewrites.append(imp['text'])

        for rec in active_res.get('recommendedPractice') or []:
            if rec and rec not in next_actions:
                next_actions.append(rec)

    band_8_rewrite = "\n\n".join(improved_rewrites) if improved_rewrites else ""
    next_action = next_actions[0] if next_actions else ("Review detailed feedback and focus on weaker areas." if top_status == 'completed' else "Exam assessment is underway.")

    teacher_comment = None
    for result in values:
        if result.get('teacherComment'):
            teacher_comment = result['teacherComment']
            break
        fb = result["approvedFeedback"] or {}
        if isinstance(fb, dict) and (fb.get('teacherComment') or fb.get('teacher_comment')):
            teacher_comment = fb.get('teacherComment') or fb.get('teacher_comment')
            break
    if not teacher_comment and (staff or attempt.status == "completed") and isinstance(attempt.media_state, dict):
        teacher_comment = attempt.media_state.get('teacher_comment')

    is_reviewed = teacher_confirmed or bool(not latest and attempt.media_state and isinstance(attempt.media_state, dict) and attempt.media_state.get('is_teacher_reviewed'))
    provisional = not is_reviewed
    reviewed_by = (attempt.media_state.get('teacher_reviewed_by') if (attempt.media_state and isinstance(attempt.media_state, dict)) else None)

    return dict(
        attemptId=identifier,
        status=top_status,
        overall_band=overall_band,
        confidence=conf,
        provisional=provisional,
        teacher_confirmed=is_reviewed,
        is_teacher_reviewed=is_reviewed,
        isTeacherReviewed=is_reviewed,
        teacher_comment=teacher_comment,
        teacherComment=teacher_comment,
        teacher_reviewed_by=reviewed_by,
        criteria_scores=criteria_scores,
        criteria_by_part=criteria_by_part,
        provisional_skills=results.provisional_skills(latest, reviewed_ids),
        strengths=strengths,
        weaknesses=weaknesses,
        mistakes_and_fixes=mistakes_and_fixes,
        vocabulary_upgrades=vocabulary_upgrades,
        next_action=next_action,
        band_8_rewrite=band_8_rewrite,
        assessments=values
    )

def audio(actor,identifier,question_id):
    job=get(identifier);authorize(actor,job)
    r=next((r for p in job.input_snapshot['parts'] for r in p['responses'] if r['questionId']==question_id),None)
    if not r or not r.get('audioKey') or not storage_path(r['audioKey']).is_file():fail('FILE_NOT_FOUND','Audio not found',404)
    return r['audioKey']

def update(job,**values):
    values['updated_at']=timezone.now();AssessmentJob.objects.filter(id=job.id).update(**values);job.refresh_from_db();return job

def project(job,result,actor_id,comment=''):
    score=results.score(job.input_snapshot,result)
    existing = {
        answer.question_id: answer.rubric_scores
        for answer in MockAnswer.objects.filter(attempt_id=job.attempt_id)
    }
    for part in job.input_snapshot['parts']:
        rated=next(p for p in result['parts'] if p['id']==part['id']);value=next(p['score'] for p in score['parts'] if p['id']==part['id'])
        if value is None:results.fail('Incomplete rubric cannot be finalized')
        for r in part['responses']:
            values=dict(score=value,is_graded=True,graded_by_id=actor_id,rubric_scores=dict(handwriting_fields(existing.get(r['questionId'])), **rated['criteria']),updated_at=timezone.now())
            if comment:
                values['feedback'] = comment
            MockAnswer.objects.update_or_create(attempt_id=job.attempt_id,question_id=r['questionId'],defaults=values,
                create_defaults=dict(values,id=str(uuid4()),response=r['originalResponse'],audio_key=r.get('audioKey')))

def feedback_only(next,previous):
    def facts(value):return dict(confidence=value['confidence'],pronunciationEvidence=value['pronunciationEvidence'],parts=sorted([{k:p[k] for k in ('id','rawScore','criteria','evidence')}|({'evidenceQuotes':p['evidenceQuotes']} if 'evidenceQuotes' in p else {}) for p in value['parts']],key=lambda p:p['id']))
    from .mock_import_validate import canonical_checksum
    return canonical_checksum(facts(next))==canonical_checksum(facts(previous))

def validate_draft_parts(snapshot, parts):
    limits = {part['id']: part['max'] for part in snapshot['parts']}
    if len({part['id'] for part in parts}) != len(parts):
        results.fail('Provide each draft part once')
    for part in parts:
        if part['id'] not in limits:
            results.fail('Unknown rubric part')
        try:
            if snapshot['program'] == 'MULTILEVEL':
                if 'criteria' in part:
                    results.invalid()
                if 'rawScore' in part:
                    results.number(part['rawScore'], limits[part['id']], half=True)
            else:
                if 'rawScore' in part or not set(part.get('criteria') or {}) <= set(results.keys(snapshot)):
                    results.invalid()
                for value in (part.get('criteria') or {}).values():
                    results.number(value, 9, half=True)
        except results.ProviderError:
            results.fail('Draft scores must use the configured criteria and score limits')
    return parts


def review(actor,identifier,data):
    if actor.role not in ('teacher','admin','super_admin'):fail('FORBIDDEN','Staff access required',403)
    if not data['reason'].strip():fail('ASSESSMENT_REASON_REQUIRED','Review reason is required')
    before=get(identifier);authorize(actor,before)
    with transaction.atomic():
        attempt=MockAttempt.objects.select_for_update().get(id=before.attempt_id)
        job=AssessmentJob.objects.select_for_update().get(id=identifier)
        authorize_attempt(actor, attempt, grade=True)
        if job.version!=data['expectedVersion']:fail('ASSESSMENT_STALE_VERSION','Assessment changed; refresh before reviewing',409)
        if attempt.status=='in_progress':fail('MOCK_ATTEMPT_NOT_SUBMITTED','Attempt has been reopened',409)
        latest=AssessmentJob.objects.filter(attempt_id=job.attempt_id,skill=job.skill).order_by('-generation','-created_at').first()
        if latest.id!=job.id:fail('ASSESSMENT_STALE_VERSION','A newer assessment exists',409)
        evaluations=list(AssessmentEvaluation.objects.filter(job_id=job.id,status='SUCCEEDED').order_by('-completed_at'))
        evaluated=next((e for e in evaluations if e.id==job.selected_evaluation_id),evaluations[0] if evaluations else None)
        input=job.input_snapshot
        from .assessment_quality import enabled, evidence_input
        if enabled(input) and input['skill']=='speaking':input=evidence_input(input,list(SpeechTranscript.objects.filter(job_id=job.id,status='SUCCEEDED').order_by('-completed_at')))
        base=job.final_result if job.final_result is not None else evaluated.result if evaluated else None;action=data['action']
        old=dict(finalScore=job.final_score,teacherScore=job.teacher_score,source=job.final_score_source,version=job.version,status=job.status)
        audit_details = {'comment': data.get('comment', '').strip()}
        if action=='SAVE_DRAFT':
            audit_details['parts'] = validate_draft_parts(input, data.get('parts') or [])
            updated = update(job, version=F('version')+1)
        elif action=='CORRECT_TRANSCRIPT':
            response = next((r for p in input['parts'] for r in p['responses'] if r['questionId']==data['questionId']), None)
            transcript = SpeechTranscript.objects.filter(job_id=job.id, question_id=data['questionId'],
                audio_hash=response['audioHash'], status='SUCCEEDED').order_by('-completed_at').first() if job.skill=='speaking' and response and response.get('audioHash') else None
            if not transcript or not transcript.text:
                fail('ASSESSMENT_NO_TRANSCRIPT', 'A saved transcript is required', 409)
            audit_details.update(transcriptId=transcript.id, questionId=data['questionId'], text=data['transcript'])
            updated = update(job, version=F('version')+1)
        elif action=='REGRADE':
            if job.policy_mode=='MANUAL_ONLY':fail('ASSESSMENT_MANUAL_POLICY','Enable an AI policy before requesting a regrade')
            if AssessmentJob.objects.filter(attempt_id=job.attempt_id,skill=job.skill,status__in=('PENDING','PROCESSING','RETRY')).exists():fail('ASSESSMENT_ALREADY_RUNNING','An assessment is already queued',409)
            now=timezone.now()
            updated=AssessmentJob.objects.create(id=str(uuid4()),attempt_id=job.attempt_id,student_id=job.student_id,program=job.program,skill=job.skill,input_hash=job.input_hash,input_snapshot=job.input_snapshot,
                generation=job.generation+1,rubric_version=job.rubric_version,prompt_version=job.prompt_version,policy_mode=job.policy_mode,status='PENDING',version=1,attempt_count=0,
                teacher_score=job.teacher_score,final_score=job.final_score,final_score_source=job.final_score_source,
                final_result=job.final_result,approved_feedback=job.approved_feedback,created_at=now,updated_at=now)
            update(job,version=F('version')+1)
        elif action=='NEEDS_REVIEW':
            updated=update(job,status='SUCCEEDED' if job.final_score_source=='TEACHER' else 'NEEDS_REVIEW',
                failure_code='TEACHER_REVIEW_REQUESTED',lease_token=None,lease_expires_at=None,version=F('version')+1)
        elif action=='EDIT_FEEDBACK':
            if not base or not data.get('feedback'):fail('ASSESSMENT_NO_RESULT','Feedback is not available')
            # A manual holistic grade has no invented AI criterion evidence.
            # Feedback edits still validate every text/list and preserve all
            # scoring facts, but need not satisfy an AI provider result schema.
            try:approved=results.feedback_edit(data['feedback'],base)
            except results.ProviderError:fail('ASSESSMENT_INVALID_FEEDBACK','Feedback must use the saved parts and valid text fields')
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
                audit_details['evaluationId'] = evaluated.id
            else:
                parts = validate_draft_parts(input, data.get('parts') or [])
                result=results.teacher_result(input,job.final_result or results.empty(input),parts)
                audit_details['parts'] = parts
            score=results.score(input,result)['score']
            if score is None:results.fail('Complete rubric scores are required')
            project(job,result,actor.id,audit_details['comment'])
            values=dict(status='SUCCEEDED',failure_code=None,teacher_score=score,final_score=score,final_score_source='TEACHER',
                final_result=result,approved_feedback=result,lease_token=None,lease_expires_at=None,completed_at=timezone.now(),version=F('version')+1)
            updated=update(job,**values)
            from .mock_grading import recompute
            recompute(job.attempt_id)
        # Unlike best-effort administration audit, review audit belongs to the
        # caller-owned transaction and must roll back the entire review on error.
        AuditLog.objects.create(id=str(uuid4()),user_id=actor.id,action='assessment.'+action.lower(),entity='AssessmentJob',entity_id=job.id,old_value=old,
            new_value=dict(finalScore=updated.final_score,teacherScore=updated.teacher_score,source=updated.final_score_source,
                version=updated.version,reason=data['reason'],newJobId=updated.id,**audit_details),created_at=timezone.now())
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

def require_lease(job, *, lock=False):
    queryset = AssessmentJob.objects.select_for_update() if lock else AssessmentJob.objects
    current = queryset.filter(id=job.id).first()
    if not current or current.status!='PROCESSING' or current.lease_token!=job.lease_token or not current.lease_expires_at or aware(current.lease_expires_at)<timezone.now():fail('ASSESSMENT_STALE_LEASE','Worker lease is no longer active',409)
    return current

def speech_confidence_verified(job):
    """Auto-grading requires confidence measured for each submitted recording."""
    snapshot = job.input_snapshot
    from .assessment_quality import enabled
    if job.skill != 'speaking' or not enabled(snapshot):
        return True
    transcripts = list(SpeechTranscript.objects.filter(job_id=job.id, status='SUCCEEDED').order_by('-completed_at'))
    responses = [r for part in snapshot['parts'] for r in part['responses']]
    if not responses:
        return False
    for response in responses:
        audio_hash = response.get('audioHash')
        transcript = next((t for t in transcripts if audio_hash and t.question_id == response['questionId']
            and t.audio_hash == audio_hash and isinstance(t.text, str) and t.text.strip()), None)
        if not transcript or type(transcript.confidence) not in (int, float) or not math.isfinite(transcript.confidence) or not threshold() <= transcript.confidence <= 1:
            return False
    return True

@transaction.atomic
def finish(job,result,selected,adjudicated):
    MockAttempt.objects.select_for_update().get(id=job.attempt_id)
    current = require_lease(job, lock=True)
    score = results.score(job.input_snapshot,result)['score']
    reason = 'TEACHER_CONFIRMATION_REQUIRED'
    if score is None:
        reason = 'PRONUNCIATION_EVIDENCE_UNAVAILABLE'
    elif not speech_confidence_verified(current):
        reason = 'STT_CONFIDENCE_INSUFFICIENT'
    finalized = current.final_score_source == 'TEACHER'
    update(current, status='SUCCEEDED' if finalized else 'NEEDS_REVIEW', failure_code=None if finalized else reason,
        ai_score=score, confidence=result['confidence'], selected_evaluation_id=selected,
        lease_token=None, lease_expires_at=None, completed_at=timezone.now(), version=F('version')+1)

def fail_job(job,code,transient,uncertain, *, retry_after=0):
    retry = transient and not uncertain and job.attempt_count < max_attempts()
    now = timezone.now()
    backoff = min(300, 15 * 2 ** (job.attempt_count - 1) + uniform(0, 3))
    retry_at = now + timedelta(seconds=max(backoff, retry_after)) if retry else None
    already_final = job.final_score_source == 'TEACHER'
    values = dict(status='RETRY' if retry else 'SUCCEEDED' if already_final else 'NEEDS_REVIEW',
        failure_code=code, retry_at=retry_at, lease_token=None, lease_expires_at=None,
        version=F('version')+1, updated_at=now)
    if not retry:
        values['completed_at'] = now
    return AssessmentJob.objects.filter(id=job.id,status='PROCESSING',lease_token=job.lease_token).update(**values)

def record_legacy_grade(attempt_id,question_id):
    """Caller-owned transaction hook, not silently added to the legacy route."""
    from .mock_scoring import round_half
    jobs=AssessmentJob.objects.filter(attempt_id=attempt_id).order_by('-generation','-created_at')
    job=next((j for j in jobs if any(r['questionId']==question_id for p in j.input_snapshot['parts'] for r in p['responses'])),None)
    if job is None:return
    input=job.input_snapshot
    # Historical unversioned Multilevel answers use their original per-question
    # scale. They must not be reinterpreted as a current formal /5 or /6 rubric.
    from .multilevel import SPECS
    if input['program']=='MULTILEVEL' and input.get('specificationVersion') not in SPECS:return
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
    result['parts']=parts
    from .assessment_quality import attach_grade
    result=attach_grade(input,result);score=results.score(input,result)['score']
    update(job,teacher_score=score,final_score=score,final_score_source='TEACHER',final_result=result,approved_feedback=result,status='SUCCEEDED',failure_code=None,lease_token=None,lease_expires_at=None,completed_at=timezone.now(),version=F('version')+1)


def teacher_grade_attempt(actor, attempt_id: str, data: dict) -> dict:
    if actor.role not in ('teacher', 'admin', 'super_admin'):
        fail('FORBIDDEN', 'Staff access required', 403)
    attempt = MockAttempt.objects.filter(id=attempt_id).select_related('exam', 'student__group').first()
    if attempt is None:
        fail('MOCK_ATTEMPT_NOT_FOUND', 'Attempt not found', 404)

    if actor.role == 'teacher':
        student = getattr(attempt, 'student', None)
        student_group = getattr(student, 'group', None) if student else None
        if not student_group or getattr(student_group, 'teacher_id', None) != actor.id:
            fail('FORBIDDEN', 'Ushbu talaba sizning guruhingizga biriktirilmagan', 403)
    if attempt.status == 'in_progress':
        fail('MOCK_ATTEMPT_NOT_SUBMITTED', 'Imtihon hali topshirilmagan', 409)

    final_score = data.get('final_score')
    if final_score is None:
        final_score = data.get('finalScore')
    if final_score is None:
        final_score = data.get('total_score')
    if final_score is None:
        final_score = data.get('totalScore')
    writing_score = data.get('writing_score')
    if writing_score is None:
        writing_score = data.get('writingScore')
    speaking_score = data.get('speaking_score')
    if speaking_score is None:
        speaking_score = data.get('speakingScore')
    teacher_comment = str(data.get('teacher_comment') or data.get('teacherComment') or data.get('comment') or '').strip()
    criteria_scores = data.get('criteria_scores') or data.get('criteriaScores') or {}

    maximum = 75 if attempt.exam.type == 'multilevel' else 9
    def validated_score(value):
        if value is None:
            return None
        try:
            score = float(value)
        except (ValueError, TypeError):
            fail('SCORE_OUT_OF_RANGE', 'Ball noto‘g‘ri', 400)
        if isinstance(value, bool) or not math.isfinite(score) or not 0 <= score <= maximum:
            fail('SCORE_OUT_OF_RANGE', f'Ball 0 dan {maximum} gacha bo‘lishi kerak', 400)
        return score

    final_score_val = validated_score(final_score)
    w_score_val = validated_score(writing_score)
    s_score_val = validated_score(speaking_score)

    if final_score_val is None and w_score_val is None and s_score_val is None:
        fail('SCORE_REQUIRED', 'Baho kiritilishi shart', 400)

    now = timezone.now()
    jobs = list(AssessmentJob.objects.filter(attempt_id=attempt_id))
    if any(job.status != 'SUCCEEDED' for job in jobs):
        fail('ASSESSMENT_SKILL_REVIEW_REQUIRED', 'Review the pending Writing and Speaking skills separately', 409)
    for job in jobs:
        score_to_apply = None
        if job.skill == 'writing':
            score_to_apply = w_score_val if w_score_val is not None else final_score_val
        elif job.skill == 'speaking':
            score_to_apply = s_score_val if s_score_val is not None else final_score_val
        else:
            score_to_apply = final_score_val

        if score_to_apply is not None:
            approved = dict(job.approved_feedback or job.final_result or {})
            approved['teacherComment'] = teacher_comment
            approved['teacher_comment'] = teacher_comment
            if criteria_scores and job.skill == 'writing':
                approved['criteriaScores'] = criteria_scores
            AssessmentJob.objects.filter(id=job.id).update(
                teacher_score=score_to_apply,
                final_score=score_to_apply,
                final_score_source='TEACHER',
                status='SUCCEEDED',
                approved_feedback=approved,
                failure_code=None,
                completed_at=now,
                updated_at=now,
            )

    MockAnswer.objects.filter(
        attempt_id=attempt_id,
        question__group__section__skill__in=['writing', 'speaking']
    ).update(
        graded_by_id=actor.id,
        feedback=teacher_comment,
        is_graded=True,
        updated_at=now
    )

    sec_bands = dict(attempt.section_bands or {})
    if w_score_val is not None:
        sec_bands['writing'] = w_score_val
    elif final_score_val is not None and ('writing' in sec_bands or not sec_bands):
        sec_bands['writing'] = final_score_val

    if s_score_val is not None:
        sec_bands['speaking'] = s_score_val

    calculated_overall = final_score_val
    if calculated_overall is None and sec_bands:
        valid_nums = [float(v) for v in sec_bands.values() if isinstance(v, (int, float))]
        if valid_nums:
            calculated_overall = round(sum(valid_nums) / len(valid_nums) * 2) / 2

    std_scores = dict(attempt.standard_scores or {})
    if w_score_val is not None:
        std_scores['writing'] = w_score_val
    if s_score_val is not None:
        std_scores['speaking'] = s_score_val

    media_st = dict(attempt.media_state or {})
    media_st['is_teacher_reviewed'] = True
    media_st['is_reviewed_by_teacher'] = True
    media_st['teacher_score'] = calculated_overall
    media_st['final_score_source'] = 'TEACHER'
    media_st['teacher_comment'] = teacher_comment
    media_st['teacher_reviewed_by'] = actor.name or actor.id
    media_st['teacher_reviewed_at'] = now.isoformat()

    attempt.overall_band = calculated_overall
    attempt.section_bands = sec_bands
    attempt.standard_scores = std_scores
    attempt.media_state = media_st
    attempt.status = 'completed'
    attempt.finished_at = attempt.finished_at or now
    attempt.save(update_fields=['overall_band', 'section_bands', 'standard_scores', 'media_state', 'status', 'finished_at'])

    return {
        'success': True,
        'attemptId': attempt_id,
        'isTeacherReviewed': True,
        'is_teacher_reviewed': True,
        'is_reviewed_by_teacher': True,
        'finalScore': calculated_overall,
        'final_score': calculated_overall,
        'totalScore': calculated_overall,
        'total_score': calculated_overall,
        'final_score': calculated_overall,
        'sectionBands': sec_bands,
        'section_bands': sec_bands,
        'teacherComment': teacher_comment,
        'teacher_comment': teacher_comment,
        'reviewedBy': actor.name or actor.id,
    }
