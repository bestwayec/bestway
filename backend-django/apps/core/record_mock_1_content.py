"""Canonical content for "Multi-Level (CEFR) Mock Test 1 (Record Mock)" (legacy MockExam tables).

Used only by the import_cd_record_mock_1 management command (and its aliases).
"""
from __future__ import annotations

import os
import shutil
import filecmp
import wave
from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.core.multilevel import (
    CURRENT_SPEAKING_PROFILE,
    CURRENT_SPEC,
    blueprint_issues,
    readiness,
)
from apps.legacy_schema.models import (
    MockExam,
    MockImportReviewIssue,
    MockQuestion,
    MockQuestionGroup,
    MockSection,
    User,
)

EXAM_ID = "MOCK-RECORD-01"
EXAM_TITLE = "Multi-Level (CEFR) Mock Test 1 (Record Mock)"
MAP_IMAGE_PATH = "exams/record_mock_1/map.png"
MAP_OPTION_LETTERS = ("A", "B", "C", "D", "E", "F", "G", "H")
SPEAKING_SPORT_IMAGE_PATH ="exams/mock1/speaking_part12_sport.png"
SPEAKING_EDU_IMAGE_PATH = "exams/mock1/speaking_part2_education.png"


class SeedMediaMissing(Exception):
    """Raised when a required source file is absent from SEED_MEDIA_DIR."""


def seed_media_dir() -> Path:
    """Read-only source of exam media. Docker mounts ./media at /app/seed-media."""
    configured = os.environ.get("SEED_MEDIA_DIR", "").strip()
    return Path(configured) if configured else Path(settings.BASE_DIR).resolve().parent / "media"


# (source path under SEED_MEDIA_DIR, destination key under MEDIA_ROOT)
REQUIRED_MEDIA: tuple[tuple[str, str], ...] = (
    *((f"exams/record_mock_1/record_mock1_audio_part_{n}.wav", f"multilevel/assets/record_mock1_audio_part_{n}.wav") for n in range(1, 7)),
    ("exams/record_mock_1/listening_part4_map.png", MAP_IMAGE_PATH),
    ("exams/mock1/speaking_part12_sport.png", SPEAKING_SPORT_IMAGE_PATH),
    ("exams/mock1/speaking_part2_education.png", SPEAKING_EDU_IMAGE_PATH),
)


MIN_REAL_LISTENING_SECONDS = 60
DECLARED_LISTENING_PART_SECONDS = 360


def wav_seconds(path: Path) -> float | None:
    try:
        with wave.open(str(path), "rb") as handle:
            return handle.getnframes() / float(handle.getframerate())
    except (wave.Error, EOFError, OSError, ZeroDivisionError):
        return None


def placeholder_audio(source_root: Path) -> list[tuple[str, float]]:
    """Listening files far shorter than a real exam part (the declared length is 360 s).

    Reported, never repaired: this command must not invent audio.
    """
    found = []
    for src, _ in REQUIRED_MEDIA:
        if src.endswith(".wav"):
            seconds = wav_seconds(source_root / src)
            if seconds is not None and seconds < MIN_REAL_LISTENING_SECONDS:
                found.append((src, seconds))
    return found


LISTENING_AUDIO_KEYS = {n: f"multilevel/assets/record_mock1_audio_part_{n}.wav" for n in range(1, 7)}


def is_placeholder_wav(path: Path) -> bool:
    """True for a WAV far shorter than a real Listening part (or an unreadable WAV)."""
    seconds = wav_seconds(path)
    return seconds is None or seconds < MIN_REAL_LISTENING_SECONDS


def listening_audio_blockers(media_root: Path | None = None) -> list[str]:
    """Listening parts whose served file is missing or not a real-length recording."""
    media_root = media_root or Path(settings.MEDIA_ROOT).resolve()
    blockers = []
    for n, key in LISTENING_AUDIO_KEYS.items():
        path = media_root / key
        if not path.is_file():
            blockers.append(f"part {n}: {key} missing")
        elif is_placeholder_wav(path):
            seconds = wav_seconds(path)
            length = "unreadable" if seconds is None else f"{seconds:.0f}s"
            blockers.append(f"part {n}: {key} is {length}, expected about {DECLARED_LISTENING_PART_SECONDS}s")
    return blockers


def ensure_media_assets(stdout, *, allow_placeholder_audio: bool = False) -> tuple[dict[int, str], list[str]]:
    """Copy the exam media from SEED_MEDIA_DIR into MEDIA_ROOT. Never synthesises files.

    Raises SeedMediaMissing listing every absent source, or any existing MEDIA_ROOT
    file that differs from its source, before copying anything, so a deploy fails
    loudly and authored recordings are never overwritten. Short placeholder WAVs are
    never copied (unless ``allow_placeholder_audio`` for an isolated local database),
    so they cannot be served as exam audio.

    Returns the Listening audio keys and the list of Listening blockers. The exam
    must not be published while that list is non-empty.
    """
    source_root = seed_media_dir()
    media_root = Path(settings.MEDIA_ROOT).resolve()
    missing = [src for src, _ in REQUIRED_MEDIA if not (source_root / src).is_file()]
    if missing:
        raise SeedMediaMissing(f"SEED_MEDIA_DIR={source_root} is missing: " + ", ".join(missing))
    # Compare contents, not sizes, before copying anything. Existing assets may be
    # authored recordings that must never be replaced by the repository fixtures.
    conflicts = [dst for src, dst in REQUIRED_MEDIA
                 if (media_root / dst).exists() and
                 (not (media_root / dst).is_file() or not filecmp.cmp(source_root / src, media_root / dst, shallow=False))]
    if conflicts:
        raise SeedMediaMissing("Existing media differs; refusing to overwrite: " + ", ".join(conflicts))
    copied, skipped = 0, []
    for src, dst_key in REQUIRED_MEDIA:
        src_path, dst_path = source_root / src, media_root / dst_key
        if dst_path.is_file():
            continue
        seconds = wav_seconds(src_path) if src.endswith(".wav") else None
        if seconds is not None and seconds < MIN_REAL_LISTENING_SECONDS and not allow_placeholder_audio:
            skipped.append(f"{src.rsplit('/', 1)[-1]}={seconds:.0f}s")
            continue
        dst_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src_path, dst_path)
        copied += 1
    stdout.write(f"Media verified from {source_root} into {media_root} ({copied} copied)")
    if skipped:
        stdout.write(
            "WARNING: listening audio looks like placeholder media, not the real recordings "
            f"(declared {DECLARED_LISTENING_PART_SECONDS}s per part); not copied: " + ", ".join(skipped))
    blockers = [] if allow_placeholder_audio else listening_audio_blockers(media_root)
    if allow_placeholder_audio:
        stdout.write("LOCAL FIXTURE: placeholder Listening audio allowed; this is not the real exam audio.")
    if blockers:
        stdout.write(
            "BLOCKED: Record Mock stays unpublished until the real Listening recordings are in "
            f"MEDIA_ROOT: " + "; ".join(blockers)
        )
    return dict(LISTENING_AUDIO_KEYS), blockers


