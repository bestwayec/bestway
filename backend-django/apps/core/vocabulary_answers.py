"""Answer matching for vocabulary practice, shared by the website and the Telegram bot.

Deliberately NOT fuzzy: an answer is correct only if, after case/punctuation/apostrophe normalisation, it equals one of
the approved forms (the stored translation(s), teacher-approved variants and, for typed translation into English,
the word's synonyms). Misspellings are wrong; spelling mode accepts only the word itself and teacher-approved spellings.
"""
from __future__ import annotations

import re
import unicodedata

APOSTROPHES = "‘’‛ʻʼʹ`´′"
DASHES = "‐‑‒–—−"
_SPLIT = re.compile(r"\s*[;/,|]\s*")


def canon(text) -> str:
    """case-folded, one apostrophe form, one hyphen form, no surrounding/inner sentence punctuation, single spaces."""
    value = unicodedata.normalize("NFKC", str(text or "")).casefold()
    value = re.sub(f"[{re.escape(APOSTROPHES)}]", "'", value)
    value = re.sub(f"[{re.escape(DASHES)}]", "-", value)
    value = re.sub(r"[.,!?;:\"()\[\]{}«»“”„‟]", " ", value)
    value = re.sub(r"\s+", " ", value).strip(" -'")
    return value


def split_translations(text: str) -> list[str]:
    """'katta, ulkan; buyuk' -> ['katta', 'ulkan', 'buyuk'] (every listed translation is valid)."""
    parts = [p.strip() for p in _SPLIT.split(str(text or "")) if p.strip()]
    return parts or [str(text or "").strip()]


def accepted_forms(word, question_type: str, variants=()) -> list[str]:
    """Texts accepted for `word` in a question of `question_type`.

    eng_uzb / listen_choose / context_meaning -> the Uzbek translation(s);
    uzb_eng -> the English word and its synonyms; synonym -> the listed synonyms only;
    spelling / listen_type / fill_blank -> the word itself (plus teacher-approved spellings)."""
    if question_type in ("eng_uzb", "listen_choose", "context_meaning"):
        forms = split_translations(word.uzbek)
    elif question_type == "synonym":
        forms = [s for s in (getattr(word, 'synonyms', None) or []) if isinstance(s, str) and s.strip()]
    elif question_type == "uzb_eng":
        forms = split_translations(word.english) + [s for s in (getattr(word, 'synonyms', None) or []) if isinstance(s, str)]
    else:  # spelling: the word itself (alternative spellings only if a teacher approved them)
        forms = split_translations(word.english)
    seen, out = set(), []
    for text in list(forms) + [v for v in variants if isinstance(v, str)]:
        key = canon(text)
        if key and key not in seen:
            seen.add(key)
            out.append(text)
    return out


def matches(response, expected, accepted=None) -> bool:
    key = canon(response)
    if not key:
        return False
    return key in {canon(text) for text in [expected, *(accepted or [])] if text}


def approved_variants(word_id: str, direction: str) -> list[str]:
    from .models import VocabularyAnswerVariant
    from .vocabulary_questions import VARIANT_DIRECTION
    direction = VARIANT_DIRECTION.get(direction, direction)
    if direction is None:
        return []
    return list(VocabularyAnswerVariant.objects.filter(word_id=word_id, direction=direction).values_list("text", flat=True))
