"""Role-scoped AI rankings for comparable, immutable Multilevel task scopes."""
from collections import defaultdict
from hashlib import sha256
import json
import math
from django.db.models.fields.json import KeyTransform

from apps.legacy_schema.models import (Group, StudentProfile, MockExam, MockAttempt,
    AssessmentJob, AssessmentEvaluation, SpeechTranscript)
from common.api.exceptions import ContractAPIException
from .mock_practice import SCOPE_KEY, is_partial, scope


def fail(code, message, status=403):
    raise ContractAPIException(code, message, status)


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def cohort_scope(attempt, job):
    """Use task identity, never candidate text/audio hashes, as comparability keys."""
    source = job.input_snapshot
    if not isinstance(source, dict) or source.get('program') != 'MULTILEVEL' or job.program != 'MULTILEVEL' or source.get('skill') != job.skill:
        return None
    partial = is_partial(attempt)
    if partial != (source.get('practiceMode') == 'PARTIAL'):
        return None
    if source.get('specificationVersion') != attempt.specification_version:
        return None
    if source.get('rubricVersion') != job.rubric_version or source.get('promptVersion') != job.prompt_version:
        return None
    source_parts = source.get('parts')
    if not isinstance(source_parts, list) or not source_parts:
        return None
    seen_parts, seen_questions, parts = set(), set(), []
    for part in source_parts:
        if not isinstance(part, dict):
            return None
        identifier, maximum = part.get('id'), part.get('max')
        responses = part.get('responses')
        if not isinstance(identifier, str) or not identifier or identifier in seen_parts or not finite(maximum) or maximum <= 0:
            return None
        if not isinstance(responses, list) or not responses:
            return None
        ids = [row.get('questionId') if isinstance(row, dict) else None for row in responses]
        if any(not isinstance(qid, str) or not qid or qid in seen_questions for qid in ids) or len(set(ids)) != len(ids):
            return None
        seen_parts.add(identifier); seen_questions.update(ids)
        task = dict(task=part.get('task'), context=part.get('context'), imageKeys=part.get('imageKeys'),
            prepSeconds=part.get('prepSeconds'), responseSeconds=part.get('responseSeconds'),
            responses=[{key: row.get(key) for key in ('questionId', 'prompt', 'partNumber', 'prepSeconds', 'responseSeconds')} for row in responses])
        task_hash = sha256(json.dumps(task, sort_keys=True, separators=(',', ':')).encode()).hexdigest()[:20]
        parts.append(dict(id=identifier, max=maximum, questionIds=sorted(ids), taskVersion=task_hash))
    if partial:
        frozen = scope(attempt)
        if not frozen or job.skill not in frozen['skills'] or not seen_questions.issubset(set(frozen['questionIds'])):
            return None
    policy = source.get('gradingPolicy')
    policy_id = policy.get('id') if isinstance(policy, dict) else None
    identity = dict(examId=attempt.exam_id, skill=job.skill, isPartial=partial,
        specificationVersion=source.get('specificationVersion'),
        speakingProfileVersion=source.get('speakingProfileVersion') if job.skill == 'speaking' else None,
        rubricVersion=job.rubric_version, promptVersion=job.prompt_version,
        evaluationPolicy=source.get('evaluationPolicy'), gradingPolicyId=policy_id,
        parts=sorted(parts, key=lambda row: row['id']))
    identity['id'] = sha256(json.dumps(identity, sort_keys=True, separators=(',', ':')).encode()).hexdigest()[:20]
    identity['rawMax'] = sum(part['max'] for part in parts)
    identity['questionCount'] = len(seen_questions)
    identity['scaleMax'] = 75
    identity['label'] = ', '.join(part['id'] for part in parts)
    return identity


def ranked_rows(rows):
    """Competition ranks are local to one cohort; unavailable values remain null."""
    eligible = sorted((row for row in rows if row['eligible'] and finite(row['aiScore'])),
        key=lambda row: (-row['aiScore'], row['name'].casefold(), row['studentId']))
    previous, rank = None, None
    for index, row in enumerate(eligible, 1):
        if row['aiScore'] != previous:
            rank = index
        row['rank'] = rank; previous = row['aiScore']
    pending = sorted((row for row in rows if not row['eligible'] or not finite(row['aiScore'])), key=lambda row: (row['name'].casefold(), row['studentId']))
    return [*eligible, *pending]


