"""Teacher workspace: Cohorts, assignments, and student monitoring views."""
from __future__ import annotations

import random
import string
from django.db import transaction
from django.db.models import Count, Q
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
    VocabularySet,
)
from apps.legacy_schema.models import MockExam, User
from . import classrooms, vocabulary_collections


def success(data: object, status: int = 200) -> Response:
    return Response({"success": True, "data": data}, status=status)


def require_authenticated(request):
    if not getattr(request.user, "is_authenticated", False):
        raise ContractAPIException("UNAUTHORIZED", "Avval tizimga kiring", 401)
    return request.user


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
            qs = Cohort.objects.filter(teacher_id=request.user.id).select_related("teacher")

        cohorts_list = []
        for cohort in qs:
            if classrooms.is_linked(cohort):
                continue
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

    if not User.objects.filter(id=request.user.id, is_active=True).exists():
        raise ContractAPIException("UNAUTHORIZED", "Token yaroqsiz yoki muddati tugagan", 401)
    cohort = Cohort.objects.create(
        teacher_id=request.user.id,
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

    if classrooms.is_linked(cohort):
        raise ContractAPIException("NOT_FOUND", "Guruh topilmadi", 404)
    user_role = getattr(request.user, "role", "teacher")
    if user_role in ("teacher", "instructor") and str(cohort.teacher_id) != str(request.user.id):
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

        graded_count = 0
        for s in subs:
            graded = s.status == "graded"
            subs_map[str(s.assignment_id)] = {
                "submitted": True,
                "score_percent": s.score_percent if graded else None,
                "is_passed": s.is_passed,
                "status": s.status,
                "source": s.source,
                "completed_at": s.completed_at.isoformat() if s.completed_at else "",
            }
            if graded:
                total_score += s.score_percent
                graded_count += 1
            if s.is_passed:
                passed_count += 1

        total_subs = graded_count
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

    if classrooms.is_linked(cohort):
        raise ContractAPIException("NOT_FOUND", "Guruh topilmadi", 404)
    user_role = getattr(request.user, "role", "teacher")
    if user_role in ("teacher", "instructor") and str(cohort.teacher_id) != str(request.user.id):
        raise ContractAPIException("FORBIDDEN", "Siz faqat o'zingizning guruhingizga vazifa biriktira olasiz", 403)

    return success(create_assignment(cohort, data, title), 201)


def create_assignment(cohort, data, title, *, vocabulary_set=None):
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
        vocabulary_set=vocabulary_set,
        vocabulary_revision=vocabulary_collections.snapshot(vocabulary_set) if vocabulary_set else None,
        deadline=deadline,
        min_pass_percent=min_pass,
    )

    return assignment_payload(assignment)


def assignment_payload(assignment):
    cohort = assignment.cohort
    return {
        "id": assignment.id,
        "cohort_id": cohort.id,
        "cohort_name": classrooms.name(cohort),
        "title": assignment.title,
        "lesson_id": assignment.lesson_id,
        "lesson_title": assignment.lesson.title if assignment.lesson else None,
        "exam_id": assignment.exam_id,
        "exam_title": assignment.exam.title if assignment.exam else None,
        "vocabulary_set_id": assignment.vocabulary_set_id,
        "deadline": assignment.deadline.isoformat(),
        "min_pass_percent": assignment.min_pass_percent,
        "created_at": assignment.created_at.isoformat(),
    }


