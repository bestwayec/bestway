"""Vocabulary engine service: raw text parsing, quiz generation, gamified scoring, SRS, and Excel export."""
from io import BytesIO
import logging
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

logger = logging.getLogger(__name__)

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

    try:
        from apps.core.parent_bot_service import notify_parent_exam_result
        score_text = f"{score}/{total_words} ({int(percentage)}%)"
        if points_awarded > 0:
            score_text += f", +{points_awarded} ball"
        notify_parent_exam_result(student.id, vocab_set.title, score_text, skill="Lug'at")
    except Exception as e:
        logger.warning("Failed to notify parent on quiz submit: %s", e)

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


def get_vocabulary_set_report(set_id: str) -> dict[str, Any]:
    """Compile comprehensive group performance report with KPI metrics and hardest words."""
    vocab_set = VocabularySet.objects.select_related("group").filter(id=set_id).first()
    if not vocab_set:
        raise ContractAPIException("VOCABULARY_SET_NOT_FOUND", "Lug'at to'plami topilmadi", 404)

    attempts = list(
        VocabularyAttempt.objects.filter(set_id=set_id)
        .select_related("student")
        .order_by("-completed_at")
    )

    student_roster = []
    seen = set()
    hardest_words_counter = {}

    for a in attempts:
        for w in (a.wrong_answers or []):
            eng = w.get("english")
            if eng:
                hardest_words_counter[eng] = hardest_words_counter.get(eng, 0) + 1

        if a.student_id in seen:
            continue
        seen.add(a.student_id)

        student_roster.append({
            "attemptId": a.id,
            "studentId": a.student_id,
            "studentName": getattr(a.student, "name", "Noma'lum") or "Noma'lum",
            "phone": getattr(a.student, "phone", "") or "-",
            "score": a.score,
            "totalWords": a.total_words,
            "percentage": round(a.percentage, 1),
            "pointsAwarded": a.points_awarded,
            "mode": a.mode,
            "completedAt": a.completed_at.isoformat(),
            "wrongCount": len(a.wrong_answers or []),
        })

    total_words = vocab_set.words.count()
    total_attempts = len(student_roster)
    average_percentage = (
        round(sum(r["percentage"] for r in student_roster) / total_attempts, 1)
        if total_attempts > 0
        else 0.0
    )

    hardest = sorted(hardest_words_counter.items(), key=lambda x: x[1], reverse=True)[:8]
    hardest_words_list = []
    if hardest:
        words_map = {w.english.lower(): w for w in vocab_set.words.filter(english__in=[x[0] for x in hardest])}
        for word, cnt in hardest:
            w_obj = words_map.get(word.lower())
            hardest_words_list.append({
                "wordId": w_obj.id if w_obj else word,
                "english": word,
                "word": word,
                "uzbek": w_obj.uzbek if w_obj else "",
                "mistakes": cnt,
                "mistakeCount": cnt,
                "errors": cnt,
            })

    return {
        "setId": vocab_set.id,
        "title": vocab_set.title,
        "setTitle": vocab_set.title,
        "level": vocab_set.level,
        "totalWords": total_words,
        "total_words": total_words,
        "totalAttempts": total_attempts,
        "total_attempts": total_attempts,
        "averagePercentage": average_percentage,
        "average_percentage": average_percentage,
        "groupName": vocab_set.group.name if vocab_set.group else "Umumiy",
        "totalStudentsSubmitted": total_attempts,
        "roster": student_roster,
        "hardestWords": hardest_words_list,
    }


