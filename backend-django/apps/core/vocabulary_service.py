"""Vocabulary engine service: raw text parsing, quiz generation, gamified scoring, SRS, and Excel export."""
from io import BytesIO
import random
import re
from typing import Any
from uuid import uuid4

from django.db import transaction
from django.db.models import F
from django.utils import timezone
import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from apps.legacy_schema.models import PointsLog, StudentProfile, User
from common.api.exceptions import ContractAPIException

from .models import (
    QuizMode,
    UserWeakWord,
    VocabularyAttempt,
    VocabularyLevel,
    VocabularySet,
    VocabularyWord,
)


def parse_raw_vocabulary_text(raw_text: str) -> list[dict[str, str]]:
    """Parse raw vocabulary text from clipboard/Word/Telegram.

    Supported patterns per line:
    - apple - olma
    - apple — olma
    - apple – olma
    - apple : olma
    - apple = olma
    - apple\tolma
    - 1. apple - olma
    - 1) apple - olma
    - • apple - olma
    - apple [noun] (e.g. An apple a day) - olma
    """
    if not raw_text or not isinstance(raw_text, str):
        return []

    lines = raw_text.strip().splitlines()
    results = []

    # Regex for stripping leading item markers: "1. ", "1) ", "• ", "- "
    item_prefix_re = re.compile(r"^\s*(?:\d+[\.\)]|[-•*])\s*")
    # Separator regex: " - ", " — ", " – ", " : ", " = ", "\t", or surrounded by whitespace
    delim_re = re.compile(r"\s*(?:[-—–:=]|\t)\s*")

    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith("#") or line.startswith("//"):
            continue

        clean_line = item_prefix_re.sub("", line).strip()
        parts = delim_re.split(clean_line, maxsplit=1)
        if len(parts) < 2:
            continue

        eng_raw, uzb_raw = parts[0].strip(), parts[1].strip()
        if not eng_raw or not uzb_raw:
            continue

        # Extract optional part of speech in brackets: [n], [v], [adj], etc.
        pos = None
        pos_match = re.search(r"\[([a-zA-Z\.\s]+)\]", eng_raw)
        if pos_match:
            pos = pos_match.group(1).strip()
            eng_raw = re.sub(r"\[[a-zA-Z\.\s]+\]", "", eng_raw).strip()

        # Extract optional context sentence in parentheses: (e.g. He is resilient)
        context = None
        context_match = re.search(r"\(([^\)]+)\)", eng_raw)
        if context_match:
            candidate = context_match.group(1).strip()
            if candidate.lower().startswith("e.g.") or len(candidate.split()) >= 3:
                context = candidate
                eng_raw = re.sub(r"\([^\)]+\)", "", eng_raw).strip()

        # Clean trailing punctuation
        eng_clean = re.sub(r"[\s,;]+$", "", eng_raw).strip()
        uzb_clean = re.sub(r"[\s,;]+$", "", uzb_raw).strip()

        if eng_clean and uzb_clean:
            results.append({
                "english": eng_clean,
                "uzbek": uzb_clean,
                "context_sentence": context or "",
                "part_of_speech": pos or "",
            })

    return results


def create_vocabulary_set(
    actor: User,
    title: str,
    words: list[dict[str, str]],
    level: str = "B1",
    group_id: str | None = None,
    description: str | None = None,
    is_public: bool = True,
) -> VocabularySet:
    if not title or not title.strip():
        raise ContractAPIException("VALIDATION_ERROR", "Sarlavha bo'sh bo'lishi mumkin emas", 400)
    if not words:
        raise ContractAPIException("VALIDATION_ERROR", "To'plamda kamida bitta so'z bo'lishi shart", 400)

    if level not in VocabularyLevel.values:
        level = VocabularyLevel.B1

    with transaction.atomic():
        vocab_set = VocabularySet.objects.create(
            title=title.strip(),
            description=description.strip() if description else None,
            group_id=group_id if group_id else None,
            created_by_id=actor.id,
            level=level,
            is_public=is_public,
        )

        word_instances = [
            VocabularyWord(
                set=vocab_set,
                english=w["english"].strip(),
                uzbek=w["uzbek"].strip(),
                context_sentence=w.get("context_sentence", "").strip() or None,
                part_of_speech=w.get("part_of_speech", "").strip() or None,
            )
            for w in words
            if w.get("english", "").strip() and w.get("uzbek", "").strip()
        ]
        VocabularyWord.objects.bulk_create(word_instances)

    return vocab_set