@api_view(["GET", "POST"])
@transaction.atomic
def classroom_assignments_view(request, group_id):
    actor = require_authenticated(request)
    require_role(request, "teacher", "admin", "super_admin")
    if request.method == "GET":
        cohort = classrooms.homework_cohort(actor, group_id)
        assignments = cohort.assignments.select_related("lesson", "exam") if cohort else []
        return success([assignment_payload(assignment) for assignment in assignments])

    cohort = classrooms.homework_cohort(actor, group_id, create=True)
    from .domain_contracts import invalid, payload
    data = payload(request, {"title", "deadline", "min_pass_percent", "lesson_id", "exam_id", "vocabulary_set_id"})
    title = data.get("title")
    if not isinstance(title, str) or not 1 <= len(title.strip()) <= 255:
        invalid("Vazifa nomi 1–255 belgi bo‘lishi kerak")
    deadline = data.get("deadline")
    if deadline is not None:
        try:
            parsed = parse_datetime(deadline) if isinstance(deadline, str) else None
        except ValueError:
            parsed = None
        if parsed is None or timezone.is_naive(parsed):
            invalid("Muddat vaqt mintaqasi bilan ISO 8601 formatida bo‘lishi kerak")
    score = data.get("min_pass_percent", 80)
    if type(score) is not int or not 0 <= score <= 100:
        invalid("Minimal ball 0–100 oralig‘ida bo‘lishi kerak")
    if sum(key in data for key in ("lesson_id", "exam_id", "vocabulary_set_id")) > 1:
        invalid("Vazifa faqat bitta manbaga bog‘lanishi mumkin")
    for key, collection in (("lesson_id", Lesson.objects.all()), ("exam_id", assignable_exams())):
        if key in data and (not isinstance(data[key], str) or not collection.filter(id=data[key]).exists()):
            invalid(f"{key} topilmadi")
    vocab_set = None
    if "vocabulary_set_id" in data:
        if "lesson_id" in data or "exam_id" in data or not isinstance(data["vocabulary_set_id"], str):
            invalid("Vazifa faqat bitta lug‘at to‘plamiga bog‘lanishi mumkin")
        from .vocabulary_views import managed_set

        vocab_set = managed_set(request, data["vocabulary_set_id"])
        vocab_set = VocabularySet.objects.select_for_update().get(id=vocab_set.id)
        if vocab_set.group_id and vocab_set.group_id != group_id:
            invalid("Lug‘at boshqa guruhga tegishli")
        if not vocab_set.words.filter(is_archived=False).exists():
            invalid("To‘plamda so‘zlar yo‘q")
    return success(create_assignment(cohort, data, title.strip(), vocabulary_set=vocab_set), 201)


def assignable_exams():
    return MockExam.objects.filter(is_published=True).filter(Q(price=0) | Q(is_demo=True))


@api_view(["GET"])
def classroom_exams_view(request, group_id):
    actor = require_authenticated(request)
    require_role(request, "teacher", "admin", "super_admin")
    from . import groups

    groups.assert_manages_group(actor, groups.get_group(group_id))
    search = request.query_params.get("search", "").strip()
    if len(search) > 100:
        from .domain_contracts import invalid

        invalid("Search must not exceed 100 characters")
    return success(list(assignable_exams().filter(title__icontains=search).order_by("title", "id").values("id", "title")[:100]))


