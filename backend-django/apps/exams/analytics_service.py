"""Exams Analytics Service: Weak Points Diagnosis & Smart Video Lesson Recommendations."""
import logging
import re
from typing import Any, Dict, List, Optional

from django.http import Http404, JsonResponse
from django.utils import timezone

from apps.core.models import Lesson
from apps.legacy_schema.models import MockAnswer, MockAttempt, Question

logger = logging.getLogger(__name__)

# Topic keywords mapped to lesson order_index and default metadata
LESSON_TOPIC_REGISTRY: List[Dict[str, Any]] = [
    {
        "order_index": 1,
        "title": "Nouns (Otlar)",
        "keywords": ["noun", "nouns", "plural", "singular", "countable", "uncountable", "otlar"],
    },
    {
        "order_index": 2,
        "title": "Noun Test & Formations",
        "keywords": ["noun suffix", "compound noun", "irregular plural"],
    },
    {
        "order_index": 3,
        "title": "Adjectives (Sifatlar)",
        "keywords": ["adjective", "adjectives", "comparative", "superlative", "degree", "sifat"],
    },
    {
        "order_index": 4,
        "title": "Adverbs (Ravishlar)",
        "keywords": ["adverb", "adverbs", "frequency", "manner", "ravish"],
    },
    {
        "order_index": 5,
        "title": "Numerals (Sonlar)",
        "keywords": ["numeral", "numerals", "ordinal", "cardinal", "sonlar"],
    },
    {
        "order_index": 6,
        "title": "Articles (Artikllar: a, an, the)",
        "keywords": ["article", "articles", "definite article", "indefinite article", "a/an", "the"],
    },
    {
        "order_index": 7,
        "title": "Future Continuous Tense",
        "keywords": ["future continuous", "will be doing", "future progressive"],
    },
    {
        "order_index": 8,
        "title": "Future Perfect Continuous Tense",
        "keywords": ["future perfect continuous", "will have been doing"],
    },
    {
        "order_index": 9,
        "title": "Future Perfect Tense",
        "keywords": ["future perfect", "will have done"],
    },
    {
        "order_index": 10,
        "title": "Future Simple & Future Forms",
        "keywords": ["future simple", "will", "going to", "kelasi zamon", "future"],
    },
    {
        "order_index": 11,
        "title": "Gerund and Infinitive",
        "keywords": ["gerund", "infinitive", "verb-ing", "to-infinitive", "bare infinitive"],
    },
    {
        "order_index": 12,
        "title": "Conditionals (0, 1st, 2nd, 3rd & Mixed)",
        "keywords": ["conditional", "conditionals", "if clause", "if conditionals", "unreal conditional", "wish"],
    },
    {
        "order_index": 13,
        "title": "Reported / Indirect Speech",
        "keywords": ["reported speech", "indirect speech", "say/tell", "backshift", "quote"],
    },
    {
        "order_index": 14,
        "title": "Modal Verbs & Modal Perfects",
        "keywords": ["modal", "modal verb", "modals", "must", "should", "could have", "might", "can"],
    },
    {
        "order_index": 15,
        "title": "Numerals: Fractions, Decimals & Advanced Rules",
        "keywords": ["fraction", "fractions", "decimals", "percentages"],
    },
    {
        "order_index": 16,
        "title": "Passive Voice & Causative Forms",
        "keywords": ["passive", "passive voice", "by agent", "causative", "majhul nisbat"],
    },
    {
        "order_index": 17,
        "title": "Past Continuous Tense",
        "keywords": ["past continuous", "was doing", "were doing", "past progressive"],
    },
    {
        "order_index": 18,
        "title": "Past Perfect Continuous Tense",
        "keywords": ["past perfect continuous", "had been doing"],
    },
    {
        "order_index": 19,
        "title": "Past Perfect Tense",
        "keywords": ["past perfect", "had done", "earlier past"],
    },
    {
        "order_index": 20,
        "title": "Past Simple Tense & Used to",
        "keywords": ["past simple", "used to", "did", "regular verb", "irregular verb", "o'tgan zamon"],
    },
    {
        "order_index": 21,
        "title": "Personal & Possessive Pronouns",
        "keywords": ["pronoun", "pronouns", "possessive", "reflexive", "relative pronoun"],
    },
    {
        "order_index": 22,
        "title": "Present Continuous Tense",
        "keywords": ["present continuous", "is doing", "are doing", "progressive"],
    },
    {
        "order_index": 23,
        "title": "Present Perfect Continuous Tense",
        "keywords": ["present perfect continuous", "have been doing", "has been doing"],
    },
    {
        "order_index": 24,
        "title": "Present Perfect Tense",
        "keywords": ["present perfect", "have done", "has done", "since/for", "already/yet"],
    },
    {
        "order_index": 25,
        "title": "Present Simple Tense",
        "keywords": ["present simple", "simple present", "daily routine", "oddiy hozirgi"],
    },
    {
        "order_index": 26,
        "title": "Relative Clauses & Pronouns",
        "keywords": ["relative clause", "defining relative", "non-defining", "who/which/that", "whom/whose"],
    },
    {
        "order_index": 27,
        "title": "Subject-Verb Agreement",
        "keywords": ["agreement", "subject-verb", "concord", "singular plural verb"],
    },
    {
        "order_index": 28,
        "title": "Prepositions of Place, Time & Movement",
        "keywords": ["preposition", "prepositions", "in/on/at", "preposition of time", "place"],
    },
    {
        "order_index": 29,
        "title": "Conjunctions & Linking Words",
        "keywords": ["conjunction", "conjunctions", "linking words", "connectors", "transitions", "however", "although"],
    },
]


