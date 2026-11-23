"""Vocabulary engine service: raw text parsing, quiz generation, gamified scoring, SRS, and Excel export."""
from datetime import timedelta
from io import BytesIO
import logging
import random
import re
from typing import Any
from uuid import uuid4

from django.db import connection, transaction
from django.db.models import F, Sum
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
    VocabularyPracticeSession,
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
    # Separators: a tab (spreadsheet paste) wins; otherwise an en/em dash, ":" or
    # "=", or a hyphen only when surrounded by spaces, so hyphenated headwords
    # such as "self-confidence" or "well-known" are never split apart.
    delim_re = re.compile(r"\s+-\s+|\s*[—–:=]\s*")

    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith("#") or line.startswith("//"):
            continue

        clean_line = item_prefix_re.sub("", line).strip()
        if "\t" in clean_line:
            parts = [cell for cell in clean_line.split("\t") if cell.strip()][:2]
        else:
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
    from .vocabulary_collections import clean_words, text

    title = text(title, "title", 255, True)
    description = text(description if description is not None else "", "description", 4000)
    if level not in VocabularyLevel.values:
        level = VocabularyLevel.B1
    aliases = {"context_sentence": "contextSentence", "part_of_speech": "partOfSpeech", "audio_url": "audioUrl"}
    if isinstance(words, list):
        words = [{aliases.get(key, key): value for key, value in row.items()} if isinstance(row, dict) else row for row in words]
    clean = clean_words(words)
    if any(identifier is not None for identifier, _ in clean):
        raise ContractAPIException("VALIDATION_ERROR", "New words cannot include IDs", 400)

    with transaction.atomic():
        vocab_set = VocabularySet.objects.create(
            title=title.strip(),
            description=description.strip() if description else None,
            group_id=group_id if group_id else None,
            created_by_id=actor.id,
            level=level,
            is_public=is_public,
        )

        VocabularyWord.objects.bulk_create([VocabularyWord(set=vocab_set, **row) for _, row in clean])

    return vocab_set


def generate_quiz_for_set(set_id: str, mode: str = "mixed", student_id: str | None = None) -> dict[str, Any]:
    vocab_set = VocabularySet.objects.filter(id=set_id).first()
    if not vocab_set:
        raise ContractAPIException("VOCABULARY_SET_NOT_FOUND", "Lug'at to'plami topilmadi", 404)

    words = list(VocabularyWord.objects.filter(set_id=set_id, is_archived=False)[:MAX_PRACTICE_WORDS + 1])
    return quiz_from_words(vocab_set, words, mode)


def quiz_from_words(vocab_set, words, mode):
    if len(words) > MAX_PRACTICE_WORDS:
        raise ContractAPIException("SET_TOO_LARGE", "Mashq 500 so‘zdan oshmasligi kerak", 400)
    if not words:
        raise ContractAPIException("EMPTY_VOCABULARY_SET", "Ushbu to'plamda savollar yo'q", 400)

    # Shuffle question order
    random.shuffle(words)

    from . import vocabulary_questions
    if mode in vocabulary_questions.NEW_TYPES or mode == QuizMode.SMART_MIX:
        rng = random.Random()
        plan = vocabulary_questions.plan_types(words, mode, rng)
        questions = [vocabulary_questions.build_question(word, plan[word.id], words, rng) for word in words]
        return {
            "setId": vocab_set.id, "setTitle": vocab_set.title, "level": vocab_set.level, "mode": mode,
            "totalQuestions": len(questions), "questions": questions,
        }

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
            # The example sentence usually contains the English word, which is the answer of
            # uzb_eng and spelling questions: only send it where the word is the prompt.
            "contextSentence": word.context_sentence if q_type == "eng_uzb" else None,
            "partOfSpeech": word.part_of_speech,
            "firstLetter": word.english[0].upper() if word.english else "",
            # The spoken word is the English prompt only for eng_uzb; uzb_eng / spelling must not
            # play (or ship audio for) the answer before submission.
            "audioUrl": (getattr(word, "audio_url", "") or None) if q_type == "eng_uzb" else None,
            "pronunciation": (getattr(word, "pronunciation", "") or None) if q_type == "eng_uzb" else None,
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


