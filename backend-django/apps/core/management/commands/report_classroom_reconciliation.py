"""Read-only counts and identifiers for administrators reconciling legacy classrooms."""
import json

from django.core.management.base import BaseCommand
from django.db.models import Exists, OuterRef

from apps.core.classroom_roster import active_enrollments
from apps.core.models import ClassroomEnrollment, Cohort, CohortMembership
from apps.legacy_schema.models import StudentProfile


class Command(BaseCommand):
    help = "Report unmatched legacy primary groups and standalone cohort memberships for review."

    def handle(self, *args, **options):
        matches = active_enrollments(student_id=OuterRef("user_id"), group_id=OuterRef("group_id"))
        mismatches = StudentProfile.objects.exclude(group_id=None).exclude(Exists(matches))
        linked = active_enrollments(student_id=OuterRef("student_id"), group_id=OuterRef("cohort__classroom_id"))
        cohort_mismatches = CohortMembership.objects.filter(status="active", cohort__classroom_id__isnull=False).exclude(Exists(linked))
        self.stdout.write(json.dumps({
            "legacyPrimaryGroupWithoutActiveEnrollment": list(mismatches.values("user_id", "group_id")),
            "linkedCohortWithoutActiveEnrollment": list(cohort_mismatches.values("student_id", "cohort_id")),
            "standaloneCohortIds": list(Cohort.objects.filter(classroom_id__isnull=True).values_list("id", flat=True)),
            "unknownEnrollmentStartCount": ClassroomEnrollment.objects.filter(started_at__isnull=True).count(),
        }, indent=2))