def find_matching_lesson_for_topic(topic_str: str) -> Optional[Dict[str, Any]]:
    """Match topic string against the 29 video lessons registry or database."""
    if not topic_str:
        return None

    cleaned = topic_str.strip().lower()

    # Find matching entry in registry
    matched_entry = None
    best_score = 0
    for item in LESSON_TOPIC_REGISTRY:
        for kw in item["keywords"]:
            if kw in cleaned or re.search(rf"\b{re.escape(kw)}\b", cleaned):
                score = len(kw)
                if score > best_score:
                    best_score = score
                    matched_entry = item

    if not matched_entry:
        return None

    order_idx = matched_entry["order_index"]

    # Try resolving actual Lesson record from DB
    lesson = None
    try:
        lesson = Lesson.objects.filter(order_index=order_idx).first()
    except Exception as e:
        logger.debug("Error querying lesson for order %s: %s", order_idx, e)

    lesson_id = str(lesson.id) if lesson else f"lesson-{order_idx}"
    lesson_title = lesson.title if lesson else matched_entry["title"]

    return {
        "lesson_id": lesson_id,
        "lesson_title": lesson_title,
        "order_index": order_idx,
        "topic": topic_str,
        "url": f"/en/videos?lesson={lesson_id}",
        "button_text": f"▶️ {order_idx}-dars: {lesson_title} darsini ko'rish",
        "description": f"Sizda ushbu mavzuda xatolik ko'p: {lesson_title} darsini ko'rib, bilimlarni mustahkamlang.",
    }


def analyze_attempt_weak_points_and_recommendations(
    attempt_id: str,
    user: Optional[Any] = None,
) -> Dict[str, Any]:
    """Diagnose weak areas from a student's mock attempt and return recommended video lessons."""
    attempt = None
    try:
        attempt = MockAttempt.objects.filter(id=attempt_id).first()
    except Exception as e:
        logger.debug("Error querying attempt %s: %s", attempt_id, e)

    detected_topics = set()

    # 1. Inspect diagnostic feedback from attempt
    if attempt and attempt.diagnostic_feedback and isinstance(attempt.diagnostic_feedback, dict):
        for skill, fb in attempt.diagnostic_feedback.items():
            if not isinstance(fb, dict):
                continue
            # Look inside weaknesses
            for w in fb.get("weaknesses", []):
                if isinstance(w, str):
                    detected_topics.add(w)

            # Look inside mistakes_and_fixes explanations
            for m in fb.get("mistakes_and_fixes", []):
                if isinstance(m, dict):
                    exp = m.get("explanation", "")
                    orig = m.get("original", "")
                    detected_topics.add(f"{orig} {exp}")

            # Look inside action plan
            for step in fb.get("action_plan", []):
                if isinstance(step, str):
                    detected_topics.add(step)

    # 2. Inspect MockAnswer errors (where is_correct is False or feedback notes error)
    if attempt:
        try:
            wrong_answers = MockAnswer.objects.filter(attempt_id=attempt_id, is_correct=False)[:20]
            for ans in wrong_answers:
                if ans.feedback:
                    detected_topics.add(ans.feedback)
                # Check question guidance / section
                if hasattr(ans, "question") and ans.question:
                    q = ans.question
                    if q.guidance:
                        detected_topics.add(q.guidance)
                    if hasattr(q, "passage_text") and q.passage_text:
                        pass
        except Exception as e:
            logger.debug("Error inspecting wrong answers for %s: %s", attempt_id, e)

    # If no specific topics detected, provide default core foundations (e.g. Tenses, Passive, Conditionals)
    if not detected_topics:
        detected_topics.update(["Past Perfect", "Conditionals", "Passive Voice", "Articles"])

    # Match detected topics with video lessons
    recommendations = []
    seen_lesson_orders = set()

    for topic_raw in detected_topics:
        match = find_matching_lesson_for_topic(topic_raw)
        if match and match["order_index"] not in seen_lesson_orders:
            seen_lesson_orders.add(match["order_index"])
            recommendations.append(match)

    # Sort recommendations by order_index
    recommendations.sort(key=lambda r: r["order_index"])

    return {
        "attempt_id": attempt_id,
        "total_recommendations": len(recommendations),
        "recommendations": recommendations,
    }


def attempt_recommendations_view(request, attempt_id: str):
    """GET /api/v1/mock/attempts/<attempt_id>/recommendations"""
    user = request.user if hasattr(request, "user") and request.user.is_authenticated else None
    data = analyze_attempt_weak_points_and_recommendations(attempt_id, user=user)
    return JsonResponse({"success": True, "data": data})


def weak_points_recommendations_view(request):
    """GET /api/v1/analytics/weak-points/recommendations

    Query param: `topic` (e.g. ?topic=Past+Perfect) or returns default top recommendations.
    """
    topic_query = request.GET.get("topic")
    if topic_query:
        match = find_matching_lesson_for_topic(topic_query)
        recommendations = [match] if match else []
    else:
        # Default top recommended foundation lessons
        recommendations = []
        for default_topic in ["Past Perfect", "Conditionals", "Passive Voice", "Gerund and Infinitive", "Articles"]:
            m = find_matching_lesson_for_topic(default_topic)
            if m:
                recommendations.append(m)

    return JsonResponse({
        "success": True,
        "data": {
            "total_recommendations": len(recommendations),
            "recommendations": recommendations,
        },
    })