PRACTICE_LIFETIME = timedelta(hours=1)
MAX_PRACTICE_WORDS = 500


def points_already_awarded(student_id: str, set_id: str) -> int:
    """Read total rewards while the caller holds the user's row lock."""
    return VocabularyAttempt.objects.filter(student_id=student_id, set_id=set_id).aggregate(
        total=Sum("points_awarded"))["total"] or 0


def practice_mode(mode):
    if mode not in QuizMode.values:
        raise ContractAPIException("VALIDATION_ERROR", "Mashq turi yaroqsiz", 400)
    return mode


def lock_practice_actor(actor):
    # User exists regardless of whether its optional StudentProfile exists.
    user = User.objects.select_for_update().filter(id=actor.id, is_active=True).first()
    if user is None or user.role not in ("student", "teacher", "admin", "super_admin"):
        raise ContractAPIException("FORBIDDEN", "Mashqqa ruxsat berilmagan", 403)
    return user


def legacy_session(student_id, set_id, mode, now):
    return VocabularyPracticeSession.objects.filter(
        student_id=student_id, vocabulary_set_id=set_id, mode=mode,
        legacy=True, expires_at__gt=now,
    ).order_by("-expires_at", "-id").first()


@transaction.atomic
def issue_practice(actor, vocab_set, mode, *, explicit):
    from .vocabulary_homework import snapshot_questions

    practice_mode(mode)
    user = lock_practice_actor(actor)
    now = timezone.now()
    session = None if explicit else legacy_session(user.id, vocab_set.id, mode, now)
    if session is None:
        quiz = generate_quiz_for_set(vocab_set.id, mode=mode, student_id=user.id)
        session = VocabularyPracticeSession.objects.create(
            student_id=user.id, vocabulary_set=vocab_set, mode=mode, legacy=not explicit,
            questions=snapshot_questions(vocab_set, quiz), expires_at=now + PRACTICE_LIFETIME,
        )
    return {
        "sessionId": session.id, "setId": vocab_set.id, "mode": mode,
        "setTitle": vocab_set.title, "level": vocab_set.level,
        "totalQuestions": len(session.questions),
        "questions": [row["question"] for row in session.questions],
    }


