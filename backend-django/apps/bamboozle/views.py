"""Bamboozle 1v1 Arena API Views & Viral Room Sharing."""
import hashlib
import hmac
import json
import logging
import secrets
import string
from typing import Any, Dict, Optional

from django.core.cache import cache
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from apps.core.lms_services import apply_bamboozle_card_effect, get_quiz_deck_detail, list_quiz_decks

logger = logging.getLogger(__name__)

CACHE_PREFIX = "bamboozle:room:"
ROOM_TTL_SECONDS = 86400  # 24 hours


def generate_room_code(length: int = 6) -> str:
    """Generate a clean, unambiguous 6-character uppercase alphanumeric code."""
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # omit O, 0, I, 1 to prevent typos
    for _ in range(50):
        code = "".join(secrets.choice(chars) for _ in range(length))
        if not cache.get(f"{CACHE_PREFIX}{code}"):
            return code
    return "".join(secrets.choice(chars) for _ in range(length))


def get_cached_room(room_code: str) -> Optional[Dict[str, Any]]:
    """Fetch room state from cache (internal: includes answer keys and token hashes)."""
    return cache.get(f"{CACHE_PREFIX}{room_code.upper().strip()}")


def save_cached_room(room: Dict[str, Any]) -> None:
    """Persist room state to cache with TTL."""
    code = room["room_code"].upper().strip()
    cache.set(f"{CACHE_PREFIX}{code}", room, timeout=ROOM_TTL_SECONDS)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _issue_token(room: Dict[str, Any], team: int) -> str:
    """A per-player secret. Only its hash is stored; the room state never carries it."""
    token = secrets.token_urlsafe(24)
    room.setdefault("_tokens", {})[str(team)] = _token_hash(token)
    return token


def team_for_token(room: Dict[str, Any], token: Any) -> Optional[int]:
    if not isinstance(token, str) or not token:
        return None
    digest = _token_hash(token)
    for team, stored in (room.get("_tokens") or {}).items():
        if hmac.compare_digest(stored, digest):
            return int(team)
    return None


def public_room(room: Dict[str, Any]) -> Dict[str, Any]:
    """What any client may see: no token hashes, no answer of a card nobody has opened yet."""
    out = {k: v for k, v in room.items() if not k.startswith("_")}
    out["cards"] = [
        {k: v for k, v in card.items() if k != "correct_answer" or card.get("is_revealed")}
        for card in room.get("cards", [])
    ]
    return out


def _same(a: Any, b: Any) -> bool:
    return " ".join(str(a or "").split()).casefold() == " ".join(str(b or "").split()).casefold()


