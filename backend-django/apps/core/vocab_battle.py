"""Vocab Battle Engine - Live Classroom Kahoot-style Quiz Competition."""
import logging
import random
from typing import Any
from uuid import uuid4
from django.db.models import F
from django.utils import timezone
from apps.core.models import BattleStatus, VocabBattleSession, VocabularySet, VocabularyWord
from apps.legacy_schema.models import PointsLog, StudentProfile, User
from common.api.exceptions import ContractAPIException

logger = logging.getLogger(__name__)


def create_battle_session(host_user, set_id: str, question_count: int = 10) -> dict[str, Any]:
    """Create a new live battle session with 6-digit PIN and randomized 4-option questions."""
    vocab_set = VocabularySet.objects.prefetch_related("words").filter(id=set_id).first()
    if not vocab_set:
        raise ContractAPIException("VOCABULARY_SET_NOT_FOUND", "Lug'at to'plami topilmadi", 404)

    words = list(vocab_set.words.all())
    if len(words) < 2:
        raise ContractAPIException("NOT_ENOUGH_WORDS", "Bellashuv uchun kamida 2 ta so'z bo'lishi kerak", 400)

    # Generate 6-digit PIN
    pin = f"{random.randint(100000, 999999)}"
    while VocabBattleSession.objects.filter(pin=pin, status__in=[BattleStatus.WAITING, BattleStatus.QUESTION, BattleStatus.LEADERBOARD]).exists():
        pin = f"{random.randint(100000, 999999)}"

    # Sample words
    sample_size = min(len(words), question_count)
    selected_words = random.sample(words, sample_size)

    # Distractor pool
    all_uzbek_translations = [w.uzbek for w in words]
    if len(all_uzbek_translations) < 4:
        # Fallback common distractors if small set
        all_uzbek_translations.extend(["kitob", "qalam", "uy", "yo'l", "do'st", "maktab", "daraxt"])

    questions = []
    for idx, word in enumerate(selected_words):
        correct_answer = word.uzbek
        distractors = [u for u in all_uzbek_translations if u != correct_answer]
        random.shuffle(distractors)
        chosen_distractors = distractors[:3]

        options = [correct_answer] + chosen_distractors
        random.shuffle(options)
        correct_index = options.index(correct_answer)

        questions.append({
            "questionId": f"q_{idx + 1}",
            "english": word.english,
            "prompt": f"'{word.english}' so'zining to'g'ri tarjimasi qaysi?",
            "options": options,
            "correctIndex": correct_index,
            "timeLimit": 15,
        })

    session = VocabBattleSession.objects.create(
        pin=pin,
        set=vocab_set,
        host=host_user,
        status=BattleStatus.WAITING,
        current_question_index=0,
        questions=questions,
        participants={},
    )

    return {
        "sessionId": session.id,
        "pin": session.pin,
        "setTitle": vocab_set.title,
        "level": vocab_set.level,
        "totalQuestions": len(questions),
        "status": session.status,
    }


def join_battle(pin: str, user) -> dict[str, Any]:
    """Join a live battle by PIN."""
    session = VocabBattleSession.objects.select_related("set").filter(pin=pin).first()
    if not session:
        raise ContractAPIException("BATTLE_NOT_FOUND", "Ushbu PIN-kodli bellashuv topilmadi", 404)

    if session.status == BattleStatus.FINISHED:
        raise ContractAPIException("BATTLE_FINISHED", "Ushbu bellashuv allaqachon yakunlangan", 400)

    user_id = str(user.id)
    user_name = getattr(user, "name", "O'quvchi") or "O'quvchi"

    participants = dict(session.participants or {})
    if user_id not in participants:
        participants[user_id] = {
            "id": user_id,
            "name": user_name,
            "score": 0,
            "streak": 0,
            "answers": {},
            "joinedAt": timezone.now().isoformat(),
        }
        session.participants = participants
        session.save(update_fields=["participants", "updated_at"])

    return get_battle_state(pin, current_user=user)


