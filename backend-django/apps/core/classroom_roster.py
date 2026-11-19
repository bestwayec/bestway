"""Django-owned classroom lifecycle and historical enrollment over Prisma Group IDs."""
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.legacy_schema.models import AssessmentJob, Attendance, MockAttempt, StudentProfile, TestAttempt, User

from . import groups
from .models import ClassroomArchive, ClassroomEnrollment, HomeworkSubmission


def assert_active(group_id):
    if ClassroomArchive.objects.filter(group_id=group_id).exists():
        groups.fail("GROUP_ARCHIVED", "Guruh arxivlangan", 409)


def record_enrollment(student_id, old_group, new_group):
    """The caller holds the StudentProfile row lock during the membership change."""
    if old_group == new_group:
        return
    now = timezone.now()
    open_enrollment = ClassroomEnrollment.objects.filter(student_id=student_id, ended_at__isnull=True)
    tracked = open_enrollment.first()
    open_enrollment.update(ended_at=now)
    if old_group and (tracked is None or tracked.group_id != old_group):
        # A legacy membership's true start is unknown. Only explicitly scoped records
        # may be disclosed for this period.
        ClassroomEnrollment.objects.create(student_id=student_id, group_id=old_group, ended_at=now)
    if new_group:
        ClassroomEnrollment.objects.create(student_id=student_id, group_id=new_group, started_at=now)


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
    is_member = StudentProfile.objects.filter(user_id=student_id, group_id=group_id).exists()
    if not intervals and not is_member:
        groups.fail("STUDENT_NOT_IN_GROUP", "O‘quvchi bu guruhga tegishli emas", 404)

    # When prior enrollment start is unknown, expose only records with a group FK.
    in_group = Q(pk__in=[])
    for period in intervals:
        if period.started_at is None or (period.ended_at is None and not is_member):
            continue
        window = Q(started_at__gte=period.started_at)
        if period.ended_at is not None:
            window &= Q(started_at__lt=period.ended_at)
        in_group |= window
    mocks = list(MockAttempt.objects.filter(in_group, student_id=student_id, status="completed")
                 .order_by("-started_at").values("id", "exam__title", "started_at", "overall_band", "overall_score")[:50])
    tests = list(TestAttempt.objects.filter(in_group, student_id=student_id, status="completed")
                 .order_by("-started_at").values("id", "test__title", "started_at", "total_score")[:50])
    feedback = AssessmentJob.objects.filter(
        attempt_id__in=[row["id"] for row in mocks], skill__in=["writing", "speaking"], status="approved",
    ).exclude(approved_feedback=None).order_by("-completed_at").values(
        "attempt_id", "skill", "approved_feedback", "final_score",
    )[:100]

    return {
        "studentId": student_id,
        "name": User.objects.filter(id=student_id).values_list("name", flat=True).first(),
        "groupId": group.id,
        "groupName": group.name,
        "currentlyEnrolled": is_member,
        "membership": [{"startedAt": row.started_at, "endedAt": row.ended_at} for row in intervals],
        "attendance": list(Attendance.objects.filter(group_id=group_id, student_id=student_id)
                           .order_by("-date").values("date", "state")[:100]),
        "homework": list(HomeworkSubmission.objects.filter(
            student_id=student_id, assignment__cohort__classroom_id=group_id,
        ).order_by("-completed_at").values(
            "assignment_id", "assignment__title", "assignment__vocabulary_set_id",
            "status", "score_percent", "is_passed", "completed_at",
        )[:100]),
        "mockExams": mocks,
        "tests": tests,
        "feedback": list(feedback),
    }


def member_history(actor, group_id, search, page):
    group = groups.get_group(group_id)
    groups.assert_manages_group(actor, group)
    periods = ClassroomEnrollment.objects.filter(group_id=group_id).values("student_id")
    current = StudentProfile.objects.filter(group_id=group_id).values("user_id")
    rows = User.objects.filter(Q(id__in=periods) | Q(id__in=current), name__icontains=search)
    page_size = 25
    offset = (page - 1) * page_size
    members = list(rows.order_by("name", "id").values("id", "name")[offset:offset + page_size + 1])
    current_ids = set(StudentProfile.objects.filter(group_id=group_id, user_id__in=[m["id"] for m in members])
                      .values_list("user_id", flat=True))
    return {
        "members": [{**member, "currentlyEnrolled": member["id"] in current_ids} for member in members[:page_size]],
        "page": page,
        "hasNext": len(members) > page_size,
    }
