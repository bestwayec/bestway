"""API endpoints for Adaptive Study Plan, Mistake Vault Diagnostics, and Targeted Practice Drills."""
from __future__ import annotations

from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from common.auth.permissions import Authenticated
from common.api.exceptions import ContractAPIException
from . import study_plan_service


def success(data: object, status: int = 200) -> Response:
    return Response({"success": True, "data": data}, status=status)


@api_view(["GET"])
@permission_classes([Authenticated])
def study_plan_view(request):
    """Retrieve adaptive study roadmap and daily workload for authenticated student."""
    months = int(request.query_params.get("months", 3))
    exam_date = request.query_params.get("examDate")
    data = study_plan_service.get_student_study_plan(request.user, target_months=months, target_exam_date=exam_date)
    return success(data)


@api_view(["POST"])
@permission_classes([Authenticated])
def study_plan_target_view(request):
    """Update target timeline and exam date."""
    payload = request.data or {}
    months = int(payload.get("months", 3))
    exam_date = payload.get("examDate")
    data = study_plan_service.get_student_study_plan(request.user, target_months=months, target_exam_date=exam_date)
    return success(data)


@api_view(["GET"])
@permission_classes([Authenticated])
def mistake_vault_view(request):
    """Retrieve deep diagnostic breakdown of weak question types."""
    data = study_plan_service.get_student_mistake_vault(request.user)
    return success(data)


def _category(request, payload=None) -> str:
    payload = payload or {}
    return (payload.get("categoryId") or payload.get("category") or request.query_params.get("category")
            or request.query_params.get("categoryId") or request.query_params.get("category_id") or "tfng")


@api_view(["GET", "POST"])
@permission_classes([Authenticated])
def targeted_practice_view(request):
    """Start a targeted practice drill (questions only; the answers stay on the server).
    A POST that carries a practiceId finishes that drill."""
    payload = request.data if request.method == "POST" and isinstance(request.data, dict) else {}
    if payload.get("practiceId"):
        return success(study_plan_service.submit_targeted_practice(request.user, payload.get("practiceId"), payload.get("answers")))
    return success(study_plan_service.generate_targeted_practice(request.user, category_id=_category(request, payload)))


@api_view(["POST"])
@permission_classes([Authenticated])
def answer_targeted_practice_view(request):
    """Check one answer of a drill; reveals the key and explanation of that question only."""
    payload = request.data if isinstance(request.data, dict) else {}
    return success(study_plan_service.answer_targeted_practice(
        request.user, payload.get("practiceId"), payload.get("questionId"), payload.get("selectedAnswer")))


@api_view(["POST"])
@permission_classes([Authenticated])
def submit_targeted_practice_view(request):
    """Finish a drill once: the server's own record is scored; a repeat gives no points."""
    payload = request.data if isinstance(request.data, dict) else {}
    return success(study_plan_service.submit_targeted_practice(request.user, payload.get("practiceId"), payload.get("answers")))
