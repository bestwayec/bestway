"""Scope classroom results to explicit assignment, supervision and sharing evidence."""
from django.db import connection
from django.db.models import Exists, OuterRef, Q
from django.db.models.fields.json import KeyTextTransform
from django.db.models.functions import Coalesce
from django.utils import timezone

from .homework_scoring import ASSIGNMENT_KEY
from .models import HomeworkAssignment, HomeworkSubmission, PracticeResultShare


def assignment_attempts(attempts, *, group_id=None, teacher_id=None, include_practice_shares=False, linked_classrooms_only=False):
    assignments = HomeworkAssignment.objects.all()
    if linked_classrooms_only:
        assignments = assignments.filter(cohort__classroom_id__isnull=False)
    if group_id is not None:
        assignments = assignments.filter(cohort__classroom_id=group_id)
    if teacher_id is not None:
        assignments = assignments.filter(
            Q(cohort__classroom__teacher_id=teacher_id)
            | Q(cohort__classroom_id__isnull=True, cohort__teacher_id=teacher_id)
        )
    launch = assignments.filter(exam_id=OuterRef("exam_id"), id=OuterRef("assignment_for_report"))
    submission = HomeworkSubmission.objects.filter(
        assignment_id__in=assignments.values("id"), student_id=OuterRef("student_id"),
        attempt_id=OuterRef("id"), source="exam_attempt",
    )
    submission = submission.filter(assignment__exam_id=OuterRef("exam_id"))
    allowed = Exists(launch) | Exists(submission)
    if include_practice_shares:
        from .classroom_roster import active_enrollments
        from .models import ClassroomArchive

        shared = PracticeResultShare.objects.filter(attempt_id=OuterRef("pk"), teacher_id=teacher_id)
        in_roster = active_enrollments(
            student_id=OuterRef("student_id"), group__teacher_id=teacher_id,
        ).exclude(group_id__in=ClassroomArchive.objects.values("group_id"))
        allowed = allowed | (Exists(shared) & Exists(in_roster))
    return attempts.alias(assignment_for_report=KeyTextTransform(ASSIGNMENT_KEY, "media_state")).filter(allowed)


def supervises_attempt(teacher_id, attempt):
    # The live-exam service initializes these legacy tables on first use.
    with connection.cursor() as cursor:
        cursor.execute("SELECT to_regclass(%s) IS NOT NULL", ['"LiveExamParticipant"'])
        if not cursor.fetchone()[0]:
            return False
        cursor.execute(
            '''SELECT 1 FROM "LiveExamParticipant" p JOIN "LiveExamSession" s ON s.id = p.session_id
               WHERE p.attempt_id = %s AND p.student_id = %s AND s.teacher_id = %s AND s.exam_id = %s''',
            [attempt.id, attempt.student_id, teacher_id, attempt.exam_id],
        )
        return cursor.fetchone() is not None


def explicit_teacher_access(actor, attempt, *, grade=False):
    from apps.legacy_schema.models import MockAttempt

    if assignment_attempts(MockAttempt.objects.filter(pk=attempt.id), teacher_id=actor.id).exists():
        return True
    if supervises_attempt(actor.id, attempt):
        return True
    return (
        not grade
        and PracticeResultShare.objects.filter(attempt_id=attempt.id, teacher_id=actor.id).exists()
        and shareable_teachers(attempt).filter(pk=actor.id).exists()
    )


def shareable_teachers(attempt):
    from apps.legacy_schema.models import Group, User
    from .classroom_roster import student_group_ids
    from .models import ClassroomArchive

    groups = Group.objects.filter(id__in=student_group_ids(attempt.student_id)).exclude(
        id__in=ClassroomArchive.objects.values("group_id"),
    )
    return User.objects.filter(role="teacher", is_active=True, id__in=groups.values("teacher_id"))


def assert_attempt_access(actor, attempt, *, grade=False):
    from .mock_attempts import assert_view, fail

    if actor.role != "teacher":
        assert_view(actor, attempt.student_id)
    elif not explicit_teacher_access(actor, attempt, grade=grade):
        fail("FORBIDDEN", "Bu natijani ko‘rish huquqingiz yo‘q", 403)


def is_personal_practice(attempt):
    return (
        attempt.status == "completed"
        and attempt.mode == "practice"
        and ASSIGNMENT_KEY not in (attempt.media_state or {})
        and not HomeworkSubmission.objects.filter(attempt_id=attempt.id, student_id=attempt.student_id).exists()
    )


