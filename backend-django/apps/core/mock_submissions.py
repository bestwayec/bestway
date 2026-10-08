"""Atomic submission boundary; deterministic scoring only, no grading workers."""
import json
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from apps.legacy_schema.models import MockAnswer, Setting
from . import mock_attempts as attempts, mock_catalog, mock_scoring as scoring


def saved_result(attempt):
    return dict(status=attempt.status, rawScores=attempt.raw_scores or {},
        sectionBands=attempt.section_bands, overallBand=attempt.overall_band,
        cefrLevel=attempt.cefr_level, standardScores=attempt.standard_scores,
        overallScore=attempt.overall_score, specificationVersion=attempt.specification_version,
        scoreMethod=attempt.score_method, scoreVersion=attempt.score_version, isOfficial=False)


def assert_complete(attempt, sections, answers, now):
    overall = attempts.aware(attempt.overall_deadline_at or attempt.deadline_at)
    if overall and overall <= now:
        return
    deadlines = attempt.section_deadlines if isinstance(attempt.section_deadlines, dict) else {}
    missing = []
    for section in sections:
        skill = section['skill']
        raw = deadlines.get(skill)
        try:
            deadline = attempts.aware(parse_datetime(raw)) if isinstance(raw, str) else None
        except ValueError:
            deadline = None
        if deadline and deadline <= now:
            continue
        if attempt.flow_mode == 'full_test' and attempt.current_skill != skill:
            continue
        questions = [q for g in section['groups'] for q in g['questions']]
        count = sum(not (answers.get(q['id'], {}).get('audioKey') if q['type'] == 'speaking_task'
            else scoring.trim(answers.get(q['id'], {}).get('response', ''))) for q in questions)
        if count:
            spoken = any(q['type'] == 'speaking_task' for q in questions)
            missing.append(f"{skill.capitalize()} {count} of {len(questions)} {'not recorded' if spoken else 'unanswered'}")
    if missing:
        message = 'Finish the remaining work before submitting — ' + '; '.join(missing) + '.'
        if overall:
            message += ' This exam still submits by itself when the timer ends.'
        attempts.fail('MOCK_ATTEMPT_INCOMPLETE', message)


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
        if not versioned:
            attempts.fail('MOCK_ATTEMPT_FINISHED', 'Bu urinish allaqachon topshirilgan')
        enqueue(attempt, skills)
        return saved_result(attempt)
    if versioned and not force:
        attempts.assert_program(actor, attempt)
    exam = attempt.exam
    sections = mock_catalog.shape_exam(exam, True)['sections']
    rows = list(MockAnswer.objects.filter(attempt_id=attempt.id))
    answers = {a.question_id: dict(response=a.response, audioKey=a.audio_key,
        isGraded=a.is_graded, score=a.score) for a in rows}
    now = timezone.now()
    if versioned and not force:
        assert_complete(attempt, sections, answers, now)
    elif skills:
        sections = [s for s in sections if s['skill'] in skills]
        if not sections:
            attempts.fail('VALIDATION_ERROR', 'Bunday bo‘lim bu imtihonda yo‘q')
    result, projections = scoring.calculate(exam.type, sections, answers,
        versioned=versioned, full_test=attempt.flow_mode == 'full_test', tables=band_tables())
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
        from .mock_authoring import audit_event
        audit_event(actor,'mock.attempt.force_submit','mockAttempt',attempt.id,new=dict(status=result['status']))
    enqueue(attempt, skills)
    notify(attempt)
    return result
