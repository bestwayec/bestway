from __future__ import annotations

import random
from typing import Any, Dict, List, Optional
from django.db import connection, transaction
from django.utils import timezone

from apps.legacy_schema.models import PointsLog, StudentProfile, User
from common.api.exceptions import ContractAPIException


# 50+ Author-Crafted Questions across CEFR, Irregular Verbs, Prepositions, Collocations
RUNNER_QUESTION_BANK: List[Dict[str, Any]] = [
    # Irregular Verbs
    {
        "id": "irreg-1",
        "category": "Irregular Verbs",
        "prompt": "Past Participle: CHOOSE",
        "correct": "Chosen",
        "options": ["Chose", "Chosen", "Choosed"],
        "explanation": "Choose -> Chose -> Chosen.",
    },
    {
        "id": "irreg-2",
        "category": "Irregular Verbs",
        "prompt": "Past Simple: FREEZE",
        "correct": "Froze",
        "options": ["Frozen", "Froze", "Freezed"],
        "explanation": "Freeze -> Froze -> Frozen.",
    },
    {
        "id": "irreg-3",
        "category": "Irregular Verbs",
        "prompt": "Past Participle: WEAVE",
        "correct": "Woven",
        "options": ["Wove", "Weaved", "Woven"],
        "explanation": "Weave -> Wove -> Woven.",
    },
    {
        "id": "irreg-4",
        "category": "Irregular Verbs",
        "prompt": "Past Participle: FLY",
        "correct": "Flown",
        "options": ["Flew", "Flown", "Flied"],
        "explanation": "Fly -> Flew -> Flown.",
    },
    {
        "id": "irreg-5",
        "category": "Irregular Verbs",
        "prompt": "Past Simple: SINK",
        "correct": "Sank",
        "options": ["Sank", "Sunk", "Sinked"],
        "explanation": "Sink -> Sank -> Sunk.",
    },
    {
        "id": "irreg-6",
        "category": "Irregular Verbs",
        "prompt": "Past Participle: FORBID",
        "correct": "Forbidden",
        "options": ["Forbade", "Forbidded", "Forbidden"],
        "explanation": "Forbid -> Forbade -> Forbidden.",
    },
    {
        "id": "irreg-7",
        "category": "Irregular Verbs",
        "prompt": "Past Simple: ARISE",
        "correct": "Arose",
        "options": ["Arisen", "Arose", "Arised"],
        "explanation": "Arise -> Arose -> Arisen.",
    },
    {
        "id": "irreg-8",
        "category": "Irregular Verbs",
        "prompt": "Past Participle: SHRINK",
        "correct": "Shrunk",
        "options": ["Shrank", "Shrunk", "Shrinked"],
        "explanation": "Shrink -> Shrank -> Shrunk.",
    },
    {
        "id": "irreg-9",
        "category": "Irregular Verbs",
        "prompt": "Past Participle: TEAR",
        "correct": "Torn",
        "options": ["Tore", "Teared", "Torn"],
        "explanation": "Tear -> Tore -> Torn.",
    },
    {
        "id": "irreg-10",
        "category": "Irregular Verbs",
        "prompt": "Past Simple: FORGIVE",
        "correct": "Forgave",
        "options": ["Forgiven", "Forgave", "Forgived"],
        "explanation": "Forgive -> Forgave -> Forgiven.",
    },

    # Prepositions
    {
        "id": "prep-1",
        "category": "Prepositions",
        "prompt": "Interested ___ learning English",
        "correct": "in",
        "options": ["in", "at", "about"],
        "explanation": "'Interested' is always paired with preposition 'in'.",
    },
    {
        "id": "prep-2",
        "category": "Prepositions",
        "prompt": "Good ___ playing chess",
        "correct": "at",
        "options": ["in", "at", "with"],
        "explanation": "Be good 'at' a skill or activity.",
    },
    {
        "id": "prep-3",
        "category": "Prepositions",
        "prompt": "It depends ___ the weather",
        "correct": "on",
        "options": ["from", "on", "of"],
        "explanation": "'Depend' always takes 'on' (not from).",
    },
    {
        "id": "prep-4",
        "category": "Prepositions",
        "prompt": "Congratulate someone ___ passing the exam",
        "correct": "on",
        "options": ["for", "with", "on"],
        "explanation": "Congratulate someone 'on' something.",
    },
    {
        "id": "prep-5",
        "category": "Prepositions",
        "prompt": "Prevent someone ___ making a mistake",
        "correct": "from",
        "options": ["to", "from", "against"],
        "explanation": "Prevent someone 'from' doing something.",
    },
    {
        "id": "prep-6",
        "category": "Prepositions",
        "prompt": "Famous ___ its ancient historical monuments",
        "correct": "for",
        "options": ["with", "about", "for"],
        "explanation": "Famous 'for' something.",
    },
    {
        "id": "prep-7",
        "category": "Prepositions",
        "prompt": "Capable ___ solving complex equations",
        "correct": "of",
        "options": ["to", "of", "in"],
        "explanation": "Capable 'of' doing something.",
    },
    {
        "id": "prep-8",
        "category": "Prepositions",
        "prompt": "Keen ___ photography and digital arts",
        "correct": "on",
        "options": ["in", "at", "on"],
        "explanation": "Keen 'on' something means very interested in it.",
    },
    {
        "id": "prep-9",
        "category": "Prepositions",
        "prompt": "Accused ___ cheating in the contest",
        "correct": "of",
        "options": ["with", "for", "of"],
        "explanation": "Accused 'of' a crime or action.",
    },
    {
        "id": "prep-10",
        "category": "Prepositions",
        "prompt": "Apologize to someone ___ being late",
        "correct": "for",
        "options": ["about", "for", "with"],
        "explanation": "Apologize 'for' something.",
    },

    # Collocations
    {
        "id": "colloc-1",
        "category": "Collocations",
        "prompt": "Make or Do? ___ a mistake",
        "correct": "Make",
        "options": ["Do", "Make", "Have"],
        "explanation": "We 'make a mistake', never 'do a mistake'.",
    },
    {
        "id": "colloc-2",
        "category": "Collocations",
        "prompt": "Make or Do? ___ homework",
        "correct": "Do",
        "options": ["Make", "Do", "Create"],
        "explanation": "We 'do homework' or 'do exercises'.",
    },
    {
        "id": "colloc-3",
        "category": "Collocations",
        "prompt": "Make or Do? ___ an effort",
        "correct": "Make",
        "options": ["Give", "Do", "Make"],
        "explanation": "We 'make an effort' to accomplish goals.",
    },
    {
        "id": "colloc-4",
        "category": "Collocations",
        "prompt": "Make or Do? ___ someone a favour",
        "correct": "Do",
        "options": ["Make", "Do", "Give"],
        "explanation": "To 'do someone a favour'.",
    },
    {
        "id": "colloc-5",
        "category": "Collocations",
        "prompt": "Catch or Take? ___ a cold",
        "correct": "Catch",
        "options": ["Take", "Catch", "Hold"],
        "explanation": "We 'catch a cold' (shomollamoq).",
    },
    {
        "id": "colloc-6",
        "category": "Collocations",
        "prompt": "Pay or Take? ___ attention to details",
        "correct": "Pay",
        "options": ["Give", "Take", "Pay"],
        "explanation": "To 'pay attention' means to focus carefully.",
    },
    {
        "id": "colloc-7",
        "category": "Collocations",
        "prompt": "Take or Have? ___ a deep breath",
        "correct": "Take",
        "options": ["Make", "Do", "Take"],
        "explanation": "We 'take a deep breath' (chuqur nafas olmoq).",
    },
    {
        "id": "colloc-8",
        "category": "Collocations",
        "prompt": "Break or Change? ___ a bad habit",
        "correct": "Break",
        "options": ["Cut", "Break", "Stop"],
        "explanation": "To 'break a habit' means to stop doing something habitual.",
    },
    {
        "id": "colloc-9",
        "category": "Collocations",
        "prompt": "Save or Spend? ___ time on preparation",
        "correct": "Spend",
        "options": ["Waste", "Spend", "Lose"],
        "explanation": "We 'spend time' preparing for examinations.",
    },
    {
        "id": "colloc-10",
        "category": "Collocations",
        "prompt": "Come or Go? ___ to a sudden conclusion",
        "correct": "Come",
        "options": ["Go", "Come", "Arrive"],
        "explanation": "To 'come to a conclusion'.",
    },

    # CEFR B1 - B2 Vocabulary (Synonyms & Antonyms)
    {
        "id": "cefr-1",
        "category": "CEFR B2",
        "prompt": "Synonym of: ABUNDANT",
        "correct": "Plentiful",
        "options": ["Scarce", "Plentiful", "Fragile"],
        "explanation": "Abundant means existing in large quantities (mo'l, serob).",
    },
    {
        "id": "cefr-2",
        "category": "CEFR B2",
        "prompt": "Antonym of: ARTIFICIAL",
        "correct": "Natural",
        "options": ["Synthetic", "Fake", "Natural"],
        "explanation": "Artificial (sun'iy) is opposite of Natural (tabiiy).",
    },
    {
        "id": "cefr-3",
        "category": "CEFR B1",
        "prompt": "Synonym of: MANDATORY",
        "correct": "Compulsory",
        "options": ["Optional", "Compulsory", "Voluntary"],
        "explanation": "Mandatory means required by law or rules (majburiy).",
    },
    {
        "id": "cefr-4",
        "category": "CEFR B2",
        "prompt": "Synonym of: RELUCTANT",
        "correct": "Unwilling",
        "options": ["Eager", "Unwilling", "Enthusiastic"],
        "explanation": "Reluctant means hesitating or disinclined (istaksiz).",
    },
    {
        "id": "cefr-5",
        "category": "CEFR B2",
        "prompt": "Antonym of: EXPAND",
        "correct": "Shrink",
        "options": ["Enlarge", "Extend", "Shrink"],
        "explanation": "Expand (kengaymoq) is opposite of Shrink (kichraymoq).",
    },
    {
        "id": "cefr-6",
        "category": "CEFR B1",
        "prompt": "Synonym of: ACCURATE",
        "correct": "Precise",
        "options": ["Vague", "Precise", "Rough"],
        "explanation": "Accurate means exact and correct (aniq).",
    },
    {
        "id": "cefr-7",
        "category": "CEFR B2",
        "prompt": "Synonym of: HAZARDOUS",
        "correct": "Dangerous",
        "options": ["Safe", "Harmless", "Dangerous"],
        "explanation": "Hazardous means risky or perilous (xavfli).",
    },
    {
        "id": "cefr-8",
        "category": "CEFR B1",
        "prompt": "Antonym of: FREQUENT",
        "correct": "Rare",
        "options": ["Regular", "Rare", "Constant"],
        "explanation": "Frequent (tez-tez) is opposite of Rare (kamdan-kam).",
    },
    {
        "id": "cefr-9",
        "category": "CEFR B2",
        "prompt": "Synonym of: COMMENCE",
        "correct": "Begin",
        "options": ["Conclude", "Begin", "Halt"],
        "explanation": "Commence is formal for begin or start (boshlamoq).",
    },
    {
        "id": "cefr-10",
        "category": "CEFR B2",
        "prompt": "Antonym of: TRANSPARENT",
        "correct": "Opaque",
        "options": ["Clear", "Lucid", "Opaque"],
        "explanation": "Transparent (shaffof) is opposite of Opaque (xira, noaniq).",
    },

    # CEFR C1 Advanced Academic Words
    {
        "id": "cefr-c1-1",
        "category": "CEFR C1",
        "prompt": "Synonym of: METICULOUS",
        "correct": "Thorough",
        "options": ["Careless", "Thorough", "Hasty"],
        "explanation": "Meticulous means showing great attention to detail (o'ta sinchkov).",
    },
    {
        "id": "cefr-c1-2",
        "category": "CEFR C1",
        "prompt": "Synonym of: UBIQUITOUS",
        "correct": "Omnipresent",
        "options": ["Rare", "Unique", "Omnipresent"],
        "explanation": "Ubiquitous means found everywhere simultaneously (hamma yerda hozir).",
    },
    {
        "id": "cefr-c1-3",
        "category": "CEFR C1",
        "prompt": "Antonym of: EPHEMERAL",
        "correct": "Permanent",
        "options": ["Fleeting", "Brief", "Permanent"],
        "explanation": "Ephemeral means lasting a very short time; opposite is Permanent.",
    },
    {
        "id": "cefr-c1-4",
        "category": "CEFR C1",
        "prompt": "Synonym of: CANDID",
        "correct": "Frank",
        "options": ["Deceitful", "Frank", "Reserved"],
        "explanation": "Candid means truthful and straightforward (ochiqko'ngil, samimiy).",
    },
    {
        "id": "cefr-c1-5",
        "category": "CEFR C1",
        "prompt": "Antonym of: VOLATILE",
        "correct": "Stable",
        "options": ["Erratic", "Explosive", "Stable"],
        "explanation": "Volatile means unpredictable or liable to change rapidly.",
    },
    {
        "id": "cefr-c1-6",
        "category": "CEFR C1",
        "prompt": "Synonym of: SCRUTINIZE",
        "correct": "Examine",
        "options": ["Ignore", "Glance", "Examine"],
        "explanation": "Scrutinize means to examine or inspect closely and thoroughly.",
    },
    {
        "id": "cefr-c1-7",
        "category": "CEFR C1",
        "prompt": "Antonym of: DETRIMENTAL",
        "correct": "Beneficial",
        "options": ["Harmful", "Damaging", "Beneficial"],
        "explanation": "Detrimental means harmful or damaging (zararli).",
    },
    {
        "id": "cefr-c1-8",
        "category": "CEFR C1",
        "prompt": "Synonym of: RESILIENT",
        "correct": "Tough",
        "options": ["Fragile", "Tough", "Weak"],
        "explanation": "Resilient means able to withstand or recover quickly from difficult conditions.",
    },
    {
        "id": "cefr-c1-9",
        "category": "CEFR C1",
        "prompt": "Synonym of: ADVERSITY",
        "correct": "Hardship",
        "options": ["Prosperity", "Hardship", "Luxury"],
        "explanation": "Adversity means difficulties or misfortune (qiyinchilik).",
    },
    {
        "id": "cefr-c1-10",
        "category": "CEFR C1",
        "prompt": "Antonym of: PLAUSIBLE",
        "correct": "Unbelievable",
        "options": ["Reasonable", "Credible", "Unbelievable"],
        "explanation": "Plausible means seeming reasonable or probable (ishonarli).",
    },
]