def _linked_assignments(attempt):
    submission_ids = HomeworkSubmission.objects.filter(
        attempt_id=attempt.id, student_id=attempt.student_id, source="exam_attempt",
    ).values("assignment_id")
    assignments = HomeworkAssignment.objects.filter(exam_id=attempt.exam_id)
    marker = (attempt.media_state or {}).get(ASSIGNMENT_KEY)
    if marker is not None:
        return assignments.filter(pk=marker)
    return assignments.filter(pk__in=submission_ids)


def _active_attempts(attempts, now):
    return attempts.filter(status="in_progress").alias(
        ends_at=Coalesce("overall_deadline_at", "deadline_at"),
    ).filter(Q(ends_at__isnull=True) | Q(ends_at__gt=now))


def _assignment_answer_window(assignment, now):
    from apps.legacy_schema.models import MockAttempt

    exam_attempts = MockAttempt.objects.filter(exam_id=assignment.exam_id)
    assigned = exam_attempts.filter(
        Q(media_state__contains={ASSIGNMENT_KEY: assignment.id})
        | Q(id__in=HomeworkSubmission.objects.filter(
            assignment=assignment, source="exam_attempt",
        ).values("attempt_id")),
    )
    participants = assignment.participant_ids
    # Keep timed opportunities open even when the published deadline has passed.
    timed = exam_attempts.filter(mode="timed")
    if participants is not None:
        timed = timed.filter(student_id__in=participants)
    if _active_attempts(assigned | timed, now).exists():
        return "ACTIVE_ATTEMPT_BLOCKED"
    if assignment.deadline <= now:
        return None
    # A legacy roster cannot reliably establish who still has a right to start.
    if not participants:
        return "AWAITING_COHORT_OR_DEADLINE"
    submitted = assigned.filter(
        status="completed", submitted_at__isnull=False,
    ).values_list("student_id", flat=True)
    if set(participants).issubset(submitted):
        return None
    return "AWAITING_COHORT_OR_DEADLINE"


def practice_answers_available(attempt, *, now=None):
    """An overlapping exam assignment reserves this exam's keys for its participant."""
    from .classrooms import student_homework_scope

    if ASSIGNMENT_KEY in (attempt.media_state or {}):
        return False
    if _linked_assignments(attempt).exists():
        return False
    assignments = HomeworkAssignment.objects.filter(
        student_homework_scope(attempt.student_id), exam_id=attempt.exam_id,
    )
    # A snapshot remains relevant after a participant changes groups.
    assignments = HomeworkAssignment.objects.filter(exam_id=attempt.exam_id).filter(
        Q(participant_ids__contains=[attempt.student_id])
        | Q(participant_ids__isnull=True, pk__in=assignments.values("pk")),
    )
    now = now or timezone.now()
    return all(_assignment_answer_window(assignment, now) is None for assignment in assignments)


def answer_disclosure_status(actor, attempt):
    """Use the same release decision for answer keys, evidence, and audio review."""
    from .mock_attempts import review_blocked

    def decision(disclosed, reason, date=None):
        return {"disclosed": disclosed, "reason": reason, "discloseAt": date}

    if getattr(actor, "role", None) in ("admin", "super_admin"):
        return decision(True, "STAFF")
    if getattr(actor, "role", None) == "teacher":
        return decision(True, "STAFF") if explicit_teacher_access(actor, attempt) else decision(False, "FORBIDDEN")
    if attempt.status != "completed":
        return decision(False, "ATTEMPT_IN_PROGRESS")
    if review_blocked(attempt):
        return decision(False, "ACTIVE_ATTEMPT_BLOCKED")

    marker = (attempt.media_state or {}).get(ASSIGNMENT_KEY)
    assignments = list(_linked_assignments(attempt))
    if not assignments:
        if marker is not None or HomeworkSubmission.objects.filter(
            attempt_id=attempt.id, student_id=attempt.student_id, source="exam_attempt",
        ).exists():
            return decision(False, "ASSIGNMENT_UNAVAILABLE")
        if not practice_answers_available(attempt):
            return decision(False, "AWAITING_COHORT_OR_DEADLINE")
        return decision(True, "PRACTICE_OR_SOLO")

    now = timezone.now()
    date = max(assignment.deadline for assignment in assignments)
    for assignment in assignments:
        reason = _assignment_answer_window(assignment, now)
        if reason:
            return decision(False, reason, date)
    return decision(True, "DEADLINE_PASSED" if date <= now else "ALL_PARTICIPANTS_SUBMITTED", date)