def generate_quiz_for_set(set_id: str, mode: str = "mixed", student_id: str | None = None) -> dict[str, Any]:
    vocab_set = VocabularySet.objects.filter(id=set_id).first()
    if not vocab_set:
        raise ContractAPIException("VOCABULARY_SET_NOT_FOUND", "Lug'at to'plami topilmadi", 404)

    words = list(VocabularyWord.objects.filter(set_id=set_id))
    if not words:
        raise ContractAPIException("EMPTY_VOCABULARY_SET", "Ushbu to'plamda savollar yo'q", 400)

    # Shuffle question order
    random.shuffle(words)

    all_uzbek = [w.uzbek for w in words]
    all_english = [w.english for w in words]

    questions = []
    for idx, word in enumerate(words):
        # Determine question type
        if mode == QuizMode.ENG_UZB:
            q_type = "eng_uzb"
        elif mode == QuizMode.UZB_ENG:
            q_type = "uzb_eng"
        elif mode == QuizMode.SPELLING:
            q_type = "spelling"
        else:
            # Mixed rotation: eng_uzb -> uzb_eng -> spelling
            cycle = idx % 3
            if cycle == 0:
                q_type = "eng_uzb"
            elif cycle == 1:
                q_type = "uzb_eng"
            else:
                q_type = "spelling"

        options = []
        if q_type == "eng_uzb":
            prompt = word.english
            distractor_pool = [u for u in all_uzbek if u.lower() != word.uzbek.lower()]
            num_distractors = min(3, len(distractor_pool))
            distractors = random.sample(distractor_pool, num_distractors) if num_distractors > 0 else []
            opts = list(set([word.uzbek] + distractors))
            random.shuffle(opts)
            options = opts
        elif q_type == "uzb_eng":
            prompt = word.uzbek
            distractor_pool = [e for e in all_english if e.lower() != word.english.lower()]
            num_distractors = min(3, len(distractor_pool))
            distractors = random.sample(distractor_pool, num_distractors) if num_distractors > 0 else []
            opts = list(set([word.english] + distractors))
            random.shuffle(opts)
            options = opts
        else:  # spelling
            prompt = word.uzbek
            options = []

        questions.append({
            "id": word.id,
            "wordId": word.id,
            "prompt": prompt,
            "type": q_type,
            "options": options,
            "contextSentence": word.context_sentence,
            "partOfSpeech": word.part_of_speech,
            "firstLetter": word.english[0].upper() if word.english else "",
        })

    return {
        "setId": vocab_set.id,
        "setTitle": vocab_set.title,
        "level": vocab_set.level,
        "mode": mode,
        "totalQuestions": len(questions),
        "questions": questions,
    }


def calculate_points_for_percentage(percentage: float) -> int:
    """Gamified point allocation:

    - 100% accuracy -> +5 points
    - 80% to 99% accuracy -> +3 points
    - Below 80% -> 0 points
    """
    if percentage >= 100.0:
        return 5
    if percentage >= 80.0:
        return 3
    return 0