def seed_record_mock_1(stdout, style=None, *, allow_placeholder_audio: bool = False) -> list[str]:
    """Write the legacy exam rows. Returns the Listening blockers (empty = publishable)."""
    audio_keys, blockers = ensure_media_assets(stdout, allow_placeholder_audio=allow_placeholder_audio)
    publishable = not blockers

    admin_user = (
        User.objects.filter(role__in=["super_admin", "admin"]).order_by("created_at").first()
    )
    if not admin_user:
        admin_user = User.objects.filter(role="teacher").order_by("created_at").first()
    if not admin_user:
        now_dt = timezone.now()
        admin_user = User.objects.create(
            id=str(uuid4()),
            name="System Admin",
            phone="+998901234567",
            role="super_admin",
            is_active=True,
            password_hash="",
            created_at=now_dt,
            updated_at=now_dt,
        )

    with transaction.atomic():
        now = timezone.now()
        # 0. Unpublish old Gym & Vegetarian mock test so Record Mock is default
        MockExam.objects.filter(id="multilevel-test-01-gym-vegetarian").update(is_published=False, is_demo=False)


        # =========================================================================
        # EXAM ROOT RECORD
        # =========================================================================
        exam, _ = MockExam.objects.update_or_create(
            id=EXAM_ID,
            defaults={
                "type": "multilevel",
                "title": EXAM_TITLE,
                "description": (
                    "Official Multi-Level (CEFR) Mock Examination (Record Mock - Test 1): "
                    "Listening (35 questions, 6 parts), Reading (35 questions, 5 parts), "
                    "Writing (2 parts / 3 tasks), Speaking (4 parts). "
                    "Timed and scored to UZBMB / DTM standards."
                ),
                "profile": "full_mock",
                "level": "B1-C1",
                "practice_level": "B2",
                "specification_version": CURRENT_SPEC,
                "speaking_profile_version": CURRENT_SPEAKING_PROFILE,
                "assessment_policy": "FULL_MOCK_AI_WITH_REVIEW",
                "is_published": publishable,
                "is_demo": publishable,
                "is_free_for_approved": True,
                "price": 0,
                "created_by_id": admin_user.id,
                "content_version": 2,
                "created_at": now,
                "updated_at": now,
            },
        )

        MockImportReviewIssue.objects.filter(import_record__exam_id=EXAM_ID).delete()

        # =========================================================================
        # 1. LISTENING SECTION (35 questions, 6 parts, 45 minutes)
        # =========================================================================
        l_section, _ = MockSection.objects.update_or_create(
            id=f"{EXAM_ID.lower()}-sec-listening",
            defaults={
                "exam": exam,
                "skill": "listening",
                "title": "Listening",
                "sort_order": 0,
                "duration_minutes": 45,
                "instructions": (
                    "The Listening test consists of 6 parts and 35 questions (45 minutes). "
                    "Answer all questions as you listen. Write your answers in the spaces provided."
                ),
            },
        )

        # Listening Part 1 (Questions 1-8): Short reply matching (MCQ A/B/C)
        lg1, _ = MockQuestionGroup.objects.update_or_create(
            id=f"{EXAM_ID.lower()}-grp-l1",
            defaults={
                "section": l_section,
                "audio_key": audio_keys[1],
                "audio_duration_sec": 360,
                "audio_play_limit": 1,
                "sort_order": 0,
                "part_number": 1,
                "created_at": now,
                "title": "Part 1 — Short Reply Matching",
                "instructions": (
                    "Questions 1–8. You will hear some sentences. You will hear each sentence twice. "
                    "Choose the correct reply to each sentence (A, B or C)."
                ),
            },
        )

        l_q_data_1 = [
            (1, "", ["C"], ["c"], ["A  Me too.", "B  Can you?", "C  Sure, you can."]),
            (2, "", ["A"], ["a"], ["A  Take bus 6.", "B  It starts at 9 a.m. tomorrow.", "C  It’s in the center."]),
            (3, "", ["C"], ["c"], ["A  OK, here it is.", "B  No, that doesn’t suit you.", "C  Sure, I’ll wait here."]),
            (4, "", ["B"], ["b"], ["A  In the school library.", "B  Since 1997.", "C  Before I was born."]),
            (5, "", ["A"], ["a"], ["A  You should take a short break.", "B  Let’s get to work right now!", "C  Don’t worry, they haven’t."]),
            (6, "", ["A"], ["a"], ["A  How about an ice-cream?", "B  You need to wear your sweater.", "C  Let’s eat some fresh pizza and chips."]),
            (7, "", ["C"], ["c"], ["A  When does it happen?", "B  Where did you see that?", "C  Who told you that?"]),
            (8, "", ["B"], ["b"], ["A  My hands are also firm.", "B  Sounds like a boring person.", "C  Can you expect anything?"]),
        ]
        for num, prompt, answers, variants, options in l_q_data_1:
            MockQuestion.objects.update_or_create(
                id=f"{EXAM_ID.lower()}-ql{num}",
                defaults={
                    "group": lg1,
                    "number": num,
                    "sort_order": num,
                    "type": "multiple_choice",
                    "prompt": prompt,
                    "options": options,
                    "correct_answers": answers,
                    "accepted_variants": variants,
                    "points": 1,
                    "created_at": now,
                },
            )

        # Listening Part 2 (Questions 9-14): School trip note completion (1 word/number)
        lg2, _ = MockQuestionGroup.objects.update_or_create(
            id=f"{EXAM_ID.lower()}-grp-l2",
            defaults={
                "section": l_section,
                "audio_key": audio_keys[2],
                "audio_duration_sec": 360,
                "audio_play_limit": 1,
                "sort_order": 1,
                "part_number": 2,
                "created_at": now,
                "title": "Part 2 — School Trip",
                "instructions": (
                    "Questions 9–14. You will hear someone giving a talk. For each question, "
                    "fill in the missing information in the numbered space. Write ONE WORD and / or A NUMBER for each answer."
                ),
                "passage_text": (
                    "SCHOOL TRIP\n"
                    "Teacher’s name: Turner\n\n"
                    "They will travel by (9) __________ .\n"
                    "First activity: they walk around the (10) __________ .\n"
                    "Students spend their free time in the (11) __________ .\n"
                    "Lunch will be a (12) __________ together.\n"
                    "They will visit a (13) __________ .\n"
                    "They should bring a (14) __________ ."
                ),
            },
        )

        l_q_data_2 = [
            (9, "They will travel by (9) __________ .", ["coach"], ["a coach", "the coach", "bus"]),
            (10, "First activity: they walk around the (10) __________ .", ["lake"], ["the lake"]),
            (11, "Students spend their free time in the (11) __________ .", ["park"], ["the park"]),
            (12, "Lunch will be a (12) __________ together.", ["picnic"], ["a picnic"]),
            (13, "They will visit a (13) __________ .", ["museum"], ["a museum", "the museum"]),
            (14, "They should bring a (14) __________ .", ["raincoat"], ["a raincoat", "rain coat"]),
        ]
        for num, prompt, answers, variants in l_q_data_2:
            MockQuestion.objects.update_or_create(
                id=f"{EXAM_ID.lower()}-ql{num}",
                defaults={
                    "group": lg2,
                    "number": num,
                    "sort_order": num,
                    "type": "note_completion",
                    "prompt": prompt,
                    "correct_answers": answers,
                    "accepted_variants": variants,
                    "word_limit": 1,
                    "answer_rule": "ONE_WORD_AND_OR_NUMBER",
                    "points": 1,
                    "created_at": now,
                },
            )

        # Listening Part 3 (Questions 15-18): Speaker matching (A-F)
        part3_places = [
            "A  In a swimming pool",
            "B  At home",
            "C  In a shopping centre",
            "D  In a garden",
            "E  In a restaurant",
            "F  In a classroom",
        ]
        lg3, _ = MockQuestionGroup.objects.update_or_create(
            id=f"{EXAM_ID.lower()}-grp-l3",
            defaults={
                "section": l_section,
                "audio_key": audio_keys[3],
                "audio_duration_sec": 360,
                "audio_play_limit": 1,
                "sort_order": 2,
                "part_number": 3,
                "options_reusable": False,
                "created_at": now,
                "title": "Part 3 — Speaker Matching",
                "instructions": (
                    "Questions 15–18. You will hear people speaking in different situations. "
                    "Match each speaker (15–18) to the place where they are (A–F). "
                    "There are TWO extra options which you do not need to use."
                ),
            },
        )

        l_q_data_3 = [
            (15, "15. Speaker 1", ["A"], ["swimming pool", "in a swimming pool"]),
            (16, "16. Speaker 2", ["F"], ["classroom", "in a classroom"]),
            (17, "17. Speaker 3", ["B"], ["at home", "home"]),
            (18, "18. Speaker 4", ["D"], ["garden", "in a garden"]),
        ]
        for num, prompt, answers, variants in l_q_data_3:
            MockQuestion.objects.update_or_create(
                id=f"{EXAM_ID.lower()}-ql{num}",
                defaults={
                    "group": lg3,
                    "number": num,
                    "sort_order": num,
                    "type": "matching",
                    "prompt": prompt,
                    "options": part3_places,
                    "correct_answers": answers,
                    "accepted_variants": variants,
                    "points": 1,
                    "created_at": now,
                },
            )

        # Listening Part 4 (Questions 19-23): Community Centre Map Labeling (A-H)
        # The plan prints the letters A-H inside eight unnamed rooms, so the
        # options are the bare letters the student sees on the map.
        part4_rooms = list(MAP_OPTION_LETTERS)
        lg4, _ = MockQuestionGroup.objects.update_or_create(
            id=f"{EXAM_ID.lower()}-grp-l4",
            defaults={
                "section": l_section,
                "audio_key": audio_keys[4],
                "audio_duration_sec": 360,
                "audio_play_limit": 1,
                "sort_order": 3,
                "part_number": 4,
                "image_key": MAP_IMAGE_PATH,
                "created_at": now,
                "title": "Part 4 — Community Centre Plan (Map Labeling)",
                "instructions": (
                    "Questions 19–23. You will hear someone giving a talk. Label the places (19–23) "
                    "on the map (A–H). There are THREE extra options which you do not need to use."
                ),
                # No passage text: a prose description of the plan contradicted
                # the printed map (it put letters on the wrong rooms).
                "passage_text": "",
            },
        )

        l_q_data_4 = [
            (19, "19. Bike racks", ["D"], ["d"]),
            (20, "20. Kitchen room", ["C"], ["c"]),
            (21, "21. Music room", ["A"], ["a"]),
            (22, "22. Shower room", ["E"], ["e"]),
            (23, "23. Restroom", ["H"], ["h"]),
        ]
        for num, prompt, answers, variants in l_q_data_4:
            MockQuestion.objects.update_or_create(
                id=f"{EXAM_ID.lower()}-ql{num}",
                defaults={
                    "group": lg4,
                    "number": num,
                    "sort_order": num,
                    "type": "matching",
                    "prompt": prompt,
                    "options": part4_rooms,
                    "correct_answers": answers,
                    "accepted_variants": variants,
                    "points": 1,
                    "created_at": now,
                },
            )

        # Listening Part 5 (Questions 24-29): Three extracts (MCQ A/B/C)
        lg5, _ = MockQuestionGroup.objects.update_or_create(
            id=f"{EXAM_ID.lower()}-grp-l5",
            defaults={
                "section": l_section,
                "audio_key": audio_keys[5],
                "audio_duration_sec": 360,
                "audio_play_limit": 1,
                "sort_order": 4,
                "part_number": 5,
                "created_at": now,
                "title": "Part 5 — Three Short Extracts",
                "instructions": (
                    "Questions 24–29. You will hear three extracts. Choose the correct answer (A, B or C) "
                    "for each question. There are TWO questions for each extract."
                ),
            },
        )

        l_q_data_5 = [
            (24, "EXTRACT ONE: What is the main conversation about?", ["A"], ["a"], ["A  A new library and its features", "B  A recent community event", "C  Renovations at the local museum"]),
            (25, "EXTRACT ONE: What is the woman concerned about?", ["B"], ["b"], ["A  The lack of seating", "B  There are too many people in the evenings", "C  The opening hours are too short"]),
            (26, "EXTRACT TWO: What is the main conversation about?", ["C"], ["c"], ["A  The menu options at a café", "B  The location of a popular café", "C  The size and atmosphere of a new coffee shop"]),
            (27, "EXTRACT TWO: What did the man say about the new coffee shop?", ["A"], ["a"], ["A  The service was slower", "B  The prices were higher", "C  The staff weren’t friendlier"]),
            (28, "EXTRACT THREE: What is the main conversation about?", ["B"], ["b"], ["A  The difficulty of taking care of a pet animal", "B  Choosing the right breed for a family", "C  Training a dog to behave indoors"]),
            (29, "EXTRACT THREE: What was the woman’s recommendation?", ["A"], ["a"], ["A  Going for a smaller one", "B  Buying a pet from a shelter", "C  Hiring a professional trainer"]),
        ]
        for num, prompt, answers, variants, options in l_q_data_5:
            MockQuestion.objects.update_or_create(
                id=f"{EXAM_ID.lower()}-ql{num}",
                defaults={
                    "group": lg5,
                    "number": num,
                    "sort_order": num,
                    "type": "multiple_choice",
                    "prompt": prompt,
                    "options": options,
                    "correct_answers": answers,
                    "accepted_variants": variants,
                    "points": 1,
                    "created_at": now,
                },
            )

        # Listening Part 6 (Questions 30-35): Marketing & Branding Lecture gap-fill
        lg6, _ = MockQuestionGroup.objects.update_or_create(
            id=f"{EXAM_ID.lower()}-grp-l6",
            defaults={
                "section": l_section,
                "audio_key": audio_keys[6],
                "audio_duration_sec": 360,
                "audio_play_limit": 1,
                "sort_order": 5,
                "part_number": 6,
                "created_at": now,
                "title": "Part 6 — Marketing and Branding",
                "instructions": (
                    "Questions 30–35. You will hear a part of a lecture. For each question, "
                    "fill in the missing information in the numbered space. Write NO MORE THAN ONE WORD for each answer."
                ),
                "passage_text": (
                    "MARKETING AND BRANDING:\n"
                    "A strong brand can help a company dominate its (30) __________ .\n"
                    "Apple products are considered more valuable because of their high (31) __________ .\n"
                    "Many brands focus less on selling logic and more on selling (32) __________ .\n"
                    "After drinking Coca-Cola, customers don’t notice the ingredients but experience a feeling of (33) __________ .\n"
                    "Online businesses track customer preferences using (34) __________ history.\n"
                    "This data helps improve both the customer experience and overall (35) __________ ."
                ),
            },
        )

        l_q_data_6 = [
            (30, "A strong brand can help a company dominate its (30) __________ .", ["market"], ["its market"]),
            (31, "Apple products are considered more valuable because of their high (31) __________ .", ["quality"], ["high quality"]),
            (32, "Many brands focus less on selling logic and more on selling (32) __________ .", ["feelings"], ["feeling"]),
            (33, "After drinking Coca-Cola, customers don’t notice the ingredients but experience a feeling of (33) __________ .", ["happiness"], ["joy"]),
            (34, "Online businesses track customer preferences using (34) __________ history.", ["cookies"], ["cookie"]),
            (35, "This data helps improve both the customer experience and overall (35) __________ .", ["sales"], ["sale"]),
        ]
        for num, prompt, answers, variants in l_q_data_6:
            MockQuestion.objects.update_or_create(
                id=f"{EXAM_ID.lower()}-ql{num}",
                defaults={
                    "group": lg6,
                    "number": num,
                    "sort_order": num,
                    "type": "note_completion",
                    "prompt": prompt,
                    "correct_answers": answers,
                    "accepted_variants": variants,
                    "word_limit": 1,
                    "answer_rule": "ONE_WORD_ONLY",
                    "points": 1,
                    "created_at": now,
                },
            )

        # =========================================================================
        # 2. READING SECTION (35 questions, 5 parts, 60 minutes)
        # =========================================================================
        r_section, _ = MockSection.objects.update_or_create(
            id=f"{EXAM_ID.lower()}-sec-reading",
            defaults={
                "exam": exam,
                "skill": "reading",
                "title": "Reading",
                "sort_order": 1,
                "duration_minutes": 60,
                "instructions": (
                    "The Reading test consists of 5 parts and 35 questions (60 minutes). "
                    "Read the texts and answer all questions in the spaces provided."
                ),
            },
        )

        # Reading Part 1 (Questions 1-6): Honey gap fill
        rg1, _ = MockQuestionGroup.objects.update_or_create(
            id=f"{EXAM_ID.lower()}-grp-r1",
            defaults={
                "section": r_section,
                "audio_play_limit": 0,
                "sort_order": 0,
                "part_number": 1,
                "created_at": now,
                "title": "Part 1 — Honey",
                "instructions": (
                    "Questions 1–6. Read the text. Fill in each gap with ONE word. "
                    "You must use a word which is somewhere in the rest of the text."
                ),
                "passage_text": (
                    "HONEY\n\n"
                    "Honey is a sweet and natural food made by bees. (1) __________ collect nectar from flowers and "
                    "bring it back to their hive. Inside the (2) __________ , the bees change the nectar into thick, golden "
                    "honey. This process is fascinating, and many scientists study how bees work together. A group of "
                    "(3) __________ recently discovered that each bee in the colony has a special job. Some bees fly out "
                    "to find flowers, while others protect the hive or store the (4) __________ . To make a small jar of "
                    "honey, thousands of bees must visit millions of (5) __________ . The (6) __________ they collect is "
                    "carried in their tiny bodies. Once they return, they pass it from one bee to another, slowly turning it "
                    "into honey."
                ),
            },
        )

        r_q_data_1 = [
            (1, "(1) __________ collect nectar from flowers and bring it back to their hive.", ["bees"], ["Bees", "bee"]),
            (2, "Inside the (2) __________ , the bees change the nectar into thick, golden honey.", ["hive"], ["the hive"]),
            (3, "A group of (3) __________ recently discovered that each bee in the colony has a special job.", ["scientists"], ["Scientists"]),
            (4, "Some bees fly out to find flowers, while others protect the hive or store the (4) __________ .", ["honey"], ["Honey"]),
            (5, "To make a small jar of honey, thousands of bees must visit millions of (5) __________ .", ["flowers"], ["Flowers"]),
            (6, "The (6) __________ they collect is carried in their tiny bodies.", ["nectar"], ["Nectar"]),
        ]
        for num, prompt, answers, variants in r_q_data_1:
            MockQuestion.objects.update_or_create(
                id=f"{EXAM_ID.lower()}-qr{num}",
                defaults={
                    "group": rg1,
                    "number": num,
                    "sort_order": num,
                    "type": "sentence_completion",
                    "prompt": prompt,
                    "correct_answers": answers,
                    "accepted_variants": variants,
                    "word_limit": 1,
                    "answer_rule": "ONE_WORD_ONLY",
                    "points": 1,
                    "created_at": now,
                },
            )

        # Reading Part 2 (Questions 7-14): Picnic spots matching (A-J)
        part2_statements = [
            "A  A cozy spot near a fireplace, perfect for enjoying a warm drink and a good book.",
            "B  A unique dining experience with breathtaking city views, a cool breeze, and a touch of romance.",
            "C  A breathtaking experience with panoramic views, fresh mountain air, and a feeling of accomplishment.",
            "D  A bustling marketplace with vibrant stalls, delicious street food, and a lively atmosphere.",
            "E  A tranquil spot by a lake, perfect for a relaxing afternoon with loved ones.",
            "F  A peaceful escape surrounded by towering trees and lush greenery, offering a magical atmosphere.",
            "G  A casual and convenient option, ideal for a quick bite and people-watching in the city.",
            "H  A leisurely picnic with a scenic backdrop, featuring a flowing river and the sound of water.",
            "I  A tranquil escape surrounded by blooming flowers and fragrant herbs, perfect for a romantic date.",
            "J  A quintessential summer experience with the sound of waves crashing and the warmth of the sun.",
        ]
        rg2, _ = MockQuestionGroup.objects.update_or_create(
            id=f"{EXAM_ID.lower()}-grp-r2",
            defaults={
                "section": r_section,
                "audio_play_limit": 0,
                "sort_order": 1,
                "part_number": 2,
                "created_at": now,
                "title": "Part 2 — Picnic Spot Matching",
                "instructions": (
                    "Questions 7–14. Read the texts 7–14 and the statements A–J. "
                    "Decide which text matches the situation described in each statement. "
                    "Each statement can be used ONCE only. There are TWO extra statements which you do not need to use."
                ),
            },
        )

        r_q_data_2 = [
            (7, "7. This picnic spot next to a quiet lake is peaceful and beautiful. You can lay out your blanket on soft grass, listen to calm waves, and enjoy the clean air. It’s the perfect place to relax and spend quality time with your loved ones.", ["E"], ["e"]),
            (8, "8. This forest picnic area is calm and full of tall trees and greenery. Sunlight shines through the leaves, making it feel magical. You can enjoy nature’s beauty, hear birds singing, and have a quiet meal in a peaceful place.", ["F"], ["f"]),
            (9, "9. If you want a simple and quick picnic, this park bench is perfect. Grab some snacks or a takeaway sandwich and enjoy your food while watching people and the park. It’s a nice spot in the middle of the city to rest and unwind.", ["G"], ["g"]),
            (10, "10. A picnic on the beach gives you the full summer feeling. You can hear the waves, feel the warm sun, and smell the sea. Enjoy your food with a view of the ocean, build sandcastles, and relax under the sun.", ["J"], ["j"]),
            (11, "11. Take your picnic to the top of a mountain for amazing views. After a good hike, enjoy the fresh mountain air and feel proud of reaching the top. It’s a perfect place for a picnic with a view you won’t forget.", ["C"], ["c"]),
            (12, "12. Hidden in a quiet garden, this picnic spot is peaceful and surrounded by flowers and nice smells. It’s great for a calm afternoon with friends or a sweet date in a relaxing garden setting.", ["I"], ["i"]),
            (13, "13. Have a picnic by a flowing river, sitting on soft grass. You can relax while listening to the water, watch boats pass by, and enjoy the lovely view. It’s perfect for a calm picnic in nature.", ["H"], ["h"]),
            (14, "14. Try something different with a picnic on a rooftop. Enjoy amazing views of the city, feel the cool wind, and have a special meal. It’s great for a romantic night or celebrating a special event under the stars.", ["B"], ["b"]),
        ]
        for num, prompt, answers, variants in r_q_data_2:
            MockQuestion.objects.update_or_create(
                id=f"{EXAM_ID.lower()}-qr{num}",
                defaults={
                    "group": rg2,
                    "number": num,
                    "sort_order": num,
                    "type": "matching",
                    "prompt": prompt,
                    "options": part2_statements,
                    "correct_answers": answers,
                    "accepted_variants": variants,
                    "points": 1,
                    "created_at": now,
                },
            )

        # Reading Part 3 (Questions 15-20): Canada's Must-Visit Destinations (Heading Matching)
        part3_headings = [
            "A  For adventurous skiers",
            "B  Especially good in autumn",
            "C  For the rich and lazy",
            "D  Not just for gamblers",
            "E  Like an island in heaven",
            "F  Film-makers like it",
            "G  Looking down from up there",
            "H  Probably the best one of five",
        ]
        rg3, _ = MockQuestionGroup.objects.update_or_create(
            id=f"{EXAM_ID.lower()}-grp-r3",
            defaults={
                "section": r_section,
                "audio_play_limit": 0,
                "sort_order": 2,
                "part_number": 3,
                "created_at": now,
                "title": "Part 3 — Canada's Must-Visit Tourist Destinations",
                "instructions": (
                    "Questions 15–20. Read the text and choose the correct heading for each paragraph (15–20) "
                    "from the list of headings below. There are more headings than paragraphs, so you will not use all of them. "
                    "You cannot use any heading more than once."
                ),
                "passage_text": (
                    "CANADA’S MUST-VISIT TOURIST DESTINATIONS\n\n"
                    "15. If you go to the Insular Mountain Range of Vancouver Island and face the open Pacific Ocean, "
                    "be ready to experience the magnificent natural and cultural heritage of Canada’s west coast. If you "
                    "decide to go deeper into the island, you will find a lush coastal rainforest that gives way to bountiful "
                    "and diverse intertidal and subtidal areas. And to top it all off, there are breathtaking beaches that "
                    "make this an island paradise.\n\n"
                    "16. The resort town of Whistler is about a two-hour drive from Vancouver. Whistler offers visitors "
                    "fine food and spas, but mostly it is popular among tourists for the opportunities it offers for "
                    "adventure. Whistler and Blackcomb Mountains make Whistler one of the best destinations in the "
                    "world for first-class skiing. The passage between the two mountains creates a unique terrain one "
                    "mile above the village, providing a year-round skiable territory.\n\n"
                    "17. A prized national treasure, Banff National Park is one of five national parks in the Canadian "
                    "Rocky Mountains. It attracts millions of visitors each year for camping, hiking, biking, skiing, "
                    "fishing or just relaxing. A full range of accommodation, restaurants and shops can be found in the "
                    "resort. Two of the most famous and historic Canadian hotels, the Fairmont Banff Springs and the "
                    "Chateau Lake Louise, are located in these towns as well.\n\n"
                    "18. Niagara Falls is maybe the most famous in the world, attracting millions of tourists each year. "
                    "However, it has a certain reputation for being partly a small-scale Las Vegas and a theme park, "
                    "because in addition to Niagara Falls the tourists can visit a casino resort with fine hotels and "
                    "restaurants. Although this area is improving very quickly and everyone can easily find what they "
                    "like, the Niagara region as a whole is worth deeper exploration.\n\n"
                    "19. Tourists are naturally drawn to tall buildings where they can get a bird’s eye view of a city. The "
                    "CN Tower, located in downtown Toronto, is the tallest free-standing structure in the world. "
                    "Unfortunately, elevated observation usually comes at an equally elevated price, and the CN Tower is "
                    "no different. However, tourists love it, and the glass elevator takes them to the glass-floored outdoor "
                    "observation deck, which is a real thrill for both kids and grown-ups.\n\n"
                    "20. The 300 km long Cabot Trail is famous for its panorama views of the Atlantic Ocean. The trail "
                    "is especially popular in the fall when the views are the most spectacular. Even though the drive into "
                    "this area usually takes a few hours, once there, tourists can spend a day or two stopping in at one or "
                    "two of the towns along the trail, relaxing and enjoying the magnificent nature all around."
                ),
            },
        )

        r_q_data_3 = [
            (15, "Paragraph 15", ["E"], ["Like an island in heaven"]),
            (16, "Paragraph 16", ["A"], ["For adventurous skiers"]),
            (17, "Paragraph 17", ["H"], ["Probably the best one of five"]),
            (18, "Paragraph 18", ["D"], ["Not just for gamblers"]),
            (19, "Paragraph 19", ["G"], ["Looking down from up there"]),
            (20, "Paragraph 20", ["B"], ["Especially good in autumn"]),
        ]
        for num, prompt, answers, variants in r_q_data_3:
            MockQuestion.objects.update_or_create(
                id=f"{EXAM_ID.lower()}-qr{num}",
                defaults={
                    "group": rg3,
                    "number": num,
                    "sort_order": num,
                    "type": "matching_headings",
                    "prompt": prompt,
                    "options": part3_headings,
                    "correct_answers": answers,
                    "accepted_variants": variants,
                    "points": 1,
                    "created_at": now,
                },
            )

        # Reading Part 4 (Questions 21-29): A Strange Morning (4 MCQ + 5 True/False/No Info)
        rg4, _ = MockQuestionGroup.objects.update_or_create(
            id=f"{EXAM_ID.lower()}-grp-r4",
            defaults={
                "section": r_section,
                "audio_play_limit": 0,
                "sort_order": 3,
                "part_number": 4,
                "created_at": now,
                "title": "Part 4 — A Strange Morning",
                "instructions": (
                    "Questions 21–29. Read the text below. For questions 21–24, choose the correct answer (A, B, C or D). "
                    "For questions 25–29, decide if the statements agree with the text (True, False, or No Information)."
                ),
                "passage_text": (
                    "A STRANGE MORNING\n\n"
                    "Emily woke up before her alarm went off and knew instantly something wasn’t quite right in the "
                    "house. Bailey, her chocolate-coloured pet Labrador, should have been there at the bedroom door "
                    "demanding food, but there was no sound of him. She decided to get up and go and see where he was. "
                    "It felt cold in the hall, but she knew she had left the heating on last night. As she walked down the "
                    "stairs, she heard a noise in the kitchen; the strange feeling that something was wrong was getting "
                    "stronger. What was going on? She got to the bottom of the stairs and opened the door to the living "
                    "room, which led to the kitchen. Why was the door closed? She always left it open. Bailey was "
                    "nowhere to be seen, and his toys, which were usually all over the living room floor, were in a neat "
                    "pile in the corner next to his basket. Had they been there when she had gone to bed last night? She "
                    "couldn’t remember.\n\n"
                    "She walked into the kitchen and turned the light on; it didn’t work, nothing happened. She stood "
                    "very still and listened: nothing. There wasn’t a sound. That was really strange; she lived in the "
                    "middle of a busy city, and there were always people around. She woke up to the sound of traffic, car "
                    "horns, police cars and her neighbours shouting in the house next door. How could there be silence at "
                    "8 o’clock on a Friday morning? She went back into the living room and turned the TV on, but again "
                    "nothing happened. She went back into the kitchen and looked out of the window; it was a bright, "
                    "clear day. The back door was shut, but when she tried the handle, she realised it was unlocked. She "
                    "walked out into the tiny back garden and opened the back gate; still nothing, not a sound and no sign "
                    "of Bailey. She called him, but he didn’t come.\n\n"
                    "She went back into the house and did what she realised she should have done as soon as she got up: "
                    "she called her mother. But there was no answer. She called her boyfriend, but his mobile was "
                    "switched off and she got the answerphone message. She tried a couple of other numbers, but with "
                    "equal success. She sat down on the sofa and thought about what she could do. She couldn’t decide if "
                    "she should stay at home or go out and find someone. Just as she decided the best thing would be to "
                    "stay at home and wait, there was a loud banging on the front door. She jumped up and ran to the "
                    "door. “Who is it?” she shouted through the door. “It’s me,” came the reply. But she had no idea who "
                    "“me” was.\n\n"
                    "She didn’t want to open the door until she was sure she knew who it was, not with all the other "
                    "strange things that were happening this morning, and she didn’t want to shout through the thick front "
                    "door, so she walked back into the living room and tried to look through the front window to see who "
                    "was standing at the front door. It was a man, but she couldn’t make out who he was; he didn’t look "
                    "familiar. He was tall and was wearing a big coat with a hood over his head. Just as she was thinking "
                    "of running out of the back door, she saw that the man had Bailey with him, and Bailey seemed quite "
                    "happy, which meant that the man had to be someone he knew and liked; he would have been barking "
                    "otherwise.\n\n"
                    "She still wasn’t taking any chances, though; she put the safety latch on the door and opened it just "
                    "enough to see who was there. She was instantly relieved; it was her brother, who lived just a few "
                    "streets away. She opened the door all the way and let him in. As he walked through the door, he was "
                    "almost knocked over by Bailey jumping up and looking more pleased than ever to see her. “So, "
                    "what’s going on?” she asked her brother. He looked at her as if she was stupid. “Haven’t you "
                    "heard?”"
                ),
            },
        )

        r_q_data_4 = [
            (
                21,
                "What was the first thing Emily noticed that made her feel something was wrong that morning?",
                ["B"],
                ["b"],
                [
                    "A) The living room door was wide open.",
                    "B) Bailey wasn’t waiting outside her room asking for food.",
                    "C) She heard loud music coming from the kitchen.",
                    "D) The heating system wasn’t working.",
                ],
                "multiple_choice",
                None,
            ),
            (
                22,
                "Which part of the story shows that Emily was shocked by how quiet everything was?",
                ["B"],
                ["b"],
                [
                    "A) She lives in a quiet place in the countryside.",
                    "B) She expected it to be noisier since it was a busy Friday morning.",
                    "C) That time of day is always quiet with no people or cars.",
                    "D) She got up much earlier than she usually does.",
                ],
                "multiple_choice",
                None,
            ),
            (
                23,
                "How did Emily realise that the power might be out?",
                ["B"],
                ["b"],
                [
                    "A) She tried to turn on the heat but it didn’t work.",
                    "B) The kitchen lights wouldn’t come on.",
                    "C) She switched on the TV but only saw static.",
                    "D) The home phone had no signal.",
                ],
                "multiple_choice",
                None,
            ),
            (
                24,
                "What made Emily finally open the front door?",
                ["B"],
                ["b"],
                [
                    "A) She clearly heard her brother calling her.",
                    "B) She saw that Bailey was calmly standing beside the man.",
                    "C) The man outside said he would break the door.",
                    "D) She remembered someone was supposed to visit.",
                ],
                "multiple_choice",
                None,
            ),
            (
                25,
                "Emily finds Bailey’s toys lying scattered around the living room floor.",
                ["False"],
                ["B", "false"],
                ["True", "False", "No Information"],
                "true_false_notgiven",
                None,
            ),
            (
                26,
                "Emily attempts several phone calls but cannot get through to anyone.",
                ["True"],
                ["A", "true"],
                ["True", "False", "No Information"],
                "true_false_notgiven",
                None,
            ),
            (
                27,
                "The text states that Emily’s mother left her a message on the voicemail.",
                ["No Information"],
                ["C", "no information", "Not Given"],
                ["True", "False", "No Information"],
                "true_false_notgiven",
                None,
            ),
            (
                28,
                "The stranger at the door turns out to be Emily’s brother.",
                ["True"],
                ["A", "true"],
                ["True", "False", "No Information"],
                "true_false_notgiven",
                None,
            ),
            (
                29,
                "Emily had locked the back door before going to bed.",
                ["No Information"],
                ["C", "no information", "Not Given"],
                ["True", "False", "No Information"],
                "true_false_notgiven",
                None,
            ),
        ]
        for num, prompt, answers, variants, options, q_type, w_limit in r_q_data_4:
            MockQuestion.objects.update_or_create(
                id=f"{EXAM_ID.lower()}-qr{num}",
                defaults={
                    "group": rg4,
                    "number": num,
                    "sort_order": num,
                    "type": q_type,
                    "prompt": prompt,
                    "options": options,
                    "correct_answers": answers,
                    "accepted_variants": variants,
                    "word_limit": w_limit,
                    "points": 1,
                    "created_at": now,
                },
            )

        # Reading Part 5 (Questions 30-35): The Nomadic Way of Life (4 Summary Completion + 2 MCQ)
        rg5, _ = MockQuestionGroup.objects.update_or_create(
            id=f"{EXAM_ID.lower()}-grp-r5",
            defaults={
                "section": r_section,
                "audio_play_limit": 0,
                "sort_order": 4,
                "part_number": 5,
                "created_at": now,
                "title": "Part 5 — The Nomadic Way of Life",
                "instructions": (
                    "Questions 30–35. Read the text below. For questions 30–33, fill in the missing information "
                    "in the numbered spaces with NO MORE THAN ONE WORD and / or A NUMBER. "
                    "For questions 34–35, choose the correct answer (A, B, C or D)."
                ),
                "passage_text": (
                    "THE NOMADIC WAY OF LIFE\n\n"
                    "Out of a world population of 7.5 billion, around 30 million people currently lead a migratory "
                    "lifestyle. Every continent has nomadic groups, leading a life very different from the sedentary "
                    "communities they come into contact with. Almost all migratory communities are in steady decline "
                    "for a wide range of reasons: climate change, political unrest, forced resettlement and armed conflict "
                    "have all impacted on these traditional communities, diminishing their numbers year on year.\n\n"
                    "However, the lure of the travelling lifestyle is as strong as ever. The ‘gypsy lifestyle’ continues to "
                    "inspire people – especially the young – who crave the freedom of unstructured movement. "
                    "Backpacking has become almost a rite of passage for the young. ‘Gap years’ between school and "
                    "university often stretch to two years, or even more, as young people become addicted to the culture "
                    "of travelling light and moving on.\n\n"
                    "Traditional nomads may be seen as ‘wanderers’, but their movement is not as unstructured as it may "
                    "appear. Most nomadic communities are, or were, herdsmen, leading their animals across fixed "
                    "routes based on pastures. Their societies were based on strong bonds of kinship. According to "
                    "14th-century social historian Ibn Khaldun, the Bedouin community owed their success in battle to "
                    "asabiyya or ‘group feeling’, which enhanced their ability to protect the group from outsiders. This, "
                    "along with excellent horsemanship and the rigours of a harsh lifestyle, based around the constant "
                    "alertness needed to protect livestock, made them formidable adversaries in war when compared to "
                    "their more settled counterparts.\n\n"
                    "Far from the desert-dwelling Bedouin live a different kind of nomad: the Moken, or sea gypsies, of "
                    "the Mergui Archipelago between Myanmar and the islands of Thailand’s North Andaman coast. "
                    "During the dry season, they live on traditional houseboats, and during the monsoon season they "
                    "build temporary villages on sheltered stretches of beach. Theirs is a culture of sharing and giving, to "
                    "the extent that their language contains no words for individual possessions. These indigenous people "
                    "have a great understanding of and respect for their environment, making use of over 80 plant species "
                    "for food and more than 100 for shelter, handicrafts and other purposes. However, the Moken’s "
                    "lifestyle has more recently been affected by government restrictions on their hunter-gathering "
                    "activities, and legal disputes over ownership of their traditional lands. Somewhat inevitably, they "
                    "have become a focus for tourism in the area, which they have embraced to some extent as they try to "
                    "adapt to the modern world.\n\n"
                    "Nomadic communities exist in Europe too. In the tundras and taigas of northern Scandinavia live a "
                    "reindeer-herding community, the Sami. Originally travelling freely across the areas which now "
                    "belong to Norway, Sweden, Finland and Russia, this subculture has had its traditional lifestyle "
                    "curtailed by the creation of national borders."
                ),
            },
        )

        r_q_data_5 = [
            (
                30,
                "Migratory lifestyles (30) __________ the youth who are eager to have unplanned travel.",
                ["inspire"],
                ["inspires"],
                None,
                "summary_completion",
                1,
            ),
            (
                31,
                "Nomadic herders tend to choose their way taking (31) __________ into account.",
                ["pastures"],
                ["pasture"],
                None,
                "summary_completion",
                1,
            ),
            (
                32,
                "The Bedouin community had to be cautious all the time to (32) __________ their farm animals.",
                ["protect"],
                ["guard"],
                None,
                "summary_completion",
                1,
            ),
            (
                33,
                "The Moken have no words for (33) __________ property.",
                ["individual"],
                ["private", "personal"],
                None,
                "summary_completion",
                1,
            ),
            (
                34,
                "According to the passage, the Moken …",
                ["C"],
                ["c"],
                [
                    "A) hardly share their own possessions.",
                    "B) live on the sea during the rainy season.",
                    "C) changed their lifestyle because of restrictions.",
                    "D) escaped to become accustomed to the modern world.",
                ],
                "multiple_choice",
                None,
            ),
            (
                35,
                "What is the writer’s purpose in the reading passage?",
                ["D"],
                ["d"],
                [
                    "A) to explain the future of backpacking culture",
                    "B) to compare the success of different nomadic groups",
                    "C) to criticise the lack of tolerance for travelling communities",
                    "D) to highlight the current state of traditional travelling cultures",
                ],
                "multiple_choice",
                None,
            ),
        ]
        for num, prompt, answers, variants, options, q_type, w_limit in r_q_data_5:
            MockQuestion.objects.update_or_create(
                id=f"{EXAM_ID.lower()}-qr{num}",
                defaults={
                    "group": rg5,
                    "number": num,
                    "sort_order": num,
                    "type": q_type,
                    "prompt": prompt,
                    "options": options,
                    "correct_answers": answers,
                    "accepted_variants": variants,
                    "word_limit": w_limit,
                    "points": 1,
                    "created_at": now,
                },
            )

        # =========================================================================
        # 3. WRITING SECTION (3 tasks, 2 parts, 60 minutes)
        # =========================================================================
        w_section, _ = MockSection.objects.update_or_create(
            id=f"{EXAM_ID.lower()}-sec-writing",
            defaults={
                "exam": exam,
                "skill": "writing",
                "title": "Writing",
                "sort_order": 2,
                "duration_minutes": 60,
                "instructions": (
                    "The Writing test consists of 2 parts (3 tasks) and takes 60 minutes.\n"
                    "Part 1 contains two email tasks sharing one scenario (Task 1.1: Informal Email, Task 1.2: Formal Email).\n"
                    "Part 2 contains an opinion Blog Post."
                ),
            },
        )

        shared_writing_stimulus = "stimulus-record-mock1-science-trip"

        # Task 1.1: Informal Email
        wg1, _ = MockQuestionGroup.objects.update_or_create(
            id=f"{EXAM_ID.lower()}-grp-w1",
            defaults={
                "section": w_section,
                "audio_play_limit": 0,
                "sort_order": 0,
                "part_number": 1,
                "max_score": 5,
                "stimulus_ref": shared_writing_stimulus,
                "created_at": now,
                "title": "Task 1.1 — Informal Email: Science Centre Trip Rescheduled",
                "instructions": (
                    "You planned a school trip to the Science Centre to see robotic displays. "
                    "However, the trip has been cancelled and rescheduled for next week. "
                    "Students can either get their money back or keep their place for the new date.\n\n"
                    "Write about 50 words to your friend."
                ),
                "passage_text": (
                    "SCENARIO:\n"
                    "You planned a school trip to the Science Centre to see robotic displays. "
                    "However, the trip has been cancelled and rescheduled for next week. "
                    "Students can either get their money back or keep their place for the new date."
                ),
            },
        )
        MockQuestion.objects.update_or_create(
            id=f"{EXAM_ID.lower()}-qw1",
            defaults={
                "group": wg1,
                "number": 1,
                "sort_order": 1,
                "type": "essay_task1",
                "prompt": (
                    "TASK 1.1 · INFORMAL EMAIL (Write about 50 words)\n\n"
                    "Write a short email to your friend.\n"
                    "• Explain that the trip to the Science Centre has been cancelled.\n"
                    "• Tell your friend that it will take place next week instead."
                ),
                "word_limit": 50,
                "points": 5,
                "created_at": now,
            },
        )

        # Task 1.2: Formal Email
        wg2, _ = MockQuestionGroup.objects.update_or_create(
            id=f"{EXAM_ID.lower()}-grp-w2",
            defaults={
                "section": w_section,
                "audio_play_limit": 0,
                "sort_order": 1,
                "part_number": 2,
                "max_score": 5,
                "stimulus_ref": shared_writing_stimulus,
                "created_at": now,
                "title": "Task 1.2 — Formal Email: Official Notice to Registered Students",
                "instructions": (
                    "Write an email to the students who registered for the trip (Write 120–150 words)."
                ),
                "passage_text": (
                    "SCENARIO:\n"
                    "You planned a school trip to the Science Centre to see robotic displays. "
                    "However, the trip has been cancelled and rescheduled for next week. "
                    "Students can either get their money back or keep their place for the new date."
                ),
            },
        )
        MockQuestion.objects.update_or_create(
            id=f"{EXAM_ID.lower()}-qw2",
            defaults={
                "group": wg2,
                "number": 2,
                "sort_order": 2,
                "type": "essay_task1",
                "prompt": (
                    "TASK 1.2 · FORMAL EMAIL (Write 120–150 words)\n\n"
                    "Write an email to the students who registered for the trip.\n"
                    "• Inform them that the trip has been cancelled for now.\n"
                    "• Explain that it has been rescheduled for next week.\n"
                    "• Ask them whether they want a refund or prefer to keep their place for the new date."
                ),
                "word_limit": 150,
                "points": 5,
                "created_at": now,
            },
        )

        # Part 2: Blog Post (Opinion Essay)
        wg3, _ = MockQuestionGroup.objects.update_or_create(
            id=f"{EXAM_ID.lower()}-grp-w3",
            defaults={
                "section": w_section,
                "audio_play_limit": 0,
                "sort_order": 2,
                "part_number": 3,
                "max_score": 6,
                "stimulus_ref": "stimulus-record-mock1-school-trips-debate",
                "created_at": now,
                "title": "Part 2 — Blog Post: School Trips vs Classroom Learning",
                "instructions": (
                    "Write 180–200 words expressing your opinion in an online discussion."
                ),
            },
        )
        MockQuestion.objects.update_or_create(
            id=f"{EXAM_ID.lower()}-qw3",
            defaults={
                "group": wg3,
                "number": 3,
                "sort_order": 3,
                "type": "essay_task2",
                "prompt": (
                    "PART 2 · BLOG POST (Write 180–200 words)\n\n"
                    "You are participating in an online discussion for language learners. The question is:\n"
                    "“Some people say school trips are a waste of time, while others believe students learn more outside the classroom. What is your opinion?”\n\n"
                    "Post your response, giving reasons and examples."
                ),
                "word_limit": 200,
                "points": 6,
                "created_at": now,
            },
        )

        # =========================================================================
        # 4. SPEAKING SECTION (4 parts, 30 minutes)
        # =========================================================================
        s_section, _ = MockSection.objects.update_or_create(
            id=f"{EXAM_ID.lower()}-sec-speaking",
            defaults={
                "exam": exam,
                "skill": "speaking",
                "title": "Speaking",
                "sort_order": 3,
                "duration_minutes": 30,
                "instructions": (
                    "The Speaking test consists of 4 parts (approx. 15-20 minutes).\n"
                    "Part 1.1: Personal interview (30s each, no prep)\n"
                    "Part 1.2: Sport comparison (Q1: 45s, Q2-Q3: 30s)\n"
                    "Part 2: Educational experience cue card (1m prep, 2m speak)\n"
                    "Part 3: Social media debate (1m prep, 2m speak)"
                ),
            },
        )

        # Speaking Part 1.1: Personal Questions (3 questions)
        sg1, _ = MockQuestionGroup.objects.update_or_create(
            id=f"{EXAM_ID.lower()}-grp-s1",
            defaults={
                "section": s_section,
                "audio_play_limit": 0,
                "sort_order": 0,
                "part_number": 1,
                "max_score": 5,
                "created_at": now,
                "title": "Part 1.1 — Personal Questions",
                "instructions": "Answer the questions about yourself. 30 SECONDS EACH · NO PREPARATION",
            },
        )

        s_q_data_1 = [
            (1, "1. What is your favourite food?"),
            (2, "2. Do you have any pets?"),
            (3, "3. What do you like to do at the weekend?"),
        ]
        for num, prompt in s_q_data_1:
            MockQuestion.objects.update_or_create(
                id=f"{EXAM_ID.lower()}-qs1-{num}",
                defaults={
                    "group": sg1,
                    "number": num,
                    "sort_order": num,
                    "type": "speaking_task",
                    "prompt": prompt,
                    "points": 5,
                    "created_at": now,
                },
            )

        # Speaking Part 1.2: Two-Picture Comparison (Tennis vs Outdoor Yoga)
        sg2, _ = MockQuestionGroup.objects.update_or_create(
            id=f"{EXAM_ID.lower()}-grp-s2",
            defaults={
                "section": s_section,
                "audio_play_limit": 0,
                "sort_order": 1,
                "part_number": 2,
                "max_score": 5,
                "image_key": SPEAKING_SPORT_IMAGE_PATH,
                "created_at": now,
                "title": "Part 1.2 — Sport Comparison (Tennis vs Outdoor Yoga)",
                "instructions": (
                    "Look at the pictures and answer the questions. "
                    "Q1: 45 SEC · Q2–Q3: 30 SEC · NO PREPARATION"
                ),
            },
        )

        s_q_data_2 = [
            (1, "1. What are the people in these photos doing? (45 seconds)"),
            (2, "2. What are the benefits of doing sport? (30 seconds)"),
            (3, "3. What sports are popular in your country? (30 seconds)"),
        ]
        for num, prompt in s_q_data_2:
            MockQuestion.objects.update_or_create(
                id=f"{EXAM_ID.lower()}-qs2-{num}",
                defaults={
                    "group": sg2,
                    "number": num,
                    "sort_order": num,
                    "type": "speaking_task",
                    "prompt": prompt,
                    "points": 5,
                    "created_at": now,
                },
            )

        # Speaking Part 2: Educational Experience Cue Card
        sg3, _ = MockQuestionGroup.objects.update_or_create(
            id=f"{EXAM_ID.lower()}-grp-s3",
            defaults={
                "section": s_section,
                "audio_play_limit": 0,
                "sort_order": 2,
                "part_number": 3,
                "max_score": 5,
                "image_key": SPEAKING_EDU_IMAGE_PATH,
                "created_at": now,
                "title": "Part 2 — Educational Experience",
                "instructions": (
                    "Look at the picture and answer the questions. 1 MIN PREPARATION · 2 MIN SPEAKING"
                ),
            },
        )
        MockQuestion.objects.update_or_create(
            id=f"{EXAM_ID.lower()}-qs3-1",
            defaults={
                "group": sg3,
                "number": 1,
                "sort_order": 1,
                "type": "speaking_task",
                "prompt": (
                    "CUE CARD — EDUCATIONAL EXPERIENCE\n\n"
                    "1. Describe a significant educational experience you have had.\n"
                    "2. How has this experience shaped your career or personal development?\n"
                    "3. What do you believe are the key components of a good education?"
                ),
                "points": 5,
                "created_at": now,
            },
        )

        # Speaking Part 3: Social Media Impact on Mental Health Debate
        sg4, _ = MockQuestionGroup.objects.update_or_create(
            id=f"{EXAM_ID.lower()}-grp-s4",
            defaults={
                "section": s_section,
                "audio_play_limit": 0,
                "sort_order": 3,
                "part_number": 4,
                "max_score": 6,
                "created_at": now,
                "title": "Part 3 — Two-Way Debate: Social Media and Mental Health",
                "instructions": (
                    "Discuss the statement. Talk about both sides. 1 MIN PREPARATION · 2 MIN SPEAKING"
                ),
            },
        )
        MockQuestion.objects.update_or_create(
            id=f"{EXAM_ID.lower()}-qs4-1",
            defaults={
                "group": sg4,
                "number": 1,
                "sort_order": 1,
                "type": "speaking_task",
                "prompt": (
                    "TOPIC: Social media has a negative impact on mental health.\n\n"
                    "FOR:\n"
                    "• Contributes to anxiety, depression and addiction\n"
                    "• Promotes unrealistic standards and cyberbullying\n"
                    "• Distracts from real-life relationships and responsibilities\n\n"
                    "AGAINST:\n"
                    "• Increases social connectivity and awareness\n"
                    "• Provides platforms for self-expression and support\n"
                    "• Facilitates access to information and global communities"
                ),
                "points": 6,
                "created_at": now,
            },
        )

        normalized = normalize_objective_keys(EXAM_ID)

    stdout.write(style.SUCCESS(f"Successfully seeded exam {EXAM_ID}: {EXAM_TITLE} ({normalized} answer keys normalized)"))
    return blockers


