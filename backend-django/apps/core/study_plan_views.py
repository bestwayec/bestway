"""API endpoints for Adaptive Study Plan and Mistake Vault Diagnostics."""
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


@api_view(["POST"])
@permission_classes([Authenticated])
def targeted_practice_view(request):
    """1-Click launch of targeted 10-question practice set for specific mistake category."""
    category_id = (request.data or {}).get("categoryId", "tfng")
    data = study_plan_service.generate_targeted_practice(request.user, category_id=category_id)
    return success(data)