@api_view(["GET"])
def classroom_vocabulary_view(request, group_id):
    actor = require_authenticated(request)
    require_role(request, "teacher", "admin", "super_admin")
    from . import groups

    groups.assert_manages_group(actor, groups.get_group(group_id))
    sets = VocabularySet.objects.filter(Q(group_id__isnull=True) | Q(group_id=group_id))
    if actor.role == "teacher":
        sets = sets.filter(Q(created_by_id=actor.id) | Q(group_id=group_id))
    sets = sets.annotate(wordCount=Count("words", filter=Q(words__is_archived=False))).filter(wordCount__gt=0)
    return success(list(sets.order_by("title", "id").values("id", "title", "wordCount")))


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
    if not cohort or classrooms.is_linked(cohort):
        raise ContractAPIException("NOT_FOUND", "Bunday taklif kodli guruh topilmadi", 404)

    membership, created = CohortMembership.objects.update_or_create(
        cohort=cohort,
        student_id=request.user.id,
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

    assignments_qs = HomeworkAssignment.objects.filter(
        classrooms.student_homework_scope(request.user.id),
    ).select_related("cohort__teacher", "cohort__classroom__teacher", "lesson", "exam").order_by("deadline")

    submissions = {
        str(s.assignment_id): s
        for s in HomeworkSubmission.objects.filter(student_id=request.user.id)
    }
    from . import homework_scoring as scoring
    for a in assignments_qs:
        sub = submissions.get(str(a.id))
        if a.exam_id and (sub is None or sub.status != scoring.GRADED or sub.source == "exam_attempt"):
            synced = scoring.sync_from_exam(a, request.user.id)
            if synced is not None:
                submissions[str(a.id)] = synced

    now = timezone.now()
    results = []

    for a in assignments_qs:
        sub = submissions.get(str(a.id))
        is_submitted = sub is not None
        graded = bool(sub and sub.status == scoring.GRADED)
        score_percent = sub.score_percent if graded else None
        is_passed = sub.is_passed if graded else False
        is_overdue = not is_submitted and a.deadline < now

        if is_passed:
            status_str = "passed"
        elif is_submitted and not graded:
            status_str = sub.status
        elif is_submitted:
            status_str = "failed"
        elif is_overdue:
            status_str = "overdue"
        else:
            status_str = "pending"

        results.append({
            "id": a.id,
            "cohort_id": a.cohort.id,
            "cohort_name": classrooms.name(a.cohort),
            "teacher_name": getattr(classrooms.teacher(a.cohort), "name", ""),
            "title": a.title,
            "lesson_id": a.lesson_id,
            "lesson_title": a.lesson.title if a.lesson else None,
            "lesson_order": a.lesson.order_index if a.lesson else None,
            "exam_id": a.exam_id,
            "exam_title": a.exam.title if a.exam else None,
            "vocabulary_set_id": getattr(a, "vocabulary_set_id", None),
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
    is_member = classrooms.is_member(assignment.cohort, request.user.id)
    if not is_member:
        raise ContractAPIException("FORBIDDEN", "Siz ushbu guruhga a'zo emassiz", 403)
    if isinstance(getattr(assignment, "vocabulary_set_id", None), str):
        raise ContractAPIException("VOCABULARY_SESSION_REQUIRED", "Vazifani lug‘at mashqidan yakunlang", 400)

    # The client never supplies a score (an empty POST used to record 100% passed).
    from . import homework_scoring as scoring
    if assignment.exam_id:
        sub = scoring.sync_from_exam(assignment, request.user.id)
        if sub is None:
            raise ContractAPIException(
                "HOMEWORK_ATTEMPT_REQUIRED",
                "Avval biriktirilgan imtihonni topshiring — natija avtomatik olinadi", 400)
    else:
        sub = scoring.submit_for_review(assignment, request.user.id)
    return success(scoring.payload(sub))


@api_view(["POST"])
def teacher_grade_assignment_view(request, assignment_id: str):
    """
    POST /api/v1/teacher/assignments/<id>/grade  {student_id, score_percent}
    The only way a non-exam homework (or an attempt without an objective result) gets a score.
    """
    require_authenticated(request)
    require_role(request, "teacher", "instructor", "admin", "super_admin")
    try:
        assignment = HomeworkAssignment.objects.select_related("cohort").get(id=assignment_id)
    except HomeworkAssignment.DoesNotExist:
        raise ContractAPIException("NOT_FOUND", "Vazifa topilmadi", 404)
    if getattr(request.user, "role", "") in ("teacher", "instructor") and classrooms.teacher_id(assignment.cohort) != request.user.id:
        raise ContractAPIException("FORBIDDEN", "Bu guruh sizga tegishli emas", 403)
    data = request.data or {}
    student_id = str(data.get("student_id") or "").strip()
    score = data.get("score_percent")
    if not student_id or isinstance(score, bool) or not isinstance(score, int) or not 0 <= score <= 100:
        raise ContractAPIException("VALIDATION_ERROR", "student_id va 0–100 oralig'idagi butun score_percent kerak", 400)
    if not classrooms.is_member(assignment.cohort, student_id):
        raise ContractAPIException("STUDENT_NOT_IN_COHORT", "O'quvchi bu guruhda emas", 400)
    if isinstance(getattr(assignment, "vocabulary_set_id", None), str):
        raise ContractAPIException("VOCABULARY_SERVER_GRADED", "Lug‘at natijasini server hisoblaydi", 400)
    from . import homework_scoring as scoring
    return success(scoring.payload(scoring.teacher_grade(assignment, student_id, score, request.user.id)))


@api_view(["GET"])
def teacher_submissions_view(request):
    """
    GET /api/v1/teacher/submissions
    Returns the pending (and recently graded) submissions awaiting assessment for this teacher's students.
    Strictly enforces authorization: teachers only see attempts of students enrolled in their managed groups.
    """
    actor = require_authenticated(request)
    require_role(request, "teacher", "instructor", "admin", "super_admin")

    from apps.legacy_schema.models import MockAttempt, MockAnswer

    attempts_qs = MockAttempt.objects.select_related("exam", "student__user", "student__group").order_by("-submitted_at")

    # Filter by teacher's groups unless admin/super_admin
    if getattr(actor, "role", "") in ("teacher", "instructor"):
        attempts_qs = attempts_qs.filter(student__group__teacher_id=actor.id)

    status_filter = request.query_params.get("status", "pending")
    if status_filter == "pending":
        attempts_qs = attempts_qs.filter(status="grading")
    elif status_filter == "graded":
        attempts_qs = attempts_qs.filter(status="completed")

    skill_filter = request.query_params.get("skill")

    try:
        offset = max(int(request.query_params.get("offset", 0)), 0)
    except (ValueError, TypeError):
        offset = 0

    try:
        limit = min(max(int(request.query_params.get("limit", 50)), 1), 100)
    except (ValueError, TypeError):
        limit = 50

    attempts = list(attempts_qs[offset : offset + limit])

    results = []
    for att in attempts:
        user = getattr(att.student, "user", None) if att.student else None
        student_name = getattr(user, "name", "") or getattr(att.student, "full_name", "") or "O‘quvchi"
        student_phone = getattr(user, "phone", "") or getattr(user, "phone_number", "") or ""
        exam_title = getattr(att.exam, "title", "") or "Imtihon"
        raw_type = getattr(att.exam, "type", "ielts")
        exam_type = "MULTILEVEL" if "multilevel" in str(raw_type).lower() else "IELTS"

        answers = list(MockAnswer.objects.filter(attempt_id=att.id).select_related("question"))
        writing_answers = [ans for ans in answers if getattr(ans.question, "section_type", "") == "writing" or getattr(ans.question, "skill", "") == "writing"]
        speaking_answers = [ans for ans in answers if getattr(ans.question, "section_type", "") == "speaking" or getattr(ans.question, "skill", "") == "speaking" or ans.audio_key]

        skills_to_add = []
        if not skill_filter or skill_filter == "writing":
            if writing_answers or "writing" in (att.submitted_sections or []):
                skills_to_add.append("writing")
        if not skill_filter or skill_filter == "speaking":
            if speaking_answers or "speaking" in (att.submitted_sections or []):
                skills_to_add.append("speaking")
        if not skills_to_add:
            skills_to_add = ["writing"]

        for sk in skills_to_add:
            ans = (writing_answers[0] if writing_answers else None) if sk == "writing" else (speaking_answers[0] if speaking_answers else None)
            rubric = ans.rubric_scores if (ans and isinstance(ans.rubric_scores, dict)) else {}
            results.append({
                "id": att.id if len(skills_to_add) == 1 else f"{att.id}_{sk}",
                "studentName": student_name,
                "studentPhone": student_phone,
                "examTitle": exam_title,
                "examType": exam_type,
                "skill": sk,
                "subType": f"Task ({sk.title()})",
                "submittedAt": att.submitted_at.isoformat() if att.submitted_at else (att.started_at.isoformat() if att.started_at else ""),
                "status": "pending" if att.status == "grading" else "graded",
                "prompt": getattr(ans.question, "prompt", "") if ans and ans.question else "",
                "responseText": ans.response if ans else "",
                "audioUrl": ans.audio_key if ans else "",
                "criteriaScores": {
                    "c1": rubric.get("c1", rubric.get("TR", rubric.get("FC", 0))),
                    "c2": rubric.get("c2", rubric.get("CC", rubric.get("LR", 0))),
                    "c3": rubric.get("c3", rubric.get("LR", rubric.get("GRA", 0))),
                    "c4": rubric.get("c4", rubric.get("GRA", rubric.get("PR", 0))),
                },
                "overallBand": att.overall_band,
                "teacherFeedback": ans.feedback if (ans and ans.feedback) else "",
            })

    return success(results)


@api_view(["POST"])
def teacher_grade_submission_view(request, submission_id: str):
    """
    POST /api/v1/teacher/submissions/<submission_id>/grade
    Grades an attempt submission or homework submission.
    """
    require_authenticated(request)
    require_role(request, "teacher", "instructor", "admin", "super_admin")

    actual_attempt_id = submission_id.split("_")[0]
    from . import assessment_views
    return assessment_views.teacher_grade(request, actual_attempt_id)
