"""Vocabulary Exam 3.0 question types, generated only from data the teacher actually entered.

A type is offered for a word only when its answer key is grounded:

* ``listen_choose``   — hear the English word (two plays), choose the Uzbek meaning. Key: ``uzbek``.
* ``listen_type``     — hear the word, type it. Key: ``english``.
* ``fill_blank``      — the word's own ``context_sentence`` with the word blanked; only when the
                        sentence contains the word as a whole word (case-insensitive). Key: ``english``.
* ``context_meaning`` — the word highlighted in its ``context_sentence``; choose the meaning. Key: ``uzbek``.
* ``synonym``         — choose a synonym; only for words with teacher-entered ``synonyms``. Distractors
                        are other words of the set that are not listed synonyms of the target.

There are no antonym questions: the vocabulary model stores no antonyms, and none are invented.
Distractor texts are de-duplicated after normalisation so two options can never both be correct.
"""
from __future__ import annotations

import random
import re

from .vocabulary_answers import canon, split_translations

NEW_TYPES = ("listen_choose", "listen_type", "fill_blank", "context_meaning", "synonym")
BLANK = "_____"
# Base direction whose teacher-approved answer variants also apply to the new type.
VARIANT_DIRECTION = {
    "listen_choose": "eng_uzb", "context_meaning": "eng_uzb",
    "listen_type": "spelling", "fill_blank": "spelling",
    "synonym": None,
}
# Types whose spoken prompt is the target word (the client plays it; the answer is typed/chosen).
LISTENING_TYPES = ("listen_choose", "listen_type")


def _word_pattern(english: str):
    text = (english or "").strip()
    if not text:
        return None
    return re.compile(r"(?<![\w'])" + re.escape(text) + r"(?![\w'])", re.IGNORECASE)


def blanked_sentence(word) -> str | None:
    """The context sentence with the word replaced by a blank, or None if it does not contain it."""
    sentence = (getattr(word, "context_sentence", "") or "").strip()
    pattern = _word_pattern(word.english)
    if not sentence or pattern is None or not pattern.search(sentence):
        return None
    return pattern.sub(BLANK, sentence, count=1)


def synonyms_of(word) -> list[str]:
    return [s.strip() for s in (getattr(word, "synonyms", None) or []) if isinstance(s, str) and s.strip()]


def eligible_types(word) -> list[str]:
    types = ["listen_choose", "listen_type"]
    if blanked_sentence(word):
        types += ["fill_blank", "context_meaning"]
    if synonyms_of(word):
        types.append("synonym")
    return types


def _options(correct: str, pool: list[str], excluded_keys: set[str], rng: random.Random, count: int = 3) -> list[str]:
    seen = {canon(correct)} | excluded_keys
    distractors = []
    for text in rng.sample(pool, len(pool)):
        key = canon(text)
        if key and key not in seen:
            seen.add(key)
            distractors.append(text)
        if len(distractors) == count:
            break
    options = [correct, *distractors]
    rng.shuffle(options)
    return options


def build_question(word, q_type: str, words: list, rng: random.Random) -> dict:
    """One question for `word`. Never returns an answer key; the key is frozen server-side."""
    base = {
        "id": word.id, "wordId": word.id, "type": q_type, "options": [],
        "contextSentence": None, "partOfSpeech": getattr(word, "part_of_speech", None), "firstLetter": "",
        "speak": None,
        # Stored pronunciation audio (teacher-provided). The IPA is only shown where it does not
        # give away a listening answer.
        "audioUrl": (getattr(word, "audio_url", "") or None),
        "pronunciation": None if q_type in LISTENING_TYPES else (getattr(word, "pronunciation", "") or None),
    }
    meanings_of = lambda w: {canon(t) for t in split_translations(w.uzbek)}
    if q_type == "listen_choose":
        pool = [w.uzbek for w in words if w.id != word.id and not (meanings_of(w) & meanings_of(word))]
        base.update(prompt="", speak=word.english, options=_options(word.uzbek, pool, meanings_of(word), rng))
    elif q_type == "listen_type":
        base.update(prompt="", speak=word.english, firstLetter="")
    elif q_type == "fill_blank":
        base.update(prompt=blanked_sentence(word), firstLetter=word.english[:1].upper())
    elif q_type == "context_meaning":
        pool = [w.uzbek for w in words if w.id != word.id and not (meanings_of(w) & meanings_of(word))]
        base.update(prompt=word.english, contextSentence=word.context_sentence,
                    options=_options(word.uzbek, pool, meanings_of(word), rng))
    elif q_type == "synonym":
        synonyms = synonyms_of(word)
        excluded = {canon(s) for s in synonyms} | {canon(word.english)}
        pool = [w.english for w in words if w.id != word.id]
        correct = rng.choice(synonyms)
        base.update(prompt=word.english, options=_options(correct, pool, excluded, rng))
    else:
        raise ValueError(f"unknown question type {q_type}")
    return base


def expected_answer(word, q_type: str, question: dict) -> str:
    if q_type in ("listen_choose", "context_meaning"):
        return word.uzbek
    if q_type == "synonym":
        listed = {canon(s): s for s in synonyms_of(word)}
        chosen = next((o for o in question.get("options", []) if canon(o) in listed), None)
        return chosen or (synonyms_of(word) or [word.english])[0]
    return word.english


def plan_types(words: list, mode: str, rng: random.Random) -> dict[str, str]:
    """word id -> question type for a 3.0 mode. Words that cannot support the requested type fall
    back to the closest grounded type (listening), never to an invented key."""
    plan = {}
    for index, word in enumerate(words):
        eligible = eligible_types(word)
        if mode == "smart_mix":
            plan[word.id] = eligible[index % len(eligible)]
        elif mode in eligible:
            plan[word.id] = mode
        elif mode == "synonym" and "context_meaning" in eligible:
            plan[word.id] = "context_meaning"
        elif mode == "context_meaning" or mode == "fill_blank":
            plan[word.id] = "listen_choose"
        else:
            plan[word.id] = "listen_choose"
    return plan
