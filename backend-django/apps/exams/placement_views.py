"""Express Placement Test & Guest Session Engine.

Provides an adaptive 10-minute diagnostic test calibrated against CEFR (A1-C1)
and IELTS Band (4.0-8.0), guest session handling with IP rate limiting (5 tests/hour),
scoring & weak grammar topics diagnostics, and frictionless claim migration to student profiles.
"""
from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Dict, List, Optional

from django.core.cache import cache
from django.db import connection, transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from apps.core.models import PlacementTestResult
from apps.exams.analytics_service import find_matching_lesson_for_topic
from apps.legacy_schema.models import StudentProfile, User
from common.auth.authentication import BestwayJWTAuthentication

logger = logging.getLogger(__name__)

RATE_LIMIT_PREFIX = "placement_test_rate:"
SESSION_PREFIX = "placement_session:"
RESULT_PREFIX = "placement_result:"

# 20 calibrated CEFR questions: 4 A1/A2, 6 B1, 6 B2, 4 C1
PLACEMENT_QUESTIONS: List[Dict[str, Any]] = [
    # --- A1 / A2 (4 questions) ---
    {
        "id": "q1",
        "number": 1,
        "level": "A1/A2",
        "skill": "grammar",
        "topic": "Present Simple Tense",
        "prompt": "She usually ______ coffee in the morning, but today she is drinking green tea.",
        "options": [
            {"key": "A", "text": "drinks"},
            {"key": "B", "text": "is drinking"},
            {"key": "C", "text": "drink"},
            {"key": "D", "text": "drank"},
        ],
        "correct_option": "A",
        "explanation": "Doimiy odatlar uchun Present Simple qo'llaniladi (she drinks).",
    },
    {
        "id": "q2",
        "number": 2,
        "level": "A1/A2",
        "skill": "vocabulary",
        "topic": "Prepositions of Place, Time & Movement",
        "prompt": "Could you please ______ the light? It is too dark to read in this room.",
        "options": [
            {"key": "A", "text": "turn on"},
            {"key": "B", "text": "make on"},
            {"key": "C", "text": "put off"},
            {"key": "D", "text": "get in"},
        ],
        "correct_option": "A",
        "explanation": "Chiroqni yoqish iborasi 'turn on' bo'ladi.",
    },
    {
        "id": "q3",
        "number": 3,
        "level": "A1/A2",
        "skill": "grammar",
        "topic": "Past Simple Tense & Used to",
        "prompt": "Last night, they ______ to an Italian restaurant and enjoyed delicious pasta.",
        "options": [
            {"key": "A", "text": "go"},
            {"key": "B", "text": "went"},
            {"key": "C", "text": "have gone"},
            {"key": "D", "text": "was going"},
        ],
        "correct_option": "B",
        "explanation": "'Last night' aniq o'tgan zamon signali, fe'lning 2-shakli 'went' ishlatiladi.",
    },
    {
        "id": "q4",
        "number": 4,
        "level": "A1/A2",
        "skill": "reading",
        "topic": "Articles (Artikllar: a, an, the)",
        "prompt": "'The library is closed on Mondays and national holidays. On weekdays, doors open at 9:00 AM.' According to the notice, when can visitors enter?",
        "options": [
            {"key": "A", "text": "Every Monday morning"},
            {"key": "B", "text": "Tuesday morning at 9:00 AM"},
            {"key": "C", "text": "On national holiday mornings"},
            {"key": "D", "text": "Only on weekends"},
        ],
        "correct_option": "B",
        "explanation": "Dushanbadan tashqari ish kunlari (masalan Seshanba) soat 9:00 da ochiq bo'ladi.",
    },
    # --- B1 (6 questions) ---
    {
        "id": "q5",
        "number": 5,
        "level": "B1",
        "skill": "grammar",
        "topic": "Present Perfect Tense",
        "prompt": "I have lived in Tashkent ______ 2018, and I really enjoy the dynamic city life.",
        "options": [
            {"key": "A", "text": "for"},
            {"key": "B", "text": "since"},
            {"key": "C", "text": "during"},
            {"key": "D", "text": "ago"},
        ],
        "correct_option": "B",
        "explanation": "Aniq boshlanish nuqtasi (2018) ko'rsatilganda 'since' ishlatiladi.",
    },
    {
        "id": "q6",
        "number": 6,
        "level": "B1",
        "skill": "grammar",
        "topic": "Modal Verbs & Modal Perfects",
        "prompt": "You ______ touch that exposed cable; it carries 220 volts and is extremely dangerous.",
        "options": [
            {"key": "A", "text": "don't have to"},
            {"key": "B", "text": "shouldn't have"},
            {"key": "C", "text": "mustn't"},
            {"key": "D", "text": "might not"},
        ],
        "correct_option": "C",
        "explanation": "Qat'iy taqiq uchun 'mustn't' ishlatiladi.",
    },
    {
        "id": "q7",
        "number": 7,
        "level": "B1",
        "skill": "grammar",
        "topic": "Conditionals (0, 1st, 2nd, 3rd & Mixed)",
        "prompt": "If I ______ enough money right now, I would travel across Europe.",
        "options": [
            {"key": "A", "text": "have"},
            {"key": "B", "text": "had"},
            {"key": "C", "text": "will have"},
            {"key": "D", "text": "would have"},
        ],
        "correct_option": "B",
        "explanation": "Second Conditional (norasmiy hozirgi xomxayol): If + Past Simple, would + V1.",
    },
    {
        "id": "q8",
        "number": 8,
        "level": "B1",
        "skill": "vocabulary",
        "topic": "Prepositions of Place, Time & Movement",
        "prompt": "She is completely capable ______ passing the C1 examination on her first attempt.",
        "options": [
            {"key": "A", "text": "with"},
            {"key": "B", "text": "to"},
            {"key": "C", "text": "of"},
            {"key": "D", "text": "for"},
        ],
        "correct_option": "C",
        "explanation": "'Capable' sifati doim 'of' predlogi bilan birga keladi (capable of doing sth).",
    },
    {
        "id": "q9",
        "number": 9,
        "level": "B1",
        "skill": "grammar",
        "topic": "Passive Voice & Causative Forms",
        "prompt": "The historical novel ______ into more than thirty languages since its initial release.",
        "options": [
            {"key": "A", "text": "translated"},
            {"key": "B", "text": "has been translated"},
            {"key": "C", "text": "was translating"},
            {"key": "D", "text": "is translating"},
        ],
        "correct_option": "B",
        "explanation": "Present Perfect Passive (has been translated) kitob o'zi emas, tarjima qilinganligini bildiradi.",
    },
    {
        "id": "q10",
        "number": 10,
        "level": "B1",
        "skill": "reading",
        "topic": "Conjunctions & Linking Words",
        "prompt": "'Although solar energy investments surged by 30% last year, traditional fossil fuels still accounted for the majority of electricity generated.' What does this sentence imply?",
        "options": [
            {"key": "A", "text": "Solar energy has fully replaced fossil fuels"},
            {"key": "B", "text": "Solar grew significantly, yet fossil fuels remain predominant"},
            {"key": "C", "text": "Investment in clean energy plummeted dramatically"},
            {"key": "D", "text": "Electricity usage declined across all sectors"},
        ],
        "correct_option": "B",
        "explanation": "'Although' qarama-qarshilikni ko'rsatadi: quyosh energiyasi o'sgan bo'lsa-da, qazilma yoqilg'i hanuz ko'pchilikni tashkil etmoqda.",
    },
    # --- B2 (6 questions) ---
    {
        "id": "q11",
        "number": 11,
        "level": "B2",
        "skill": "grammar",
        "topic": "Conditionals (0, 1st, 2nd, 3rd & Mixed)",
        "prompt": "If the morning flight had not been delayed by fog, we ______ the opening symposium.",
        "options": [
            {"key": "A", "text": "would attend"},
            {"key": "B", "text": "will attend"},
            {"key": "C", "text": "would have attended"},
            {"key": "D", "text": "had attended"},
        ],
        "correct_option": "C",
        "explanation": "Third Conditional (o'tmishdagi amalga oshmagan holat): If + Past Perfect, would have + V3.",
    },
    {
        "id": "q12",
        "number": 12,
        "level": "B2",
        "skill": "grammar",
        "topic": "Relative Clauses & Pronouns",
        "prompt": "The lead researcher, ______ groundbreaking work on neural networks won global praise, gave a keynote speech.",
        "options": [
            {"key": "A", "text": "whose"},
            {"key": "B", "text": "whom"},
            {"key": "C", "text": "who"},
            {"key": "D", "text": "which"},
        ],
        "correct_option": "A",
        "explanation": "Tegishlilik (egallik) nisbiy olmoshi: 'whose groundbreaking work' (uning inqilobiy ishi).",
    },
    {
        "id": "q13",
        "number": 13,
        "level": "B2",
        "skill": "grammar",
        "topic": "Gerund and Infinitive",
        "prompt": "We deeply regret ______ our subscribers that monthly tuition will increase next semester.",
        "options": [
            {"key": "A", "text": "inform"},
            {"key": "B", "text": "to inform"},
            {"key": "C", "text": "informing"},
            {"key": "D", "text": "to having informed"},
        ],
        "correct_option": "B",
        "explanation": "Nojo'ya yoki rasmiy xabarni yetkazishda 'regret to inform' to-infinitive bilan keladi.",
    },
    {
        "id": "q14",
        "number": 14,
        "level": "B2",
        "skill": "vocabulary",
        "topic": "Conjunctions & Linking Words",
        "prompt": "Due to unforeseen scheduling conflicts, the executive board agreed to ______ the annual summit.",
        "options": [
            {"key": "A", "text": "put off"},
            {"key": "B", "text": "call off"},
            {"key": "C", "text": "break down"},
            {"key": "D", "text": "turn down"},
        ],
        "correct_option": "A",
        "explanation": "'Put off' majlisni keyinga qoldirish (postpone) ma'nosini beradi.",
    },
    {
        "id": "q15",
        "number": 15,
        "level": "B2",
        "skill": "grammar",
        "topic": "Reported / Indirect Speech",
        "prompt": "During the formal interview, the candidate enquired ______ previous international experience was strictly required.",
        "options": [
            {"key": "A", "text": "that if"},
            {"key": "B", "text": "whether"},
            {"key": "C", "text": "what if"},
            {"key": "D", "text": "unless"},
        ],
        "correct_option": "B",
        "explanation": "O'zlashtirma so'roq gaplarda 'whether' yoki 'if' ishlatiladi ('that if' xato).",
    },
    {
        "id": "q16",
        "number": 16,
        "level": "B2",
        "skill": "reading",
        "topic": "Conjunctions & Linking Words",
        "prompt": "'Proponents of remote work celebrate zero commuting time and enhanced autonomy, whereas skeptics underscore diminished peer collaboration and blurred work-life boundaries.' What is the author's primary intention?",
        "options": [
            {"key": "A", "text": "Unequivocally condemning remote working models"},
            {"key": "B", "text": "Providing an impartial appraisal of both perspectives"},
            {"key": "C", "text": "Advocating for compulsory physical office presence"},
            {"key": "D", "text": "Encouraging employees to lengthen their commute"},
        ],
        "correct_option": "B",
        "explanation": "Muallif har ikki tomon dalillarini xolis, muvozanatli tarzda ko'rsatmoqda (impartial appraisal).",
    },
    # --- C1 (4 questions) ---
    {
        "id": "q17",
        "number": 17,
        "level": "C1",
        "skill": "grammar",
        "topic": "Adverbs (Ravishlar)",
        "prompt": "Seldom ______ such tenacity and academic discipline in an undergraduate candidate.",
        "options": [
            {"key": "A", "text": "we have witnessed"},
            {"key": "B", "text": "have we witnessed"},
            {"key": "C", "text": "we witnessed"},
            {"key": "D", "text": "did we witnessed"},
        ],
        "correct_option": "B",
        "explanation": "Inversion: Inkor / cheklovchi ravish ('Seldom') boshida kelsa, yordamchi fe'l egadan oldinga o'tadi (have we witnessed).",
    },
    {
        "id": "q18",
        "number": 18,
        "level": "C1",
        "skill": "grammar",
        "topic": "Conditionals (0, 1st, 2nd, 3rd & Mixed)",
        "prompt": "If he had accepted the research fellowship offer last autumn, he ______ in Cambridge today.",
        "options": [
            {"key": "A", "text": "would be working"},
            {"key": "B", "text": "will work"},
            {"key": "C", "text": "would have worked"},
            {"key": "D", "text": "had worked"},
        ],
        "correct_option": "A",
        "explanation": "Mixed Conditional (o'tgan zamondagi qarorning hozirgi natijasi): If + had done, would be doing today.",
    },
    {
        "id": "q19",
        "number": 19,
        "level": "C1",
        "skill": "vocabulary",
        "topic": "Adjectives (Sifatlar)",
        "prompt": "The committee's policy proposal was ______ upon rigorous empirical evidence gathered across multi-site trials.",
        "options": [
            {"key": "A", "text": "hinged"},
            {"key": "B", "text": "predicated"},
            {"key": "C", "text": "rooted"},
            {"key": "D", "text": "grounded"},
        ],
        "correct_option": "B",
        "explanation": "Akademik kollokatsiya: 'predicated upon' (biror narsaga qat'iy asoslangan/tayanilgan).",
    },
    {
        "id": "q20",
        "number": 20,
        "level": "C1",
        "skill": "reading",
        "topic": "Passive Voice & Causative Forms",
        "prompt": "'Far from acting as a panacea for severe urban congestion, the newly inaugurated arterial bypass merely catalyzed latent demand, ultimately compounding vehicular deadlock.' The author regards the bypass as:",
        "options": [
            {"key": "A", "text": "A definitive breakthrough solving transport issues"},
            {"key": "B", "text": "A counterproductive initiative that aggravated traffic"},
            {"key": "C", "text": "A triumph of cost-effective metropolitan planning"},
            {"key": "D", "text": "An indispensable enhancement exclusively for pedestrians"},
        ],
        "correct_option": "B",
        "explanation": "'Far from panacea... merely catalyzed latent demand... compounding deadlock' matnda yo'l kutgan natijani bermay vaziyatni yanada og'irlashtirganini bildiradi (counterproductive).",
    },
]

