"""Existing teacher grade and caller-owned assessment recomputation contracts."""
import math
from django.db import transaction
from django.utils import timezone
from apps.legacy_schema.models import MockAttempt,MockAnswer,MockQuestion,AssessmentJob
from .mock_attempts import fail,versioned
from .mock_authoring import new_id
from .mock_catalog import shape_exam
from .mock_submissions import band_tables
from . import mock_scoring as scoring
from .points import assert_can_view
from .mock_practice import is_partial,scope,scope_sections

def annotate_practice_grades(attempt,result):
    """Keep the native raw score and attach the same persisted display grade."""
    if attempt.exam.type!='multilevel':return result
    seen=set()
    for job in AssessmentJob.objects.filter(attempt_id=attempt.id).order_by('-generation','-created_at'):
        if job.skill in seen:continue
        seen.add(job.skill)
        if job.final_score is None or not job.final_result:continue
        grade=job.final_result.get('practiceGrade')
        raw=result['rawScores'].get(job.skill)
        if grade is not None and raw is not None and grade['rawScore']==raw['score'] and grade['rawMax']==raw['max']:
            raw['practiceGrade']=grade
    return result

def save_projection(attempt,result):
    names=dict(status='status',raw_scores='rawScores',section_bands='sectionBands',overall_band='overallBand',cefr_level='cefrLevel')
    if versioned(attempt):names.update(standard_scores='standardScores',overall_score='overallScore',score_method='scoreMethod',score_version='scoreVersion')
    for attr,key in names.items():setattr(attempt,attr,result[key])
    attempt.finished_at=timezone.now() if result['status']=='completed' else None
    attempt.save(update_fields=[*names,'finished_at'])

def recompute(attempt_id):
    attempt=MockAttempt.objects.select_related('exam').filter(id=attempt_id).first()
    if attempt is None:fail('MOCK_ATTEMPT_NOT_FOUND','Urinish topilmadi',404)
    sections=scope_sections(attempt,shape_exam(attempt.exam,True)['sections']);answers={a.question_id:a for a in MockAnswer.objects.filter(attempt_id=attempt.id)}
    # Submission and teacher/AI reviews must use the same per-section pending
    # rules. A global pending flag used to hide already graded later sections.
    values={identifier:dict(response=a.response,isGraded=a.is_graded,score=a.score) for identifier,a in answers.items()}
    result,_=scoring.calculate(attempt.exam.type,sections,values,versioned=versioned(attempt),
        full_test=attempt.flow_mode=='full_test',tables=band_tables())
    if is_partial(attempt):result=scoring.partial_result(result)
    result=annotate_practice_grades(attempt,result)
    was_completed=attempt.status=='completed'
    save_projection(attempt,result)
    from .assessment_quality import attempt_practice_grades
    if (is_partial(attempt) or attempt_practice_grades(attempt)) and result['status']=='completed' and not was_completed:
        from .mock_submission_snapshots import notify
        notify(attempt)
    return result

