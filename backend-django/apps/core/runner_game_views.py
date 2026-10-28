from __future__ import annotations

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response

from .views import success
from . import runner_game_service as service


@api_view(["GET"])
@permission_classes([AllowAny])
def runner_questions_view(request: Request) -> Response:
    """Return a randomized batch of 40 vocabulary runner questions."""
    limit = int(request.query_params.get("limit") or 40)
    category = request.query_params.get("category")
    questions = service.get_runner_questions(limit=limit, category=category)
    return success(questions)


@api_view(["POST"])
@permission_classes([AllowAny])
def runner_submit_score_view(request: Request) -> Response:
    """Validate score, award XP, update student total XP, and log mistakes."""
    data = request.data or {}
    user = getattr(request, "user", None)
    res = service.submit_runner_score(user, data)
    return success(res)


@api_view(["GET"])
@permission_classes([AllowAny])
def runner_leaderboard_view(request: Request) -> Response:
    """Return top runner scores and leaderboard entries."""
    limit = int(request.query_params.get("limit") or 10)
    leaderboard = service.get_runner_leaderboard(limit=limit)
    return success(leaderboard)