def lookup_word(word: str) -> dict[str, Any]:
    """Perform high-speed lookup of an English word with Uzbek translation and grammatical metadata."""
    cleaned = (word or "").strip().lower()
    cleaned = re.sub(r"^[^a-zA-Z]+|[^a-zA-Z]+$", "", cleaned)
    if not cleaned:
        raise ContractAPIException("INVALID_WORD", "So'z kiritilmadi", 400)

    # 1. Database word check
    vw = VocabularyWord.objects.filter(english__iexact=cleaned).first()
    if vw:
        return {
            "word": vw.english,
            "cleanWord": cleaned,
            "uzbek": vw.uzbek,
            "partOfSpeech": vw.part_of_speech or "noun",
            "contextSentence": vw.context_sentence or "",
            "source": "database",
        }

    # 2. Built-in CEFR high-frequency dictionary
    common_dict = {
        "abandon": ("tashlab ketmoq", "verb"),
        "ability": ("qobiliyat", "noun"),
        "abroad": ("chet elda", "adverb"),
        "absence": ("yo'qlik", "noun"),
        "absorb": ("shimib olmoq", "verb"),
        "academic": ("akademik", "adjective"),
        "accent": ("aksent, talaffuz", "noun"),
        "accept": ("qabul qilmoq", "verb"),
        "access": ("kirish huquqi", "noun"),
        "accident": ("baxtsiz hodisa", "noun"),
        "accompany": ("hamrohlik qilmoq", "verb"),
        "accomplish": ("erishmoq, bajarmoq", "verb"),
        "accurate": ("aniq", "adjective"),
        "achieve": ("erishmoq", "verb"),
        "acquire": ("orttirmoq", "verb"),
        "action": ("harakat", "noun"),
        "active": ("faol", "adjective"),
        "adapt": ("moslashmoq", "verb"),
        "adequate": ("yetarli", "adjective"),
        "adjust": ("sozlamoq", "verb"),
        "admire": ("qoyil qolmoq", "verb"),
        "advantage": ("afzallik", "noun"),
        "adventure": ("sarguzasht", "noun"),
        "advice": ("maslahat", "noun"),
        "affect": ("ta'sir qilmoq", "verb"),
        "afford": ("qurbi yetmoq", "verb"),
        "agenda": ("kun tartibi", "noun"),
        "allow": ("ruxsat bermoq", "verb"),
        "alter": ("o'zgartirmoq", "verb"),
        "alternative": ("muqobil", "noun"),
        "amazing": ("ajoyib", "adjective"),
        "ambition": ("intilish, maqsad", "noun"),
        "analyse": ("tahlil qilmoq", "verb"),
        "analyze": ("tahlil qilmoq", "verb"),
        "ancient": ("qadimiy", "adjective"),
        "annual": ("yillik", "adjective"),
        "anxious": ("xavotirlangan", "adjective"),
        "appear": ("paydo bo'lmoq", "verb"),
        "apply": ("qo'llamoq, ariza bermoq", "verb"),
        "appreciate": ("qadrlamoq", "verb"),
        "approach": ("yondashuv", "noun"),
        "appropriate": ("mos, munosib", "adjective"),
        "approve": ("ma'qullamoq", "verb"),
        "argument": ("bahs-munozara", "noun"),
        "aspect": ("jihat", "noun"),
        "assess": ("baholamoq", "verb"),
        "assessment": ("baholash", "noun"),
        "attempt": ("urinish", "noun"),
        "attitude": ("munosabat", "noun"),
        "attract": ("jalb qilmoq", "verb"),
        "available": ("mavjud", "adjective"),
        "average": ("o'rtacha", "adjective"),
        "avoid": ("chetlanmoq", "verb"),
        "award": ("mukofot", "noun"),
        "aware": ("xabardor", "adjective"),
        "balance": ("muvozanat", "noun"),
        "barrier": ("to'siq", "noun"),
        "benefit": ("foyda, naf", "noun"),
        "brief": ("qisqa", "adjective"),
        "calculate": ("hisoblamoq", "verb"),
        "campaign": ("kampaniya", "noun"),
        "candidate": ("nomzod", "noun"),
        "capacity": ("sig'im, qobiliyat", "noun"),
        "challenge": ("qiyinchilik, chaqiriq", "noun"),
        "circumstance": ("holat, sharoit", "noun"),
        "citizen": ("fuqaro", "noun"),
        "collaborate": ("hamkorlik qilmoq", "verb"),
        "combine": ("birlashtirmoq", "verb"),
        "community": ("hamjamiyat", "noun"),
        "comprehension": ("tushunish darajasi", "noun"),
        "conclusion": ("xulosa", "noun"),
        "confidence": ("ishonch", "noun"),
        "confirm": ("tasdiqlamoq", "verb"),
        "consequence": ("oqibat", "noun"),
        "consider": ("o'ylab ko'rmoq", "verb"),
        "consistent": ("izchil", "adjective"),
        "contribute": ("hissa qo'shmoq", "verb"),
        "convenient": ("qulay", "adjective"),
        "crucial": ("juda muhim", "adjective"),
        "curious": ("qiziquvchan", "adjective"),
        "decade": ("o'n yillik", "noun"),
        "decrease": ("kamaymoq", "verb"),
        "demonstrate": ("namoyish etmoq", "verb"),
        "determine": ("aniqlamoq", "verb"),
        "development": ("rivojlanish", "noun"),
        "diverse": ("turli xil", "adjective"),
        "economy": ("iqtisodiyot", "noun"),
        "effective": ("samarali", "adjective"),
        "efficient": ("unumdor", "adjective"),
        "emphasize": ("ta'kidlamoq", "verb"),
        "encourage": ("rag'batlantirmoq", "verb"),
        "enhance": ("kuchaytirmoq, oshirmoq", "verb"),
        "enormous": ("ulkan", "adjective"),
        "environment": ("atrof-muhit", "noun"),
        "essential": ("muhim, zarur", "adjective"),
        "evaluate": ("baholamoq", "verb"),
        "evidence": ("dalil", "noun"),
        "experience": ("tajriba", "noun"),
        "fluent": ("ravon", "adjective"),
        "focus": ("diqqatni qaratmoq", "verb"),
        "frequent": ("tez-tez", "adjective"),
        "generation": ("avlod", "noun"),
        "global": ("global, dunyo miqyosidagi", "adjective"),
        "gradual": ("bosqichma-bosqich", "adjective"),
        "guidance": ("yo'l-yo'riq", "noun"),
        "hesitate": ("ikkilanmoq", "verb"),
        "highlight": ("ajratib ko'rsatmoq", "verb"),
        "identify": ("aniqlamoq", "verb"),
        "illustrate": ("tasvirlamoq", "verb"),
        "impact": ("ta'sir", "noun"),
        "implement": ("amalga oshirmoq", "verb"),
        "increase": ("oshmoq", "verb"),
        "indicate": ("ko'rsatmoq", "verb"),
        "influence": ("ta'sir ko'rsatmoq", "verb"),
        "innovative": ("innovatsion", "adjective"),
        "insight": ("chuqur tushuncha", "noun"),
        "inspire": ("ilhomlantirmoq", "verb"),
        "interact": ("o'zaro muloqot qilmoq", "verb"),
        "investigate": ("tadqiq qilmoq", "verb"),
        "knowledge": ("bilim", "noun"),
        "maintain": ("saqlamoq", "verb"),
        "manage": ("boshqarmoq", "verb"),
        "measure": ("o'lchamoq", "verb"),
        "motivate": ("rag'batlantirmoq", "verb"),
        "necessary": ("zarur", "adjective"),
        "notice": ("payqamoq", "verb"),
        "obtain": ("qo'lga kiritmoq", "verb"),
        "obvious": ("ravshan, aniq", "adjective"),
        "opportunity": ("imkoniyat", "noun"),
        "outcome": ("natija", "noun"),
        "pamper": ("erkalamoq, ko'nglini olmoq", "verb"),
        "participate": ("qatnashmoq", "verb"),
        "perception": ("idrok", "noun"),
        "perspective": ("nuqtai nazar", "noun"),
        "potential": ("salohiyat", "noun"),
        "practice": ("mashq, amaliyot", "noun"),
        "predict": ("bashorat qilmoq", "verb"),
        "prepare": ("tayyorlanmoq", "verb"),
        "prevent": ("oldini olmoq", "verb"),
        "primary": ("asosiy", "adjective"),
        "priority": ("ustuvor vazifa", "noun"),
        "probability": ("ehtimollik", "noun"),
        "progress": ("o'sish, siljish", "noun"),
        "propose": ("taklif qilmoq", "verb"),
        "provide": ("ta'minlamoq", "verb"),
        "recognize": ("tanimoq", "verb"),
        "recommend": ("tavsiya qilmoq", "verb"),
        "reduce": ("kamaytirmoq", "verb"),
        "reflect": ("aks ettirmoq", "verb"),
        "regular": ("muntazam", "adjective"),
        "relevant": ("tegishli, dolzarb", "adjective"),
        "reliable": ("ishonchli", "adjective"),
        "require": ("talab qilmoq", "verb"),
        "research": ("tadqiqot", "noun"),
        "resource": ("manba, resurs", "noun"),
        "respond": ("javob qaytarmoq", "verb"),
        "significant": ("ahamiyatli", "adjective"),
        "solution": ("yechim", "noun"),
        "specific": ("aniq, muayyan", "adjective"),
        "strategy": ("strategiya", "noun"),
        "structure": ("tuzilma", "noun"),
        "succeed": ("muvaffaqiyat qozonmoq", "verb"),
        "sufficient": ("yetarli", "adjective"),
        "summarize": ("umumlashtirmoq", "verb"),
        "support": ("qo'llab-quvvatlamoq", "verb"),
        "sustain": ("qo'llab-quvvatlab turmoq", "verb"),
        "target": ("maqsad", "noun"),
        "technique": ("uslub, texnika", "noun"),
        "theory": ("nazariya", "noun"),
        "transform": ("o'zgartirmoq", "verb"),
        "ultimate": ("yakuniy", "adjective"),
        "understand": ("tushunmoq", "verb"),
        "unique": ("noyob", "adjective"),
        "valuable": ("qimmatli", "adjective"),
        "variety": ("xilma-xillik", "noun"),
        "vary": ("farqlanmoq", "verb"),
        "visible": ("ko'rinadigan", "adjective"),
        "vocabulary": ("lug'at", "noun"),
    }
    match = common_dict.get(cleaned)
    if match:
        return {
            "word": word,
            "cleanWord": cleaned,
            "uzbek": match[0],
            "partOfSpeech": match[1],
            "contextSentence": "",
            "source": "dictionary",
        }

    return {
        "word": word,
        "cleanWord": cleaned,
        "uzbek": f"'{cleaned}' so'zi",
        "partOfSpeech": "word",
        "contextSentence": "",
        "source": "general",
    }


