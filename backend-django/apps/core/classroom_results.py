"""Scope classroom results to explicit assignment, supervision and sharing evidence."""
from django.db import connection
from django.db.models import Exists, OuterRef, Q
from django.db.models.fields.json import KeyTextTransform

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


def answer_disclosure_status(actor, attempt, *, is_review_blocked=False):
    """Server-authoritative answer key disclosure policy across APIs, review views, and exports."""
    from apps.legacy_schema.models import MockAttempt
    from .classroom_roster import active_enrollments
    from .models import CohortMembership, HomeworkAssignment

    if getattr(actor, "role", None) in ("admin", "super_admin"):
        return {"disclosed": True, "reason": "STAFF", "discloseAt": None}
    if getattr(actor, "role", None) == "teacher":
        if explicit_teacher_access(actor, attempt):
            return {"disclosed": True, "reason": "STAFF", "discloseAt": None}
        return {"disclosed": False, "reason": "FORBIDDEN", "discloseAt": None}

    if attempt.status != "completed":
        return {"disclosed": False, "reason": "ATTEMPT_IN_PROGRESS", "discloseAt": None}
    if is_review_blocked:
        return {"disclosed": False, "reason": "ACTIVE_ATTEMPT_BLOCKED", "discloseAt": None}

    assignment_id = (attempt.media_state or {}).get(ASSIGNMENT_KEY)
    if not assignment_id:
        assignment_id = (
            HomeworkSubmission.objects.filter(attempt_id=attempt.id, student_id=attempt.student_id, source="exam_attempt")
            .values_list("assignment_id", flat=True)
            .first()
        )
    if not assignment_id:
        return {"disclosed": True, "reason": "PRACTICE_OR_SOLO", "discloseAt": None}

    assignment = HomeworkAssignment.objects.select_related("cohort").filter(pk=assignment_id).first()
    if assignment is None:
        return {"disclosed": True, "reason": "ASSIGNMENT_REMOVED", "discloseAt": None}

    from django.utils import timezone as dj_timezone

    now = dj_timezone.now()
    if assignment.deadline and now >= assignment.deadline:
        return {"disclosed": True, "reason": "DEADLINE_PASSED", "discloseAt": assignment.deadline}

    # Before deadline: unlock early ONLY if all active eligible participants have submitted
    # and no active retake / in-progress attempt exists on this assignment.
    if assignment.cohort.classroom_id:
        eligible_ids = set(active_enrollments(group_id=assignment.cohort.classroom_id).values_list("student_id", flat=True))
    else:
        eligible_ids = set(
            CohortMembership.objects.filter(cohort_id=assignment.cohort_id, status="active")
            .values_list("student_id", flat=True)
        )

    submitted_ids = set(
        HomeworkSubmission.objects.filter(assignment_id=assignment.id).values_list("student_id", flat=True)
    )
    assigned_attempts = MockAttempt.objects.alias(
        assignment_for_report=KeyTextTransform(ASSIGNMENT_KEY, "media_state"),
    ).filter(exam_id=attempt.exam_id, assignment_for_report=assignment.id)
    submitted_ids.update(
        assigned_attempts.filter(status__in=("grading", "completed")).values_list("student_id", flat=True)
    )
    has_in_progress = assigned_attempts.filter(status="in_progress").exists()

    if eligible_ids and eligible_ids.issubset(submitted_ids) and not has_in_progress:
        return {"disclosed": True, "reason": "ALL_PARTICIPANTS_SUBMITTED", "discloseAt": assignment.deadline}

    return {
        "disclosed": False,
        "reason": "AWAITING_COHORT_OR_DEADLINE",
        "discloseAt": assignment.deadline,
    }
