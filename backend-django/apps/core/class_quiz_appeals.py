"""Answer appeals and audited grading corrections for classroom quizzes.

A student may ask for ONE wrong free-text answer of a submitted attempt to be accepted. Only an authorised teacher of
the group (or an admin) decides. Approval never edits the issued snapshot: it adds an accepted answer for that
assignment + question and re-grades only the affected stored answers, bumping `result_version` and writing an
append-only ClassQuizCorrection row for each changed attempt. Rejection changes nothing but the appeal.
"""
from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from apps.legacy_schema.models import Group

from . import class_quiz as cq
from .models import (ClassQuizAcceptedAnswer, ClassQuizAnswer, ClassQuizAppeal, ClassQuizAssignment, ClassQuizAttempt,
                     ClassQuizCorrection)

MAX_NOTE = 500


def accepted_extra(assignment_id, question_id) -> list[str]:
    return list(ClassQuizAcceptedAnswer.objects.filter(assignment_id=assignment_id, question_id=question_id).values_list('text', flat=True))


def _question(snapshot, question_id):
    return next((q for q in snapshot['questions'] if q['id'] == question_id), None)


def file_appeal(actor, attempt_id, question_index) -> tuple[ClassQuizAppeal, bool]:
    """Student files an appeal for the wrong text answer at snapshot position `question_index`. Idempotent."""
    attempt = cq._own_attempt(actor, attempt_id)
    if attempt.status != 'submitted':
        cq.fail('RESULT_NOT_READY', 'Natija test yakunlangach ochiladi', 409)
    questions = attempt.assignment.snapshot['questions']
    if not isinstance(question_index, int) or not 0 <= question_index < len(questions):
        cq.fail('QUESTION_NOT_FOUND', 'Savol topilmadi', 404)
    question = questions[question_index]
    answer = attempt.answers.filter(question_id=question['id']).first()
    if question['type'] != 'text' or answer is None or answer.is_correct or not answer.response.strip():
        cq.fail('NOTHING_TO_APPEAL', "Bu javob uchun e'tiroz bildirib bo'lmaydi", 409)
    appeal, created = ClassQuizAppeal.objects.get_or_create(
        attempt=attempt, question_id=question['id'], defaults={'student_id': actor.id, 'response': answer.response[:2000]})
    if created:
        cq._notify('new_appeal', appeal.id)
    return appeal, created


def _manages(actor, assignment: ClassQuizAssignment) -> bool:
    if actor.role in ('admin', 'super_admin'):
        return True
    group = Group.objects.filter(id=assignment.group_id).first()
    return actor.role == 'teacher' and group is not None and group.teacher_id == actor.id


def _staff(actor):
    if getattr(actor, 'role', None) not in cq.STAFF:
        cq.fail('FORBIDDEN', "Bu amal uchun ruxsat yo'q", 403)


def _view(appeal: ClassQuizAppeal) -> dict:
    snapshot = appeal.attempt.assignment.snapshot
    question = _question(snapshot, appeal.question_id) or {}
    return dict(id=appeal.id, attemptId=appeal.attempt_id, assignmentId=appeal.attempt.assignment_id, quizTitle=snapshot['title'],
                prompt=question.get('prompt', ''), correctAnswers=question.get('correctAnswers', []), response=appeal.response,
                status=appeal.status, studentId=appeal.student_id, createdAt=appeal.created_at, note=appeal.note)


def pending_appeals(actor, limit=20) -> list[dict]:
    """Pending appeals of the actor's OWN groups only (admins: all)."""
    _staff(actor)
    rows = (ClassQuizAppeal.objects.select_related('attempt__assignment').filter(status='pending').order_by('created_at'))
    return [_view(a) for a in rows[:500] if _manages(actor, a.attempt.assignment)][:limit]


def get_appeal(actor, appeal_id) -> dict:
    _staff(actor)
    appeal = ClassQuizAppeal.objects.select_related('attempt__assignment').filter(id=appeal_id).first()
    if appeal is None or not _manages(actor, appeal.attempt.assignment):
        cq.fail('APPEAL_NOT_FOUND', 'Murojaat topilmadi', 404)   # no existence leak across teachers
    return _view(appeal)