def get_battle_state(pin: str, current_user=None) -> dict[str, Any]:
    """Retrieve full live state of a battle session."""
    session = VocabBattleSession.objects.select_related("set", "host").filter(pin=pin).first()
    if not session:
        raise ContractAPIException("BATTLE_NOT_FOUND", "Bellashuv topilmadi", 404)

    is_host = bool(current_user and str(current_user.id) == str(session.host_id))
    q_idx = session.current_question_index
    questions = session.questions or []
    current_q = questions[q_idx] if 0 <= q_idx < len(questions) else None

    # Mask correctIndex for students while in QUESTION state
    sanitized_q = None
    if current_q:
        sanitized_q = {
            "questionId": current_q["questionId"],
            "english": current_q["english"],
            "prompt": current_q["prompt"],
            "options": current_q["options"],
            "timeLimit": current_q.get("timeLimit", 15),
        }
        if is_host or session.status in (BattleStatus.LEADERBOARD, BattleStatus.FINISHED):
            sanitized_q["correctIndex"] = current_q["correctIndex"]

    # Calculate participant leaderboard
    participants_map = dict(session.participants or {})
    leaderboard = sorted(
        participants_map.values(),
        key=lambda p: (p.get("score", 0), p.get("streak", 0)),
        reverse=True,
    )

    # Check answered count for current question
    answered_count = 0
    curr_q_id = current_q["questionId"] if current_q else ""
    for p in participants_map.values():
        if curr_q_id in p.get("answers", {}):
            answered_count += 1

    user_id = str(current_user.id) if current_user else None
    my_state = participants_map.get(user_id) if user_id else None

    return {
        "sessionId": session.id,
        "pin": session.pin,
        "setTitle": session.set.title,
        "level": session.set.level,
        "hostName": getattr(session.host, "name", "Ustoz") if session.host else "Ustoz",
        "isHost": is_host,
        "status": session.status,
        "currentQuestionIndex": q_idx,
        "totalQuestions": len(questions),
        "currentQuestion": sanitized_q,
        "answeredCount": answered_count,
        "totalParticipants": len(participants_map),
        "leaderboard": leaderboard[:10],
        "myState": my_state,
    }


def submit_battle_answer(pin: str, user, question_index: int, selected_index: int, elapsed_sec: float = 0.0) -> dict[str, Any]:
    """Submit an answer to current battle question and calculate speed/streak points."""
    session = VocabBattleSession.objects.filter(pin=pin).first()
    if not session:
        raise ContractAPIException("BATTLE_NOT_FOUND", "Bellashuv topilmadi", 404)

    if session.status != BattleStatus.QUESTION:
        raise ContractAPIException("NOT_IN_QUESTION_STATE", "Savol qabul qilish vaqti tugagan", 400)

    if session.current_question_index != question_index:
        raise ContractAPIException("QUESTION_MISMATCH", "Savol indeksi mos kelmadi", 400)

    questions = session.questions or []
    if question_index < 0 or question_index >= len(questions):
        raise ContractAPIException("INVALID_QUESTION", "Noto'g'ri savol", 400)

    q = questions[question_index]
    correct_index = q["correctIndex"]
    is_correct = selected_index == correct_index

    user_id = str(user.id)
    participants = dict(session.participants or {})
    if user_id not in participants:
        participants[user_id] = {
            "id": user_id,
            "name": getattr(user, "name", "O'quvchi") or "O'quvchi",
            "score": 0,
            "streak": 0,
            "answers": {},
        }

    p = participants[user_id]
    q_id = q["questionId"]
    if q_id in p.get("answers", {}):
        # Already answered
        ans = p["answers"][q_id]
        return {
            "isCorrect": ans["isCorrect"],
            "correctIndex": correct_index,
            "pointsGained": ans.get("pointsGained", 0),
            "totalScore": p.get("score", 0),
            "streak": p.get("streak", 0),
            "alreadyAnswered": True,
        }

    # Points formula: 100 base + speed_bonus (0..150) + streak_bonus
    time_limit = q.get("timeLimit", 15)
    speed_factor = max(0.0, float(time_limit) - min(float(elapsed_sec), float(time_limit)))
    speed_bonus = int(speed_factor * 10)  # e.g. 10s left -> +100 bonus

    if is_correct:
        streak = p.get("streak", 0) + 1
        streak_bonus = min(streak * 20, 100)
        points_gained = 100 + speed_bonus + streak_bonus
        p["score"] = p.get("score", 0) + points_gained
        p["streak"] = streak
    else:
        points_gained = 0
        p["streak"] = 0

    p.setdefault("answers", {})[q_id] = {
        "selectedIndex": selected_index,
        "isCorrect": is_correct,
        "pointsGained": points_gained,
        "elapsedSec": elapsed_sec,
    }

    session.participants = participants
    session.save(update_fields=["participants", "updated_at"])

    return {
        "isCorrect": is_correct,
        "correctIndex": correct_index,
        "pointsGained": points_gained,
        "totalScore": p["score"],
        "streak": p["streak"],
        "alreadyAnswered": False,
    }


