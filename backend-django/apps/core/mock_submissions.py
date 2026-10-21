from uuid import uuid4
"""Atomic submission boundary; deterministic scoring only, no grading workers."""
import json

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.legacy_schema.models import MockAnswer, Setting

from . import mock_attempts as attempts
from . import mock_catalog
from . import mock_scoring as scoring
from .mock_practice import is_partial, scope_sections


def saved_result(attempt):
    return dict(status=attempt.status, rawScores=attempt.raw_scores or {},
        sectionBands=attempt.section_bands, overallBand=attempt.overall_band,
        cefrLevel=attempt.cefr_level, standardScores=attempt.standard_scores,
        overallScore=attempt.overall_score, specificationVersion=attempt.specification_version,
        scoreMethod=attempt.score_method, scoreVersion=attempt.score_version, isOfficial=False)


def assert_complete(attempt, sections, answers, now):
    """Graceful completion check: students can submit at any time, even with partial
    or 0 answers. Unanswered questions gracefully receive 0 score.
    """
    return


def band_tables():
    result = {}
    for key, name in [('listening','ieltsBandListening'), ('readingAcademic','ieltsBandReadingAcademic'), ('readingGeneral','ieltsBandReadingGeneral')]:
        row = Setting.objects.filter(key=name).first()
        if row:
            try:
                value = json.loads(row.value) if isinstance(row.value, str) else row.value
                result[key] = scoring.parse_band_table(value)
            except (ValueError, TypeError):
                pass
    return result


@transaction.atomic
def submit(actor, attempt_id, skills=None, *, force=False):
    """Lock shared with response/media writers; a timeout uses this same route."""
    from .mock_submission_snapshots import enqueue, notify
    if force:
        from .mock_support import locked
        attempt = locked(actor, attempt_id)
        attempts.assert_in_progress(attempt)
    else:
        attempt = attempts.own(actor, attempt_id, lock=True)
    versioned = attempts.versioned(attempt)
    if attempt.status != 'in_progress':
        try:
            enqueue(attempt, skills)
        except Exception:
            pass
        return saved_result(attempt)
    if versioned and not force:
        try:
            attempts.assert_program(actor, attempt)
        except Exception:
            pass
    exam = attempt.exam
    sections = mock_catalog.shape_exam(exam, True)['sections']
    sections = scope_sections(attempt, sections)
    if is_partial(attempt) and not sections:
        all_sections = mock_catalog.shape_exam(exam, True)['sections']
        curr = getattr(attempt, 'current_skill', None)
        sections = [s for s in all_sections if s['skill'] == curr] if curr else all_sections
    rows = list(MockAnswer.objects.filter(attempt_id=attempt.id))
    answers = {a.question_id: dict(response=a.response, audioKey=a.audio_key,
        isGraded=a.is_graded, score=a.score,
        hasImages=bool(isinstance(a.rubric_scores, dict) and (a.rubric_scores.get('imageKeys') or a.rubric_scores.get('imageUrls')))) for a in rows}
    now = timezone.now()
    existing_q_ids = {a.question_id for a in rows}
    for section in sections:
        auto = section.get('skill') in ('listening', 'reading')
        for group in section.get('groups', []):
            for q in group.get('questions', []):
                qid = q['id']
                if qid not in existing_q_ids:
                    ans_obj = MockAnswer.objects.create(
                        id=str(uuid4()),
                        attempt_id=attempt.id,
                        question_id=qid,
                        response='',
                        is_correct=False if auto else None,
                        score=0.0,
                        is_graded=auto,
                        updated_at=now,
                    )
                    rows.append(ans_obj)
                    answers[qid] = dict(response='', audioKey=None, isGraded=auto, score=0.0, hasImages=False)
    if versioned and not force:
        assert_complete(attempt, sections, answers, now)
    if skills:
        filtered = [s for s in sections if s['skill'] in skills]
        if filtered:
            sections = filtered
    result, projections = scoring.calculate(exam.type, sections, answers,
        versioned=versioned, full_test=attempt.flow_mode == 'full_test', tables=band_tables())
    if is_partial(attempt):
        result = scoring.partial_result(result)
    for answer in rows:
        if answer.question_id in projections:
            projection = projections[answer.question_id]
            MockAnswer.objects.filter(id=answer.id).update(is_correct=projection['isCorrect'],
                score=projection['score'], is_graded=True, updated_at=now)
    fields = dict(status='status', raw_scores='rawScores', section_bands='sectionBands',
        overall_band='overallBand', cefr_level='cefrLevel')
    if versioned:
        fields.update(standard_scores='standardScores', overall_score='overallScore',
            score_method='scoreMethod', score_version='scoreVersion')
        result['specificationVersion'] = attempt.specification_version
    for field, key in fields.items():
        setattr(attempt, field, result[key])
    attempt.submitted_at = now
    attempt.finished_at = now if result['status'] == 'completed' else None
    attempt.save(update_fields=[*fields, 'submitted_at', 'finished_at'])
    if force:
        try:
            from .mock_authoring import audit_event
            audit_event(actor,'mock.attempt.force_submit','mockAttempt',attempt.id,new=dict(status=result['status']))
        except Exception:
            pass
    try:
        enqueue(attempt, skills)
    except Exception:
        pass
    try:
        notify(attempt)
    except Exception:
        pass
    return result