def normalize_objective_keys(exam_id: str) -> int:
    """Bring stored answer keys in line with the shared authoring rules.

    The historical content attached letter/text "variants" to choice and
    True/False items and an unsupported ``ONE_WORD_ONLY`` rule to completion
    items. The validator therefore rejected every Listening part, practice
    fell back to an unvalidated question list and silently dropped Part 1.
    Every change here is scoring-neutral:
      * choice/decision items are scored by option index / canonical decision,
        never by variants, so their variants are removed;
      * ``ONE_WORD_ONLY`` was never recognised by the scorer (generic matching
        with ``word_limit=1`` applied), so the rule becomes ``None`` and the
        one-word limit stays;
      * under a valid answer rule, a variant that breaks the rule could never
        match a rule-abiding response, so it is removed.
    """
    from apps.core.mock_rules import (
        ANSWER_RULES,
        CHOICE_TYPES,
        TEXT_TYPES,
        respects_answer_rule,
    )
    changed = 0
    for question in MockQuestion.objects.filter(group__section__exam_id=exam_id):
        variants = list(question.accepted_variants or [])
        rule = question.answer_rule
        if question.type in CHOICE_TYPES | {"true_false_notgiven", "yes_no_notgiven"}:
            variants = []
        elif question.type in TEXT_TYPES:
            if rule is not None and rule not in ANSWER_RULES:
                rule = None
            if rule in ANSWER_RULES:
                variants = [v for v in variants if isinstance(v, str) and respects_answer_rule(v, rule)]
        if variants != list(question.accepted_variants or []) or rule != question.answer_rule:
            MockQuestion.objects.filter(id=question.id).update(accepted_variants=variants, answer_rule=rule)
            changed += 1
    return changed