def add_practice_reward(student_id, amount, title, percentage):
    from .auth_service import unique_link_code

    if not StudentProfile.objects.filter(user_id=student_id).exists():
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO "StudentProfile" ("userId", "linkCode", "createdAt")
                VALUES (%s, %s, NOW()) ON CONFLICT ("userId") DO NOTHING
                """,
                [student_id, unique_link_code(cursor)],
            )
    StudentProfile.objects.filter(user_id=student_id).update(current_points=F("current_points") + amount)
    PointsLog.objects.create(
        id=str(uuid4()), student_id=student_id, change=amount, by_user_id=student_id,
        reason=f"Lug'at testi: {title} ({int(percentage)}%)", created_at=timezone.now(),
    )


def notify_practice_result(student_id, title, score, total, percentage, points):
    try:
        from .parent_bot_service import notify_parent_exam_result

        score_text = f"{score}/{total} ({int(percentage)}%)"
        if points:
            score_text += f", +{points} ball"
        notify_parent_exam_result(student_id, title, score_text, skill="Lug'at")
    except Exception:
        logger.warning("Failed to notify parent on quiz submit", exc_info=True)


@transaction.atomic
def submit_quiz_attempt(student, set_id, mode, answers, session_id=None):
    from .vocabulary_homework import score_snapshot
    from .vocabulary_review import record_answer

    user = lock_practice_actor(student)
    now = timezone.now()
    if session_id is None:
        session = legacy_session(user.id, set_id, practice_mode(mode), now)
    else:
        session = VocabularyPracticeSession.objects.filter(
            pk=session_id, student_id=user.id, vocabulary_set_id=set_id,
        ).first()
    if session is None:
        raise ContractAPIException("PRACTICE_SESSION_REQUIRED", "Mashqni qayta oching", 409)
    if mode is not None and mode != session.mode:
        raise ContractAPIException("VALIDATION_ERROR", "Mashq turi sessiyaga mos kelmadi", 400)
    if session.result is None and session.expires_at <= now:
        raise ContractAPIException("PRACTICE_SESSION_EXPIRED", "Mashqni qayta oching", 409)

    questions, wrong, score, total, percentage = score_snapshot(session.questions, answers)
    if session.result is not None:
        return session.result

    is_student = user.role == "student"
    earned = calculate_points_for_percentage(percentage) if is_student else 0
    already = points_already_awarded(user.id, set_id) if earned else 0
    award = max(0, earned - already)
    attempt = VocabularyAttempt.objects.create(
        student_id=user.id, set_id=set_id, score=score, total_words=total,
        percentage=percentage, points_awarded=award, mode=session.mode, wrong_answers=wrong,
    )
    title = session.vocabulary_set.title
    if is_student:
        missed = {row["wordId"] for row in wrong}
        for word in VocabularyWord.objects.filter(set_id=set_id, id__in=questions).order_by("id"):
            record_answer(user.id, word, word.id not in missed, now)
        if award:
            add_practice_reward(user.id, award, title, percentage)
        transaction.on_commit(lambda: notify_practice_result(user.id, title, score, total, percentage, award))

    session.result = {
        "attemptId": attempt.id, "setId": set_id, "setTitle": title,
        "score": score, "totalWords": total, "percentage": percentage,
        "pointsAwarded": award, "pointsEarned": earned, "pointsAlreadyAwarded": already,
        "mode": session.mode, "wrongAnswers": wrong,
        "completedAt": attempt.completed_at.isoformat(), "isMasteredSRS": not wrong,
    }
    session.save(update_fields=["result"])
    return session.result


def generate_srs_quiz_for_user(student_id: str, limit: int = 20) -> dict[str, Any]:
    """Generate personalized spaced repetition quiz for user's weak words."""
    from django.core import signing
    from .vocabulary_review import due, word_revision

    weak_records = list(
        due(student_id, timezone.now()).select_related("word")
        .order_by("-mistake_count", "-last_reviewed", "word_id")[:limit]
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
            # The example sentence usually contains the English word, which is the answer of
            # uzb_eng and spelling questions: only send it where the word is the prompt.
            "contextSentence": word.context_sentence if q_type == "eng_uzb" else None,
            "partOfSpeech": word.part_of_speech,
            "firstLetter": word.english[0].upper() if word.english else "",
            # The spoken word is the English prompt only for eng_uzb; uzb_eng / spelling must not
            # play (or ship audio for) the answer before submission.
            "audioUrl": (getattr(word, "audio_url", "") or None) if q_type == "eng_uzb" else None,
            "pronunciation": (getattr(word, "pronunciation", "") or None) if q_type == "eng_uzb" else None,
        })

    session = signing.dumps({
        "owner": student_id,
        "words": [[q["wordId"], q["type"], row.review_count, word_revision(row.word)]
                  for q, row in zip(questions, weak_records, strict=True)],
    }, salt="bestway-vocabulary-review")
    return {
        "sessionId": session,
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
    words_count = vocab_set.words.filter(is_archived=False).count()
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
            eng = None
            if isinstance(w, dict):
                eng = w.get("english") or w.get("word")
            elif isinstance(w, str):
                eng = w
            if eng and str(eng).strip():
                eng_clean = str(eng).strip()
                hardest_words_counter[eng_clean] = hardest_words_counter.get(eng_clean, 0) + 1

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
            "completedAt": a.completed_at.isoformat() if hasattr(a.completed_at, "isoformat") else str(a.completed_at),
            "wrongCount": len(a.wrong_answers or []),
        })

    total_words = vocab_set.words.filter(is_archived=False).count()
    total_attempts = len(student_roster)
    average_percentage = (
        round(sum(r["percentage"] for r in student_roster) / total_attempts, 1)
        if total_attempts > 0
        else 0.0
    )

    hardest = [x for x in sorted(hardest_words_counter.items(), key=lambda x: x[1], reverse=True) if x[1] > 0][:8]
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
        "submitted_count": total_attempts,
        "submittedCount": total_attempts,
        "averagePercentage": average_percentage,
        "average_percentage": average_percentage,
        "groupName": vocab_set.group.name if vocab_set.group else "Umumiy",
        "totalStudentsSubmitted": total_attempts,
        "roster": student_roster,
        "hardestWords": hardest_words_list,
        "hardest_words": hardest_words_list,
    }