def add_word_to_user_srs(student_id: str, english: str, uzbek: str = "") -> dict[str, Any]:
    """Add or upsert a word into student's personal SRS Weak Words bank."""
    cleaned_en = english.strip()
    if not cleaned_en:
        raise ContractAPIException("ENGLISH_WORD_REQUIRED", "So'z kiritilmadi", 400)

    # Resolve uzbek if not provided
    if not uzbek or uzbek.startswith("'"):
        lookup_res = lookup_word(cleaned_en)
        uzbek = lookup_res.get("uzbek") or cleaned_en

    # Ensure a VocabularyWord exists
    word_obj = VocabularyWord.objects.filter(english__iexact=cleaned_en).first()
    if not word_obj:
        # Find or create a default set for personal words
        default_set = VocabularySet.objects.filter(title="Shaxsiy Lug'at Banki (Personal)").first()
        if not default_set:
            first_user = User.objects.first()
            default_set = VocabularySet.objects.create(
                title="Shaxsiy Lug'at Banki (Personal)",
                description="Matndan tanlab qo'shilgan so'zlar",
                level="B1",
                is_public=True,
                created_by=first_user,
            )
        word_obj = VocabularyWord.objects.create(
            set=default_set,
            english=cleaned_en.capitalize(),
            uzbek=uzbek,
            part_of_speech="noun",
        )

    # Upsert UserWeakWord
    user_weak, created = UserWeakWord.objects.get_or_create(
        student_id=student_id,
        word=word_obj,
        defaults={
            "mistake_count": 1,
            "correct_streak": 0,
            "is_mastered": False,
        },
    )
    if not created:
        user_weak.is_mastered = False
        user_weak.mistake_count += 1
        user_weak.save(update_fields=["is_mastered", "mistake_count", "last_reviewed"])

    return {
        "success": True,
        "wordId": word_obj.id,
        "english": word_obj.english,
        "uzbek": word_obj.uzbek,
        "isCreated": created,
        "message": f"'{word_obj.english}' shaxsiy lug'at bankiga (SRS) muvaffaqiyatli qo'shildi!",
    }
