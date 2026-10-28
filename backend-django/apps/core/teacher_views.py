"""Teacher workspace: Cohorts, assignments, and student monitoring views."""
from __future__ import annotations

import random
import string
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from common.api.exceptions import ContractAPIException
from apps.core.models import (
    Cohort,
    CohortMembership,
    HomeworkAssignment,
    HomeworkSubmission,
    Lesson,
    UserLessonProgress,
)
from apps.legacy_schema.models import MockExam, User


def success(data: object, status: int = 200) -> Response:
    return Response({"success": True, "data": data}, status=status)


def require_authenticated(request) -> None:
    if not getattr(request.user, "is_authenticated", False):
        raise ContractAPIException("UNAUTHORIZED", "Avval tizimga kiring", 401)


def require_role(request, *roles) -> None:
    role = getattr(request.user, "role", None)
    if role not in roles:
        raise ContractAPIException("FORBIDDEN", "Bu amal uchun rolingiz yetarli emas", 403)


def generate_cohort_invite_code() -> str:
    """Generate a 6-character unique invite code like BW-7892 or BW9421."""
    for _ in range(50):
        digits = "".join(random.choices(string.digits, k=4))
        code = f"BW-{digits}"
        if not Cohort.objects.filter(invite_code=code).exists():
            return code
    chars = "".join(random.choices(string.ascii_uppercase + string.digits, k=4))
    return f"BW-{chars}"


@api_view(["GET", "POST"])
def teacher_cohorts_view(request):
    """
    GET /api/v1/teacher/cohorts - List cohorts for teacher or all if admin
    POST /api/v1/teacher/cohorts - Create a new cohort with unique invite code
    """
    require_authenticated(request)
    require_role(request, "teacher", "instructor", "admin", "super_admin")

    user_role = getattr(request.user, "role", "teacher")

    if request.method == "GET":
        if user_role in ("admin", "super_admin"):
            qs = Cohort.objects.all().select_related("teacher")
        else:
            qs = Cohort.objects.filter(teacher=request.user).select_related("teacher")

        cohorts_list = []
        for cohort in qs:
            active_students = cohort.memberships.filter(status="active").count()
            assignment_count = cohort.assignments.count()
            cohorts_list.append({
                "id": cohort.id,
                "name": cohort.name,
                "description": cohort.description,
                "invite_code": cohort.invite_code,
                "teacher_id": str(cohort.teacher_id),
                "teacher_name": getattr(cohort.teacher, "name", "O'qituvchi") if cohort.teacher else "",
                "student_count": active_students,
                "assignment_count": assignment_count,
                "created_at": cohort.created_at.isoformat() if cohort.created_at else "",
            })
        return success(cohorts_list)

    # POST
    data = request.data or {}
    name = (data.get("name") or "").strip()
    if not name:
        raise ContractAPIException("VALIDATION_ERROR", "Guruh nomi kiritilishi shart", 400)

    description = (data.get("description") or "").strip()
    invite_code = (data.get("invite_code") or "").strip().upper()
    if not invite_code:
        invite_code = generate_cohort_invite_code()
    else:
        if Cohort.objects.filter(invite_code__iexact=invite_code).exists():
            raise ContractAPIException("DUPLICATE_CODE", "Ushbu taklif kodi allaqachon mavjud", 400)

    cohort = Cohort.objects.create(
        teacher=request.user,
        name=name,
        description=description,
        invite_code=invite_code,
    )

    return success({
        "id": cohort.id,
        "name": cohort.name,
        "description": cohort.description,
        "invite_code": cohort.invite_code,
        "teacher_id": str(cohort.teacher_id),
        "teacher_name": getattr(cohort.teacher, "name", ""),
        "student_count": 0,
        "assignment_count": 0,
        "created_at": cohort.created_at.isoformat() if cohort.created_at else "",
    }, 201)


