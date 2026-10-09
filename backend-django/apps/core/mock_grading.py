"""Existing teacher grade and caller-owned assessment recomputation contracts."""
import math
from django.db import transaction
from django.utils import timezone
from apps.legacy_schema.models import MockAttempt,MockAnswer,MockQuestion
from .mock_attempts import fail,versioned
from .mock_authoring import new_id
from .mock_catalog import shape_exam
from .mock_submissions import band_tables
from . import mock_scoring as scoring
from .points import assert_can_view

def save_projection(attempt,result):
    names=dict(status='status',raw_scores='rawScores',section_bands='sectionBands',overall_band='overallBand',cefr_level='cefrLevel')
    if versioned(attempt):names.update(standard_scores='standardScores',overall_score='overallScore',score_method='scoreMethod',score_version='scoreVersion')
    for attr,key in names.items():setattr(attempt,attr,result[key])
    attempt.finished_at=timezone.now() if result['status']=='completed' else None
    attempt.save(update_fields=[*names,'finished_at'])

def recompute(attempt_id):
    attempt=MockAttempt.objects.select_related('exam').filter(id=attempt_id).first()
    if attempt is None:fail('MOCK_ATTEMPT_NOT_FOUND','Urinish topilmadi',404)
    sections=shape_exam(attempt.exam,True)['sections'];answers={a.question_id:a for a in MockAnswer.objects.filter(attempt_id=attempt.id)}
    ielts=attempt.exam.type in ('ielts_academic','ielts_general');ml=not ielts and versioned(attempt)
    raw={};bands={};standard={};pending=False;tables=band_tables() if ielts else None
    for section in sections:
        skill=section['skill'];manual=skill not in ('listening','reading')
        rows=[(q,answers.get(q['id'])) for g in section['groups'] for q in g['questions']]
        graded=[(q,a) for q,a in rows if a and a.is_graded]
        if manual and len(graded)!=len(rows):pending=True
        value=sum(a.score or 0 for _,a in graded) if manual else sum(a.score or 0 for _,a in rows if a)
        maximum=sum(g.get('maxScore') if g.get('maxScore') is not None else g['questions'][0]['points'] if g['questions'] else 0 for g in section['groups']) if ml and manual else sum(q['points'] for q,_ in rows)
        if ml and skill=='speaking':
            parts=[]
            for group in section['groups']:
                scores=[answers[q['id']].score for q in group['questions'] if q['id'] in answers and answers[q['id']].score is not None]
                parts.append(scoring.round_half(sum(scores)/len(scores)) if scores and len(scores)==len(group['questions']) else None)
            value=0 if None in parts else sum(parts)
        raw[skill]=dict(score=value,max=maximum)
        if ielts and not manual and maximum>0:bands[skill]=scoring.band_from_raw(skill,attempt.exam.type,value,maximum,tables,any(a and a.response.strip() for _,a in rows))
        if ielts and manual and not pending and graded:
            tasks=[(q['type'],a.score or 0) for q,a in graded];t1=next((s for t,s in tasks if t=='essay_task1'),None);t2=next((s for t,s in tasks if t=='essay_task2'),None)
            bands[skill]=scoring.round_half((t1+2*t2)/3 if skill=='writing' and t1 is not None and t2 is not None else sum(s for _,s in tasks)/len(tasks))
        if ml and maximum>0 and not pending:standard[skill]=dict(rawScore=value,rawMax=maximum,estimatedStandardScore=scoring.convert_expert(skill,value) if manual else scoring.estimate_objective(value,maximum)['estimatedStandardScore'],scoreMethod='ESTIMATED',scoreVersion=scoring.ESTIMATE_VERSION,isOfficial=False)
    overall_band=scoring.round_half(sum(bands.values())/(4 if attempt.flow_mode=='full_test' else len(bands))) if ielts and not pending and bands else None
    overall_score=sum(standard[s]['estimatedStandardScore'] for s in ('listening','reading','writing','speaking'))/4 if ml and not pending and all(s in standard for s in ('listening','reading','writing','speaking')) else None
    cefr=scoring.cefr_band(overall_band) if overall_band is not None else scoring.multilevel_level(overall_score) if overall_score is not None else None
    result=dict(status='grading' if pending else 'completed',rawScores=raw,sectionBands=bands if ielts else None,overallBand=overall_band,cefrLevel=cefr,
        standardScores=standard,overallScore=overall_score,scoreMethod='ESTIMATED',scoreVersion=scoring.ESTIMATE_VERSION)
    save_projection(attempt,result)
    return result

def grade(actor,attempt_id,data):
    attempt=MockAttempt.objects.select_related('exam').filter(id=attempt_id).first()
    if attempt is None:fail('MOCK_ATTEMPT_NOT_FOUND','Urinish topilmadi',404)
    if attempt.status=='in_progress':fail('MOCK_ATTEMPT_NOT_SUBMITTED','Imtihon hali topshirilmagan')
    assert_can_view(actor,attempt.student_id)
    question=MockQuestion.objects.filter(id=data['questionId'],group__section__exam_id=attempt.exam_id).select_related('group__section').first()
    if question is None:fail('QUESTION_NOT_IN_EXAM','Savol bu imtihonga tegishli emas')
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
        result,projections=scoring.calculate(attempt.exam.type,shape_exam(attempt.exam,True)['sections'],answers,versioned=versioned(attempt),full_test=attempt.flow_mode=='full_test',tables=band_tables())
        for row in rows:
            if row.question_id in projections:
                p=projections[row.question_id];MockAnswer.objects.filter(id=row.id).update(score=p['score'],is_correct=p['isCorrect'],is_graded=True,updated_at=timezone.now())
        save_projection(attempt,result)
    from .system_settings import audit
    audit(actor,'mock.answer.grade','mockAnswer',question.id,old=dict(score=before.score if before else None,gradedById=before.graded_by_id if before else None,feedback=before.feedback if before else None),new=dict(attemptId=attempt_id,score=final,status=result['status']))
    if result['status']=='completed':
        from .mock_submission_snapshots import notify
        notify(attempt)
    return dict(saved=True,status=result['status'])
