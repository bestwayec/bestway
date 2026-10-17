"""Project real, validated AI evidence without substituting teacher grades."""
import math
from . import assessment_results as results,assessment_quality as quality


def ranking_ai_projection(job,evaluations,transcripts=None):
    empty=dict(score=None,rawScore=None,rawMax=None,scaleMax=75 if job.program=='MULTILEVEL' else 9,
        confidence=job.confidence,status=job.status,reviewRequired=True,eligible=False,
        evaluationId=None,provider=None,model=None,gradingPolicy=job.input_snapshot.get('gradingPolicy'))
    if job.status not in ('SUCCEEDED','NEEDS_REVIEW'):
        return empty
    selected=next((e for e in evaluations if e.id==job.selected_evaluation_id and e.job_id==job.id and e.status=='SUCCEEDED'),None)
    if not selected or selected.role not in ('PRIMARY','ADJUDICATOR') or not selected.result:
        return empty
    if transcripts is None and job.skill=='speaking' and quality.enabled(job.input_snapshot):
        from apps.legacy_schema.models import SpeechTranscript
        transcripts=list(SpeechTranscript.objects.filter(job_id=job.id,status='SUCCEEDED').order_by('-completed_at'))
    input=quality.evidence_input(job.input_snapshot,transcripts or [])
    from .mock_import_validate import canonical_checksum
    if job.input_hash!=canonical_checksum(job.input_snapshot) or selected.input_hash!=canonical_checksum(input):return dict(empty,status='NEEDS_REVIEW')
    try:
        value=results.validate(selected.result,input)
        if selected.role=='ADJUDICATOR':
            primary=next(iter(sorted([e for e in evaluations if e.job_id==job.id and e.role=='PRIMARY' and e.status=='SUCCEEDED' and e.result and e.input_hash==selected.input_hash],key=lambda e:(e.attempt_number,e.completed_at),reverse=True)),None)
            if not primary:return empty
            value=results.combine(results.validate(primary.result,input),value,input)
        native=results.score(input,value)
    except (results.ProviderError,results.ContractAPIException,KeyError,TypeError,ValueError):
        return dict(empty,status='NEEDS_REVIEW')
    score=native['score'];raw=native['rawTotal'] if job.program=='MULTILEVEL' else score
    maximum=sum(p['max'] for p in input['parts']) if job.program=='MULTILEVEL' else 9
    practice=value.get('practiceGrade')
    if practice is not None:score=practice['score']
    elif input.get('practiceMode')=='PARTIAL' and score is not None:score=round(75*raw/maximum,1)
    if job.program == 'MULTILEVEL' and score is not None:
        score = min(55.0, float(score))
    confidence=value['confidence']
    if type(job.confidence) in (int,float) and math.isfinite(job.confidence):confidence=min(confidence,job.confidence)
    from .assessment import threshold
    eligible=score is not None and confidence>=threshold() and job.failure_code in (None,'TEACHER_CONFIRMATION_REQUIRED')
    return dict(empty,score=score,rawScore=raw,rawMax=maximum,confidence=confidence,
        eligible=eligible,reviewRequired=job.status!='SUCCEEDED' or not eligible,
        evaluationId=selected.id,provider=selected.provider,model=selected.model,practiceGrade=practice)