@transaction.atomic
def grade(actor,attempt_id,data):
    # Share the attempt lock with assessment review/worker finalization so a
    # saved teacher grade and its ledger projection cannot race an AI result.
    attempt=MockAttempt.objects.select_for_update().select_related('exam').filter(id=attempt_id).first()
    if attempt is None:fail('MOCK_ATTEMPT_NOT_FOUND','Urinish topilmadi',404)
    if attempt.status=='in_progress':fail('MOCK_ATTEMPT_NOT_SUBMITTED','Imtihon hali topshirilmagan')
    assert_can_view(actor,attempt.student_id)
    question=MockQuestion.objects.filter(id=data['questionId'],group__section__exam_id=attempt.exam_id).select_related('group__section').first()
    if question is None:fail('QUESTION_NOT_IN_EXAM','Savol bu imtihonga tegishli emas')
    selected=scope(attempt)
    if selected is not None and question.id not in selected['questionIds']:fail('QUESTION_NOT_IN_EXAM','Savol bu mashqqa tegishli emas')
    skill=question.group.section.skill
    if skill in ('listening','reading'):fail('NOT_MANUAL_QUESTION','Bu savol avtomatik baholanadi')
    allowed=['ta','cc','lr','gra'] if skill=='writing' else ['fluency','lexical','grammar','pronunciation']
    rubrics=data.get('rubricScores');has_rubrics='rubricScores' in data
    # JS treats {} as truthy and Object.entries(null) raises an internal error.
    if versioned(attempt) and rubrics is not None:fail('SCORE_REQUIRED','Multilevel uses holistic task raw scores; enter a half-point raw score')
    if has_rubrics:
        for key,value in rubrics.items():
            if key not in allowed:fail('VALIDATION_ERROR',f"Noma'lum rubric: {key}")
            if type(value) not in (int,float) or math.isnan(value) or not 0<=value<=9:fail('VALIDATION_ERROR',f'Rubric "{key}" 0 dan 9 gacha bo\'lsin')
            if scoring.js_round(value*2)!=value*2:fail('VALIDATION_ERROR',f'Rubric "{key}" 0.5 qadamda bo\'lsin')
    if 'score' in data:final=data['score']
    elif rubrics is not None and all(type(rubrics.get(k)) in (int,float) and not math.isnan(rubrics[k]) for k in allowed):final=scoring.round_half(sum(rubrics[k] for k in allowed)/4)
    else:fail('SCORE_REQUIRED','Ball kiriting yoki 4 ta mezonni to‘liq baholang')
    maximum=question.group.max_score if versioned(attempt) and question.group.max_score is not None else question.points
    if final is not None and not 0<=final<=maximum:fail('SCORE_OUT_OF_RANGE',f"Ball 0 dan {maximum} gacha bo'lishi kerak")
    if versioned(attempt) and (type(final) not in (int,float) or not math.isfinite(final) or final*2!=scoring.js_round(final*2)):fail('SCORE_OUT_OF_RANGE','Use half-point raw scores')
    before=MockAnswer.objects.filter(attempt_id=attempt_id,question_id=question.id).first()
    values=dict(score=final,is_graded=True,graded_by_id=actor.id,feedback=data.get('feedback'),rubric_scores=rubrics,updated_at=timezone.now())
    MockAnswer.objects.update_or_create(attempt_id=attempt_id,question_id=question.id,defaults=values,
        create_defaults=dict(values,id=new_id(),response=''))
    with transaction.atomic():
        rows=list(MockAnswer.objects.filter(attempt_id=attempt_id));answers={a.question_id:dict(response=a.response,isGraded=a.is_graded,score=a.score) for a in rows}
        result,projections=scoring.calculate(attempt.exam.type,scope_sections(attempt,shape_exam(attempt.exam,True)['sections']),answers,versioned=versioned(attempt),full_test=attempt.flow_mode=='full_test',tables=band_tables())
        if is_partial(attempt):result=scoring.partial_result(result)
        for row in rows:
            if row.question_id in projections:
                p=projections[row.question_id];MockAnswer.objects.filter(id=row.id).update(score=p['score'],is_correct=p['isCorrect'],is_graded=True,updated_at=timezone.now())
        from .assessment import record_legacy_grade
        record_legacy_grade(attempt_id,question.id)
        result=annotate_practice_grades(attempt,result)
        save_projection(attempt,result)
    from .system_settings import audit
    audit(actor,'mock.answer.grade','mockAnswer',question.id,old=dict(score=before.score if before else None,gradedById=before.graded_by_id if before else None,feedback=before.feedback if before else None),new=dict(attemptId=attempt_id,score=final,status=result['status']))
    if result['status']=='completed':
        from .mock_submission_snapshots import notify
        notify(attempt)
    return dict(saved=True,status=result['status'])
