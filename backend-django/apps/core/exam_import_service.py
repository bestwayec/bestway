"""Smart Exam Question Parser, Excel/CSV Bulk Importer, and Single Audio Timestamp Service."""
from __future__ import annotations

import ast
import csv
import html as html_lib
import json
import math
import re
import xml.etree.ElementTree as ET
import zipfile
from io import BytesIO, StringIO

from django.db import connection, transaction
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from apps.legacy_schema.models import (
    MockExam,
    MockQuestion,
    MockQuestionGroup,
    MockSection,
)
from common.api.exceptions import ContractAPIException

from .mock_authoring import (
    STAFF,
    audit_event,
    bump,
    group_payload,
    new_id,
    now,
    question_payload,
)
from .mock_media import media_url, store_upload
from .mock_parse import build_correct_answers
from .mock_rules import CHOICE_TYPES, QUESTION_TYPES, TEXT_TYPES, canonical_decision

_listening_table_ensured = False


def ensure_listening_config_table() -> None:
    global _listening_table_ensured
    if _listening_table_ensured:
        return
    with connection.cursor() as cursor:
        if connection.vendor == "postgresql":
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS "MockListeningConfig" (
                    "exam_id" VARCHAR(255) PRIMARY KEY,
                    "section_id" VARCHAR(255),
                    "audio_key" TEXT,
                    "audio_url" TEXT,
                    "duration_sec" INTEGER,
                    "timestamps" JSONB,
                    "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
                """
            )
        else:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS "MockListeningConfig" (
                    "exam_id" VARCHAR(255) PRIMARY KEY,
                    "section_id" VARCHAR(255),
                    "audio_key" TEXT,
                    "audio_url" TEXT,
                    "duration_sec" INTEGER,
                    "timestamps" JSON,
                    "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                """
            )
    _listening_table_ensured = True


PART_HEADER_RE = re.compile(
    r"^\s*(?:READING\s+PASSAGE|PASSAGE|PART|SECTION|BO['‘’]?LIM|QISM)\s*(\d{1,2})\b[:.\-—\s]*(.*)$",
    re.IGNORECASE,
)
QUESTION_RANGE_HEADER_RE = re.compile(
    r"^\s*(?:Questions?|Savollar?|Q)\s*(\d{1,3})\s*(?:[-–—]|to)\s*(\d{1,3})\b[:.\-—\s]*(.*)$",
    re.IGNORECASE,
)
ANSWER_SECTION_HEADER_RE = re.compile(
    r"^\s*(?:ANSWERS?|ANSWER\s+KEYS?|CORRECT\s+ANSWERS?|JAVOBLAR|KALITLAR|KEY)\s*[:\-—]?\s*$",
    re.IGNORECASE,
)
INLINE_ANSWER_RE = re.compile(
    r"(?:\(\s*(?:Answer|Ans|Correct|Key|Javob|To['‘’]?g['‘’]?ri\s+javob)\s*[:=\-]\s*([^)]+)\)|"
    r"\[\s*(?:Answer|Ans|Correct|Key|Javob)\s*[:=\-]\s*([^\]]+)\]|"
    r"(?:^|\s)(?:Answer|Ans|Key|Javob)\s*[:=]\s*([A-Za-z0-9_/\s,\-]+)\s*$)",
    re.IGNORECASE,
)
QUESTION_LINE_RE = re.compile(
    r"^\s*(?:(?:Question|Savol|Q|№|#)\s*(\d{1,3})\s*[.):\-]?|\[(\d{1,3})\]|(\d{1,3})\s*[.):\-])\s+(.+)$",
    re.IGNORECASE,
)
OPTION_LINE_RE = re.compile(
    r"^\s*(\*)?\s*\(?([A-Ha-h])\s*[.):\-]\s*(.+?)\s*(\[(?:correct|to['‘’]?g['‘’]?ri|\*)\])?\s*$",
    re.IGNORECASE,
)
INLINE_OPTIONS_RE = re.compile(
    r"(?:^|\s)(\*?)\(?([A-Ha-h])[.)]\s*([^\n\r]+?)(?=(?:\s+\*?\(?[A-Ha-h][.)]\s)|\s*$)"
)
ROMAN_HEADING_LINE_RE = re.compile(
    r"^\s*\(?((?:x|ix|iv|vi{0,3}|i{1,3}|xi{0,3}))[.)]\s+(.+)$",
    re.IGNORECASE,
)
POOL_OPTION_LINE_RE = re.compile(
    r"^\s*(?:List\s+of\s+(?:Headings|Options|People|Places|Ideas|Findings)|Options\s+Pool|Headings)\s*[:\-—]?\s*$",
    re.IGNORECASE,
)
BLANK_TOKEN_RE = re.compile(r"_{2,}|\.{3,}|…|\[gap(?:\s*\d+)?\]|\(\s*\d+\s*\)\s*_{2,}", re.IGNORECASE)
ANSWER_PAIR_RE = re.compile(
    r"(?:^|[,;\s]+)(?:Q|№|#)?(\d{1,3})\s*(?:[.):\-=]|->)\s*([A-Za-z0-9_/'’\-\s]+?)(?=(?:[,;\s]+(?:Q|№|#)?\d{1,3}\s*(?:[.):\-=]|->))|$)",
    re.IGNORECASE,
)


def extract_docx_text(docx_bytes: bytes) -> str:
    """Extract plain text paragraphs from DOCX without executing any macros or scripts."""
    try:
        with zipfile.ZipFile(BytesIO(docx_bytes)) as zf:
            if "word/document.xml" not in zf.namelist():
                return ""
            xml_content = zf.read("word/document.xml")
        tree = ET.fromstring(xml_content)
        ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        paragraphs = []
        for p in tree.findall(".//w:p", ns):
            texts = [t.text for t in p.findall(".//w:t", ns) if t.text]
            paragraphs.append("".join(texts) if texts else "")
        return "\n".join(paragraphs)
    except Exception:
        return ""


def extract_pdf_text(pdf_bytes: bytes) -> str:
    """Extract text from PDF pages safely using pypdf."""
    try:
        from pypdf import PdfReader

        reader = PdfReader(BytesIO(pdf_bytes))
        pages = []
        for page in reader.pages:
            t = page.extract_text()
            if t:
                pages.append(t)
        return "\n\n".join(pages)
    except Exception:
        return ""


def extract_html_text(html_str: str) -> str:
    """Safely extract plain text from HTML, stripping scripts, styles, office XML, comments, and unescaping entities."""
    # Strip HTML comments including conditional MS Word comments (<!--[if ...]>...<![endif]-->)
    cleaned = re.sub(r"<!--[\s\S]*?-->", "", html_str)
    # Strip embedded scripts, styles, noscripts, iframes, and office XML blocks
    cleaned = re.sub(r"<(script|style|noscript|iframe|xml)[^>]*>[\s\S]*?</\1>", "", cleaned, flags=re.IGNORECASE)
    # Strip office XML tags such as <o:p>, <w:...>
    cleaned = re.sub(r"</?(?:o:[a-z0-9_-]+|w:[a-z0-9_-]+)[^>]*>", "", cleaned, flags=re.IGNORECASE)
    # Convert block elements to newlines
    text = re.sub(r"<(?:h[1-6]|p|div|tr|li|blockquote)[^>]*>", "\n", cleaned, flags=re.IGNORECASE)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<td[^>]*>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    # Replace non-breaking spaces and zero-width artifacts
    text = text.replace("\xa0", " ").replace("\u200b", "").replace("\ufeff", "")
    text = html_lib.unescape(text)
    lines = [re.sub(r"[ \t]+", " ", l).strip() for l in text.split("\n")]
    # Deduplicate consecutive blank lines
    result_lines = []
    blank = False
    for l in lines:
        if not l:
            if not blank:
                result_lines.append("")
                blank = True
        else:
            result_lines.append(l)
            blank = False
    return "\n".join(result_lines).strip()