def next_battle_step(pin: str, host_user) -> dict[str, Any]:
    """Advance the battle state (WAITING -> QUESTION -> LEADERBOARD -> ... -> FINISHED)."""
    session = VocabBattleSession.objects.filter(pin=pin).first()
    if not session:
        raise ContractAPIException("BATTLE_NOT_FOUND", "Bellashuv topilmadi", 404)

    if str(session.host_id) != str(host_user.id):
        raise ContractAPIException("NOT_HOST", "Faqat mezbon o'qituvchi boshqara oladi", 403)

    questions = session.questions or []
    total_q = len(questions)

    if session.status == BattleStatus.WAITING:
        session.status = BattleStatus.QUESTION
        session.current_question_index = 0
    elif session.status == BattleStatus.QUESTION:
        session.status = BattleStatus.LEADERBOARD
    elif session.status == BattleStatus.LEADERBOARD:
        if session.current_question_index + 1 < total_q:
            session.current_question_index += 1
            session.status = BattleStatus.QUESTION
        else:
            session.status = BattleStatus.FINISHED
            finish_battle_and_award_points(session)
    elif session.status == BattleStatus.FINISHED:
        return get_battle_state(pin, current_user=host_user)

    session.save(update_fields=["status", "current_question_index", "updated_at"])
    return get_battle_state(pin, current_user=host_user)


def finish_battle_and_award_points(session: VocabBattleSession) -> list[dict[str, Any]]:
    """Award +10, +7, +5 points to Top 3 podium winners and record PointsLog."""
    participants = dict(session.participants or {}).values()
    sorted_players = sorted(participants, key=lambda p: (p.get("score", 0), p.get("streak", 0)), reverse=True)

    podium_awards = [(1, 10), (2, 7), (3, 5)]
    winners = []

    for rank, pts in podium_awards:
        if len(sorted_players) >= rank:
            player = sorted_players[rank - 1]
            p_id = player["id"]
            p_name = player.get("name", "O'quvchi")

            # Award points to student profile
            StudentProfile.objects.filter(user_id=p_id).update(
                current_points=F("current_points") + pts
            )
            PointsLog.objects.create(
                id=str(uuid4()),
                student_id=p_id,
                change=pts,
                reason=f"Vocab Battle {rank}-o'rin ({session.set.title})",
                by_user_id=session.host_id,
                created_at=timezone.now(),
            )
            winners.append({
                "rank": rank,
                "studentId": p_id,
                "name": p_name,
                "score": player.get("score", 0),
                "pointsAwarded": pts,
            })

    session.status = BattleStatus.FINISHED
    session.save(update_fields=["status", "updated_at"])
    return winners