QUESTIONS_DICT = {q["id"]: q for q in PLACEMENT_QUESTIONS}


def get_client_ip(request) -> str:
    """Extract real client IP considering reverse proxy headers."""
    x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
    if x_forwarded_for:
        return x_forwarded_for.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "127.0.0.1")


def get_authenticated_user_from_request(request) -> Optional[User]:
    """Retrieve User instance from DRF request, session, or BestwayJWTAuthentication."""
    user = getattr(request, "user", None)
    if user and getattr(user, "is_authenticated", False):
        try:
            return User.objects.filter(id=user.id).first()
        except Exception:
            return None

    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        try:
            authenticator = BestwayJWTAuthentication()
            auth_res = authenticator.authenticate(request)
            if auth_res:
                legacy_user, _ = auth_res
                return User.objects.filter(id=legacy_user.id).first()
        except Exception as e:
            logger.debug("Failed to authenticate bearer token: %s", e)

    return None


@csrf_exempt
def placement_questions_view(request):
    """GET /api/v1/placement-test/questions

    Returns a guest session ID and 20 calibrated CEFR questions without answers.
    Rate limited to 5 requests per hour per IP.
    """
    if request.method != "GET":
        return JsonResponse({"success": False, "error": "GET method required"}, status=405)

    client_ip = get_client_ip(request)
    rate_key = f"{RATE_LIMIT_PREFIX}{client_ip}"

    # Rate limiting check (max 5 per hour)
    try:
        current_count = cache.get(rate_key, 0)
        if current_count >= 5:
            return JsonResponse(
                {
                    "success": False,
                    "error": "Rate limit exceeded. Maximum 5 placement tests per hour from one IP address.",
                    "retry_after_seconds": 3600,
                },
                status=429,
            )
        cache.set(rate_key, current_count + 1, timeout=3600)
    except Exception as e:
        logger.warning("Cache rate limit error: %s", e)

    # Generate guest session ID
    guest_session_id = str(uuid.uuid4())
    session_data = {
        "guest_session_id": guest_session_id,
        "ip": client_ip,
        "created_at": timezone.now().isoformat(),
    }
    try:
        cache.set(f"{SESSION_PREFIX}{guest_session_id}", session_data, timeout=7200)
    except Exception as e:
        logger.warning("Cache session write error: %s", e)

    # Sanitize questions: omit correct_option and explanation
    client_questions = []
    for q in PLACEMENT_QUESTIONS:
        client_questions.append({
            "id": q["id"],
            "number": q["number"],
            "level": q["level"],
            "skill": q["skill"],
            "topic": q["topic"],
            "prompt": q["prompt"],
            "options": q["options"],
        })

    return JsonResponse({
        "success": True,
        "data": {
            "guest_session_id": guest_session_id,
            "total_questions": len(client_questions),
            "duration_minutes": 10,
            "questions": client_questions,
        },
    })