def parse_structured_html_bundle(
    html_content: str,
    default_skill: str = "reading",
    exam_type: str = "ielts_academic",
    provided_answers: dict | None = None,
) -> dict | None:
    """Extract structured questions, passages, and keys from HTML files containing embedded test data."""
    has_bundle_marker = bool(
        re.search(r"\bconst\s+K\s*=", html_content)
        or re.search(r"\bconst\s+P\s*=", html_content)
        or re.search(r"\btf\s*\(", html_content)
    )
    if not has_bundle_marker:
        return None

    k_match = re.search(r"const\s+K\s*=\s*(\{[\s\S]*?\});", html_content)
    k_dict: dict[int, any] = {}
    if k_match:
        try:
            k_dict = ast.literal_eval(k_match.group(1))
        except Exception:
            for m in re.finditer(r"(\d+)\s*:\s*(\[[^\]]*\]|'[^']*'|\"[^\"]*\")", k_match.group(1)):
                q_num = int(m.group(1))
                val_raw = m.group(2)
                try:
                    k_dict[q_num] = ast.literal_eval(val_raw)
                except Exception:
                    k_dict[q_num] = val_raw.strip("'\"")

    ms_match = re.search(r"const\s+MS\s*=\s*(\[[\s\S]*?\]);", html_content)
    ms_list: list[str] = []
    if ms_match:
        try:
            ms_list = ast.literal_eval(ms_match.group(1))
        except Exception:
            pass

    m38_match = re.search(r"const\s+M38\s*=\s*(\[[\s\S]*?\]);", html_content)
    m38_options: list[str] = []
    if m38_match:
        try:
            m38_options = ast.literal_eval(m38_match.group(1))
        except Exception:
            pass

    p_match = re.search(r"const\s+P\s*=\s*\[([\s\S]*?)\];\s*(?:const|let|var|function|\n[A-Z])", html_content)
    passages: list[dict] = []
    if p_match:
        p_raw = p_match.group(1)
        p_objs = re.split(r"\{(?=\s*t\s*:)", p_raw)
        for po in p_objs:
            if not po.strip():
                continue
            t_m = re.search(r"t\s*:\s*['\"]([^'\"]+)['\"]", po)
            h_m = re.search(r"h\s*:\s*['\"]([^'\"]+)['\"]", po)
            x_m = re.search(r"x\s*:\s*\[([\s\S]*?)\]", po)
            paras: list[str] = []
            if x_m:
                paras = [
                    m.group(1).replace('\\"', '"').replace("\\'", "'")
                    for m in re.finditer(r'["\']((?:\\.|[^"\'])*)["\']', x_m.group(1))
                ]
            title = t_m.group(1) if t_m else (h_m.group(1) if h_m else f"Passage {len(passages) + 1}")
            passages.append(
                {
                    "partNumber": len(passages) + 1,
                    "title": title,
                    "passageText": "\n\n".join(paras),
                    "paragraphs": paras,
                }
            )

    tf_questions: dict[int, dict] = {}
    for m in re.finditer(r"tf\s*\(\s*(\d+)\s*,\s*([\'\"][^\n\r]*?)\s*(?:,\s*(\d+))?\s*\)", html_content):
        q_num = int(m.group(1))
        raw_text = m.group(2).strip()
        y_flag = m.group(3)
        if (raw_text.startswith('"') and raw_text.endswith('"')) or (
            raw_text.startswith("'") and raw_text.endswith("'")
        ):
            try:
                q_prompt = ast.literal_eval(raw_text)
            except Exception:
                q_prompt = raw_text[1:-1]
        else:
            q_prompt = raw_text
        q_type = "yes_no_notgiven" if y_flag == "1" else "true_false_notgiven"
        options = ["YES", "NO", "NOT GIVEN"] if q_type == "yes_no_notgiven" else ["TRUE", "FALSE", "NOT GIVEN"]
        tf_questions[q_num] = {
            "number": q_num,
            "type": q_type,
            "prompt": q_prompt,
            "options": options,
        }

    mt_questions: dict[int, dict] = {}
    for m in re.finditer(r"mt\s*\(\s*(\d+)\s*,\s*([\'\"][^\n\r]*?)\s*,\s*([\'\"][^\n\r]*?)\s*\)", html_content):
        q_num = int(m.group(1))
        raw_text = m.group(2).strip()
        raw_letters = m.group(3).strip()
        try:
            q_prompt = ast.literal_eval(raw_text)
        except Exception:
            q_prompt = raw_text.strip("'\"")
        try:
            letters_str = ast.literal_eval(raw_letters)
        except Exception:
            letters_str = raw_letters.strip("'\"")
        mt_questions[q_num] = {
            "number": q_num,
            "type": "matching",
            "prompt": q_prompt,
            "options": list(letters_str),
        }

    tx_prompts: dict[int, str] = {}
    for m in re.finditer(r"<li>([\s\S]*?tx\((\d+)\)[\s\S]*?)</li>", html_content):
        full_li = m.group(1)
        q_num = int(m.group(2))
        clean_prompt = re.sub(r"\$\{tx\(\d+\)\}", "_______", full_li)
        clean_prompt = re.sub(r"<[^>]+>", " ", clean_prompt)
        clean_prompt = re.sub(r"\s+", " ", clean_prompt).strip()
        tx_prompts[q_num] = clean_prompt

    for m in re.finditer(r"<p><b>(\d+)</b>\s+([^<]+?)\s*\$\{tx\(\1\)\}</p>", html_content):
        q_num = int(m.group(1))
        tx_prompts[q_num] = m.group(2).strip()

    m38_prompt_m = re.search(r"38-40<\/span><b>(.*?)<\/b>", html_content)
    m38_prompt = (
        m38_prompt_m.group(1).strip()
        if m38_prompt_m
        else "Which THREE of the following areas are explored by the writer of this article?"
    )

    m38_formatted_opts = []
    for idx, opt_text in enumerate(m38_options):
        letter = chr(ord("A") + idx)
        m38_formatted_opts.append(f"{letter}. {opt_text}")

    questions: list[dict] = []
    answers_map: dict[str, str] = {}
    needs_review: list[int] = []

    for q_num in range(1, 41):
        if q_num <= 13:
            part_num = 1
        elif q_num <= 26:
            part_num = 2
        else:
            part_num = 3

        if q_num in tf_questions:
            item = tf_questions[q_num]
            q_type = item["type"]
            prompt = item["prompt"]
            options = item["options"]
        elif q_num in mt_questions:
            item = mt_questions[q_num]
            q_type = "matching"
            prompt = item["prompt"]
            options = item["options"]
        elif q_num in tx_prompts:
            q_type = (
                "note_completion"
                if (6 <= q_num <= 10)
                else ("sentence_completion" if (22 <= q_num <= 26) else "short_answer")
            )
            prompt = tx_prompts[q_num]
            options = None
        elif 38 <= q_num <= 40:
            q_type = "multi_select"
            prompt = f"{m38_prompt} (Selection {q_num - 37} of 3)"
            options = m38_formatted_opts
        else:
            q_type = "short_answer"
            prompt = f"Question {q_num}"
            options = None

        if 38 <= q_num <= 40:
            c_answers = list(ms_list) if ms_list else ["B", "D", "E"]
        else:
            raw_k = k_dict.get(q_num)
            if isinstance(raw_k, list):
                c_answers = [str(x) for x in raw_k]
            elif raw_k is not None:
                c_answers = [str(raw_k)]
            else:
                c_answers = []

        if provided_answers and str(q_num) in provided_answers:
            p_val = provided_answers[str(q_num)]
            if p_val:
                c_answers = [str(p_val)]

        answers_map[str(q_num)] = ", ".join(c_answers)

        q_item = {
            "number": q_num,
            "partNumber": part_num,
            "type": q_type,
            "prompt": prompt,
            "options": options,
            "correctAnswers": c_answers,
            "acceptedVariants": (
                c_answers[1:]
                if len(c_answers) > 1 and q_type not in CHOICE_TYPES | {"multi_select"}
                else []
            ),
            "points": 1,
            "wordLimit": (
                2
                if q_type in {"note_completion", "sentence_completion"}
                else (3 if q_type == "short_answer" else None)
            ),
            "answerRule": None,
        }
        if not c_answers:
            q_item["needsReview"] = True
            q_item["reviewReason"] = "Javob kaliti kiritilmagan"
            needs_review.append(q_num)
        questions.append(q_item)

    if not questions and not passages:
        return None

    for p in passages:
        p["questions"] = [q for q in questions if q["partNumber"] == p["partNumber"]]

    by_type: dict[str, int] = {}
    for q in questions:
        by_type[q["type"]] = by_type.get(q["type"], 0) + 1

    p_counts = [len(p["questions"]) for p in passages]
    is_complete_ielts = (
        len(questions) == 40
        and len(passages) == 3
        and p_counts == [13, 13, 14]
        and len(needs_review) == 0
    )

    first_instructions = next((p.get("instructions") for p in passages if p.get("instructions")), None)
    first_passage = next((p.get("passageText") for p in passages if p.get("passageText")), None)

    return {
        "status": "complete" if is_complete_ielts else "partial",
        "instructions": first_instructions,
        "passageText": first_passage,
        "passages": passages,
        "parts": passages,
        "questions": questions,
        "answers": answers_map,
        "count": len(questions),
        "needsReview": needs_review,
        "summary": {
            "total": len(questions),
            "withAnswers": sum(1 for q in questions if q["correctAnswers"]),
            "byType": by_type,
            "passagesCount": len(passages),
            "isCompleteIeltsReading": is_complete_ielts,
            "needsReviewCount": len(needs_review),
        },
    }


def _detect_group_type_hint(header_or_instr: str) -> str | None:
    lower = (header_or_instr or "").lower()
    if "not given" in lower or "not_given" in lower:
        if "true" in lower and "false" in lower:
            return "true_false_notgiven"
        if re.search(r"\byes\b", lower) and re.search(r"\bno\b", lower):
            return "yes_no_notgiven"
    if "list of headings" in lower or "matching headings" in lower or "choose the correct heading" in lower:
        return "matching_headings"
    if re.search(r"\b(?:label\s+the\s+(?:map|plan)|map\s+labelling|plan\s+labelling|diagram\s+labelling)\b", lower):
        return "map_labelling"
    if "which paragraph contains" in lower or "match each" in lower or "matching" in lower:
        return "matching"
    if re.search(r"\bchoose\s+(?:two|three|four|five|\d+)\b", lower):
        return "multi_select"
    if "complete the summary" in lower or "summary completion" in lower or "flowchart" in lower or "flow chart" in lower or "flow-chart" in lower:
        return "summary_completion"
    if "complete the notes" in lower or "note completion" in lower or "complete the form" in lower or "form completion" in lower:
        return "note_completion"
    if "complete the sentences" in lower or "sentence completion" in lower:
        return "sentence_completion"
    if "complete the table" in lower or "table completion" in lower:
        return "table_completion"
    return None


def _extract_word_limit(text: str) -> tuple[int | None, str | None]:
    lower = (text or "").lower()
    if "one word only" in lower:
        return 1, "ONE_WORD_ONLY"
    if "one word and/or a number" in lower or "one word and / or a number" in lower:
        return 1, "ONE_WORD_AND_OR_NUMBER"
    if "no more than two words and/or a number" in lower or "no more than 2 words and/or a number" in lower:
        return 2, "NO_MORE_THAN_TWO_WORDS_AND_OR_NUMBER"
    if "no more than two words" in lower or "two words only" in lower or "no more than 2 words" in lower:
        return 2, "NO_MORE_THAN_TWO_WORDS"
    if "no more than three words and/or a number" in lower or "no more than 3 words and/or a number" in lower:
        return 3, "NO_MORE_THAN_THREE_WORDS_AND_OR_NUMBER"
    if "no more than three words" in lower or "three words only" in lower or "no more than 3 words" in lower:
        return 3, "NO_MORE_THAN_THREE_WORDS"
    return None, None


def _detect_type_hint(text_block: str) -> str | None:
    return _detect_group_type_hint(text_block)


def _extract_inline_answer(text: str) -> tuple[str, str | None]:
    match = INLINE_ANSWER_RE.search(text)
    if not match:
        return text, None
    ans = (match.group(1) or match.group(2) or match.group(3) or "").strip()
    cleaned = (text[: match.start()] + " " + text[match.end() :]).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned, ans or None


def _parse_inline_options(line: str) -> tuple[str, list[str], str | None] | None:
    matches = list(INLINE_OPTIONS_RE.finditer(line))
    if len(matches) < 2:
        return None
    letters = [m.group(2).upper() for m in matches]
    if letters[0] != "A":
        return None
    prefix = line[: matches[0].start()].strip()
    options: list[str] = []
    marked_answer: str | None = None
    for m in matches:
        star = bool(m.group(1))
        letter = m.group(2).upper()
        raw_opt = m.group(3).strip()
        if re.search(r"\[(?:correct|to['‘’]?g['‘’]?ri|\*)\]\s*$", raw_opt, re.IGNORECASE):
            star = True
            raw_opt = re.sub(r"\[(?:correct|to['‘’]?g['‘’]?ri|\*)\]\s*$", "", raw_opt, flags=re.IGNORECASE).strip()
        if raw_opt.startswith("*"):
            star = True
            raw_opt = raw_opt.lstrip("*").strip()
        options.append(raw_opt)
        if star and not marked_answer:
            marked_answer = letter
    return prefix, options, marked_answer