def rankings(actor, group_id, exam_id=None, skill='writing'):
    if actor.role not in ('teacher', 'admin', 'super_admin'):
        fail('FORBIDDEN', 'Bu amal uchun rolingiz yetarli emas')
    group = Group.objects.filter(id=group_id).first()
    if group is None:
        fail('GROUP_NOT_FOUND', 'Guruh topilmadi', 404)
    if actor.role == 'teacher' and group.teacher_id != actor.id:
        fail('FORBIDDEN', 'Bu guruh sizga biriktirilmagan')
    roster = list(StudentProfile.objects.filter(group_id=group.id).select_related('user').order_by('user__name', 'user_id'))
    student_ids = [student.user_id for student in roster]
    exams = list(MockExam.objects.filter(type='multilevel', mockattempt__student_id__in=student_ids)
        .distinct().order_by('title', 'id').values('id', 'title', 'type')) if student_ids else []
    result = dict(group=dict(id=group.id, name=group.name), skill=skill, exams=exams,
        selectedExamId=exam_id, cohorts=[], unranked=[])
    if exam_id is None:
        return result
    if not any(exam['id'] == exam_id for exam in exams):
        fail('RANKING_EXAM_NOT_FOUND', 'Bu guruh uchun imtihon natijalari topilmadi', 404)
    # A later Speaking-only practice must not hide a student's Writing result.
    # Exact frozen version/selection is required; damaged/unknown scopes stay in
    # the latest-attempt check rather than silently reviving an older grade.
    other_skill = 'speaking' if skill == 'writing' else 'writing'
    unrelated = MockAttempt.objects.filter(exam_id=exam_id, student_id__in=student_ids,
        flow_mode='partial_practice').annotate(ranking_scope=KeyTransform(SCOPE_KEY, 'media_state'))
    unrelated = unrelated.filter(ranking_scope__version=1, ranking_scope__skills=[other_skill]).values('id')
    # PostgreSQL DISTINCT ON chooses each student's latest relevant attempt.
    attempts = list(MockAttempt.objects.filter(exam_id=exam_id, student_id__in=student_ids)
        .exclude(id__in=unrelated)
        .order_by('student_id', '-started_at', '-id').distinct('student_id'))
    by_student = {attempt.student_id: attempt for attempt in attempts}
    jobs = list(AssessmentJob.objects.filter(attempt_id__in=[attempt.id for attempt in attempts], skill=skill)
        .order_by('attempt_id', '-generation', '-created_at', '-id').distinct('attempt_id'))
    by_attempt = {job.attempt_id: job for job in jobs}
    evaluations, transcripts = defaultdict(list), defaultdict(list)
    job_ids = [job.id for job in jobs]
    if job_ids:
        for evaluation in AssessmentEvaluation.objects.filter(job_id__in=job_ids):
            evaluations[evaluation.job_id].append(evaluation)
        if skill == 'speaking':
            for transcript in SpeechTranscript.objects.filter(job_id__in=job_ids, status='SUCCEEDED'):
                transcripts[transcript.job_id].append(transcript)
    from .assessment_ranking_scores import ranking_ai_projection
    cohorts = {}
    for student in roster:
        attempt = by_student.get(student.user_id)
        job = by_attempt.get(attempt.id) if attempt else None
        row = dict(studentId=student.user_id, name=student.user.name,
            attemptId=attempt.id if attempt else None, jobId=job.id if job else None,
            aiScore=None, aiRawScore=None, teacherScore=None, finalScore=None,
            finalScoreSource=None, finalScoreScaleMax=None, confidence=None,
            reviewRequired=False, eligible=False, rank=None,
            status='NO_ATTEMPT' if attempt is None else 'IN_PROGRESS' if attempt.status == 'in_progress' else 'NO_ASSESSMENT')
        if job is None or attempt.status == 'in_progress' or job.student_id != student.user_id:
            result['unranked'].append(row); continue
        descriptor = cohort_scope(attempt, job)
        if descriptor is None:
            row['status'] = 'INVALID_SCOPE'; result['unranked'].append(row); continue
        projection = ranking_ai_projection(job, evaluations[job.id], transcripts[job.id])
        row.update(aiScore=projection.get('score'), aiRawScore=projection.get('rawScore'),
            confidence=projection.get('confidence'), status=projection['status'],
            reviewRequired=projection.get('reviewRequired', False), eligible=projection.get('eligible', False),
            evaluationId=projection.get('evaluationId'), provider=projection.get('provider'), model=projection.get('model'),
            practiceGrade=projection.get('practiceGrade'),
            teacherScore=job.teacher_score, finalScore=job.final_score, finalScoreSource=job.final_score_source,
            finalPracticeGrade=(job.final_result or {}).get('practiceGrade') if isinstance(job.final_result, dict) else None,
            finalScoreScaleMax=descriptor['rawMax'] if descriptor['isPartial'] else 75)
        cohort = cohorts.setdefault(descriptor['id'], dict(descriptor, rows=[]))
        cohort['rows'].append(row)
    result['cohorts'] = [dict(cohort, rows=ranked_rows(cohort['rows'])) for cohort in sorted(cohorts.values(), key=lambda item: item['id'])]
    return result