class PlayRejected(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def apply_play(room: Dict[str, Any], token: Any, card_id: Any, answer: Any = None) -> Dict[str, Any]:
    """Play one card for the player holding `token`. The server decides everything:
    whose turn it is, whether a question was answered correctly, and any 2x bonus."""
    team = team_for_token(room, token)
    if team is None:
        raise PlayRejected("NOT_A_PLAYER", "Siz bu xonada o'yinchi emassiz", 403)
    if room.get("status") != "active":
        raise PlayRejected("ROOM_NOT_ACTIVE", "O'yin hali boshlanmagan yoki tugagan", 409)
    if int(room.get("active_turn") or 1) != team:
        raise PlayRejected("NOT_YOUR_TURN", "Hozir raqibingiz navbati", 409)
    card = next((c for c in room.get("cards", []) if str(c.get("id")) == str(card_id)), None)
    if card is None:
        raise PlayRejected("CARD_NOT_FOUND", "Karta topilmadi", 404)
    if card.get("is_revealed"):
        raise PlayRejected("CARD_ALREADY_REVEALED", "Ushbu karta allaqachon ochilgan", 409)

    card_type = card.get("card_type", "question")
    is_correct = False
    if card_type == "question":
        options = [str(o) for o in card.get("options") or []]
        if not isinstance(answer, str) or not answer.strip():
            raise PlayRejected("ANSWER_REQUIRED", "Javobni tanlang", 400)
        if options and not any(_same(answer, o) for o in options):
            raise PlayRejected("INVALID_ANSWER", "Bunday javob varianti yo'q", 400)
        is_correct = bool(card.get("correct_answer")) and _same(answer, card.get("correct_answer"))
    doubles = room.setdefault("_double", {"1": False, "2": False})
    has_double = bool(doubles.get(str(team)))
    new_t1, new_t2, effect_msg = apply_bamboozle_card_effect(
        active_team=team, card_type=card_type, points=int(card.get("points") or 10),
        team1_score=room["team1_score"], team2_score=room["team2_score"],
        is_correct=is_correct, has_double=has_double,
    )
    if card_type == "double":
        doubles[str(team)] = True
    elif card_type == "question":
        doubles[str(team)] = False  # a 2x bonus is used by the next question, right or wrong
    room["double_pending"] = {k: bool(v) for k, v in doubles.items()}

    card["is_revealed"] = True
    card["revealed_by_team"] = team
    card["effect_message"] = effect_msg
    room["team1_score"], room["team2_score"] = new_t1, new_t2
    room["revealed_cards_count"] = sum(1 for c in room["cards"] if c.get("is_revealed"))
    team_label = room["team1_name"] if team == 1 else room["team2_name"]
    room.setdefault("logs", []).append(f"[{team_label}] #{card.get('order_index')}-kartani tanladi: {effect_msg}")
    room["active_turn"] = 2 if team == 1 else 1
    room["last_play"] = {
        "team": team, "cardId": str(card.get("id")), "cardType": card_type,
        "answer": answer if card_type == "question" else None,
        "isCorrect": is_correct if card_type == "question" else None,
        "message": effect_msg, "at": timezone.now().isoformat(),
    }
    room["version"] = int(room.get("version") or 0) + 1
    if room["revealed_cards_count"] >= room.get("total_cards", len(room["cards"])):
        room["status"] = "finished"
        if new_t1 > new_t2:
            room["logs"].append(f"🏆 O'yin tugadi! G'olib: {room['team1_name']} ({new_t1} ball)!")
        elif new_t2 > new_t1:
            room["logs"].append(f"🏆 O'yin tugadi! G'olib: {room['team2_name']} ({new_t2} ball)!")
        else:
            room["logs"].append(f"🤝 O'yin durang bilan yakunlandi ({new_t1} - {new_t2})!")
    room["logs"] = room["logs"][-50:]
    return room


def _fail(code: str, message: str, status: int, data: Any = None) -> JsonResponse:
    body: Dict[str, Any] = {"success": False, "error": {"code": code, "message": message}}
    if data is not None:
        body["data"] = data
    return JsonResponse(body, status=status)


def _body(request) -> Dict[str, Any]:
    try:
        body = json.loads(request.body.decode("utf-8")) if request.body else {}
    except Exception:
        body = {}
    return body if isinstance(body, dict) else {}


def _player_token(request, body: Dict[str, Any]) -> Any:
    return request.headers.get("X-Bamboozle-Player") or body.get("player_token")


def _name(value: Any, fallback: str) -> str:
    text = " ".join(str(value or "").split())[:40]
    return text or fallback


@csrf_exempt
def create_room_view(request):
    """POST /api/v1/bamboozle/rooms/create  {"deck_id": "...", "host_name": "Jasur"}

    The response carries the host's `player_token` (team 1) once; keep it to play."""
    if request.method != "POST":
        return _fail("METHOD_NOT_ALLOWED", "POST method required", 405)
    body = _body(request)
    user = request.user if hasattr(request, "user") and request.user.is_authenticated else None

    deck_id = body.get("deck_id") or body.get("deck")
    if not deck_id:
        decks = list_quiz_decks()
        if not decks:
            return _fail("DECK_NOT_FOUND", "Mavjud quiz to'plami topilmadi", 404)
        deck_id = decks[0]["id"]
    try:
        deck_detail = get_quiz_deck_detail(str(deck_id), user)
    except Exception:
        return _fail("DECK_NOT_FOUND", "To'plam topilmadi", 404)
    if not deck_detail.get("is_unlocked", True):
        return _fail("DECK_LOCKED", "Bu to'plam darsni tugatgandan keyin ochiladi", 403)

    host_name = _name(body.get("host_name") or (user.name if user else None), "O'yinchi 1")
    host_id = str(user.id) if user else f"anon-{secrets.token_hex(4)}"
    room_code = generate_room_code()

    cards_state = []
    for idx, c in enumerate((deck_detail.get("cards") or [])[:16], start=1):  # 16 cards: a fast 1v1
        card_type = c.get("card_type", "question")
        if card_type == "question" and not c.get("correct_answer"):
            continue  # an unanswerable question cannot be judged by the server
        cards_state.append({
            "id": c.get("id") or f"card-{idx}",
            "order_index": len(cards_state) + 1,
            "card_type": card_type,
            "points": c.get("points", 10),
            "question_text": c.get("question_text", f"Savol #{idx}"),
            "options": c.get("options", []),
            "correct_answer": c.get("correct_answer", ""),
            "is_revealed": False,
            "revealed_by_team": None,
            "effect_message": None,
        })
    if not cards_state:
        return _fail("DECK_EMPTY", "To'plamda o'ynash mumkin bo'lgan kartalar yo'q", 400)

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
        "double_pending": {"1": False, "2": False},
        "last_play": None,
        "version": 0,
        "share_url": share_url,
        "telegram_share_url": (
            f"https://t.me/share/url?url={share_url}"
            f"&text=🎮 Men bilan BestWay Bamboozle 1v1 arenasida bellashasanmi? Xona kodi: {room_code}"
        ),
        "created_at": timezone.now().isoformat(),
        "logs": [f"🎮 {host_name} 1v1 arenasini yaratdi. Do'st taklifini kutmoqda..."],
    }
    token = _issue_token(room_state, 1)
    save_cached_room(room_state)
    return JsonResponse({"success": True, "data": dict(public_room(room_state), player_token=token, my_team=1)}, status=201)


