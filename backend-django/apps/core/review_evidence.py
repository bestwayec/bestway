"""Review material that explains a question after the attempt: where the answer is.

Two optional, author-written fields per question (old exams have neither and show no
highlight):

* ``evidenceText`` — a passage of the Reading text (or of the Listening audioscript)
  copied by the author. It is stored only when it really occurs in that text; its
  position (``evidenceOffset``) is computed here, never trusted from the client.
* ``audioStartSec`` — the moment in the Listening recording where the answer is heard
  ("play from here" in review).

Nothing here is shown during an exam: the attempt detail adds it only once the result is
released to the student (or to staff).
"""
from __future__ import annotations

import html
import math
import re

from common.api.exceptions import ContractAPIException

MAX_EVIDENCE = 600
MAX_AUDIO_SECONDS = 4 * 60 * 60

_TAG = re.compile(r"<[^>]+>")
_BLOCK = re.compile(r"</(p|div|li|h[1-6]|tr|blockquote)>|<br\s*/?>", re.I)


def plain_text(value: str | None) -> str:
    """Readable text of stored (sanitized) HTML; plain text comes back unchanged."""
    if not value:
        return ""
    if "<" not in value:
        return value
    text = _BLOCK.sub("\n", value)
    return html.unescape(_TAG.sub("", text))


def source_text(group, skill: str) -> str:
    """The text a question's evidence must come from: the Reading passage, or the
    Listening audioscript (the transcript in passageText for older Listening parts)."""
    if skill == "listening":
        return plain_text(getattr(group, "audio_script", None)) or plain_text(getattr(group, "passage_text", None))
    return plain_text(getattr(group, "passage_text", None)) or plain_text(getattr(group, "content_html", None))


def locate(text: str, source: str) -> tuple[str, int] | None:
    """Where ``text`` occurs in ``source``: exact first, then ignoring differences in
    spacing and line breaks. Returns the text as it stands in the source and its offset."""
    if not text or not source:
        return None
    exact = source.find(text)
    if exact >= 0:
        return text, exact
    words = text.split()
    if not words:
        return None
    match = re.search(r"\s+".join(re.escape(word) for word in words), source)
    return (match.group(0), match.start()) if match else None


def clean_evidence(value, source: str) -> tuple[str | None, int | None]:
    if value is None:
        return None, None
    if not isinstance(value, str):
        raise ContractAPIException("VALIDATION_ERROR", "evidenceText must be text", 400)
    text = value.strip()
    if not text:
        return None, None
    if len(text) > MAX_EVIDENCE:
        raise ContractAPIException("VALIDATION_ERROR", f"evidenceText must be at most {MAX_EVIDENCE} characters", 400)
    found = locate(text, source)
    if found is None:
        raise ContractAPIException(
            "VALIDATION_ERROR",
            "evidenceText must be copied from this part's passage or audioscript",
            400,
        )
    return found


def clean_audio_start(value, duration_sec: int | float | None) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise ContractAPIException("VALIDATION_ERROR", "audioStartSec must be a number of seconds from 0", 400)
    limit = duration_sec if duration_sec else MAX_AUDIO_SECONDS
    if value > limit:
        raise ContractAPIException("VALIDATION_ERROR", f"audioStartSec is after the end of the recording ({int(limit)} s)", 400)
    return round(float(value), 1)


def apply(payload: dict, data: dict, group, skill: str) -> None:
    """Adds the cleaned review fields the request carries to a question payload."""
    if "evidenceText" in data:
        text, offset = clean_evidence(data.get("evidenceText"), source_text(group, skill))
        payload["evidence_text"], payload["evidence_offset"] = text, offset
    if "audioStartSec" in data:
        if skill != "listening" and data.get("audioStartSec") not in (None, ""):
            raise ContractAPIException("VALIDATION_ERROR", "audioStartSec is only for Listening questions", 400)
        payload["audio_start_sec"] = clean_audio_start(data.get("audioStartSec"), getattr(group, "audio_duration_sec", None))


def authoring_fields(question) -> dict:
    return {
        "evidenceText": question.evidence_text,
        "evidenceOffset": question.evidence_offset,
        "audioStartSec": question.audio_start_sec,
    }


def review_fields(question, source: str) -> dict:
    """Shown with a released result only; absent keys mean the author gave nothing.
    The evidence is located again in the current text, so a later edit of the passage
    never points the highlight at the wrong words (no match, no highlight)."""
    value = {}
    found = locate(question.evidence_text, source) if question.evidence_text else None
    if found:
        value["evidence"] = {"text": found[0], "offset": found[1]}
    if question.audio_start_sec is not None:
        value["audioStartSec"] = question.audio_start_sec
    return value
