"""Bamboozle 1v1 Arena API Views & Viral Room Sharing."""
import json
import logging
import random
import string
from typing import Any, Dict, List, Optional

from django.core.cache import cache
from django.http import Http404, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from apps.core.lms_services import apply_bamboozle_card_effect, get_quiz_deck_detail, list_quiz_decks
from apps.core.models import QuizDeck

logger = logging.getLogger(__name__)

CACHE_PREFIX = "bamboozle:room:"
ROOM_TTL_SECONDS = 86400  # 24 hours


def generate_room_code(length: int = 6) -> str:
    """Generate a clean, unambiguous 6-character uppercase alphanumeric code."""
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # omit O, 0, I, 1 to prevent typos
    for _ in range(50):
        code = "".join(random.choice(chars) for _ in range(length))
        if not cache.get(f"{CACHE_PREFIX}{code}"):
            return code
    return "".join(random.choice(chars) for _ in range(length))


def get_cached_room(room_code: str) -> Optional[Dict[str, Any]]:
    """Fetch room state from cache."""
    return cache.get(f"{CACHE_PREFIX}{room_code.upper().strip()}")


def save_cached_room(room: Dict[str, Any]) -> None:
    """Persist room state to cache with TTL."""
    code = room["room_code"].upper().strip()
    cache.set(f"{CACHE_PREFIX}{code}", room, timeout=ROOM_TTL_SECONDS)


@csrf_exempt
def create_room_view(request):
    """POST /api/v1/bamboozle/rooms/create

    Payload: { "deck_id": "...", "host_name": "Jasur" }
    """
    if request.method != "POST":
        return JsonResponse({"success": False, "error": "POST method required"}, status=405)

    try:
        body = json.loads(request.body.decode("utf-8")) if request.body else {}
    except Exception:
        body = {}

    deck_id = body.get("deck_id") or body.get("deck")
    if not deck_id:
        # Fallback to first available deck
        decks = list_quiz_decks()
        if decks:
            deck_id = decks[0]["id"]
        else:
            return JsonResponse({"success": False, "error": "Mavjud quiz to'plami topilmadi"}, status=404)

    try:
        deck_detail = get_quiz_deck_detail(str(deck_id))
    except Exception as e:
        return JsonResponse({"success": False, "error": f"To'plam topilmadi: {e}"}, status=404)

    user = request.user if hasattr(request, "user") and request.user.is_authenticated else None
    host_name = body.get("host_name") or (user.name if user else "O'yinchi 1")
    host_id = str(user.id) if user else f"anon-{random.randint(1000, 9999)}"

    room_code = generate_room_code()

    raw_cards = deck_detail.get("cards", [])
    # Limit to 16 cards max for a fast, viral 1v1 battle
    selected_cards = raw_cards[:16] if raw_cards else []

    cards_state = []
    for idx, c in enumerate(selected_cards, start=1):
        cards_state.append({
            "id": c.get("id") or f"card-{idx}",
            "order_index": idx,
            "card_type": c.get("card_type", "question"),
            "points": c.get("points", 10),
            "question_text": c.get("question_text", f"Savol #{idx}"),
            "options": c.get("options", []),
            "correct_answer": c.get("correct_answer", ""),
            "is_revealed": False,
            "revealed_by_team": None,
            "effect_message": None,
        })

    share_url = f"https://bestwayec.uz/en/bamboozle?room={room_code}&deck={deck_id}"

    room_state = {
        "room_code": room_code,
        "deck_id": str(deck_detail["id"]),
        "deck_title": deck_detail["title"],
        "category": deck_detail.get("category", "General"),
        "host_id": host_id,
        "host_name": host_name,
        "guest_id": None,
        "guest_name": None,
        "mode": "1v1",
        "status": "waiting",  # waiting, active, finished
        "active_turn": 1,  # 1 for Host, 2 for Guest
        "team1_score": 0,
        "team2_score": 0,
        "team1_name": host_name,
        "team2_name": "Do'st (Kutilmoqda)",
        "cards": cards_state,
        "total_cards": len(cards_state),
        "revealed_cards_count": 0,
        "share_url": share_url,
        "telegram_share_url": (
            f"https://t.me/share/url?url={share_url}"
            f"&text=🎮 Men bilan BestWay Bamboozle 1v1 arenasida bellashasanmi? Xona kodi: {room_code}"
        ),
        "created_at": timezone.now().isoformat(),
        "logs": [f"🎮 {host_name} 1v1 arenasini yaratdi. Do'st taklifini kutmoqda..."],
    }

    save_cached_room(room_state)

    return JsonResponse({"success": True, "data": room_state}, status=201)


