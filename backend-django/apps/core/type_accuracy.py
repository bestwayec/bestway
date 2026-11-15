"""Accuracy per question type across a student's released results, with the trend.

Only auto-marked questions (Listening and Reading) count: a type's accuracy is correct
answers over the questions of that type the attempt asked (its skills and, for partial
practice, its scope). Three queries whatever the number of attempts (no N+1).
"""
from __future__ import annotations

from collections import defaultdict

from apps.legacy_schema.models import MockAnswer, MockAttempt, MockQuestion

from .mock_practice import scope

AUTO_SKILLS = ("listening", "reading")
PROGRAM_TYPES = {"IELTS": ("ielts_academic", "ielts_general"), "MULTILEVEL": ("multilevel",)}


def _asked(attempt, questions):
    """Ids of the auto-marked questions this attempt asked."""
    taken = [skill for skill in (attempt.raw_scores or {}) if skill in AUTO_SKILLS]
    limit = scope(attempt)
    allowed = set(limit["questionIds"]) if limit else None
    return [q for q in questions if q["skill"] in taken and (allowed is None or q["id"] in allowed)]


def type_accuracy(student_id: str, program: str | None, limit: int = 10) -> dict:
    rows = MockAttempt.objects.filter(student_id=student_id, status="completed").select_related("exam")
    if program in PROGRAM_TYPES:
        rows = rows.filter(exam__type__in=PROGRAM_TYPES[program])
    attempts = list(rows.order_by("-finished_at", "-started_at")[:limit])
    attempts.reverse()  # oldest first: the trend reads left to right
    if not attempts:
        return {"attempts": [], "types": []}
    by_exam = defaultdict(list)
    for q in MockQuestion.objects.filter(group__section__exam_id__in={a.exam_id for a in attempts},
                                         group__section__skill__in=AUTO_SKILLS).values(
            "id", "type", "group__section__exam_id", "group__section__skill"):
        by_exam[q["group__section__exam_id"]].append({"id": q["id"], "type": q["type"], "skill": q["group__section__skill"]})
    correct = set(MockAnswer.objects.filter(attempt_id__in=[a.id for a in attempts], is_correct=True)
                  .values_list("attempt_id", "question_id"))
    history = defaultdict(list)
    for attempt in attempts:
        counts = defaultdict(lambda: [0, 0])
        for q in _asked(attempt, by_exam.get(attempt.exam_id, [])):
            counts[q["type"]][1] += 1
            if (attempt.id, q["id"]) in correct:
                counts[q["type"]][0] += 1
        for kind, (right, total) in counts.items():
            history[kind].append({"attemptId": attempt.id, "finishedAt": attempt.finished_at, "correct": right, "total": total})
    types = []
    for kind, points in history.items():
        right = sum(p["correct"] for p in points)
        total = sum(p["total"] for p in points)
        types.append({"type": kind, "correct": right, "total": total,
                      "accuracy": round(100 * right / total) if total else None, "history": points})
    types.sort(key=lambda item: (item["accuracy"] if item["accuracy"] is not None else 101, item["type"]))
    return {
        "attempts": [{"id": a.id, "examTitle": a.exam.title, "finishedAt": a.finished_at} for a in attempts],
        "types": types,
    }