@csrf_exempt
def placement_submit_view(request):
    """POST /api/v1/placement-test/submit

    Body: { "guest_session_id": "...", "answers": { "q1": "A", "q2": "B", ... } }
    Evaluates CEFR level, estimated IELTS band, weak grammar topics, and creates
    a 24h result token and persistent PlacementTestResult record.
    """
    if request.method != "POST":
        return JsonResponse({"success": False, "error": "POST method required"}, status=405)

    try:
        body = json.loads(request.body.decode("utf-8")) if request.body else {}
    except Exception:
        return JsonResponse({"success": False, "error": "Invalid JSON payload"}, status=400)

    guest_session_id = body.get("guest_session_id")
    answers = body.get("answers", {})

    if not guest_session_id:
        return JsonResponse({"success": False, "error": "guest_session_id is required"}, status=400)

    # Calculate score & analyze answers
    score = 0
    total_questions = len(PLACEMENT_QUESTIONS)
    mistake_topic_counts: Dict[str, int] = {}
    detailed_answers = {}

    for q in PLACEMENT_QUESTIONS:
        qid = q["id"]
        selected = answers.get(qid)
        is_correct = bool(selected and str(selected).strip().upper() == q["correct_option"])
        
        detailed_answers[qid] = {
            "selected": selected,
            "is_correct": is_correct,
            "topic": q["topic"],
            "level": q["level"],
        }

        if is_correct:
            score += 1
        else:
            topic = q["topic"]
            mistake_topic_counts[topic] = mistake_topic_counts.get(topic, 0) + 1

    score_percent = round((score / total_questions) * 100)

    # Determine CEFR Level and Estimated IELTS Band
    if score <= 5:
        cefr_level = "A2"
        cefr_label = "A2 — Elementary"
        estimated_ielts_band = "3.5 - 4.5"
        national_score_estimate = "25 - 35 ball"
        summary_text = (
            "Siz ingliz tilining boshlang'ich poydevoriga egasiz. "
            "So'z boyligini kengaytirish va sodda zamonlarni mustahkamlash orqali qisqa vaqtda B1 darajaga ko'tarilishingiz mumkin."
        )
    elif score <= 10:
        cefr_level = "B1"
        cefr_label = "B1 — Intermediate"
        estimated_ielts_band = "5.0 - 5.5"
        national_score_estimate = "38 - 50 ball"
        summary_text = (
            "Sizda mustahkam o'rta darajadagi baza mavjud. "
            "Murakkab zamonlar (Perfect tenses) va modallarni o'zlashtirish sizni Upper-Intermediate pog'onasiga olib chiqadi."
        )
    elif score <= 16:
        cefr_level = "B2"
        cefr_label = "B2 — Upper-Intermediate"
        estimated_ielts_band = "6.0 - 6.5"
        national_score_estimate = "52 - 65 ball"
        summary_text = (
            "Juda yaxshi natija! Siz grammatika va akademik leksikani yaxshi tushunasiz. "
            "Inversion, aralash shart mayllari (Mixed Conditionals) va nozik kollokatsiyalar ustida ishlab C1 darajaga yetishingiz mumkin."
        )
    else:
        cefr_level = "C1"
        cefr_label = "C1 — Advanced"
        estimated_ielts_band = "7.0 - 8.0"
        national_score_estimate = "66 - 75 ball"
        summary_text = (
            "A'lo darajadagi natija! Siz ingliz tilining murakkab qonuniyatlarini puxta egallagansiz. "
            "IELTS 7.5+ yoki DTM C1 sertifikatini qo'lga kiritish uchun professional darajada tayyorsiz."
        )

    # Resolve top 3 weak topics
    sorted_topics = sorted(mistake_topic_counts.items(), key=lambda item: item[1], reverse=True)
    top_weak = sorted_topics[:3]

    # If fewer than 3 weak topics, populate with standard advanced focus areas
    fallback_topics = [
        "Conditionals (0, 1st, 2nd, 3rd & Mixed)",
        "Passive Voice & Causative Forms",
        "Conjunctions & Linking Words",
    ]
    weak_topics_list = []
    seen_topics = set()

    for topic_name, mistake_count in top_weak:
        seen_topics.add(topic_name)
        lesson_match = find_matching_lesson_for_topic(topic_name)
        weak_topics_list.append({
            "topic": topic_name,
            "mistakes_count": mistake_count,
            "lesson_title": lesson_match["lesson_title"] if lesson_match else topic_name,
            "lesson_order": lesson_match["order_index"] if lesson_match else None,
            "lesson_id": lesson_match["lesson_id"] if lesson_match else None,
            "recommendation": f"Ushbu mavzudagi noaniqliklarni bartaraf etish uchun {lesson_match['order_index']}-darsni o'rganish tavsiya etiladi." if lesson_match else "Ushbu mavzuda ko'proq mashq bajarish tavsiya etiladi.",
        })

    for fallback in fallback_topics:
        if len(weak_topics_list) >= 3:
            break
        if fallback not in seen_topics:
            seen_topics.add(fallback)
            lesson_match = find_matching_lesson_for_topic(fallback)
            weak_topics_list.append({
                "topic": fallback,
                "mistakes_count": 0,
                "lesson_title": lesson_match["lesson_title"] if lesson_match else fallback,
                "lesson_order": lesson_match["order_index"] if lesson_match else None,
                "lesson_id": lesson_match["lesson_id"] if lesson_match else None,
                "recommendation": "Keyingi darajaga o'tish uchun ushbu muhim mavzuni takrorlash tavsiya etiladi.",
            })

    # Generate persistent result token
    result_token = f"pt_{uuid.uuid4().hex}"

    # Check if this user is already logged in
    auth_user = get_authenticated_user_from_request(request)

    # Persist in Database
    try:
        placement_record = PlacementTestResult.objects.create(
            guest_session_id=guest_session_id,
            result_token=result_token,
            cefr_level=cefr_level,
            cefr_label=cefr_label,
            estimated_ielts_band=estimated_ielts_band,
            score=score,
            total_questions=total_questions,
            score_percent=score_percent,
            weak_topics=weak_topics_list,
            analysis=summary_text,
            answers=detailed_answers,
            student=auth_user if auth_user else None,
            is_claimed=bool(auth_user),
            claimed_at=timezone.now() if auth_user else None,
        )
        if auth_user:
            # Auto-update profile if already authenticated
            _sync_profile_placement(auth_user, cefr_level, score_percent)
    except Exception as e:
        logger.error("Failed to create PlacementTestResult record: %s", e)

    # Cache result for fast retrieval (24 hours TTL)
    result_data = {
        "result_token": result_token,
        "guest_session_id": guest_session_id,
        "score": score,
        "total_questions": total_questions,
        "score_percent": score_percent,
        "cefr_level": cefr_level,
        "cefr_label": cefr_label,
        "estimated_ielts_band": estimated_ielts_band,
        "national_score_estimate": national_score_estimate,
        "weak_topics": weak_topics_list,
        "analysis": summary_text,
        "is_claimed": bool(auth_user),
        "created_at": timezone.now().isoformat(),
    }
    try:
        cache.set(f"{RESULT_PREFIX}{result_token}", result_data, timeout=86400)
    except Exception as e:
        logger.warning("Cache result write error: %s", e)

    return JsonResponse({
        "success": True,
        "data": result_data,
    })