def get_room_view(request, room_code):
    """GET /api/v1/bamboozle/rooms/<room_code>"""
    room = get_cached_room(room_code)
    if not room:
        return JsonResponse({"success": False, "error": "Bunday arena xonasi topilmadi yoki muddati o'tgan"}, status=404)
    return JsonResponse({"success": True, "data": room})


@csrf_exempt
def join_room_view(request, room_code):
    """POST /api/v1/bamboozle/rooms/<room_code>/join

    Payload: { "guest_name": "Madina" }
    """
    if request.method != "POST":
        return JsonResponse({"success": False, "error": "POST method required"}, status=405)

    room = get_cached_room(room_code)
    if not room:
        return JsonResponse({"success": False, "error": "Bunday arena xonasi topilmadi"}, status=404)

    try:
        body = json.loads(request.body.decode("utf-8")) if request.body else {}
    except Exception:
        body = {}

    user = request.user if hasattr(request, "user") and request.user.is_authenticated else None
    guest_name = body.get("guest_name") or (user.name if user else "Raqib")
    guest_id = str(user.id) if user else f"guest-{random.randint(1000, 9999)}"

    # If already joined or slot open
    if not room.get("guest_id") or room.get("guest_id") == guest_id:
        room["guest_id"] = guest_id
        room["guest_name"] = guest_name
        room["team2_name"] = guest_name
        room["status"] = "active"
        room["logs"].append(f"⚔️ {guest_name} jangga qo'shildi! Bellashuv boshlandi!")
        save_cached_room(room)

    return JsonResponse({"success": True, "data": room})


@csrf_exempt
def play_room_action_view(request, room_code):
    """POST /api/v1/bamboozle/rooms/<room_code>/play

    Payload: {
        "card_id": "...",
        "is_correct": true,
        "team": 1 or 2,
        "has_double": false
    }
    """
    if request.method != "POST":
        return JsonResponse({"success": False, "error": "POST method required"}, status=405)

    room = get_cached_room(room_code)
    if not room:
        return JsonResponse({"success": False, "error": "Arena topilmadi"}, status=404)

    try:
        body = json.loads(request.body.decode("utf-8")) if request.body else {}
    except Exception:
        body = {}

    card_id = body.get("card_id")
    is_correct = bool(body.get("is_correct", True))
    active_team = int(body.get("team") or room.get("active_turn", 1))
    has_double = bool(body.get("has_double", False))

    target_card = None
    for c in room["cards"]:
        if str(c["id"]) == str(card_id):
            target_card = c
            break

    if not target_card:
        return JsonResponse({"success": False, "error": "Karta topilmadi"}, status=404)

    if target_card.get("is_revealed"):
        return JsonResponse({"success": False, "error": "Ushbu karta allaqachon ochilgan"}, status=400)

    # Calculate effect
    card_type = target_card.get("card_type", "question")
    points = target_card.get("points", 10)

    new_t1, new_t2, effect_msg = apply_bamboozle_card_effect(
        active_team=active_team,
        card_type=card_type,
        points=points,
        team1_score=room["team1_score"],
        team2_score=room["team2_score"],
        is_correct=is_correct,
        has_double=has_double,
    )

    target_card["is_revealed"] = True
    target_card["revealed_by_team"] = active_team
    target_card["effect_message"] = effect_msg

    room["team1_score"] = new_t1
    room["team2_score"] = new_t2
    room["revealed_cards_count"] = sum(1 for c in room["cards"] if c["is_revealed"])

    team_label = room["team1_name"] if active_team == 1 else room["team2_name"]
    room["logs"].append(f"[{team_label}] #{target_card['order_index']}-kartani tanladi: {effect_msg}")

    # Switch turn to next player
    room["active_turn"] = 2 if active_team == 1 else 1

    # Check if all cards revealed
    if room["revealed_cards_count"] >= room["total_cards"]:
        room["status"] = "finished"
        if new_t1 > new_t2:
            winner = room["team1_name"]
            room["logs"].append(f"🏆 O'yin tugadi! G'olib: {winner} ({new_t1} ball)!")
        elif new_t2 > new_t1:
            winner = room["team2_name"]
            room["logs"].append(f"🏆 O'yin tugadi! G'olib: {winner} ({new_t2} ball)!")
        else:
            room["logs"].append(f"🤝 O'yin durang bilan yakunlandi ({new_t1} - {new_t2})!")

    save_cached_room(room)

    return JsonResponse({"success": True, "data": room})