def get_room_view(request, room_code):
    """GET /api/v1/bamboozle/rooms/<room_code>  (public view: no unopened answers)."""
    room = get_cached_room(room_code)
    if not room:
        return _fail("ROOM_NOT_FOUND", "Bunday arena xonasi topilmadi yoki muddati o'tgan", 404)
    data = public_room(room)
    team = team_for_token(room, request.headers.get("X-Bamboozle-Player"))
    if team:
        data["my_team"] = team
    return JsonResponse({"success": True, "data": data})


@csrf_exempt
def join_room_view(request, room_code):
    """POST /api/v1/bamboozle/rooms/<room_code>/join  {"guest_name": "Madina"}

    The first guest takes team 2 and receives its `player_token`. A returning player
    (same signed-in account, or the token already held) keeps their seat."""
    if request.method != "POST":
        return _fail("METHOD_NOT_ALLOWED", "POST method required", 405)
    room = get_cached_room(room_code)
    if not room:
        return _fail("ROOM_NOT_FOUND", "Bunday arena xonasi topilmadi", 404)
    body = _body(request)
    user = request.user if hasattr(request, "user") and request.user.is_authenticated else None

    held = team_for_token(room, _player_token(request, body))
    if held:
        return JsonResponse({"success": True, "data": dict(public_room(room), my_team=held)})
    if user and str(user.id) == str(room.get("host_id")):
        return _fail("HOST_CANNOT_JOIN", "Siz bu xonaning egasisiz", 409)

    same_user = user is not None and room.get("guest_id") == str(user.id)
    if room.get("guest_id") and not same_user:
        return _fail("ROOM_FULL", "Xona to'lgan", 409, public_room(room))
    guest_name = _name(body.get("guest_name") or (user.name if user else None), "Raqib")
    room["guest_id"] = str(user.id) if user else f"guest-{secrets.token_hex(4)}"
    room["guest_name"] = guest_name
    room["team2_name"] = guest_name
    if room.get("status") == "waiting":
        room["status"] = "active"
        room.setdefault("logs", []).append(f"⚔️ {guest_name} jangga qo'shildi! Bellashuv boshlandi!")
    room["version"] = int(room.get("version") or 0) + 1
    token = _issue_token(room, 2)
    save_cached_room(room)
    return JsonResponse({"success": True, "data": dict(public_room(room), player_token=token, my_team=2)})


@csrf_exempt
def play_room_action_view(request, room_code):
    """POST /api/v1/bamboozle/rooms/<room_code>/play
    Header `X-Bamboozle-Player: <player_token>`; body {"card_id": "...", "answer": "<option>"}.

    `answer` is required for question cards and judged here. Client claims such as
    `is_correct`, `team` or `has_double` are ignored."""
    if request.method != "POST":
        return _fail("METHOD_NOT_ALLOWED", "POST method required", 405)
    body = _body(request)
    lock_key = f"{CACHE_PREFIX}lock:{str(room_code).upper().strip()}"
    if not cache.add(lock_key, 1, timeout=5):
        return _fail("BUSY", "Boshqa harakat bajarilmoqda, qayta urinib ko'ring", 409)
    try:
        room = get_cached_room(room_code)
        if not room:
            return _fail("ROOM_NOT_FOUND", "Arena topilmadi", 404)
        try:
            apply_play(room, _player_token(request, body), body.get("card_id"), body.get("answer"))
        except PlayRejected as rejected:
            return _fail(rejected.code, rejected.message, rejected.status)
        save_cached_room(room)
        team = team_for_token(room, _player_token(request, body))
        return JsonResponse({"success": True, "data": dict(public_room(room), my_team=team)})
    finally:
        cache.delete(lock_key)