def lookup_word(word: str) -> dict[str, Any]:
    """Perform high-speed lookup of an English word with Uzbek translation and grammatical metadata."""
    cleaned = (word or "").strip().lower()
    cleaned = re.sub(r"^[^a-zA-Z]+|[^a-zA-Z]+$", "", cleaned)
    if not cleaned:
        raise ContractAPIException("INVALID_WORD", "So'z kiritilmadi", 400)

    # 1. Database word check
    vw = VocabularyWord.objects.filter(english__iexact=cleaned, is_archived=False, set__is_public=True, set__group_id__isnull=True).first()
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


@transaction.atomic
def add_word_to_user_srs(student_id: str, english: str, uzbek: str = "") -> dict[str, Any]:
    """Add or upsert a word into student's personal SRS Weak Words bank."""
    cleaned_en = english.strip()
    if not cleaned_en:
        raise ContractAPIException("ENGLISH_WORD_REQUIRED", "So'z kiritilmadi", 400)

    # Resolve uzbek if not provided
    if not uzbek or uzbek.startswith("'"):
        lookup_res = lookup_word(cleaned_en)
        uzbek = lookup_res.get("uzbek") or cleaned_en

    if len(cleaned_en) > 255 or len(uzbek) > 255:
        raise ContractAPIException("VALIDATION_ERROR", "So‘z va tarjima 255 belgidan oshmasligi kerak", 400)

    # Add and look up words only in this account's personal collection.
    User.objects.select_for_update().only("id").get(id=student_id)
    default_set = VocabularySet.objects.filter(
        created_by_id=student_id, title="Shaxsiy Lug'at Banki (Personal)", is_public=False,
    ).first()
    if not default_set:
        default_set = VocabularySet.objects.create(
            title="Shaxsiy Lug'at Banki (Personal)",
            description="Matndan tanlab qo'shilgan so'zlar",
            level="B1",
            is_public=False,
            created_by_id=student_id,
        )
    word_obj = default_set.words.filter(english__iexact=cleaned_en).first()
    if not word_obj:
        word_obj = VocabularyWord.objects.create(
            set=default_set,
            english=cleaned_en,
            uzbek=uzbek,
            part_of_speech="noun",
        )

    # Upsert UserWeakWord
    _, created = UserWeakWord.objects.get_or_create(
        student_id=student_id,
        word=word_obj,
        defaults={
            "mistake_count": 1,
            "correct_streak": 0,
            "is_mastered": False,
        },
    )
    return {
        "success": True,
        "wordId": word_obj.id,
        "english": word_obj.english,
        "uzbek": word_obj.uzbek,
        "isCreated": created,
        "message": f"'{word_obj.english}' shaxsiy lug'at bankiga (SRS) muvaffaqiyatli qo'shildi!",
    }
