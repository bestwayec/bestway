"""Django-owned classroom lifecycle and historical enrollment over Prisma Group IDs."""
from datetime import UTC

from django.db import transaction
from django.db.models import Exists, OuterRef
from django.utils import timezone

from apps.legacy_schema.models import AssessmentJob, AssessmentJobStatus, Attendance, StudentProfile, User

from . import groups
from .models import ClassroomArchive, ClassroomEnrollment, HomeworkSubmission


def assert_active(group_id):
    if ClassroomArchive.objects.filter(group_id=group_id).exists():
        groups.fail("GROUP_ARCHIVED", "Guruh arxivlangan", 409)


def current_teacher_attempts(attempts, actor):
    """Keep legacy current-roster access while excluding work before a dated transfer."""
    if actor.role != "teacher":
        return attempts
    newer_membership = ClassroomEnrollment.objects.filter(
        student_id=OuterRef("student_id"), group_id=OuterRef("student__group_id"),
        ended_at__isnull=True, started_at__gt=OuterRef("started_at"),
    )
    return attempts.filter(student__group__teacher_id=actor.id).exclude(Exists(newer_membership))


def assert_teacher_attempt_period(actor, student_id, started_at):
    if actor.role != "teacher" or started_at is None:
        return
    if timezone.is_naive(started_at):
        started_at = timezone.make_aware(started_at, UTC)
    group = StudentProfile.objects.filter(pk=student_id).values("group_id")
    if ClassroomEnrollment.objects.filter(
        student_id=student_id, group_id__in=group, ended_at__isnull=True, started_at__gt=started_at,
    ).exists():
        groups.fail("FORBIDDEN", "Bu urinish sizning o‘quv davringizga tegishli emas", 403)


def active_enrollments(**filters):
    return ClassroomEnrollment.objects.filter(ended_at__isnull=True, **filters)


def student_group_ids(student_id):
    return active_enrollments(student_id=student_id).values_list("group_id", flat=True)


def member_profiles(group_id):
    return StudentProfile.objects.filter(user_id__in=active_enrollments(group_id=group_id).values("student_id"))


def record_enrollment(student_id, old_group, new_group, *, source="staff"):
    """Open or close one period per group while holding the student's row lock."""
    if old_group == new_group:
        return
    now = timezone.now()
    if old_group:
        closed = active_enrollments(student_id=student_id, group_id=old_group).update(ended_at=now)
        if not closed:
            ClassroomEnrollment.objects.create(
                student_id=student_id, group_id=old_group, ended_at=now, source="legacy_profile",
            )
    if new_group:
        active_enrollments(student_id=student_id, group_id=new_group).get_or_create(
            student_id=student_id, group_id=new_group, defaults={"started_at": now, "source": source},
        )


def feedback_text(value):
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        for key in ("feedback", "overallFeedback", "summary"):
            text = value.get(key)
            if isinstance(text, str) and text.strip():
                return text
    return ""


@transaction.atomic
def archive(actor, group_id, archived):
    group = groups.get_group(group_id, lock=True)
    groups.assert_manages_group(actor, group)
    if archived:
        ClassroomArchive.objects.get_or_create(group_id=group_id)
    else:
        ClassroomArchive.objects.filter(group_id=group_id).delete()
    return {"archived": archived}


def archive_status(actor, group_id):
    group = groups.get_group(group_id)
    groups.assert_manages_group(actor, group)
    return {"archived": ClassroomArchive.objects.filter(group_id=group_id).exists()}


@transaction.atomic
def bulk_membership(actor, group_id, student_ids, action):
    group = groups.get_group(group_id, lock=True)
    groups.assert_manages_group(actor, group)
    assert_active(group_id)
    operation = groups.add_student if action == "add" else groups.remove_student
    # A stable lock order across overlapping bulk writes avoids circular waits.
    for student_id in sorted(student_ids):
        operation(actor, group_id, student_id)
    return {"updated": len(student_ids)}


def history(actor, group_id, student_id):
    group = groups.get_group(group_id)
    groups.assert_manages_group(actor, group)
    intervals = list(ClassroomEnrollment.objects.filter(student_id=student_id, group_id=group_id).order_by("-ended_at")[:100])
    is_member = any(row.ended_at is None for row in intervals)
    if not intervals and not is_member:
        groups.fail("STUDENT_NOT_IN_GROUP", "O‘quvchi bu guruhga tegishli emas", 404)

    from .teacher_analytics import classroom_attempts

    mocks = list(classroom_attempts(group_id).filter(student_id=student_id, status="completed")
                 .order_by("-started_at").values("id", "exam__title", "started_at", "overall_band", "overall_score")[:50])
    feedback = AssessmentJob.objects.filter(
        attempt_id__in=[row["id"] for row in mocks], skill__in=["writing", "speaking"], status=AssessmentJobStatus.SUCCEEDED,
    ).exclude(approved_feedback=None).order_by("-completed_at").values(
        "attempt_id", "skill", "approved_feedback", "final_score",
    )[:100]

    return {
        "studentId": student_id,
        "name": User.objects.filter(id=student_id).values_list("name", flat=True).first(),
        "groupId": group.id,
        "groupName": group.name,
        "currentlyEnrolled": is_member,
        "membership": [{"startedAt": row.started_at, "endedAt": row.ended_at, "source": row.source} for row in intervals],
        "attendance": list(Attendance.objects.filter(group_id=group_id, student_id=student_id)
                           .order_by("-date").values("date", "state")[:100]),
        "homework": list(HomeworkSubmission.objects.filter(
            student_id=student_id, assignment__cohort__classroom_id=group_id,
        ).order_by("-completed_at").values(
            "assignment_id", "assignment__title", "assignment__vocabulary_set_id",
            "status", "score_percent", "is_passed", "completed_at",
        )[:100]),
        "mockExams": mocks,
        "tests": [],
        "feedback": [{**row, "feedback_text": feedback_text(row["approved_feedback"])} for row in feedback],
    }


def member_history(actor, group_id, search, page):
    group = groups.get_group(group_id)
    groups.assert_manages_group(actor, group)
    periods = ClassroomEnrollment.objects.filter(group_id=group_id).values("student_id")
    current = active_enrollments(group_id=group_id)
    rows = User.objects.filter(id__in=periods, name__icontains=search)
    page_size = 25
    offset = (page - 1) * page_size
    members = list(rows.order_by("name", "id").values("id", "name")[offset:offset + page_size + 1])
    current_ids = set(current.filter(student_id__in=[m["id"] for m in members]).values_list("student_id", flat=True))
    return {
        "members": [{**member, "currentlyEnrolled": member["id"] in current_ids} for member in members[:page_size]],
        "page": page,
        "hasNext": len(members) > page_size,
    }