def submit_quiz_attempt(
    student: User,
    set_id: str,
    mode: str,
    answers: list[dict[str, Any]],
) -> dict[str, Any]:
    vocab_set = VocabularySet.objects.filter(id=set_id).first()
    if not vocab_set:
        raise ContractAPIException("VOCABULARY_SET_NOT_FOUND", "Lug'at to'plami topilmadi", 404)

    if not answers:
        raise ContractAPIException("EMPTY_ANSWERS", "Javoblar kiritilmadi", 400)

    word_ids = [a.get("wordId") or a.get("id") for a in answers if a.get("wordId") or a.get("id")]
    word_map = {w.id: w for w in VocabularyWord.objects.filter(id__in=word_ids)}

    score = 0
    wrong_answers = []

    for ans in answers:
        wid = ans.get("wordId") or ans.get("id")
        user_val = str(ans.get("answer") or "").strip()
        q_type = ans.get("type", "eng_uzb")
        word = word_map.get(wid)
        if not word:
            continue

        is_correct = False
        if q_type == "eng_uzb":
            is_correct = user_val.lower() == word.uzbek.strip().lower()
            expected = word.uzbek
        elif q_type == "uzb_eng":
            is_correct = user_val.lower() == word.english.strip().lower()
            expected = word.english
        else:  # spelling
            clean_user = re.sub(r"\s+", " ", user_val).lower()
            clean_target = re.sub(r"\s+", " ", word.english.strip()).lower()
            is_correct = clean_user == clean_target
            expected = word.english

        if is_correct:
            score += 1
            # SRS update for correct answer
            weak = UserWeakWord.objects.filter(student_id=student.id, word_id=word.id).first()
            if weak:
                weak.correct_streak += 1
                if weak.correct_streak >= 2:
                    weak.is_mastered = True
                weak.save(update_fields=["correct_streak", "is_mastered", "last_reviewed"])
        else:
            wrong_answers.append({
                "wordId": word.id,
                "english": word.english,
                "uzbek": word.uzbek,
                "userAnswer": user_val,
                "correctAnswer": expected,
                "type": q_type,
            })
            # SRS update for mistake
            weak, created = UserWeakWord.objects.get_or_create(
                student_id=student.id,
                word_id=word.id,
                defaults={"mistake_count": 1, "correct_streak": 0, "is_mastered": False},
            )
            if not created:
                weak.mistake_count += 1
                weak.correct_streak = 0
                weak.is_mastered = False
                weak.save(update_fields=["mistake_count", "correct_streak", "is_mastered", "last_reviewed"])

    total_words = len(answers)
    percentage = round((score / total_words) * 100, 1) if total_words > 0 else 0.0
    points_awarded = calculate_points_for_percentage(percentage)

    with transaction.atomic():
        attempt = VocabularyAttempt.objects.create(
            student_id=student.id,
            set=vocab_set,
            score=score,
            total_words=total_words,
            percentage=percentage,
            points_awarded=points_awarded,
            mode=mode,
            wrong_answers=wrong_answers,
        )

        # Award points to StudentProfile if bonus earned
        if points_awarded > 0:
            profile = StudentProfile.objects.filter(user_id=student.id).first()
            if not profile:
                profile = StudentProfile.objects.create(
                    user_id=student.id,
                    available_programs=["IELTS", "MULTILEVEL"],
                    active_program="IELTS",
                    is_approved=True,
                    current_points=0,
                    link_code=student.id[:8],
                    game_qualified=False,
                    created_at=timezone.now(),
                )

            StudentProfile.objects.filter(user_id=student.id).update(
                current_points=F("current_points") + points_awarded
            )
            PointsLog.objects.create(
                id=str(uuid4()),
                student_id=student.id,
                change=points_awarded,
                reason=f"Lug'at testi: {vocab_set.title} ({int(percentage)}%)",
                by_user_id=student.id,
                created_at=timezone.now(),
            )

    return {
        "attemptId": attempt.id,
        "setId": vocab_set.id,
        "setTitle": vocab_set.title,
        "score": score,
        "totalWords": total_words,
        "percentage": percentage,
        "pointsAwarded": points_awarded,
        "mode": mode,
        "wrongAnswers": wrong_answers,
        "completedAt": attempt.completed_at.isoformat(),
        "isMasteredSRS": len(wrong_answers) == 0,
    }