def decide(actor, appeal_id, approve: bool, note: str = '') -> dict:
    """Approve or reject (idempotent: a decided appeal is returned unchanged). Returns the appeal view + changed attempts."""
    _staff(actor)
    note = (note or '')[:MAX_NOTE]
    with transaction.atomic():
        appeal = (ClassQuizAppeal.objects.select_for_update(of=('self',)).select_related('attempt__assignment')
                  .filter(id=appeal_id).first())
        if appeal is None or not _manages(actor, appeal.attempt.assignment):
            cq.fail('APPEAL_NOT_FOUND', 'Murojaat topilmadi', 404)
        if appeal.status != 'pending':
            return dict(_view(appeal), changedAttempts=[])
        now = timezone.now()
        appeal.status = 'approved' if approve else 'rejected'
        appeal.decided_by_id, appeal.decided_at, appeal.note = actor.id, now, note
        appeal.save(update_fields=['status', 'decided_by_id', 'decided_at', 'note'])
        changed = []
        if approve:
            assignment = appeal.attempt.assignment
            ClassQuizAcceptedAnswer.objects.create(assignment=assignment, question_id=appeal.question_id, text=appeal.response[:500],
                                                   approved_by_id=actor.id, appeal=appeal)
            changed = _regrade_assignment_question(assignment, appeal, actor, note)
            # identical pending appeals of other students are covered by the same decision
            for other in (ClassQuizAppeal.objects.select_for_update(of=('self',)).select_related('attempt')
                          .filter(attempt__assignment=assignment, question_id=appeal.question_id, status='pending').exclude(pk=appeal.pk)):
                question = _question(assignment.snapshot, other.question_id)
                if question and cq.grade_response(question, other.response, extra=accepted_extra(assignment.id, other.question_id))[0]:
                    other.status, other.decided_by_id, other.decided_at, other.note = 'approved', actor.id, now, 'covered by an approved appeal'
                    other.save(update_fields=['status', 'decided_by_id', 'decided_at', 'note'])
        cq._audit(actor, 'class_quiz.appeal.' + appeal.status, 'classQuizAppeal', appeal.id, new=dict(status=appeal.status, changedAttempts=len(changed), note=note))
        transaction.on_commit(lambda: cq._notify('appeal_decided', appeal.id, tuple(changed)))
        return dict(_view(appeal), changedAttempts=changed)


def _regrade_assignment_question(assignment, appeal, actor, reason):
    question = _question(assignment.snapshot, appeal.question_id)
    extra = accepted_extra(assignment.id, appeal.question_id)
    changed = []
    answers = (ClassQuizAnswer.objects.select_for_update(of=('self',)).select_related('attempt')
               .filter(attempt__assignment=assignment, attempt__status='submitted', question_id=appeal.question_id, is_correct=False))
    for answer in answers:
        ok, points = cq.grade_response(question, answer.response, extra=extra)
        if not ok:
            continue
        attempt = ClassQuizAttempt.objects.select_for_update().get(pk=answer.attempt_id)
        old_correct, old_percent = attempt.correct_count, attempt.percent
        answer.is_correct, answer.points = True, points
        answer.save(update_fields=['is_correct', 'points'])
        attempt.correct_count = (attempt.correct_count or 0) + 1
        attempt.score = (attempt.score or 0.0) + points
        attempt.percent = round(attempt.score / attempt.max_score * 100, 1) if attempt.max_score else 0.0
        attempt.result_version += 1
        attempt.save(update_fields=['correct_count', 'score', 'percent', 'result_version'])
        ClassQuizCorrection.objects.create(
            attempt=attempt, question_id=appeal.question_id, appeal=appeal, old_correct_count=old_correct, new_correct_count=attempt.correct_count,
            old_percent=old_percent, new_percent=attempt.percent, result_version_after=attempt.result_version,
            decided_by_id=actor.id, reason=reason[:500])
        changed.append(dict(attemptId=attempt.id, studentId=attempt.student_id, oldPercent=old_percent, newPercent=attempt.percent))
    return changed


def corrections_for_attempt(actor, attempt_id) -> list[dict]:
    """Audit trail of one attempt: its student, or the managing teacher/admin."""
    attempt = ClassQuizAttempt.objects.select_related('assignment').filter(id=attempt_id).first()
    if attempt is None:
        cq.fail('ATTEMPT_NOT_FOUND', 'Urinish topilmadi', 404)
    if not (attempt.student_id == actor.id or (actor.role in cq.STAFF and _manages(actor, attempt.assignment))):
        cq.fail('ATTEMPT_NOT_FOUND', 'Urinish topilmadi', 404)
    return [dict(questionId=c.question_id, oldPercent=c.old_percent, newPercent=c.new_percent, versionAfter=c.result_version_after,
                 decidedBy=c.decided_by_id, reason=c.reason, at=c.created_at)
            for c in attempt.corrections.order_by('id')]
