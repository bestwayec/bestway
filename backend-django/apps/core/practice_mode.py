"""Practice mode (S4): start one section or one part, choose a timer, practice-only help.

Exam mode is untouched: a timed attempt keeps single play, server deadlines and no
help. Practice is for learning: the student may start a single part, pick no timer, the
section's time or the part's share of it (server deadline, like the exam), read the
Listening audioscript and reveal an answer. Revealed answers are recorded so the result
says so, and practice results stay raw (correct / asked), never a band.
"""
from __future__ import annotations

import math

from django.db import transaction

from apps.legacy_schema.models import MockQuestion, MockQuestionGroup

from common.api.exceptions import ContractAPIException

from .mock_practice import SCOPE_KEY, scope

TIMERS = ("none", "section", "part")
REVEALED_KEY = "__revealed"


def _fail(code, message, status=400):
    raise ContractAPIException(code, message, status)


def parse_options(data: dict, partial: bool) -> dict:
    """groupIds (one part or more of a single section) and timer, for practice only."""
    group_ids = data.get("groupIds")
    timer = data.get("timer")
    if group_ids is None and timer is None:
        return {}
    mode = data.get("mode")
    if mode != "practice":
        _fail("VALIDATION_ERROR", "groupIds and timer are practice options (mode practice)")
    if not partial or len(data.get("skills") or []) != 1:
        _fail("VALIDATION_ERROR", "Practice by part needs exactly one section in skills")
    if group_ids is not None and (not isinstance(group_ids, list) or not group_ids or len(group_ids) > 10
                                  or len(set(group_ids)) != len(group_ids) or not all(isinstance(g, str) for g in group_ids)):
        _fail("VALIDATION_ERROR", "groupIds must be a non-empty list of up to 10 part ids")
    if timer is not None and timer not in TIMERS:
        _fail("VALIDATION_ERROR", "timer must be one of: none, section, part")
    if timer == "part" and not group_ids:
        _fail("VALIDATION_ERROR", "The part timer needs the parts (groupIds)")
    return {"groupIds": group_ids, "timer": timer or "none"}


def narrow(exam_id: str, skill: str, practice: dict, group_ids: list[str] | None) -> dict:
    """The practice scope limited to the chosen parts of the section."""
    if not group_ids:
        return practice
    groups = set(MockQuestionGroup.objects.filter(id__in=group_ids, section__exam_id=exam_id, section__skill=skill)
                 .values_list("id", flat=True))
    if groups != set(group_ids):
        _fail("VALIDATION_ERROR", "A chosen part does not belong to this section")
    in_parts = set(MockQuestion.objects.filter(group_id__in=group_ids).values_list("id", flat=True))
    ids = [qid for qid in practice["questionIds"] if qid in in_parts]
    if not ids:
        raise ContractAPIException("MOCK_PRACTICE_NOT_READY", "This part has no questions ready for practice yet", 422)
    return dict(practice, questionIds=ids, groupIds=list(group_ids))


def timer_seconds(timer: str, section_seconds: int, part_questions: int, section_questions: int) -> int | None:
    """Section: the section's time. Part: its share of it by questions, in whole minutes, at least 1."""
    if timer == "section":
        return section_seconds
    if timer == "part":
        share = section_seconds * part_questions / max(1, section_questions)
        return max(60, math.ceil(share / 60) * 60)
    return None


def options(attempt) -> dict | None:
    state = getattr(attempt, "media_state", None)
    value = state.get(SCOPE_KEY) if isinstance(state, dict) else None
    if not isinstance(value, dict):
        return None
    return {"groupIds": value.get("groupIds") or None, "timer": value.get("timer") or "none"}


def revealed(attempt) -> list[str]:
    state = getattr(attempt, "media_state", None)
    value = state.get(REVEALED_KEY) if isinstance(state, dict) else None
    return list(value) if isinstance(value, list) else []


def reveal(actor, attempt_id: str, question_id: str) -> dict:
    """Shows a practice answer (key and, when the author marked it, where it is). Never in a timed attempt."""
    from . import review_evidence
    from .classroom_results import practice_answers_available
    from .mock_attempts import own

    if not isinstance(question_id, str) or not question_id:
        _fail("VALIDATION_ERROR", "questionId is required")
    with transaction.atomic():
        attempt = own(actor, attempt_id, lock=True)
        if attempt.mode != "practice":
            _fail("PRACTICE_ONLY", "Answers can be shown in practice only", 403)
        if attempt.status != "in_progress":
            _fail("MOCK_ATTEMPT_FINISHED", "This attempt is finished", 409)
        if not practice_answers_available(attempt):
            _fail("REVIEW_NOT_AVAILABLE", "Answers are reserved for an active examination", 403)
        selected = scope(attempt)
        if selected is not None and question_id not in selected["questionIds"]:
            _fail("QUESTION_NOT_IN_EXAM", "Savol bu imtihonga tegishli emas", 400)
        question = (MockQuestion.objects.select_related("group__section")
                    .filter(id=question_id, group__section__exam_id=attempt.exam_id).first())
        if question is None:
            _fail("QUESTION_NOT_IN_EXAM", "Savol bu imtihonga tegishli emas", 400)
        if question.group.section.skill not in ("listening", "reading"):
            _fail("VALIDATION_ERROR", "Only Listening and Reading answers can be shown", 400)
        state = dict(attempt.media_state or {})
        shown = [x for x in state.get(REVEALED_KEY) or [] if isinstance(x, str)]
        if question_id not in shown:
            state[REVEALED_KEY] = shown + [question_id]
            attempt.media_state = state
            attempt.save(update_fields=["media_state"])
    value = {"questionId": question.id, "correctAnswers": question.correct_answers or []}
    value.update(review_evidence.review_fields(question, review_evidence.source_text(question.group, question.group.section.skill)))
    return value
