"""Pure authoring validation shared by draft saves and publication readiness."""
from __future__ import annotations

import re
import unicodedata

ANSWER_RULES = {"ONE_WORD", "ONE_WORD_AND_OR_NUMBER"}
MATCHING_LAYOUTS = {"headings", "speakers", "short_texts", "paragraphs"}
TEXT_TYPES = {"short_answer", "sentence_completion", "note_completion", "summary_completion", "table_completion"}
CHOICE_TYPES = {"multiple_choice", "matching", "matching_headings"}
MANUAL_TYPES = {"essay_task1", "essay_task2", "speaking_task"}
QUESTION_TYPES = TEXT_TYPES | CHOICE_TYPES | MANUAL_TYPES | {"multi_select", "true_false_notgiven", "yes_no_notgiven", "map_labelling"}


def strict_answer_text(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).strip().lower().split())


def canonical_decision(value: str) -> str:
    token = re.sub(r"[\s-]+", "_", value.strip().upper())
    return "NOT_GIVEN" if token in {"NOT_GIVEN", "NO_INFORMATION"} else token


def string_array(value) -> list[str]:
    return value if isinstance(value, list) and all(isinstance(item, str) for item in value) else []


def choice_index(value: str, options: list[str]) -> int | None:
    normalized = strict_answer_text(value)
    for index, option in enumerate(options):
        if strict_answer_text(option) == normalized:
            return index
    if len(normalized) == 1 and "a" <= normalized <= "z":
        index = ord(normalized) - ord("a")
        return index if index < len(options) else None
    return None


def respects_answer_rule(value: str, rule: str) -> bool:
    tokens = strict_answer_text(value).split()
    numeric = sum(bool(re.fullmatch(r"[+-]?\d+(?:[.,:/-]\d+)*%?", token)) for token in tokens)
    words = sum(bool(re.fullmatch(r"[^\W\d_]+(?:[-'’][^\W\d_]+)*", token, flags=re.UNICODE)) for token in tokens)
    if numeric + words != len(tokens):
        return False
    return (len(tokens) == 1 and words == 1) if rule == "ONE_WORD" else bool(tokens) and words <= 1 and numeric <= 1


def objective_question_issues(question: dict, is_auto: bool, complete: bool = True) -> list[str]:
    issues: list[str] = []
    question_type = question.get("type")
    options = string_array(question.get("options"))
    keys = [key for key in string_array(question.get("correctAnswers")) if key.strip()]
    variants = string_array(question.get("acceptedVariants"))
    manual = question_type in MANUAL_TYPES
    choice = question_type in CHOICE_TYPES or (question_type == "map_labelling" and bool(options))
    text = question_type in TEXT_TYPES or (question_type == "map_labelling" and not options)
    if is_auto == manual:
        issues.append("question type is incompatible with its section")
    prompt = question.get("prompt")
    if complete and prompt is not None and (not isinstance(prompt, str) or not prompt.strip()):
        issues.append("question prompt is missing")
    if any(not option.strip() for option in options) or len({strict_answer_text(option) for option in options}) != len(options):
        issues.append("options contain blanks or duplicate values")
    if (choice or question_type == "multi_select") and complete and len(options) < 2:
        issues.append("choice questions require at least two options")
    if len(options) > 26:
        issues.append("option bank exceeds 26 entries")
    if text and options:
        issues.append("text answers must not contain options")
    if complete and is_auto and not keys:
        issues.append("objective answer key is missing")
    if manual and (keys or variants or options):
        issues.append("manual tasks cannot contain objective keys or options")
    if choice and complete:
        indexes = [choice_index(key, options) for key in keys]
        if any(index is None for index in indexes):
            issues.append("answer key does not resolve to the option bank")
        if len(set(indexes)) > 1:
            issues.append("single-choice question maps to several options")
        if variants:
            issues.append("accepted alternatives are only allowed for text answers")
    if question_type == "multi_select" and complete:
        if len(keys) < 2:
            issues.append("multi-select requires at least two keys")
        if any(choice_index(key, options) is None for key in keys):
            issues.append("multi-select key does not resolve to the options")
    if complete and question_type in {"true_false_notgiven", "yes_no_notgiven"}:
        permitted = {"TRUE", "FALSE", "NOT_GIVEN"} if question_type == "true_false_notgiven" else {"YES", "NO", "NOT_GIVEN"}
        decisions = [canonical_decision(key) for key in keys]
        if any(key not in permitted for key in decisions) or len(set(decisions)) > 1:
            issues.append("decision answer key is invalid")
        if variants:
            issues.append("decision answers cannot contain text alternatives")
    word_limit = question.get("wordLimit")
    if word_limit is not None and (not isinstance(word_limit, int) or isinstance(word_limit, bool) or not 1 <= word_limit <= 50):
        issues.append("word limit must be 1–50")
    answer_rule = question.get("answerRule")
    if answer_rule is not None:
        if answer_rule not in ANSWER_RULES or not text:
            issues.append("answer rule is only valid for text completion")
        elif complete and any(not respects_answer_rule(answer, answer_rule) for answer in [*keys, *variants]):
            issues.append("answer key exceeds the configured answer rule")
    return issues


def objective_group_issues(group: dict, is_auto: bool) -> list[str]:
    questions = group.get("questions") or []
    issues = [f"Question {index + 1}: {issue}" for index, question in enumerate(questions) for issue in objective_question_issues(question, is_auto)]
    matching = [q for q in questions if q.get("type") in {"matching", "matching_headings"} or (q.get("type") == "map_labelling" and string_array(q.get("options")))]
    layout = group.get("contentLayout")
    if layout in MATCHING_LAYOUTS:
        expected = "matching_headings" if layout == "headings" else "matching"
        if any(question.get("type") != expected for question in questions):
            issues.append(f"{layout} layout requires {expected} questions")
    if layout == "multi_extract" and any(question.get("type") != "multiple_choice" for question in questions):
        issues.append("multi-extract layout requires multiple-choice questions")
    if (layout == "map" or any(question.get("type") == "map_labelling" for question in questions)) and not group.get("imageKey"):
        issues.append("map/plan questions require an image")
    if layout in MATCHING_LAYOUTS or group.get("optionsReusable") is False or layout == "map":
        bank = string_array(matching[0].get("options")) if matching else []
        if any(string_array(question.get("options")) != bank for question in matching):
            issues.append("matching questions must share the same option bank")
    if group.get("optionsReusable") is False:
        assigned = [choice_index(string_array(q.get("correctAnswers"))[0] if string_array(q.get("correctAnswers")) else "", string_array(q.get("options"))) for q in matching]
        assigned = [index for index in assigned if index is not None]
        if len(set(assigned)) != len(assigned):
            issues.append("one-use option bank has repeated answer mappings")
    return issues