def generate_srs_quiz_for_user(student_id: str, limit: int = 20) -> dict[str, Any]:
    """Generate personalized spaced repetition quiz for user's weak words."""
    weak_records = list(
        UserWeakWord.objects.filter(student_id=student_id, is_mastered=False)
        .select_related("word", "word__set")
        .order_by("-mistake_count", "-last_reviewed")[:limit]
    )

    if not weak_records:
        return {
            "totalQuestions": 0,
            "questions": [],
            "message": "Zaif so'zlar banki bo'sh. Barcha so'zlar o'zlashtirilgan!",
        }

    words = [rec.word for rec in weak_records]
    all_uzbek = [w.uzbek for w in words]
    all_english = [w.english for w in words]

    questions = []
    for idx, word in enumerate(words):
        cycle = idx % 3
        if cycle == 0:
            q_type = "eng_uzb"
            prompt = word.english
            distractor_pool = [u for u in all_uzbek if u.lower() != word.uzbek.lower()]
            num_distractors = min(3, len(distractor_pool))
            distractors = random.sample(distractor_pool, num_distractors) if num_distractors > 0 else []
            opts = list(set([word.uzbek] + distractors))
            random.shuffle(opts)
            options = opts
        elif cycle == 1:
            q_type = "uzb_eng"
            prompt = word.uzbek
            distractor_pool = [e for e in all_english if e.lower() != word.english.lower()]
            num_distractors = min(3, len(distractor_pool))
            distractors = random.sample(distractor_pool, num_distractors) if num_distractors > 0 else []
            opts = list(set([word.english] + distractors))
            random.shuffle(opts)
            options = opts
        else:
            q_type = "spelling"
            prompt = word.uzbek
            options = []

        questions.append({
            "id": word.id,
            "wordId": word.id,
            "prompt": prompt,
            "type": q_type,
            "options": options,
            "contextSentence": word.context_sentence,
            "partOfSpeech": word.part_of_speech,
            "firstLetter": word.english[0].upper() if word.english else "",
        })

    return {
        "title": "Zaif So'zlar Banki (SRS Mashqi)",
        "mode": "srs_mixed",
        "totalQuestions": len(questions),
        "questions": questions,
    }


