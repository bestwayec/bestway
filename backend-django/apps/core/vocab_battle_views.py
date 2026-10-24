"""Vocab Battle REST API Views."""
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from .views import require_authenticated, require_role, success
from apps.core.vocab_battle import (
    create_battle_session,
    finish_battle_and_award_points,
    get_battle_state,
    join_battle,
    next_battle_step,
    submit_battle_answer,
)
from apps.core.models import VocabBattleSession
from common.api.exceptions import ContractAPIException


@api_view(["POST"])
@permission_classes([AllowAny])
def battle_create_view(request):
    """Host creates a live battle session from a VocabularySet."""
    user = require_authenticated(request)
    require_role(request, "teacher", "admin", "super_admin")

    data = request.data or {}
    set_id = data.get("setId")
    question_count = int(data.get("questionCount", 10))
    if not set_id:
        raise ContractAPIException("SET_ID_REQUIRED", "Lug'at to'plami tanlanmadi", 400)

    result = create_battle_session(user, set_id, question_count=question_count)
    return success(result, status_code=201)


@api_view(["POST"])
@permission_classes([AllowAny])
def battle_join_view(request):
    """Student joins a live battle by 6-digit PIN."""
    user = require_authenticated(request)
    data = request.data or {}
    pin = (data.get("pin") or "").strip()
    if not pin:
        raise ContractAPIException("PIN_REQUIRED", "PIN-kod kiritilmadi", 400)

    result = join_battle(pin, user)
    return success(result)


@api_view(["GET"])
@permission_classes([AllowAny])
def battle_state_view(request, pin):
    """Poll live state of battle session."""
    user = require_authenticated(request)
    result = get_battle_state(pin, current_user=user)
    return success(result)


@api_view(["POST"])
@permission_classes([AllowAny])
def battle_next_view(request, pin):
    """Host advances battle to next step (QUESTION / LEADERBOARD / FINISHED)."""
    user = require_authenticated(request)
    require_role(request, "teacher", "admin", "super_admin")

    result = next_battle_step(pin, host_user=user)
    return success(result)


@api_view(["POST"])
@permission_classes([AllowAny])
def battle_answer_view(request, pin):
    """Participant submits answer to current question."""
    user = require_authenticated(request)
    data = request.data or {}
    q_index = int(data.get("questionIndex", 0))
    sel_index = int(data.get("selectedIndex", 0))
    elapsed = float(data.get("elapsedSec", 0.0))

    result = submit_battle_answer(pin, user, q_index, sel_index, elapsed_sec=elapsed)
    return success(result)


@api_view(["POST"])
@permission_classes([AllowAny])
def battle_finish_view(request, pin):
    """Host concludes battle and triggers leaderboard points distribution."""
    user = require_authenticated(request)
    require_role(request, "teacher", "admin", "super_admin")

    session = VocabBattleSession.objects.filter(pin=pin).first()
    if not session:
        raise ContractAPIException("BATTLE_NOT_FOUND", "Bellashuv topilmadi", 404)
    if str(session.host_id) != str(user.id):
        raise ContractAPIException("NOT_HOST", "Faqat mezbon o'qituvchi yakunlay oladi", 403)

    winners = finish_battle_and_award_points(session)
    return success({
        "status": "FINISHED",
        "winners": winners,
    })