@api_view(["GET"])
def cohort_analytics_view(request, cohort_id: str):
    """
    GET /api/v1/teacher/cohorts/<id>/analytics
    Returns full progress matrix of students and assignments in this cohort.
    """
    require_authenticated(request)
    require_role(request, "teacher", "instructor", "admin", "super_admin")

    try:
        cohort = Cohort.objects.select_related("teacher").get(id=cohort_id)
    except Cohort.DoesNotExist:
        raise ContractAPIException("NOT_FOUND", "Guruh topilmadi", 404)

    user_role = getattr(request.user, "role", "teacher")
    if user_role == "teacher" and str(cohort.teacher_id) != str(request.user.id):
        raise ContractAPIException("FORBIDDEN", "Siz faqat o'zingizning guruhingizni ko'ra olasiz", 403)

    assignments_qs = cohort.assignments.select_related("lesson", "exam").order_by("created_at")
    assignments = []
    assignment_ids = []
    for a in assignments_qs:
        assignment_ids.append(a.id)
        assignments.append({
            "id": a.id,
            "title": a.title,
            "lesson_id": a.lesson_id,
            "lesson_title": a.lesson.title if a.lesson else None,
            "exam_id": a.exam_id,
            "exam_title": a.exam.title if a.exam else None,
            "deadline": a.deadline.isoformat() if a.deadline else "",
            "min_pass_percent": a.min_pass_percent,
        })

    memberships = cohort.memberships.filter(status="active").select_related("student").order_by("joined_at")
    students_data = []

    now = timezone.now()
    for m in memberships:
        student = m.student
        if not student:
            continue

        subs = HomeworkSubmission.objects.filter(student=student, assignment_id__in=assignment_ids)
        subs_map = {}
        total_score = 0
        passed_count = 0

        for s in subs:
            subs_map[str(s.assignment_id)] = {
                "submitted": True,
                "score_percent": s.score_percent,
                "is_passed": s.is_passed,
                "completed_at": s.completed_at.isoformat() if s.completed_at else "",
            }
            total_score += s.score_percent
            if s.is_passed:
                passed_count += 1

        total_subs = len(subs_map)
        avg_score = round(total_score / total_subs) if total_subs > 0 else 0

        # Also get completed video lessons count for student
        lessons_completed = UserLessonProgress.objects.filter(user=student, is_completed=True).count()

        students_data.append({
            "student_id": str(student.id),
            "name": getattr(student, "name", "Talaba"),
            "phone": getattr(student, "phone", ""),
            "email": getattr(student, "email", ""),
            "joined_at": m.joined_at.isoformat() if m.joined_at else "",
            "lessons_completed": lessons_completed,
            "total_submissions": total_subs,
            "passed_count": passed_count,
            "average_score": avg_score,
            "submissions": subs_map,
        })

    return success({
        "cohort": {
            "id": cohort.id,
            "name": cohort.name,
            "invite_code": cohort.invite_code,
            "description": cohort.description,
            "teacher_name": getattr(cohort.teacher, "name", ""),
        },
        "assignments": assignments,
        "students": students_data,
    })


@api_view(["POST"])
def teacher_assignments_view(request):
    """
    POST /api/v1/teacher/assignments
    Create a new homework assignment for a cohort tied to lesson or exam.
    """
    require_authenticated(request)
    require_role(request, "teacher", "instructor", "admin", "super_admin")

    data = request.data or {}
    cohort_id = (data.get("cohort_id") or "").strip()
    title = (data.get("title") or "").strip()

    if not cohort_id or not title:
        raise ContractAPIException("VALIDATION_ERROR", "cohort_id va title kiritilishi shart", 400)

    try:
        cohort = Cohort.objects.get(id=cohort_id)
    except Cohort.DoesNotExist:
        raise ContractAPIException("NOT_FOUND", "Guruh topilmadi", 404)

    user_role = getattr(request.user, "role", "teacher")
    if user_role == "teacher" and str(cohort.teacher_id) != str(request.user.id):
        raise ContractAPIException("FORBIDDEN", "Siz faqat o'zingizning guruhingizga vazifa biriktira olasiz", 403)

    lesson_id = data.get("lesson_id")
    lesson = None
    if lesson_id:
        lesson = Lesson.objects.filter(id=lesson_id).first()

    exam_id = data.get("exam_id")
    exam = None
    if exam_id:
        exam = MockExam.objects.filter(id=exam_id).first()

    deadline_raw = data.get("deadline")
    deadline = None
    if deadline_raw:
        deadline = parse_datetime(str(deadline_raw))

    if not deadline:
        # Default deadline: 3 days from now
        deadline = timezone.now() + timezone.timedelta(days=3)

    min_pass = data.get("min_pass_percent", 80)
    try:
        min_pass = int(min_pass)
    except (ValueError, TypeError):
        min_pass = 80

    assignment = HomeworkAssignment.objects.create(
        cohort=cohort,
        title=title,
        lesson=lesson,
        exam=exam,
        deadline=deadline,
        min_pass_percent=min_pass,
    )

    return success({
        "id": assignment.id,
        "cohort_id": cohort.id,
        "cohort_name": cohort.name,
        "title": assignment.title,
        "lesson_id": assignment.lesson_id,
        "lesson_title": assignment.lesson.title if assignment.lesson else None,
        "exam_id": assignment.exam_id,
        "exam_title": assignment.exam.title if assignment.exam else None,
        "deadline": assignment.deadline.isoformat(),
        "min_pass_percent": assignment.min_pass_percent,
        "created_at": assignment.created_at.isoformat(),
    }, 201)