def export_vocabulary_set_excel(set_id: str) -> bytes:
    """Generate high-aesthetic Emerald/Obsidian Excel (.xlsx) roster report for a vocabulary set."""
    vocab_set = VocabularySet.objects.select_related("group").filter(id=set_id).first()
    if not vocab_set:
        raise ContractAPIException("VOCABULARY_SET_NOT_FOUND", "Lug'at to'plami topilmadi", 404)

    attempts = list(
        VocabularyAttempt.objects.filter(set_id=set_id)
        .select_related("student")
        .order_by("-completed_at")
    )

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Lug'at Natijalari"
    ws.views.sheetView[0].showGridLines = True

    # Color definitions
    emerald_dark = "064E3B"
    emerald_accent = "059669"
    header_fill = PatternFill(start_color=emerald_dark, end_color=emerald_dark, fill_type="solid")
    zebra_fill = PatternFill(start_color="F0FDF4", end_color="F0FDF4", fill_type="solid")
    gold_fill = PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid")

    font_title = Font(name="Calibri", size=15, bold=True, color="064E3B")
    font_subtitle = Font(name="Calibri", size=11, italic=True, color="475569")
    font_header = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    font_data = Font(name="Calibri", size=10, color="0F172A")
    font_bold = Font(name="Calibri", size=10, bold=True, color="0F172A")
    font_gold = Font(name="Calibri", size=10, bold=True, color="B45309")
    font_green = Font(name="Calibri", size=10, bold=True, color="047857")

    border_thin = Side(border_style="thin", color="CBD5E1")
    cell_border = Border(left=border_thin, right=border_thin, top=border_thin, bottom=border_thin)

    align_center = Alignment(horizontal="center", vertical="center")
    align_left = Alignment(horizontal="left", vertical="center")

    # Title block
    ws.merge_cells("A1:J1")
    ws["A1"] = "BESTWAY EDUCATION — LUG'AT TESTI NATIJALARI VEDOMOSTI"
    ws["A1"].font = font_title
    ws["A1"].alignment = align_center

    group_name = vocab_set.group.name if vocab_set.group else "Umumiy / Ochiq"
    words_count = vocab_set.words.count()
    ws.merge_cells("A2:J2")
    ws["A2"] = f"To'plam: {vocab_set.title}   |   Daraja: {vocab_set.level}   |   Guruh: {group_name}   |   Jami so'zlar: {words_count}"
    ws["A2"].font = font_subtitle
    ws["A2"].alignment = align_center

    ws.row_dimensions[1].height = 28
    ws.row_dimensions[2].height = 20
    ws.row_dimensions[4].height = 26

    # Headers
    headers = [
        ("#", 6),
        ("Talaba Ismi", 26),
        ("Telefon", 16),
        ("Guruhi", 18),
        ("To'plangan Ball", 16),
        ("Jami So'zlar", 14),
        ("Foiz", 12),
        ("Bonus Ball", 14),
        ("Topshirilgan Sana", 20),
        ("Xato Qilingan So'zlar", 36),
    ]

    for col_idx, (h_title, _) in enumerate(headers, start=1):
        cell = ws.cell(row=4, column=col_idx, value=h_title)
        cell.fill = header_fill
        cell.font = font_header
        cell.alignment = align_center
        cell.border = cell_border

    # Roster data
    # Deduplicate showing each student's best attempt or all attempts
    seen_students = set()
    row_idx = 5

    for att in attempts:
        student_user = att.student
        st_id = student_user.id if student_user else "unknown"
        if st_id in seen_students:
            continue
        seen_students.add(st_id)

        st_name = getattr(student_user, "name", "Noma'lum") or "Noma'lum"
        st_phone = getattr(student_user, "phone", "") or "-"
        st_group = group_name

        score_text = f"{att.score} / {att.total_words}"
        percentage_text = f"{att.percentage:.1f}%"
        bonus_text = f"+{att.points_awarded} ball" if att.points_awarded > 0 else "0 ball"
        date_str = att.completed_at.strftime("%Y-%m-%d %H:%M") if att.completed_at else "-"

        wrong_list = [f"{w.get('english')} ({w.get('userAnswer') or '—'})" for w in (att.wrong_answers or [])[:6]]
        wrong_summary = ", ".join(wrong_list) if wrong_list else "Xatolarsiz (100%)"

        bonus_font = font_gold if att.points_awarded == 5 else (font_green if att.points_awarded == 3 else font_data)

        row_values = [
            (len(seen_students), align_center, font_data),
            (st_name, align_left, font_bold),
            (st_phone, align_center, font_data),
            (st_group, align_center, font_data),
            (score_text, align_center, font_data),
            (att.total_words, align_center, font_data),
            (percentage_text, align_center, font_bold),
            (bonus_text, align_center, bonus_font),
            (date_str, align_center, font_data),
            (wrong_summary, align_left, font_data),
        ]

        ws.row_dimensions[row_idx].height = 22
        is_zebra = len(seen_students) % 2 == 0

        for col_i, (val, alignment, f_style) in enumerate(row_values, start=1):
            c = ws.cell(row=row_idx, column=col_i, value=val)
            c.alignment = alignment
            c.font = f_style
            c.border = cell_border
            if att.points_awarded == 5 and col_i == 8:
                c.fill = gold_fill
            elif is_zebra:
                c.fill = zebra_fill

        row_idx += 1

    # Auto-adjust column widths
    for col_i, (_, width) in enumerate(headers, start=1):
        col_letter = get_column_letter(col_i)
        ws.column_dimensions[col_letter].width = max(width, 10)

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()