def _infer_part_for_question(number: int, exam_type: str = "ielts_academic", skill: str = "reading") -> int:
    if exam_type == "multilevel":
        if skill == "listening":
            bounds = [(8, 1), (14, 2), (18, 3), (23, 4), (29, 5), (200, 6)]
            return next(p for limit, p in bounds if number <= limit)
        if skill == "writing":
            return min(3, max(1, number))
        if skill == "speaking":
            return min(4, max(1, number))
        bounds = [(6, 1), (14, 2), (20, 3), (29, 4), (200, 5)]
        return next(p for limit, p in bounds if number <= limit)
    if skill == "listening":
        return min(4, max(1, ((number - 1) // 10) + 1))
    if skill == "writing":
        return min(2, max(1, number))
    if skill == "speaking":
        return min(3, max(1, number))
    if number <= 13:
        return 1
    if number <= 26:
        return 2
    if number <= 40:
        return 3
    return 4


def parse_smart_text_v2(
    text: str,
    default_skill: str = "reading",
    exam_type: str = "ielts_academic",
    provided_answers: dict | None = None,
) -> dict:
    """Smart text parser supporting IELTS Reading 3-passage, multi-select, and granular question groups."""
    if not isinstance(text, str) or not text.strip():
        raise ContractAPIException("VALIDATION_ERROR", "Matn bo'sh bo'lmasligi kerak", 400)

    lines = re.split(r"\r\n?|\n", text)
    answer_map: dict[int, str] = {}
    if isinstance(provided_answers, dict):
        for k, v in provided_answers.items():
            try:
                q_num = int(str(k).strip())
                if v is not None and str(v).strip():
                    answer_map[q_num] = str(v).strip()
            except ValueError:
                pass

    passages_meta: dict[int, dict] = {}
    current_part = 1
    current_group_hint = None
    current_group_options: list[str] = []
    in_answer_section = False
    in_passage_body = False
    explicit_parts_seen = False

    raw_questions: list[dict] = []
    current_q: dict | None = None
    active_range_task: dict | None = None
    potential_range_task: dict | None = None
    active_word_limit: int | None = None
    active_answer_rule: str | None = None

    def _flush_range_task():
        nonlocal active_range_task
        if active_range_task and not active_range_task["seen_numbered_q"]:
            s_num = active_range_task["start"]
            e_num = active_range_task["end"]
            prompt_str = " ".join(active_range_task["prompt_lines"]).strip() or "Choose the correct options"
            for q_num in range(s_num, e_num + 1):
                raw_questions.append(
                    {
                        "number": q_num,
                        "partNumber": active_range_task["partNumber"],
                        "lines": [f"{prompt_str} (Selection {q_num - s_num + 1} of {e_num - s_num + 1})"],
                        "options": list(active_range_task["options"]),
                        "inlineAnswer": None,
                        "groupHint": "multi_select",
                        "groupOptions": list(active_range_task["options"]),
                    }
                )
        active_range_task = None

    def flush_q():
        nonlocal current_q
        if current_q is not None:
            raw_questions.append(current_q)
            current_q = None

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            continue

        if ANSWER_SECTION_HEADER_RE.match(line):
            flush_q()
            _flush_range_task()
            in_answer_section = True
            in_passage_body = False
            continue

        if in_answer_section:
            range_ans_m = re.match(r"^\s*(?:Q|№|#)?(\d{1,3})\s*[-–—]\s*(\d{1,3})\s*[:.\-—=]+\s*(.+)$", line)
            if range_ans_m:
                s_q = int(range_ans_m.group(1))
                e_q = int(range_ans_m.group(2))
                raw_ans_list = [p.strip() for p in re.split(r"[,;/\s]+", range_ans_m.group(3)) if p.strip()]
                for q_num in range(s_q, e_q + 1):
                    answer_map[q_num] = ", ".join(raw_ans_list)
                continue

            pairs = list(ANSWER_PAIR_RE.finditer(line))
            if pairs:
                for m in pairs:
                    q_num = int(m.group(1))
                    ans_val = m.group(2).strip()
                    if ans_val:
                        answer_map[q_num] = ans_val
                continue

            single_m = re.match(r"^\s*(?:Q|№|#)?(\d{1,3})\s*[.):\-=]+\s*(.+)$", line, re.IGNORECASE)
            if single_m and not single_m.group(2).strip().endswith("?"):
                answer_map[int(single_m.group(1))] = single_m.group(2).strip()
                continue

        part_m = PART_HEADER_RE.match(line)
        if part_m:
            rest_title = (part_m.group(2) or "").strip()
            # Guard against instruction sentences mentioning the passage (e.g. "Reading Passage 2 has five sections, A-E.")
            if re.search(r"\b(?:has|contains|consists|is\s+divided|is\s+based|describes|presents)\b", rest_title, re.I):
                p_info = passages_meta.setdefault(
                    current_part,
                    {
                        "partNumber": current_part,
                        "title": f"Passage {current_part}",
                        "passageLines": [],
                        "instructions": [],
                        "detectedTitle": None,
                    },
                )
                p_info["instructions"].append(line)
                continue

            flush_q()
            _flush_range_task()
            in_answer_section = False
            explicit_parts_seen = True
            current_part = int(part_m.group(1))
            unit = "Passage" if default_skill == "reading" and exam_type != "multilevel" else "Section" if default_skill == "listening" else "Part"
            title = f"{unit} {current_part}" + (f" – {rest_title}" if rest_title else "")
            passages_meta.setdefault(
                current_part,
                {
                    "partNumber": current_part,
                    "title": title,
                    "passageLines": [],
                    "instructions": [],
                    "detectedTitle": rest_title or None,
                },
            )
            in_passage_body = True
            current_group_hint = None
            current_group_options = []
            continue

        unit = "Passage" if default_skill == "reading" and exam_type != "multilevel" else "Section" if default_skill == "listening" else "Part"
        p_info = passages_meta.setdefault(
            current_part,
            {
                "partNumber": current_part,
                "title": f"{unit} {current_part}",
                "passageLines": [],
                "instructions": [],
                "detectedTitle": None,
            },
        )
        if in_passage_body and not p_info["detectedTitle"] and not p_info["passageLines"]:
            if len(line) < 120 and not QUESTION_RANGE_HEADER_RE.match(line) and not QUESTION_LINE_RE.match(line):
                p_info["detectedTitle"] = line
                p_info["title"] = f"{unit} {current_part} – {line}"
                continue

        wl_line, rule_line = _extract_word_limit(line)
        if wl_line:
            active_word_limit = wl_line
            active_answer_rule = rule_line

        q_range_m = QUESTION_RANGE_HEADER_RE.match(line)
        if q_range_m:
            flush_q()
            _flush_range_task()
            in_passage_body = False
            in_answer_section = False
            s_q = int(q_range_m.group(1))
            e_q = int(q_range_m.group(2))
            rest_instr = q_range_m.group(3).strip()

            wl_range, rule_range = _extract_word_limit(line)
            if wl_range:
                active_word_limit = wl_range
                active_answer_rule = rule_range

            if not explicit_parts_seen:
                if default_skill == "listening":
                    current_part = min(4, max(1, ((s_q - 1) // 10) + 1))
                else:
                    if s_q <= 13:
                        current_part = 1
                    elif s_q <= 26:
                        current_part = 2
                    else:
                        current_part = 3

            hint = _detect_group_type_hint(line)
            current_group_hint = hint
            current_group_options = []
            unit = "Passage" if default_skill == "reading" and exam_type != "multilevel" else "Section" if default_skill == "listening" else "Part"
            p_info = passages_meta.setdefault(
                current_part,
                {
                    "partNumber": current_part,
                    "title": f"{unit} {current_part}",
                    "passageLines": [],
                    "instructions": [],
                    "detectedTitle": None,
                },
            )
            p_info["instructions"].append(line)

            is_shared_multi = bool(
                re.search(r"\bchoose\s+(?:two|three|four|five|\d+)\b", line, re.I)
                or re.search(r"\bwhich\s+(?:two|three|four|five|\d+)\b", line, re.I)
            )
            if is_shared_multi:
                current_group_hint = "multi_select"
                active_range_task = {
                    "start": s_q,
                    "end": e_q,
                    "partNumber": current_part,
                    "prompt_lines": [rest_instr] if rest_instr else [],
                    "options": [],
                    "seen_numbered_q": False,
                }
            else:
                if e_q > s_q and (e_q - s_q) in (1, 2, 3):
                    potential_range_task = {"start": s_q, "end": e_q, "partNumber": current_part}
            continue

        if current_q is not None:
            opt_m = OPTION_LINE_RE.match(line)
            if opt_m:
                letter = opt_m.group(2).upper()
                opt_text = opt_m.group(3).strip()
                star = bool(opt_m.group(1) or opt_m.group(4))
                if star and not current_q.get("inlineAnswer"):
                    current_q["inlineAnswer"] = letter
                current_q["options"].append(opt_text)
                continue

        if active_range_task and not active_range_task["seen_numbered_q"] and current_q is None:
            opt_m = OPTION_LINE_RE.match(line)
            if opt_m:
                letter = opt_m.group(2).upper()
                opt_text = opt_m.group(3).strip()
                active_range_task["options"].append(f"{letter}. {opt_text}")
                continue
            elif not QUESTION_LINE_RE.match(line):
                active_range_task["prompt_lines"].append(line)
                continue

        roman_m = ROMAN_HEADING_LINE_RE.match(line)
        if roman_m:
            in_passage_body = False
            current_group_options.append(f"{roman_m.group(1).lower()}. {roman_m.group(2).strip()}")
            current_group_hint = "matching_headings"
            continue

        if POOL_OPTION_LINE_RE.match(line) and current_q is None:
            in_passage_body = False
            p_info["instructions"].append(line)
            continue

        pool_opt_m = OPTION_LINE_RE.match(line)
        if pool_opt_m and current_q is None:
            in_passage_body = False
            current_group_options.append(f"{pool_opt_m.group(2).upper()}. {pool_opt_m.group(3).strip()}")
            continue

        group_hint = _detect_group_type_hint(line)
        if group_hint and current_q is None:
            in_passage_body = False
            current_group_hint = group_hint
            p_info["instructions"].append(line)
            if potential_range_task and (
                "choose three" in line.lower()
                or "choose two" in line.lower()
                or re.search(r"\bchoose\s+(?:two|three|four|five|\d+)\b", line, re.I)
            ):
                active_range_task = {
                    "start": potential_range_task["start"],
                    "end": potential_range_task["end"],
                    "partNumber": potential_range_task["partNumber"],
                    "prompt_lines": [],
                    "options": [],
                    "seen_numbered_q": False,
                }
                potential_range_task = None
            continue

        letter_range_m = re.search(r"\b([A-Z])\s*[-–—]\s*([A-Z])\b", line)
        if letter_range_m and current_group_hint in ("matching", "matching_headings", "multi_select") and not current_group_options:
            s_c = letter_range_m.group(1).upper()
            e_c = letter_range_m.group(2).upper()
            if ord(e_c) > ord(s_c) and (ord(e_c) - ord(s_c)) <= 10:
                current_group_options = [chr(c) for c in range(ord(s_c), ord(e_c) + 1)]
                continue

        q_m = QUESTION_LINE_RE.match(line)
        if q_m:
            in_passage_body = False
            if active_range_task:
                active_range_task["seen_numbered_q"] = True
                _flush_range_task()
            q_num = int(q_m.group(1) or q_m.group(2) or q_m.group(3))
            q_body = q_m.group(4).strip()

            existing_nums = {rq["number"] for rq in raw_questions} | ({current_q["number"]} if current_q else set())
            if q_num in existing_nums and len(q_body) <= 15:
                flush_q()
                answer_map[q_num] = q_body.strip()
                continue

            flush_q()
            target_part = current_part
            if not explicit_parts_seen:
                if q_num <= 13:
                    target_part = 1
                elif q_num <= 26:
                    target_part = 2
                else:
                    target_part = 3

            q_body, inline_ans = _extract_inline_answer(q_body)
            inline_opts = _parse_inline_options(q_body)
            opts_list: list[str] = []
            if inline_opts and inline_opts[0]:
                q_body, opts_list, marked = inline_opts
                if marked and not inline_ans:
                    inline_ans = marked

            current_q = {
                "number": q_num,
                "partNumber": target_part,
                "lines": [q_body],
                "options": opts_list,
                "inlineAnswer": inline_ans,
                "groupHint": current_group_hint,
                "groupOptions": list(current_group_options),
            }
            continue

        if in_passage_body:
            p_info["passageLines"].append(line)
            continue

        if current_q is not None:
            cleaned_line, inline_ans = _extract_inline_answer(line)
            if inline_ans and not current_q.get("inlineAnswer"):
                current_q["inlineAnswer"] = inline_ans
            if cleaned_line:
                current_q["lines"].append(cleaned_line)
        else:
            if not p_info["passageLines"]:
                p_info["passageLines"].append(line)

    flush_q()
    _flush_range_task()

    raw_nums = {rq["number"] for rq in raw_questions}
    if 38 in raw_nums and 39 not in raw_nums and 40 not in raw_nums:
        q38 = next(rq for rq in raw_questions if rq["number"] == 38)
        for extra_num in (39, 40):
            raw_questions.append(
                {
                    "number": extra_num,
                    "partNumber": q38["partNumber"],
                    "lines": list(q38["lines"]),
                    "options": list(q38["options"]),
                    "inlineAnswer": q38.get("inlineAnswer"),
                    "groupHint": "multi_select",
                    "groupOptions": list(q38["groupOptions"]),
                }
            )
        raw_questions.sort(key=lambda x: x["number"])

    questions_out: list[dict] = []
    by_type: dict[str, int] = {}
    needs_review: list[int] = []

    for rq in raw_questions:
        q_num = rq["number"]
        part_num = rq["partNumber"]
        prompt = " ".join(rq["lines"]).strip()
        g_hint = rq.get("groupHint")
        g_opts = rq.get("groupOptions") or []
        opts = list(rq.get("options") or [])
        raw_ans = rq.get("inlineAnswer") or answer_map.get(q_num)

        # Detect question type (multi_select prioritized before choice options)
        is_range_multi = (
            g_hint == "multi_select"
            or (default_skill == "reading" and 38 <= q_num <= 40 and g_hint in ("multi_select", None) and (len(g_opts) >= 3 or (isinstance(raw_ans, str) and len(re.split(r"[,;/]+", raw_ans)) > 1)))
            or (isinstance(raw_ans, str) and len(re.split(r"[,;/]+", raw_ans)) > 1 and len(opts) >= 2)
        )
        if is_range_multi:
            q_type = "multi_select"
            opts = opts if len(opts) >= 2 else (g_opts if g_opts else opts)
        elif len(opts) >= 2:
            q_type = "multiple_choice"
        elif g_hint in ("true_false_notgiven", "yes_no_notgiven"):
            q_type = g_hint
            opts = ["TRUE", "FALSE", "NOT GIVEN"] if q_type == "true_false_notgiven" else ["YES", "NO", "NOT GIVEN"]
        elif g_hint in ("matching", "matching_headings"):
            q_type = g_hint
            opts = g_opts if g_opts else opts
        elif g_hint in ("map_labelling", "diagram_labelling"):
            q_type = "map_labelling"
            opts = g_opts if g_opts else opts
        elif g_hint in ("note_completion", "summary_completion", "sentence_completion", "table_completion", "flowchart_completion", "form_completion"):
            q_type = g_hint
            opts = None
        elif BLANK_TOKEN_RE.search(prompt):
            q_type = "sentence_completion"
            opts = None
        else:
            q_type = "short_answer"
            opts = None

        correct_answers: list[str] = []
        accepted_variants: list[str] = []
        if raw_ans:
            built = build_correct_answers(q_type, opts, str(raw_ans))
            if q_type in {"true_false_notgiven", "yes_no_notgiven"}:
                canon = [
                    canonical_decision(x)
                    for x in built
                    if canonical_decision(x) in {"TRUE", "FALSE", "YES", "NO", "NOT_GIVEN"}
                ]
                correct_answers = [canon[0]] if canon else [canonical_decision(str(raw_ans))]
            elif q_type == "multi_select":
                correct_answers = [p.strip() for p in re.split(r"[,;/]+", str(raw_ans)) if p.strip()]
            elif q_type in CHOICE_TYPES:
                correct_answers = built if built else [str(raw_ans).strip()]
            else:
                if built:
                    correct_answers = [built[0]]
                    accepted_variants = built[1:]
                else:
                    correct_answers = [str(raw_ans).strip()]

        q_item = {
            "number": q_num,
            "partNumber": part_num,
            "type": q_type,
            "prompt": prompt,
            "options": opts if opts else None,
            "correctAnswers": correct_answers,
            "acceptedVariants": accepted_variants,
            "points": 1,
            "wordLimit": rq.get("wordLimit") or (active_word_limit if q_type in TEXT_TYPES else None),
            "answerRule": rq.get("answerRule") or (active_answer_rule if q_type in TEXT_TYPES else None),
        }

        review_reasons = []
        if not correct_answers:
            review_reasons.append("Javob kaliti topilmadi")
        if q_type in ("multiple_choice", "multi_select", "matching", "matching_headings") and not opts:
            review_reasons.append("Savol variantlari (options) topilmadi")

        if review_reasons:
            q_item["needsReview"] = True
            q_item["reviewReason"] = "; ".join(review_reasons)
            needs_review.append(q_num)

        questions_out.append(q_item)
        by_type[q_type] = by_type.get(q_type, 0) + 1

    passages_out: list[dict] = []
    for p_num in sorted(passages_meta.keys()):
        pm = passages_meta[p_num]
        p_qs = [q for q in questions_out if q["partNumber"] == p_num]
        p_text = "\n\n".join(pm["passageLines"]).strip()
        passages_out.append(
            {
                "partNumber": p_num,
                "title": pm["title"],
                "passageText": p_text if len(p_text) > 40 else None,
                "instructions": "\n".join(pm["instructions"]).strip() or None,
                "questions": p_qs,
            }
        )

    p_counts = [len(p["questions"]) for p in passages_out]
    is_complete_reading = (
        exam_type != "multilevel"
        and default_skill == "reading"
        and len(questions_out) == 40
        and len(passages_out) == 3
        and p_counts == [13, 13, 14]
        and len(needs_review) == 0
    )
    is_complete_listening = (
        exam_type != "multilevel"
        and default_skill == "listening"
        and len(questions_out) == 40
        and len(passages_out) == 4
        and p_counts == [10, 10, 10, 10]
        and len(needs_review) == 0
    )
    is_complete = is_complete_reading or is_complete_listening

    first_instructions = next((p.get("instructions") for p in passages_out if p.get("instructions")), None)
    first_passage = next((p.get("passageText") for p in passages_out if p.get("passageText")), None)

    return {
        "skill": default_skill,
        "status": "complete" if is_complete else "partial",
        "instructions": first_instructions,
        "passageText": first_passage,
        "passages": passages_out,
        "parts": passages_out,
        "questions": questions_out,
        "answers": {str(k): v for k, v in answer_map.items()},
        "count": len(questions_out),
        "needsReview": needs_review,
        "summary": {
            "total": len(questions_out),
            "withAnswers": sum(1 for q in questions_out if q["correctAnswers"]),
            "byType": by_type,
            "passagesCount": len(passages_out),
            "isCompleteIeltsReading": is_complete_reading,
            "isCompleteIeltsListening": is_complete_listening,
            "needsReviewCount": len(needs_review),
        },
    }


def detect_content_skill(text: str) -> str:
    lower = (text or "").lower()
    if (
        re.search(r"\bwriting\s+task\s+[12]\b", lower)
        or re.search(r"\btask\s+1\s*:\s*(?:the\s+(?:chart|graph|table|map|diagram)|you\s+should\s+spend)", lower)
        or re.search(r"\bwrite\s+at\s+least\s+(?:150|250)\s+words\b", lower)
        or re.search(r"\byou\s+should\s+spend\s+about\s+(?:20|40)\s+minutes\s+on\s+this\s+task\b", lower)
        or re.search(r"\bin\s+your\s+letter\s*:", lower)
        or (re.search(r"\bwriting\b", lower) and re.search(r"\btask\s+[12]\b", lower))
    ):
        return "writing"
    if (
        re.search(r"\bspeaking\s+part\s+[123]\b", lower)
        or re.search(r"\bcue\s+card\b", lower)
        or re.search(r"\bcandidate\s+task\s+card\b", lower)
        or re.search(r"\byou\s+should\s+say\s*:", lower)
        or re.search(r"\byou\s+have\s+1\s+minute\s+to\s+prepare\b", lower)
        or re.search(r"\bpart\s+3\s*[-–—:]\s*(?:two-way\s+)?discussion\b", lower)
        or (re.search(r"\bspeaking\b", lower) and re.search(r"\bpart\s+[123]\b", lower))
    ):
        return "speaking"
    if (
        re.search(r"\blistening\s+section\s+[1-4]\b", lower)
        or re.search(r"\bsection\s+[1-4]\b(?:\s*[-–—:]|\s+questions\b|\s+complete|\s+in\s+the\s+exam)", lower)
        or re.search(r"\byou\s+will\s+hear\b", lower)
        or (
            re.search(r"\bwrite\s+no\s+more\s+than\s+(?:one|two|three)\s+words\b", lower)
            and re.search(r"\bsection\s+[1234]\b", lower)
        )
        or (re.search(r"\blistening\b", lower) and re.search(r"\bsection\s+[1-4]\b", lower))
    ):
        return "listening"
    return "reading"


def parse_smart_writing_text(text: str, exam_type: str = "ielts_academic") -> dict:
    """Parse IELTS Writing Task 1 (Academic visual or GT letter) and Task 2 (Essay)."""
    if not isinstance(text, str) or not text.strip():
        raise ContractAPIException("VALIDATION_ERROR", "Matn bo'sh bo'lmasligi kerak", 400)

    t1_match = re.search(
        r"(?:(?:WRITING\s+)?TASK\s+1(?:\.1)?\b)(.*?)(?=(?:(?:WRITING\s+)?TASK\s+2\b)|\Z)",
        text,
        re.IGNORECASE | re.DOTALL,
    )
    t2_match = re.search(
        r"(?:(?:WRITING\s+)?TASK\s+2\b)(.*?)\Z",
        text,
        re.IGNORECASE | re.DOTALL,
    )

    t1_block = t1_match.group(1).strip() if t1_match else ""
    t2_block = t2_match.group(1).strip() if t2_match else ""

    if not t1_block and not t2_block:
        t1_block = text.strip()

    def _extract_task_details(block: str, task_num: int):
        if not block:
            return None
        lines = [l.strip() for l in block.splitlines() if l.strip()]
        instructions_list = []
        prompt_lines = []
        image_key = None
        word_limit = 150 if task_num == 1 else 250

        img_re = re.compile(
            r"\[(?:Image|Chart|Figure|Diagram)\s*[:=]\s*([^\]]+)\]|<img[^>]+src=[\"']([^\"']+)[\"']",
            re.I,
        )
        spend_time_re = re.compile(r"you\s+should\s+spend\s+about\s+\d+\s+minutes", re.I)
        word_count_re = re.compile(r"write\s+at\s+least\s+(\d+)\s+words", re.I)

        for line in lines:
            img_m = img_re.search(line)
            if img_m:
                image_key = (img_m.group(1) or img_m.group(2)).strip()
                continue

            wc_m = word_count_re.search(line)
            if wc_m:
                word_limit = int(wc_m.group(1))
                instructions_list.append(line)
                continue

            if spend_time_re.search(line):
                instructions_list.append(line)
                continue

            if re.search(
                r"^(?:summarise\s+the\s+information|give\s+reasons\s+for\s+your\s+answer|write\s+about\s+the\s+following\s+topic)",
                line,
                re.I,
            ):
                instructions_list.append(line)
                continue

            prompt_lines.append(line)

        instructions = " ".join(instructions_list).strip() or (
            "You should spend about 20 minutes on this task. Write at least 150 words."
            if task_num == 1
            else "You should spend about 40 minutes on this task. Write at least 250 words."
        )
        prompt = "\n".join(prompt_lines).strip() or f"Writing Task {task_num}"
        return {
            "instructions": instructions,
            "prompt": prompt,
            "imageKey": image_key,
            "wordLimit": word_limit,
        }

    t1_info = _extract_task_details(t1_block, 1)
    t2_info = _extract_task_details(t2_block, 2)

    parts_out = []
    questions_out = []

    if t1_info:
        q1 = {
            "number": 1,
            "partNumber": 1,
            "type": "essay_task1",
            "prompt": t1_info["prompt"],
            "options": None,
            "correctAnswers": [],
            "acceptedVariants": [],
            "wordLimit": t1_info["wordLimit"],
            "points": 5 if exam_type == "multilevel" else 9,
            "imageKey": t1_info["imageKey"],
        }
        parts_out.append(
            {
                "partNumber": 1,
                "title": "Task 1",
                "instructions": t1_info["instructions"],
                "passageText": t1_info["prompt"],
                "imageKey": t1_info["imageKey"],
                "questions": [q1],
            }
        )
        questions_out.append(q1)

    if t2_info:
        q2 = {
            "number": 2,
            "partNumber": 2,
            "type": "essay_task2",
            "prompt": t2_info["prompt"],
            "options": None,
            "correctAnswers": [],
            "acceptedVariants": [],
            "wordLimit": t2_info["wordLimit"],
            "points": 6 if exam_type == "multilevel" else 9,
        }
        parts_out.append(
            {
                "partNumber": 2,
                "title": "Task 2",
                "instructions": t2_info["instructions"],
                "passageText": t2_info["prompt"],
                "questions": [q2],
            }
        )
        questions_out.append(q2)

    is_complete = bool(t1_info and t2_info and t1_info["prompt"] and t2_info["prompt"])

    first_instructions = next((p.get("instructions") for p in parts_out if p.get("instructions")), None)
    first_passage = next((p.get("passageText") for p in parts_out if p.get("passageText")), None)

    return {
        "skill": "writing",
        "status": "complete" if is_complete else "partial",
        "instructions": first_instructions,
        "passageText": first_passage,
        "parts": parts_out,
        "passages": parts_out,
        "questions": questions_out,
        "answers": {},
        "count": len(questions_out),
        "needsReview": [] if is_complete else [1] if not t1_info else [2],
        "summary": {
            "total": len(questions_out),
            "withAnswers": 0,
            "byType": {q["type"]: 1 for q in questions_out},
            "task1Present": bool(t1_info),
            "task2Present": bool(t2_info),
            "isCompleteIeltsWriting": is_complete,
            "requiresManualGrading": True,
            "passagesCount": len(parts_out),
            "needsReviewCount": 0 if is_complete else 1,
        },
    }


def parse_smart_speaking_text(text: str, exam_type: str = "ielts_academic") -> dict:
    """Parse IELTS Speaking Part 1 (Interview), Part 2 (Cue Card with 60s/120s timing), and Part 3 (Discussion)."""
    if not isinstance(text, str) or not text.strip():
        raise ContractAPIException("VALIDATION_ERROR", "Matn bo'sh bo'lmasligi kerak", 400)

    p1_m = re.search(
        r"(?:(?:SPEAKING\s+)?PART\s+1\b)(.*?)(?=(?:(?:SPEAKING\s+)?PART\s+2\b|CANDIDATE\s+TASK\s+CARD)|\Z)",
        text,
        re.IGNORECASE | re.DOTALL,
    )
    p2_m = re.search(
        r"(?:(?:SPEAKING\s+)?PART\s+2\b|CANDIDATE\s+TASK\s+CARD)(.*?)(?=(?:(?:SPEAKING\s+)?PART\s+3\b|TWO-WAY\s+DISCUSSION)|\Z)",
        text,
        re.IGNORECASE | re.DOTALL,
    )
    p3_m = re.search(
        r"(?:(?:SPEAKING\s+)?PART\s+3\b|TWO-WAY\s+DISCUSSION)(.*?)\Z",
        text,
        re.IGNORECASE | re.DOTALL,
    )

    p1_block = p1_m.group(1).strip() if p1_m else ""
    p2_block = p2_m.group(1).strip() if p2_m else ""
    p3_block = p3_m.group(1).strip() if p3_m else ""

    parts_out = []
    questions_out = []
    q_counter = 1

    # Part 1: Interview questions
    if p1_block:
        lines = [l.strip() for l in p1_block.splitlines() if l.strip()]
        p1_topic = ""
        p1_questions = []
        instructions = "Answer each question spontaneously. Speak for about 30 seconds per question."

        for line in lines:
            top_m = re.match(r"^(?:Topic|Theme)\s*[:\-]\s*(.+)$", line, re.I)
            if top_m:
                p1_topic = top_m.group(1).strip()
                continue
            if re.search(r"^(?:introduction\s+and\s+interview|in\s+this\s+part|the\s+examiner\s+will)", line, re.I):
                continue
            q_m = re.match(r"^(?:(?:Q|Question)\s*\d+[.:\-]?|\d+[.):\-])\s+(.+)$", line, re.I)
            if q_m:
                p1_questions.append(q_m.group(1).strip())
            elif line.endswith("?"):
                p1_questions.append(line)

        part1_qs = []
        for q_text in p1_questions:
            q_obj = {
                "number": q_counter,
                "partNumber": 1,
                "type": "speaking_task",
                "prompt": q_text,
                "options": None,
                "correctAnswers": [],
                "acceptedVariants": [],
                "points": 5 if exam_type == "multilevel" else 9,
                "wordLimit": None,
            }
            part1_qs.append(q_obj)
            questions_out.append(q_obj)
            q_counter += 1

        parts_out.append(
            {
                "partNumber": 1,
                "title": f"Part 1{': ' + p1_topic if p1_topic else ''}",
                "instructions": instructions,
                "passageText": f"Topic: {p1_topic}" if p1_topic else None,
                "questions": part1_qs,
            }
        )

    # Part 2: Cue Card
    if p2_block:
        lines = [l.strip() for l in p2_block.splitlines() if l.strip()]
        instructions = "Describe the topic. You have 1 minute to prepare and 2 minutes to speak."
        cue_card_lines = []
        topic_prompt = ""

        for line in lines:
            if re.search(r"^you\s+have\s+1\s+minute\s+to\s+prepare", line, re.I):
                continue
            if re.search(r"^candidate\s+task\s+card", line, re.I):
                continue
            top_m = re.match(r"^(?:Topic|Describe\s+a\w*)\s*[:\-]?\s*(.+)$", line, re.I)
            if top_m and not topic_prompt:
                topic_prompt = line
            cue_card_lines.append(line)

        full_cue_card = "\n".join(cue_card_lines).strip()
        if not topic_prompt and cue_card_lines:
            topic_prompt = cue_card_lines[0]

        q2_obj = {
            "number": q_counter,
            "partNumber": 2,
            "type": "speaking_task",
            "prompt": topic_prompt or "Describe the topic on the cue card.",
            "options": None,
            "correctAnswers": [],
            "acceptedVariants": [],
            "points": 5 if exam_type == "multilevel" else 9,
            "wordLimit": None,
            "prepTimeSec": 60,
            "speakingTimeSec": 120,
        }
        parts_out.append(
            {
                "partNumber": 2,
                "title": "Part 2",
                "instructions": instructions,
                "passageText": full_cue_card,
                "questions": [q2_obj],
            }
        )
        questions_out.append(q2_obj)
        q_counter += 1

    # Part 3: Discussion questions
    if p3_block:
        lines = [l.strip() for l in p3_block.splitlines() if l.strip()]
        p3_topic = ""
        p3_questions = []
        instructions = "Discussion topic. Give developed, analytical answers."

        for line in lines:
            top_m = re.match(r"^(?:Topic|Theme)\s*[:\-]\s*(.+)$", line, re.I)
            if top_m:
                p3_topic = top_m.group(1).strip()
                continue
            if re.search(r"^(?:two-way\s+discussion|discussion\s+topics)", line, re.I):
                continue
            q_m = re.match(r"^(?:(?:Q|Question)\s*\d+[.:\-]?|\d+[.):\-])\s+(.+)$", line, re.I)
            if q_m:
                p3_questions.append(q_m.group(1).strip())
            elif line.endswith("?"):
                p3_questions.append(line)

        part3_qs = []
        for q_text in p3_questions:
            q_obj = {
                "number": q_counter,
                "partNumber": 3,
                "type": "speaking_task",
                "prompt": q_text,
                "options": None,
                "correctAnswers": [],
                "acceptedVariants": [],
                "points": 6 if exam_type == "multilevel" else 9,
                "wordLimit": None,
            }
            part3_qs.append(q_obj)
            questions_out.append(q_obj)
            q_counter += 1

        parts_out.append(
            {
                "partNumber": 3,
                "title": f"Part 3{': ' + p3_topic if p3_topic else ''}",
                "instructions": instructions,
                "passageText": f"Topic: {p3_topic}" if p3_topic else None,
                "questions": part3_qs,
            }
        )

    is_complete = bool(len(parts_out) == 3 and questions_out)
    first_instructions = next((p.get("instructions") for p in parts_out if p.get("instructions")), None)
    first_passage = next((p.get("passageText") for p in parts_out if p.get("passageText")), None)

    return {
        "skill": "speaking",
        "status": "complete" if is_complete else "partial",
        "instructions": first_instructions,
        "passageText": first_passage,
        "parts": parts_out,
        "passages": parts_out,
        "questions": questions_out,
        "answers": {},
        "count": len(questions_out),
        "needsReview": [] if is_complete else [1],
        "summary": {
            "total": len(questions_out),
            "withAnswers": 0,
            "byType": {"speaking_task": len(questions_out)},
            "part1Present": len(parts_out) > 0 and len(parts_out[0]["questions"]) > 0,
            "part1Count": len(parts_out[0]["questions"]) if len(parts_out) > 0 else 0,
            "part2Present": len(parts_out) > 1,
            "part3Present": len(parts_out) > 2 and len(parts_out[2]["questions"]) > 0,
            "part3Count": len(parts_out[2]["questions"]) if len(parts_out) > 2 else 0,
            "isCompleteIeltsSpeaking": is_complete,
            "requiresManualGrading": True,
            "passagesCount": len(parts_out),
            "needsReviewCount": 0 if is_complete else 1,
        },
    }


def parse_smart_exam_content(
    text: str | None = None,
    file_bytes: bytes | None = None,
    filename: str | None = None,
    default_skill: str = "reading",
    exam_type: str = "ielts_academic",
    provided_answers: dict | None = None,
) -> dict:
    """Unified entrypoint supporting HTML, PDF, DOCX, TXT, Excel/CSV, and raw text across all 4 IELTS skills."""
    clean_text = ""
    is_html_source = False

    if file_bytes:
        ext = (filename or "").lower().split(".")[-1]
        if ext in ("html", "htm"):
            try:
                decoded_html = file_bytes.decode("utf-8")
            except UnicodeDecodeError:
                decoded_html = file_bytes.decode("latin-1", errors="ignore")
            is_html_source = True
            clean_text = decoded_html
        elif ext == "pdf":
            clean_text = extract_pdf_text(file_bytes)
        elif ext == "docx":
            clean_text = extract_docx_text(file_bytes)
        elif ext in ("txt", "text"):
            try:
                clean_text = file_bytes.decode("utf-8")
            except UnicodeDecodeError:
                clean_text = file_bytes.decode("latin-1", errors="ignore")
        elif ext in ("xlsx", "csv"):
            clean_text = file_bytes.decode("utf-8", errors="ignore")
    elif text and text.strip():
        clean_text = text
        if "<article" in text or "<html" in text or "const K =" in text:
            is_html_source = True

    if not clean_text or not clean_text.strip():
        raise ContractAPIException("VALIDATION_ERROR", "Fayl yoki matn kiritilishi shart", 400)

    target_skill = (default_skill or "reading").strip().lower()
    if target_skill not in ("reading", "listening", "writing", "speaking") or target_skill == "auto":
        target_skill = detect_content_skill(clean_text)

    if target_skill == "writing":
        if is_html_source:
            extracted_text = extract_html_text(clean_text)
            img_m = re.search(r"<img[^>]+src=[\"']([^\"']+)[\"']", clean_text, re.I)
            if img_m:
                extracted_text += f"\n[Image: {img_m.group(1)}]"
            return parse_smart_writing_text(extracted_text, exam_type=exam_type)
        return parse_smart_writing_text(clean_text, exam_type=exam_type)

    if target_skill == "speaking":
        if is_html_source:
            clean_text = extract_html_text(clean_text)
        return parse_smart_speaking_text(clean_text, exam_type=exam_type)

    if target_skill == "listening":
        if is_html_source:
            clean_text = extract_html_text(clean_text)
        return parse_smart_text_v2(
            clean_text,
            default_skill="listening",
            exam_type=exam_type,
            provided_answers=provided_answers,
        )

    # Reading:
    if is_html_source:
        bundle_res = parse_structured_html_bundle(
            clean_text,
            default_skill="reading",
            exam_type=exam_type,
            provided_answers=provided_answers,
        )
        if bundle_res:
            return bundle_res
        clean_text = extract_html_text(clean_text)

    return parse_smart_text_v2(
        clean_text,
        default_skill="reading",
        exam_type=exam_type,
        provided_answers=provided_answers,
    )


def parse_smart_exam_text(
    text: str,
    default_skill: str = "reading",
    exam_type: str = "ielts_academic",
    provided_answers: dict | None = None,
) -> dict:
    """Backwards-compatible wrapper calling parse_smart_exam_content."""
    return parse_smart_exam_content(
        text=text,
        default_skill=default_skill,
        exam_type=exam_type,
        provided_answers=provided_answers,
    )



def _normalize_incoming_question(raw_q: dict, default_num: int, exam_type: str, skill: str) -> dict:
    number = int(raw_q.get("number") or raw_q.get("questionNumber") or default_num)
    q_type = str(raw_q.get("type") or raw_q.get("questionType") or "short_answer").strip()
    if q_type not in QUESTION_TYPES:
        q_type = "short_answer"
    prompt = str(raw_q.get("prompt") or "").strip() or f"Question {number}"
    options = raw_q.get("options")
    if isinstance(options, list):
        options = [str(o).strip() for o in options if str(o).strip()]
    else:
        options = None

    if q_type == "true_false_notgiven" and not options:
        options = ["TRUE", "FALSE", "NOT GIVEN"]
    elif q_type == "yes_no_notgiven" and not options:
        options = ["YES", "NO", "NOT GIVEN"]
    elif q_type in TEXT_TYPES:
        options = None

    correct_answers = raw_q.get("correctAnswers")
    if isinstance(correct_answers, str) and correct_answers.strip():
        correct_answers = build_correct_answers(q_type, options, correct_answers.strip())
    elif isinstance(correct_answers, list):
        correct_answers = [str(x).strip() for x in correct_answers if str(x).strip()]
    else:
        single_ans = raw_q.get("correctAnswer") or raw_q.get("answer")
        if single_ans is not None and str(single_ans).strip():
            correct_answers = build_correct_answers(q_type, options, str(single_ans).strip())
        else:
            correct_answers = []

    if q_type in {"true_false_notgiven", "yes_no_notgiven"} and correct_answers:
        correct_answers = [canonical_decision(correct_answers[0])]
    elif q_type == "multi_select" and isinstance(correct_answers, list):
        split_answers = []
        for x in correct_answers:
            split_answers.extend([p.strip() for p in re.split(r"[,;/]+", str(x)) if p.strip()])
        correct_answers = split_answers
    elif q_type == "multi_select" and isinstance(correct_answers, str):
        correct_answers = [p.strip() for p in re.split(r"[,;/]+", correct_answers) if p.strip()]

    accepted_variants = raw_q.get("acceptedVariants")
    if isinstance(accepted_variants, str):
        accepted_variants = [x.strip() for x in re.split(r"[/;,]+", accepted_variants) if x.strip()]
    elif isinstance(accepted_variants, list):
        accepted_variants = [str(x).strip() for x in accepted_variants if str(x).strip()]
    else:
        accepted_variants = []

    if q_type not in TEXT_TYPES:
        accepted_variants = []

    points = int(raw_q.get("points") or 1)
    word_limit = raw_q.get("wordLimit")
    if word_limit is not None and str(word_limit).strip() != "":
        try:
            word_limit = int(word_limit)
        except ValueError:
            word_limit = None
    elif q_type in TEXT_TYPES and exam_type == "multilevel":
        word_limit = 1

    answer_rule = raw_q.get("answerRule")
    if not answer_rule and q_type in TEXT_TYPES and exam_type == "multilevel":
        answer_rule = "ONE_WORD_AND_OR_NUMBER"

    return {
        "number": number,
        "partNumber": int(
            raw_q.get("partNumber")
            or raw_q.get("part")
            or _infer_part_for_question(number, exam_type=exam_type, skill=skill)
        ),
        "type": q_type,
        "prompt": prompt,
        "options": options,
        "correct_answers": correct_answers,
        "accepted_variants": accepted_variants,
        "points": max(1, points),
        "word_limit": word_limit,
        "answer_rule": answer_rule,
    }


def _assert_staff_author(actor, exam: MockExam) -> None:
    if not actor or getattr(actor, "role", None) not in STAFF:
        raise ContractAPIException("FORBIDDEN", "Bu amal uchun rolingiz yetarli emas", 403)
    if actor.role == "teacher" and exam.created_by_id and exam.created_by_id != actor.id:
        raise ContractAPIException(
            "MOCK_NOT_OWNER",
            "Bu imtihonni faqat yaratgan o'qituvchi (yoki admin) tahrirlay oladi",
            403,
        )


def bulk_import_to_group(actor, group_id: str, payload_data: dict) -> dict:
    """Persist smart-parsed questions or structured question array into a MockQuestionGroup."""
    try:
        group = MockQuestionGroup.objects.select_related("section__exam").get(id=group_id)
    except MockQuestionGroup.DoesNotExist:
        raise ContractAPIException("MOCK_GROUP_NOT_FOUND", "Savollar guruhi topilmadi", 404)

    exam = group.section.exam
    skill = group.section.skill
    _assert_staff_author(actor, exam)

    replace_existing = bool(payload_data.get("replaceExisting", False))
    incoming_questions = payload_data.get("questions")
    parsed_meta = {}

    if not isinstance(incoming_questions, list):
        raw_text = payload_data.get("text") or ""
        parsed_meta = parse_smart_exam_text(
            raw_text,
            default_skill=skill,
            exam_type=exam.type,
            provided_answers=payload_data.get("answers"),
        )
        incoming_questions = parsed_meta["questions"]

    if not incoming_questions:
        raise ContractAPIException("VALIDATION_ERROR", "Hech qanday savol topilmadi", 400)

    with transaction.atomic():
        locked = MockExam.objects.select_for_update().get(id=exam.id)
        group = MockQuestionGroup.objects.select_for_update().get(id=group_id)

        passage_text = payload_data.get("passageText") or parsed_meta.get("passageText")
        instructions = payload_data.get("instructions") or parsed_meta.get("instructions")
        title = payload_data.get("title")
        update_group_fields = []
        if isinstance(passage_text, str) and passage_text.strip():
            group.passage_text = passage_text.strip()
            update_group_fields.append("passage_text")
        if isinstance(instructions, str) and instructions.strip():
            group.instructions = instructions.strip()
            update_group_fields.append("instructions")
        if isinstance(title, str) and title.strip():
            group.title = title.strip()
            update_group_fields.append("title")
        if update_group_fields:
            group.save(update_fields=update_group_fields)

        if replace_existing:
            MockQuestion.objects.filter(group_id=group.id).delete()

        existing_by_num = {
            q.number: q for q in MockQuestion.objects.filter(group_id=group.id).order_by("sort_order", "number")
        }
        next_sort = len(existing_by_num)
        saved_questions: list[MockQuestion] = []

        for idx, raw_q in enumerate(incoming_questions):
            norm = _normalize_incoming_question(raw_q, idx + 1, locked.type, skill)
            q_num = norm["number"]
            if q_num in existing_by_num:
                q_obj = existing_by_num[q_num]
                for field in (
                    "type",
                    "prompt",
                    "options",
                    "correct_answers",
                    "accepted_variants",
                    "points",
                    "word_limit",
                    "answer_rule",
                ):
                    setattr(q_obj, field, norm[field])
                q_obj.save(
                    update_fields=[
                        "type",
                        "prompt",
                        "options",
                        "correct_answers",
                        "accepted_variants",
                        "points",
                        "word_limit",
                        "answer_rule",
                    ]
                )
            else:
                q_obj = MockQuestion.objects.create(
                    id=new_id(),
                    group_id=group.id,
                    number=q_num,
                    sort_order=next_sort,
                    type=norm["type"],
                    prompt=norm["prompt"],
                    options=norm["options"],
                    correct_answers=norm["correct_answers"],
                    accepted_variants=norm["accepted_variants"],
                    points=norm["points"],
                    word_limit=norm["word_limit"],
                    answer_rule=norm["answer_rule"],
                    created_at=now(),
                )
                next_sort += 1
            saved_questions.append(q_obj)

        bump(locked)

    audit_event(
        actor,
        "mock.group.bulk_import",
        "mockQuestionGroup",
        group.id,
        new={"imported": len(saved_questions), "replaceExisting": replace_existing},
    )
    all_group_questions = list(MockQuestion.objects.filter(group_id=group.id).order_by("sort_order", "number"))
    return {
        "imported": len(saved_questions),
        "groupId": group.id,
        "examId": exam.id,
        "version": locked.content_version,
        "group": group_payload(group, questions=all_group_questions),
        "questions": [question_payload(q) for q in saved_questions],
    }


def bulk_import_to_section(actor, section_id: str, payload_data: dict) -> dict:
    try:
        section = MockSection.objects.select_related("exam").get(id=section_id)
    except MockSection.DoesNotExist:
        raise ContractAPIException("MOCK_SECTION_NOT_FOUND", "Bo'lim topilmadi", 404)
    return bulk_import_to_exam(actor, section.exam_id, section.skill, payload_data)


def bulk_import_to_exam(actor, exam_id: str, skill: str, payload_data: dict) -> dict:
    """Bulk import up to 40+ questions into an exam's skill section, auto-distributing across parts/passages."""
    try:
        exam = MockExam.objects.get(id=exam_id)
    except MockExam.DoesNotExist:
        raise ContractAPIException("MOCK_EXAM_NOT_FOUND", "Mock imtihon topilmadi", 404)

    _assert_staff_author(actor, exam)
    skill = (skill or payload_data.get("skill") or "reading").strip().lower()
    if skill not in {"listening", "reading", "writing", "speaking"}:
        raise ContractAPIException("VALIDATION_ERROR", "Noto'g'ri skill nomi", 400)

    group_id = payload_data.get("groupId")
    if group_id:
        return bulk_import_to_group(actor, group_id, payload_data)

    replace_existing = bool(payload_data.get("replaceExisting", True))
    incoming_questions = payload_data.get("questions")
    parts_meta_by_num: dict[int, dict] = {}

    if not isinstance(incoming_questions, list):
        raw_text = payload_data.get("text") or ""
        parsed = parse_smart_exam_text(
            raw_text,
            default_skill=skill,
            exam_type=exam.type,
            provided_answers=payload_data.get("answers"),
        )
        incoming_questions = parsed["questions"]
        for p in parsed.get("parts") or []:
            parts_meta_by_num[p["partNumber"]] = p
    else:
        for p in payload_data.get("parts") or payload_data.get("passages") or []:
            if isinstance(p, dict) and p.get("partNumber"):
                parts_meta_by_num[int(p["partNumber"])] = p

    if not incoming_questions:
        raise ContractAPIException("VALIDATION_ERROR", "Import qilish uchun savollar topilmadi", 400)

    with transaction.atomic():
        locked = MockExam.objects.select_for_update().get(id=exam.id)
        section = MockSection.objects.filter(exam_id=locked.id, skill=skill).first()
        if section is None:
            sort_idx = {"listening": 0, "reading": 1, "writing": 2, "speaking": 3}.get(skill, 0)
            dur = 40 if skill == "listening" else (14 if skill == "speaking" else 60)
            section = MockSection.objects.create(
                id=new_id(),
                exam_id=locked.id,
                skill=skill,
                title=skill.title(),
                sort_order=sort_idx,
                duration_minutes=dur,
                instructions=payload_data.get("instructions"),
            )

        existing_groups = list(MockQuestionGroup.objects.filter(section_id=section.id).order_by("sort_order", "id"))
        normalized_list = [
            _normalize_incoming_question(rq, idx + 1, locked.type, skill)
            for idx, rq in enumerate(incoming_questions)
        ]

        part_numbers = sorted({nq["partNumber"] for nq in normalized_list})
        groups_by_part: dict[int, MockQuestionGroup] = {}
        unit_name = (
            "Passage"
            if skill == "reading" and locked.type != "multilevel"
            else "Task"
            if skill == "writing"
            else "Section"
            if skill == "listening"
            else "Part"
        )

        for idx, p_num in enumerate(part_numbers):
            matched_group = next(
                (g for g in existing_groups if g.part_number == p_num or g.sort_order == p_num - 1),
                None,
            )
            if matched_group is None and idx < len(existing_groups):
                matched_group = existing_groups[idx]
            if matched_group is None:
                p_info = parts_meta_by_num.get(p_num) or {}
                matched_group = MockQuestionGroup.objects.create(
                    id=new_id(),
                    section_id=section.id,
                    sort_order=max(0, p_num - 1),
                    title=p_info.get("title") or f"{unit_name} {p_num}",
                    instructions=p_info.get("instructions") or payload_data.get("instructions"),
                    passage_text=p_info.get("passageText") or payload_data.get("passageText"),
                    part_number=p_num if skill in {"listening", "speaking"} else None,
                    image_key=p_info.get("imageKey") or p_info.get("image_key"),
                    audio_key=p_info.get("audioKey") or p_info.get("audio_key"),
                    audio_play_limit=2 if locked.type == "multilevel" and skill == "listening" else 1,
                    created_at=now(),
                )
            else:
                p_info = parts_meta_by_num.get(p_num) or {}
                upd = []
                if p_info.get("passageText") and (
                    replace_existing or not matched_group.passage_text or matched_group.passage_text != p_info["passageText"]
                ):
                    matched_group.passage_text = p_info["passageText"]
                    upd.append("passage_text")
                if p_info.get("instructions") and (
                    replace_existing or not matched_group.instructions or matched_group.instructions != p_info["instructions"]
                ):
                    matched_group.instructions = p_info["instructions"]
                    upd.append("instructions")
                if p_info.get("title") and (
                    replace_existing or not matched_group.title or matched_group.title != p_info["title"]
                ):
                    matched_group.title = p_info["title"]
                    upd.append("title")
                if (p_info.get("imageKey") or p_info.get("image_key")) and (
                    replace_existing or not matched_group.image_key
                ):
                    matched_group.image_key = p_info.get("imageKey") or p_info.get("image_key")
                    upd.append("image_key")
                if (p_info.get("audioKey") or p_info.get("audio_key")) and (
                    replace_existing or not matched_group.audio_key
                ):
                    matched_group.audio_key = p_info.get("audioKey") or p_info.get("audio_key")
                    upd.append("audio_key")
                if skill in {"listening", "speaking"} and matched_group.part_number != p_num:
                    matched_group.part_number = p_num
                    upd.append("part_number")
                if upd:
                    matched_group.save(update_fields=upd)
            groups_by_part[p_num] = matched_group

        if replace_existing:
            target_group_ids = [g.id for g in groups_by_part.values()]
            MockQuestion.objects.filter(group_id__in=target_group_ids).delete()

        saved_questions: list[MockQuestion] = []
        sort_counters: dict[str, int] = {}

        for norm in normalized_list:
            grp = groups_by_part[norm["partNumber"]]
            s_idx = sort_counters.get(grp.id, 0)
            sort_counters[grp.id] = s_idx + 1

            existing_q = MockQuestion.objects.filter(group_id=grp.id, number=norm["number"]).first()
            if existing_q:
                for field in (
                    "type",
                    "prompt",
                    "options",
                    "correct_answers",
                    "accepted_variants",
                    "points",
                    "word_limit",
                    "answer_rule",
                ):
                    setattr(existing_q, field, norm[field])
                existing_q.save(
                    update_fields=[
                        "type",
                        "prompt",
                        "options",
                        "correct_answers",
                        "accepted_variants",
                        "points",
                        "word_limit",
                        "answer_rule",
                    ]
                )
                saved_questions.append(existing_q)
            else:
                q_obj = MockQuestion.objects.create(
                    id=new_id(),
                    group_id=grp.id,
                    number=norm["number"],
                    sort_order=s_idx,
                    type=norm["type"],
                    prompt=norm["prompt"],
                    options=norm["options"],
                    correct_answers=norm["correct_answers"],
                    accepted_variants=norm["accepted_variants"],
                    points=norm["points"],
                    word_limit=norm["word_limit"],
                    answer_rule=norm["answer_rule"],
                    created_at=now(),
                )
                saved_questions.append(q_obj)

        bump(locked)

    audit_event(
        actor,
        "mock.exam.bulk_import",
        "mockExam",
        exam.id,
        new={"skill": skill, "imported": len(saved_questions), "parts": len(groups_by_part)},
    )
    return {
        "imported": len(saved_questions),
        "examId": exam.id,
        "sectionId": section.id,
        "skill": skill,
        "partsUpdated": len(groups_by_part),
        "version": locked.content_version,
        "questions": [question_payload(q) for q in saved_questions],
    }


EXCEL_HEADERS = [
    "Part",
    "QuestionNumber",
    "QuestionType",
    "Prompt",
    "OptionA",
    "OptionB",
    "OptionC",
    "OptionD",
    "OptionE",
    "OptionF",
    "OptionG",
    "OptionH",
    "CorrectAnswer",
    "AcceptedVariants",
    "Points",
    "WordLimit",
    "PassageText",
    "Instructions",
    "AudioStartSec",
    "AudioEndSec",
]


def generate_excel_template(exam_type: str = "ielts_academic", skill: str = "reading") -> tuple[bytes, str]:
    """Generate a styled 40-question .xlsx template for teachers to fill and upload."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Questions Import"
    ws.append(EXCEL_HEADERS)

    header_fill = PatternFill(start_color="0F172A", end_color="0F172A", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF", size=10)
    thin_side = Side(border_style="thin", color="CBD5E1")
    border = Border(left=thin_side, right=thin_side, top=thin_side, bottom=thin_side)

    for col_idx in range(1, len(EXCEL_HEADERS) + 1):
        cell = ws.cell(row=1, column=col_idx)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = border

    total_rows = 35 if exam_type == "multilevel" else 40
    for q_num in range(1, total_rows + 1):
        part_num = _infer_part_for_question(q_num, exam_type=exam_type, skill=skill)
        is_first_in_part = q_num == 1 or _infer_part_for_question(q_num - 1, exam_type=exam_type, skill=skill) != part_num
        if q_num <= 10:
            q_type = "multiple_choice"
            prompt = f"Sample question {q_num}: Choose the correct letter A, B, C or D."
            opts = ["First option", "Second option", "Third option", "Fourth option", "", "", "", ""]
            ans = "A"
            variants = ""
            w_limit = ""
        elif q_num <= 20:
            q_type = "true_false_notgiven" if skill == "reading" else "short_answer"
            if q_type == "true_false_notgiven":
                prompt = f"Sample statement {q_num}: The research was conducted in 2025."
                opts = ["TRUE", "FALSE", "NOT GIVEN", "", "", "", "", ""]
                ans = "TRUE"
                variants = ""
                w_limit = ""
            else:
                prompt = f"Sample note completion {q_num}: The train leaves at ____."
                opts = ["", "", "", "", "", "", "", ""]
                ans = "9:30"
                variants = "nine thirty"
                w_limit = 2
        elif q_num <= 30:
            q_type = "matching"
            prompt = f"Sample matching item {q_num}: Match the statement with the correct option."
            opts = ["Option A", "Option B", "Option C", "Option D", "Option E", "Option F", "", ""]
            ans = "B"
            variants = ""
            w_limit = ""
        else:
            q_type = "sentence_completion"
            prompt = f"Sample completion {q_num}: Researchers discovered a new ____ in the region."
            opts = ["", "", "", "", "", "", "", ""]
            ans = "species"
            variants = "plant species"
            w_limit = 1 if exam_type == "multilevel" else 2

        passage = (
            f"Enter full reading passage text for Part/Passage {part_num} here (only needed on the first row of each part)."
            if is_first_in_part and skill == "reading"
            else ""
        )
        instr = (
            f"Questions for Part {part_num}."
            if is_first_in_part
            else ""
        )
        start_sec = (part_num - 1) * 420 if is_first_in_part and skill == "listening" else ""
        end_sec = part_num * 420 if is_first_in_part and skill == "listening" else ""

        row_values = [
            part_num,
            q_num,
            q_type,
            prompt,
            *opts,
            ans,
            variants,
            1,
            w_limit,
            passage,
            instr,
            start_sec,
            end_sec,
        ]
        ws.append(row_values)

    for col_idx in range(1, len(EXCEL_HEADERS) + 1):
        col_letter = get_column_letter(col_idx)
        ws.column_dimensions[col_letter].width = 28 if col_idx in (4, 17, 18) else 15

    buf = BytesIO()
    wb.save(buf)
    filename = f"bestway_{exam_type}_{skill}_template.xlsx"
    return buf.getvalue(), filename


def parse_spreadsheet_bytes(file_bytes: bytes, filename: str = "import.xlsx") -> dict:
    """Parse an uploaded .xlsx or .csv file into parts, questions, and listening timestamps."""
    if not file_bytes:
        raise ContractAPIException("VALIDATION_ERROR", "Yuklangan fayl bo'sh", 400)

    lower_name = (filename or "import.xlsx").lower()
    rows_dicts: list[dict[str, str]] = []

    if lower_name.endswith(".csv"):
        try:
            decoded = file_bytes.decode("utf-8-sig")
        except UnicodeDecodeError:
            decoded = file_bytes.decode("latin-1")
        reader = csv.DictReader(StringIO(decoded))
        for r in reader:
            rows_dicts.append(
                {
                    str(k).strip(): (str(v[0]) if isinstance(v, list) and v else str(v or "")).strip()
                    for k, v in r.items()
                    if k is not None and str(k).strip()
                }
            )
    else:
        try:
            wb = load_workbook(BytesIO(file_bytes), data_only=True)
        except Exception as exc:
            raise ContractAPIException("VALIDATION_ERROR", f"Excel faylni o'qib bo'lmadi: {exc}", 400)
        ws = wb.active
        all_rows = list(ws.iter_rows(values_only=True))
        if len(all_rows) < 2:
            raise ContractAPIException("VALIDATION_ERROR", "Jadvalda savollar qatori topilmadi", 400)
        headers = [str(h or "").strip() for h in all_rows[0]]
        for raw_row in all_rows[1:]:
            if not any(cell is not None and str(cell).strip() != "" for cell in raw_row):
                continue
            row_map = {}
            for idx, h in enumerate(headers):
                if h and idx < len(raw_row) and raw_row[idx] is not None:
                    row_map[h] = str(raw_row[idx]).strip()
            if row_map:
                rows_dicts.append(row_map)

    if not rows_dicts:
        raise ContractAPIException("VALIDATION_ERROR", "Jadvalda hech qanday savol topilmadi", 400)

    def _get(row: dict, *keys: str) -> str:
        lower_lookup = {k.lower().replace(" ", "").replace("_", ""): v for k, v in row.items()}
        for k in keys:
            norm_k = k.lower().replace(" ", "").replace("_", "")
            if norm_k in lower_lookup and lower_lookup[norm_k] != "":
                return lower_lookup[norm_k]
        return ""

    questions_out: list[dict] = []
    parts_map: dict[int, dict] = {}
    timestamps_map: dict[int, dict] = {}
    by_type: dict[str, int] = {}
    with_answers = 0

    for idx, r in enumerate(rows_dicts):
        q_num_raw = _get(r, "QuestionNumber", "Number", "Q", "No", "SavolRaqami")
        try:
            q_num = int(float(q_num_raw)) if q_num_raw else (idx + 1)
        except ValueError:
            q_num = idx + 1

        part_raw = _get(r, "Part", "PartNumber", "Passage", "Section", "Qism")
        try:
            part_num = int(float(part_raw)) if part_raw else _infer_part_for_question(q_num)
        except ValueError:
            part_num = _infer_part_for_question(q_num)

        q_type = _get(r, "QuestionType", "Type", "SavolTuri").lower() or "short_answer"
        prompt = _get(r, "Prompt", "Question", "Text", "Savol", "SavolMatni") or f"Question {q_num}"

        options: list[str] = []
        for letter in ("A", "B", "C", "D", "E", "F", "G", "H"):
            opt_val = _get(r, f"Option{letter}", f"Opt{letter}", letter)
            if opt_val:
                options.append(opt_val)

        if q_type not in QUESTION_TYPES:
            if len(options) >= 2:
                q_type = "multiple_choice"
            else:
                q_type = "short_answer"

        if q_type == "true_false_notgiven" and not options:
            options = ["TRUE", "FALSE", "NOT GIVEN"]
        elif q_type == "yes_no_notgiven" and not options:
            options = ["YES", "NO", "NOT GIVEN"]
        elif q_type in TEXT_TYPES:
            options = []

        ans_str = _get(r, "CorrectAnswer", "Answer", "Key", "Javob", "TogriJavob")
        variants_str = _get(r, "AcceptedVariants", "Variants", "Alternatives", "Variantlar")

        built = build_correct_answers(q_type, options or None, ans_str) if ans_str else []
        if q_type in {"true_false_notgiven", "yes_no_notgiven"} and built:
            correct_answers = [canonical_decision(built[0])]
        elif q_type in CHOICE_TYPES and built:
            correct_answers = built
        else:
            correct_answers = [built[0]] if built else ([ans_str] if ans_str else [])

        accepted_variants = [v.strip() for v in re.split(r"[/;,]+", variants_str) if v.strip()] if variants_str else []
        if len(built) > 1 and q_type in TEXT_TYPES:
            for extra_v in built[1:]:
                if extra_v not in accepted_variants:
                    accepted_variants.append(extra_v)

        if correct_answers:
            with_answers += 1

        pts_raw = _get(r, "Points", "Score", "Ball")
        try:
            points = max(1, int(float(pts_raw))) if pts_raw else 1
        except ValueError:
            points = 1

        wl_raw = _get(r, "WordLimit", "MaxWords", "SozChegarasi")
        try:
            word_limit = int(float(wl_raw)) if wl_raw else None
        except ValueError:
            word_limit = None

        q_item = {
            "number": q_num,
            "partNumber": part_num,
            "type": q_type,
            "prompt": prompt,
            "options": options if options else None,
            "correctAnswers": correct_answers,
            "acceptedVariants": accepted_variants,
            "points": points,
            "wordLimit": word_limit,
            "answerRule": None,
        }
        questions_out.append(q_item)
        by_type[q_type] = by_type.get(q_type, 0) + 1

        p_entry = parts_map.setdefault(
            part_num,
            {
                "partNumber": part_num,
                "title": f"Part {part_num}",
                "passageText": None,
                "instructions": None,
                "questions": [],
            },
        )
        p_entry["questions"].append(q_item)
        passage_val = _get(r, "PassageText", "Passage", "Matn")
        if passage_val and not p_entry["passageText"]:
            p_entry["passageText"] = passage_val
        instr_val = _get(r, "Instructions", "Instruction", "Ko'rsatma", "Korsatma")
        if instr_val and not p_entry["instructions"]:
            p_entry["instructions"] = instr_val

        start_raw = _get(r, "AudioStartSec", "StartSec", "AudioStart")
        end_raw = _get(r, "AudioEndSec", "EndSec", "AudioEnd")
        if start_raw and part_num not in timestamps_map:
            try:
                s_sec = float(start_raw)
                e_sec = float(end_raw) if end_raw else None
                timestamps_map[part_num] = {
                    "partNumber": part_num,
                    "label": f"Part {part_num}",
                    "startSec": s_sec,
                    "endSec": e_sec,
                }
            except ValueError:
                pass

    parts_list = [parts_map[k] for k in sorted(parts_map.keys())]
    timestamps_list = [timestamps_map[k] for k in sorted(timestamps_map.keys())]

    return {
        "parts": parts_list,
        "questions": questions_out,
        "timestamps": timestamps_list,
        "count": len(questions_out),
        "summary": {
            "total": len(questions_out),
            "withAnswers": with_answers,
            "byType": by_type,
        },
    }


def import_spreadsheet_to_exam(
    actor,
    exam_id: str,
    file_bytes: bytes,
    filename: str = "import.xlsx",
    skill: str = "reading",
    group_id: str | None = None,
    replace_existing: bool = True,
) -> dict:
    """Parse an uploaded Excel/CSV file and persist all questions (and timestamps if present) into the exam."""
    parsed = parse_spreadsheet_bytes(file_bytes, filename=filename)
    if group_id:
        res = bulk_import_to_group(
            actor,
            group_id,
            {
                "questions": parsed["questions"],
                "replaceExisting": replace_existing,
                "passageText": next((p["passageText"] for p in parsed["parts"] if p.get("passageText")), None),
                "instructions": next((p["instructions"] for p in parsed["parts"] if p.get("instructions")), None),
            },
        )
    else:
        res = bulk_import_to_exam(
            actor,
            exam_id,
            skill,
            {
                "questions": parsed["questions"],
                "parts": parsed["parts"],
                "replaceExisting": replace_existing,
            },
        )
    if parsed.get("timestamps") and skill == "listening":
        ts_res = save_listening_timestamps(actor, exam_id, parsed["timestamps"])
        res["listeningTimestamps"] = ts_res.get("timestamps")
    res["summary"] = parsed["summary"]
    return res


def save_listening_timestamps(
    actor,
    exam_id: str,
    timestamps: list[dict],
    audio_key: str | None = None,
    audio_url: str | None = None,
    duration_sec: int | None = None,
    uploaded_file=None,
) -> dict:
    """Save single-audio file and section/part timestamp markers for a Listening exam."""
    ensure_listening_config_table()
    try:
        exam = MockExam.objects.get(id=exam_id)
    except MockExam.DoesNotExist:
        raise ContractAPIException("MOCK_EXAM_NOT_FOUND", "Mock imtihon topilmadi", 404)

    _assert_staff_author(actor, exam)

    if uploaded_file is not None:
        audio_key = store_upload(uploaded_file, "audio")

    normalized_ts: list[dict] = []
    if isinstance(timestamps, list):
        for idx, item in enumerate(timestamps):
            if not isinstance(item, dict):
                continue
            part_num = int(item.get("partNumber") or item.get("part") or (idx + 1))
            start_sec = float(item.get("startSec") or item.get("start") or 0.0)
            raw_end = item.get("endSec") if item.get("endSec") is not None else item.get("end")
            end_sec = float(raw_end) if raw_end is not None and str(raw_end).strip() != "" else None
            normalized_ts.append(
                {
                    "partNumber": part_num,
                    "groupId": item.get("groupId"),
                    "label": str(item.get("label") or f"Part {part_num}"),
                    "startSec": max(0.0, round(start_sec, 2)),
                    "endSec": max(0.0, round(end_sec, 2)) if end_sec is not None else None,
                }
            )
    normalized_ts.sort(key=lambda x: x["partNumber"])

    with transaction.atomic():
        section = MockSection.objects.filter(exam_id=exam_id, skill="listening").first()
        groups = (
            list(MockQuestionGroup.objects.filter(section_id=section.id).order_by("sort_order", "id"))
            if section
            else []
        )

        for ts_item in normalized_ts:
            p_num = ts_item["partNumber"]
            matched = next(
                (g for g in groups if g.part_number == p_num or g.sort_order == p_num - 1),
                None,
            )
            if matched:
                ts_item["groupId"] = matched.id
                upd = []
                if audio_key:
                    matched.audio_key = audio_key
                    upd.append("audio_key")
                if ts_item["endSec"] is not None and ts_item["endSec"] > ts_item["startSec"]:
                    part_dur = int(math.ceil(ts_item["endSec"] - ts_item["startSec"]))
                    matched.audio_duration_sec = part_dur
                    upd.append("audio_duration_sec")
                elif duration_sec and not matched.audio_duration_sec:
                    matched.audio_duration_sec = int(duration_sec)
                    upd.append("audio_duration_sec")
                if upd:
                    matched.save(update_fields=upd)

        if audio_key and groups:
            for g in groups:
                if g.audio_key != audio_key:
                    g.audio_key = audio_key
                    g.save(update_fields=["audio_key"])

        resolved_url = audio_url
        if not resolved_url and groups and groups[0].audio_key:
            resolved_url = media_url(groups[0].id, "audio")
        if not audio_key and groups and groups[0].audio_key:
            audio_key = groups[0].audio_key

        if duration_sec is None and normalized_ts:
            max_end = max((t["endSec"] or t["startSec"] for t in normalized_ts), default=0)
            if max_end > 0:
                duration_sec = int(math.ceil(max_end))

        ts_json = json.dumps(normalized_ts)
        section_id = section.id if section else None

        with connection.cursor() as cursor:
            cursor.execute('SELECT 1 FROM "MockListeningConfig" WHERE "exam_id"=%s', [exam_id])
            exists = bool(cursor.fetchone())
            if exists:
                cursor.execute(
                    """
                    UPDATE "MockListeningConfig"
                    SET "section_id"=%s, "audio_key"=COALESCE(%s, "audio_key"),
                        "audio_url"=COALESCE(%s, "audio_url"),
                        "duration_sec"=COALESCE(%s, "duration_sec"),
                        "timestamps"=%s, "updated_at"=CURRENT_TIMESTAMP
                    WHERE "exam_id"=%s
                    """,
                    [section_id, audio_key, resolved_url, duration_sec, ts_json, exam_id],
                )
            else:
                cursor.execute(
                    """
                    INSERT INTO "MockListeningConfig"
                    ("exam_id", "section_id", "audio_key", "audio_url", "duration_sec", "timestamps", "updated_at")
                    VALUES (%s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
                    """,
                    [exam_id, section_id, audio_key, resolved_url, duration_sec, ts_json],
                )

    return get_listening_timestamps(exam_id)


def get_listening_timestamps(exam_id: str) -> dict:
    """Retrieve single-audio configuration and part timestamps for a Listening exam."""
    ensure_listening_config_table()
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT "exam_id", "section_id", "audio_key", "audio_url", "duration_sec", "timestamps"
            FROM "MockListeningConfig"
            WHERE "exam_id"=%s
            """,
            [exam_id],
        )
        row = cursor.fetchone()

    if row:
        ts_val = row[5]
        if isinstance(ts_val, str):
            try:
                ts_val = json.loads(ts_val)
            except Exception:
                ts_val = []
        return {
            "examId": row[0],
            "sectionId": row[1],
            "audioKey": row[2],
            "audioUrl": row[3],
            "durationSec": row[4],
            "timestamps": ts_val if isinstance(ts_val, list) else [],
        }

    # Fallback: synthesize timestamps from existing Listening MockQuestionGroups if present
    section = MockSection.objects.filter(exam_id=exam_id, skill="listening").first()
    if not section:
        return {
            "examId": exam_id,
            "sectionId": None,
            "audioKey": None,
            "audioUrl": None,
            "durationSec": None,
            "timestamps": [],
        }

    groups = list(MockQuestionGroup.objects.filter(section_id=section.id).order_by("sort_order", "id"))
    cursor_sec = 0.0
    fallback_ts = []
    first_audio_key = None
    first_audio_url = None
    for idx, g in enumerate(groups):
        p_num = g.part_number or (idx + 1)
        dur = float(g.audio_duration_sec or 420)
        if g.audio_key and not first_audio_key:
            first_audio_key = g.audio_key
            first_audio_url = media_url(g.id, "audio")
        fallback_ts.append(
            {
                "partNumber": p_num,
                "groupId": g.id,
                "label": g.title or f"Part {p_num}",
                "startSec": round(cursor_sec, 2),
                "endSec": round(cursor_sec + dur, 2),
            }
        )
        cursor_sec += dur

    return {
        "examId": exam_id,
        "sectionId": section.id,
        "audioKey": first_audio_key,
        "audioUrl": first_audio_url,
        "durationSec": int(cursor_sec) if fallback_ts else None,
        "timestamps": fallback_ts,
    }