def _sync_profile_placement(user: User, cefr_level: str, score_percent: int) -> None:
    """Helper to ensure StudentProfile exists and sync placement test results."""
    try:
        profile = StudentProfile.objects.filter(user_id=user.id).first()
        if not profile:
            profile = StudentProfile.objects.create(
                user_id=user.id,
                current_points=100,
                is_approved=True,
                link_code=user.id[:8],
                available_programs=["IELTS", "MULTILEVEL"],
                active_program="IELTS",
                created_at=timezone.now(),
                game_qualified=False,
                initial_level=cefr_level,
                diagnostic_cefr_score=float(score_percent),
            )
        else:
            StudentProfile.objects.filter(user_id=user.id).update(
                initial_level=cefr_level,
                diagnostic_cefr_score=float(score_percent),
            )
    except Exception as e:
        logger.error("Failed to sync student profile placement: %s", e)


@csrf_exempt
def placement_claim_view(request):
    """POST /api/v1/placement-test/claim

    Migrates a guest placement test result to an authenticated user's profile.
    Body: { "result_token": "pt_..." }
    Updates StudentProfile.initial_level and diagnostic_cefr_score.
    """
    if request.method != "POST":
        return JsonResponse({"success": False, "error": "POST method required"}, status=405)

    try:
        body = json.loads(request.body.decode("utf-8")) if request.body else {}
    except Exception:
        return JsonResponse({"success": False, "error": "Invalid JSON payload"}, status=400)

    result_token = body.get("result_token")
    if not result_token:
        return JsonResponse({"success": False, "error": "result_token is required"}, status=400)

    auth_user = get_authenticated_user_from_request(request)
    if not auth_user:
        # Check if user_id passed explicitly for testing/internal calls
        user_id = body.get("user_id")
        if user_id:
            auth_user = User.objects.filter(id=user_id).first()

    if not auth_user:
        return JsonResponse({"success": False, "error": "Authentication required to claim result"}, status=401)

    # Find result record from DB or cache
    record = PlacementTestResult.objects.filter(result_token=result_token).first()
    if not record:
        cached = cache.get(f"{RESULT_PREFIX}{result_token}")
        if not cached:
            return JsonResponse({"success": False, "error": "Placement test result not found or expired"}, status=404)

        # Re-create DB record if only existed in cache
        record = PlacementTestResult.objects.create(
            guest_session_id=cached.get("guest_session_id", "guest"),
            result_token=result_token,
            cefr_level=cached.get("cefr_level", "B1"),
            cefr_label=cached.get("cefr_label", "B1 — Intermediate"),
            estimated_ielts_band=cached.get("estimated_ielts_band", "5.0 - 5.5"),
            score=cached.get("score", 10),
            total_questions=cached.get("total_questions", 20),
            score_percent=cached.get("score_percent", 50),
            weak_topics=cached.get("weak_topics", []),
            analysis=cached.get("analysis", ""),
            is_claimed=False,
        )

    # Check if already claimed by another user
    if record.is_claimed and record.student_id and record.student_id != auth_user.id:
        return JsonResponse({"success": False, "error": "This result has already been claimed by another account"}, status=409)

    # Update record
    with transaction.atomic():
        record.student = auth_user
        record.is_claimed = True
        record.claimed_at = timezone.now()
        record.save()

        # Update StudentProfile
        _sync_profile_placement(auth_user, record.cefr_level, record.score_percent)

    # Update cached version
    try:
        cached_val = cache.get(f"{RESULT_PREFIX}{result_token}") or {}
        cached_val["is_claimed"] = True
        cached_val["student_id"] = auth_user.id
        cache.set(f"{RESULT_PREFIX}{result_token}", cached_val, timeout=86400)
    except Exception as e:
        logger.warning("Cache claim update error: %s", e)

    return JsonResponse({
        "success": True,
        "message": "Natijalar muvaffaqiyatli profilingizga bog'landi",
        "data": {
            "student_id": auth_user.id,
            "student_name": auth_user.name,
            "initial_level": record.cefr_level,
            "diagnostic_cefr_score": record.score_percent,
            "estimated_ielts_band": record.estimated_ielts_band,
            "result_token": record.result_token,
            "claimed_at": record.claimed_at.isoformat() if record.claimed_at else None,
        },
    })