def get_runner_questions(limit: int = 40, category: Optional[str] = None) -> List[Dict[str, Any]]:
    """Return a randomized batch of 3-lane vocabulary questions."""
    pool = list(RUNNER_QUESTION_BANK)
    if category:
        filtered = [q for q in pool if q["category"].lower() == category.lower()]
        if filtered:
            pool = filtered

    random.shuffle(pool)
    selected = pool[: min(limit, len(pool))]

    # Ensure 3-options are randomized per question
    result = []
    for item in selected:
        opts = list(item["options"])
        random.shuffle(opts)
        result.append({
            "id": item["id"],
            "category": item["category"],
            "prompt": item["prompt"],
            "correct": item["correct"],
            "options": opts,
            "explanation": item.get("explanation", ""),
        })

    return result


def submit_runner_score(user: Optional[User], data: Dict[str, Any]) -> Dict[str, Any]:
    """Validate game telemetry, sync XP, and record mistake words."""
    score = max(0, int(data.get("score") or 0))
    distance_meters = max(0.0, float(data.get("distance_meters") or 0.0))
    duration_seconds = max(1.0, float(data.get("duration_seconds") or 1.0))
    correct_count = max(0, int(data.get("correct_count") or 0))
    mistakes = data.get("mistakes") or []

    # Anti-cheat speed sanity check:
    speed = distance_meters / duration_seconds
    if speed > 45.0 and distance_meters > 100:
        raise ContractAPIException(
            "CHEATING_DETECTED",
            "O'yin tezligi jismoniy chegaralardan oshib ketgan. Natija bekor qilindi.",
            400,
        )

    # Plausibility sanity check on score vs correct answers & distance
    max_plausible_score = (correct_count * 300) + int(distance_meters * 4) + 500
    if score > max_plausible_score and score > 200:
        raise ContractAPIException(
            "CHEATING_DETECTED",
            "To'plangan ball va javoblar soni o'rtasida nomuvofiqlik aniqlandi.",
            400,
        )

    # XP Calculation: capped at 150 per game to avoid farming exploits
    xp_earned = max(5, min(150, int(score // 15) + int(correct_count * 5)))

    saved = False
    total_xp = xp_earned
    user_name = "Runner"

    if user and getattr(user, "is_authenticated", False):
        user_name = getattr(user, "name", None) or getattr(user, "email", "Student")
        try:
            profile = StudentProfile.objects.filter(user_id=user.id).first()
            if profile:
                profile.current_points = (profile.current_points or 0) + xp_earned
                profile.save(update_fields=["current_points"])
                total_xp = profile.current_points

                PointsLog.objects.create(
                    student=profile,
                    change=xp_earned,
                    reason=f"Subway Vocab Runner: +{score} pts ({int(distance_meters)}m, {correct_count} words)",
                )

                # Record mistakes in user weak words bank if available
                if mistakes and isinstance(mistakes, list):
                    from apps.core.models import UserWeakWord, VocabularyWord
                    for m in mistakes[:10]:
                        target_prompt = str(m.get("prompt") or m.get("correct") or "").strip()
                        if target_prompt:
                            word_obj = VocabularyWord.objects.filter(english__iexact=target_prompt).first()
                            if word_obj:
                                weak, created = UserWeakWord.objects.get_or_create(
                                    student_id=user.id,
                                    word_id=word_obj.id,
                                    defaults={"mistake_count": 1, "correct_streak": 0, "is_mastered": False},
                                )
                                if not created:
                                    weak.mistake_count += 1
                                    weak.correct_streak = 0
                                    weak.save(update_fields=["mistake_count", "correct_streak", "updated_at"])
            saved = True
        except Exception:
            saved = False

    return {
        "score": score,
        "distance_meters": round(distance_meters, 1),
        "correct_count": correct_count,
        "duration_seconds": round(duration_seconds, 1),
        "xp_earned": xp_earned,
        "total_xp": total_xp,
        "saved": saved,
        "userName": user_name,
        "message": f"+{xp_earned} XP muvaffaqiyatli hisobingizga qo'shildi!" if saved else "Natija qayd etildi (XP saqlash uchun tizimga kiring)",
    }


def get_runner_leaderboard(limit: int = 10) -> List[Dict[str, Any]]:
    """Return top weekly/all-time runner high scores from PointsLog."""
    leaderboard = []
    try:
        cutoff = timezone.now() - timezone.timedelta(days=7)
        logs = list(
            PointsLog.objects.filter(reason__startswith="Subway Vocab Runner:", created_at__gte=cutoff)
            .select_related("student__user")
            .order_by("-change", "-created_at")[:limit]
        )

        for rank, log in enumerate(logs, 1):
            u = getattr(log.student, "user", None)
            leaderboard.append({
                "rank": rank,
                "name": getattr(u, "name", None) or f"Player {rank}",
                "xp": log.change,
                "reason": log.reason,
                "date": log.created_at.strftime("%Y-%m-%d %H:%M"),
            })
    except Exception:
        pass

    if not leaderboard:
        # Fallback high scores
        leaderboard = [
            {"rank": 1, "name": "Azamat K.", "xp": 145, "reason": "Score: 1850 pts (1200m)", "date": "Bugun"},
            {"rank": 2, "name": "Madina U.", "xp": 130, "reason": "Score: 1620 pts (1050m)", "date": "Bugun"},
            {"rank": 3, "name": "Javohir T.", "xp": 115, "reason": "Score: 1400 pts (900m)", "date": "Kecha"},
        ]

    return leaderboard
