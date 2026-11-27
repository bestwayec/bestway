"""Access rules for homework attached to the authoritative Group roster."""
from uuid import uuid4

from django.db.models import Q

from common.api.exceptions import ContractAPIException

from . import groups
from .classroom_roster import active_enrollments, assert_active, student_group_ids
from .models import Cohort, CohortMembership


def homework_cohort(actor, group_id, *, create=False):
    group = groups.get_group(group_id, lock=create)
    groups.assert_manages_group(actor, group)
    if not create:
        return Cohort.objects.filter(classroom_id=group_id).first()
    assert_active(group_id)
    if not group.teacher_id:
        raise ContractAPIException("CLASSROOM_TEACHER_REQUIRED", "Avval o‘qituvchi biriktiring", 400)
    cohort, _ = Cohort.objects.get_or_create(
        classroom_id=group_id,
        defaults={"teacher_id": group.teacher_id, "name": group.name[:255], "invite_code": uuid4().hex[:16]},
    )
    return cohort


def is_linked(cohort):
    return isinstance(getattr(cohort, "classroom_id", None), str)


def teacher_id(cohort):
    return cohort.classroom.teacher_id if is_linked(cohort) else cohort.teacher_id


def teacher(cohort):
    return cohort.classroom.teacher if is_linked(cohort) else cohort.teacher


def name(cohort):
    return cohort.classroom.name if is_linked(cohort) else cohort.name


def is_member(cohort, student_id):
    if is_linked(cohort):
        return active_enrollments(group_id=cohort.classroom_id, student_id=student_id).exists()
    return CohortMembership.objects.filter(cohort=cohort, student_id=student_id, status="active").exists()


def student_homework_scope(student_id):
    classroom_ids = student_group_ids(student_id)
    inherited_ids = CohortMembership.objects.filter(student_id=student_id, status="active").values("cohort_id")
    return Q(cohort__classroom_id__in=classroom_ids) | Q(cohort__classroom_id__isnull=True, cohort_id__in=inherited_ids)