@api_view(["POST"])
def student_join_cohort_view(request):
    """
    POST /api/v1/student/join-cohort
    Student enters 6-character invite code to join a teacher's cohort.
    """
    require_authenticated(request)

    data = request.data or {}
    code = (data.get("invite_code") or "").strip().upper()
    if not code:
        raise ContractAPIException("VALIDATION_ERROR", "Taklif kodi kiritilmadi", 400)

    cohort = Cohort.objects.filter(invite_code__iexact=code).select_related("teacher").first()
    if not cohort:
        raise ContractAPIException("NOT_FOUND", "Bunday taklif kodli guruh topilmadi", 404)

    membership, created = CohortMembership.objects.update_or_create(
        cohort=cohort,
        student=request.user,
        defaults={"status": "active"},
    )

    return success({
        "cohort_id": cohort.id,
        "cohort_name": cohort.name,
        "invite_code": cohort.invite_code,
        "teacher_name": getattr(cohort.teacher, "name", "O'qituvchi") if cohort.teacher else "",
        "status": membership.status,
        "joined": True,
        "is_new": created,
    })


@api_view(["GET"])
def student_my_assignments_view(request):
    """
    GET /api/v1/student/my-assignments
    List all active/overdue assignments from the cohorts the student belongs to.
    """
    require_authenticated(request)

    memberships = CohortMembership.objects.filter(
        student=request.user,
        status="active",
    ).values_list("cohort_id", flat=True)

    assignments_qs = HomeworkAssignment.objects.filter(
        cohort_id__in=memberships,
    ).select_related("cohort", "cohort__teacher", "lesson", "exam").order_by("deadline")

    submissions = {
        str(s.assignment_id): s
        for s in HomeworkSubmission.objects.filter(student=request.user)
    }

    now = timezone.now()
    results = []

    for a in assignments_qs:
        sub = submissions.get(str(a.id))
        is_submitted = sub is not None
        score_percent = sub.score_percent if sub else 0
        is_passed = sub.is_passed if sub else False
        is_overdue = not is_submitted and a.deadline < now

        if is_passed:
            status_str = "passed"
        elif is_submitted:
            status_str = "failed"
        elif is_overdue:
            status_str = "overdue"
        else:
            status_str = "pending"

        results.append({
            "id": a.id,
            "cohort_id": a.cohort.id,
            "cohort_name": a.cohort.name,
            "teacher_name": getattr(a.cohort.teacher, "name", "") if a.cohort.teacher else "",
            "title": a.title,
            "lesson_id": a.lesson_id,
            "lesson_title": a.lesson.title if a.lesson else None,
            "lesson_order": a.lesson.order_index if a.lesson else None,
            "exam_id": a.exam_id,
            "exam_title": a.exam.title if a.exam else None,
            "deadline": a.deadline.isoformat(),
            "min_pass_percent": a.min_pass_percent,
            "is_submitted": is_submitted,
            "score_percent": score_percent,
            "is_passed": is_passed,
            "is_overdue": is_overdue,
            "status": status_str,
            "completed_at": sub.completed_at.isoformat() if sub and sub.completed_at else None,
        })

    return success(results)


@api_view(["POST"])
def student_submit_assignment_view(request, assignment_id: str):
    """
    POST /api/v1/student/assignments/<id>/submit
    Submit or update student homework result.
    """
    require_authenticated(request)

    try:
        assignment = HomeworkAssignment.objects.select_related("cohort").get(id=assignment_id)
    except HomeworkAssignment.DoesNotExist:
        raise ContractAPIException("NOT_FOUND", "Vazifa topilmadi", 404)

    # Check student is active member of cohort
    is_member = CohortMembership.objects.filter(
        cohort=assignment.cohort,
        student=request.user,
        status="active",
    ).exists()
    if not is_member:
        raise ContractAPIException("FORBIDDEN", "Siz ushbu guruhga a'zo emassiz", 403)

    data = request.data or {}
    score = data.get("score_percent", 100)
    try:
        score = int(score)
    except (ValueError, TypeError):
        score = 0

    is_passed = score >= assignment.min_pass_percent

    sub, created = HomeworkSubmission.objects.update_or_create(
        assignment=assignment,
        student=request.user,
        defaults={
            "score_percent": score,
            "is_passed": is_passed,
            "completed_at": timezone.now(),
        },
    )

    return success({
        "id": sub.id,
        "assignment_id": assignment.id,
        "student_id": str(request.user.id),
        "score_percent": sub.score_percent,
        "is_passed": sub.is_passed,
        "completed_at": sub.completed_at.isoformat(),
    })
