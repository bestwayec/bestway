from django.db import transaction
from rest_framework.decorators import api_view, permission_classes

from apps.legacy_schema.models import MockAttempt
from common.auth.permissions import roles

from .classroom_results import is_personal_practice, shareable_teachers
from .domain_contracts import invalid, payload
from .mock_attempt_views import success
from .mock_attempts import fail
from .models import PracticeResultShare


@api_view(["GET", "PUT"])
@permission_classes([roles("student")])
@transaction.atomic
def shares(request, attempt_id):
    attempts = MockAttempt.objects.filter(id=attempt_id, student_id=request.user.id, status="completed", mode="practice")
    if request.method == "PUT":
        attempts = attempts.select_for_update()
    attempt = attempts.first()
    if not attempt or not is_personal_practice(attempt):
        fail("PRACTICE_RESULT_NOT_FOUND", "Shaxsiy mashq natijasi topilmadi", 404)
    teachers = shareable_teachers(attempt)
    grants = PracticeResultShare.objects.filter(attempt_id=attempt.id)
    if request.method == "PUT":
        data = payload(request, {"teacherId", "shared"})
        teacher_id, shared = data.get("teacherId"), data.get("shared")
        if not isinstance(teacher_id, str) or not 1 <= len(teacher_id) <= 255 or type(shared) is not bool:
            invalid("teacherId and shared are required")
        if shared:
            if not teachers.filter(id=teacher_id).exists():
                fail("TEACHER_NOT_AVAILABLE", "O‘qituvchi tanlab bo‘lmaydi", 403)
            grants.get_or_create(attempt_id=attempt.id, teacher_id=teacher_id)
        else:
            grants.filter(teacher_id=teacher_id).delete()
    current = set(grants.values_list("teacher_id", flat=True))
    return success({
        "teachers": [
            {**teacher, "shared": teacher["id"] in current}
            for teacher in teachers.order_by("name", "id").values("id", "name")
        ],
        "inactiveShares": list(grants.exclude(teacher_id__in=teachers.values("id")).values_list("teacher_id", flat=True)),
    })
