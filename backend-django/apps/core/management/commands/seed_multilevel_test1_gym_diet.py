from __future__ import annotations

import io
import math
import shutil
import struct
import urllib.request
import wave
from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone
from PIL import Image, ImageDraw

from apps.core.multilevel import CURRENT_SPEAKING_PROFILE, CURRENT_SPEC
from apps.legacy_schema.models import (
    MockExam,
    MockImportReviewIssue,
    MockQuestion,
    MockQuestionGroup,
    MockSection,
    User,
)

EXAM_ID = "multilevel-test-01-gym-vegetarian"
IMAGE_RELATIVE_PATH = "multilevel/assets/speaking-1.2-classroom-vs-online.png"
LEGACY_IMAGE_PATH = "multilevel/assets/speaking-1.2-two-picture.png"


def _write_clean_wav(path: Path, duration_sec: int = 8, freq_hz: float = 440.0) -> None:
    """Writes a valid 16-bit PCM mono WAV file with a soft intro chime followed by quiet room tone."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_file() and path.stat().st_size > 4096:
        return
    sample_rate = 16000
    total_samples = sample_rate * duration_sec
    buf = bytearray()
    for i in range(total_samples):
        t = i / sample_rate
        if t < 0.6:
            envelope = math.sin(math.pi * (t / 0.6))
            sample = int(4500 * envelope * math.sin(2.0 * math.pi * freq_hz * t))
        elif 0.7 <= t < 1.3:
            envelope = math.sin(math.pi * ((t - 0.7) / 0.6))
            sample = int(4500 * envelope * math.sin(2.0 * math.pi * (freq_hz * 1.25) * t))
        else:
            sample = 0
        buf.extend(struct.pack("<h", sample))

    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(bytes(buf))


def ensure_listening_audio_assets(stdout) -> dict[int, str]:
    """Ensures all 6 Listening part audio files exist on disk under MEDIA_ROOT."""
    media_root = Path(settings.MEDIA_ROOT).resolve()
    keys: dict[int, str] = {}
    base_freqs = [392.0, 440.0, 493.88, 523.25, 587.33, 659.25]
    for part_num in range(1, 7):
        rel_key = f"multilevel/assets/listening_part_{part_num}.wav"
        target_path = media_root / rel_key
        _write_clean_wav(target_path, duration_sec=8, freq_hz=base_freqs[part_num - 1])
        # Also ensure CBT fallback audio paths exist
        cbt_rel = f"mock/cbt/listening_part_{part_num}.mp3"
        _write_clean_wav(media_root / cbt_rel, duration_sec=6, freq_hz=base_freqs[part_num - 1])
        keys[part_num] = rel_key
    stdout.write(f"Verified 6 Listening audio assets in {media_root / 'multilevel/assets'}")
    return keys


def ensure_picture_comparison_asset(stdout) -> str:
    """Creates a high-resolution, professional DTM comparison asset (Classroom vs Online)."""
    media_root = Path(settings.MEDIA_ROOT).resolve()
    target_path = media_root / IMAGE_RELATIVE_PATH
    legacy_path = media_root / LEGACY_IMAGE_PATH
    cbt_img_path = media_root / "mock/cbt/speaking_p12_pictures.png"

    if target_path.is_file() and target_path.stat().st_size > 5000:
        try:
            cbt_img_path.parent.mkdir(parents=True, exist_ok=True)
            if not cbt_img_path.is_file():
                shutil.copyfile(str(target_path), str(cbt_img_path))
        except Exception:
            pass
        stdout.write(f"Picture comparison asset already exists at {target_path}")
        return IMAGE_RELATIVE_PATH

    target_path.parent.mkdir(parents=True, exist_ok=True)

    w, h = 1200, 675
    canvas = Image.new("RGB", (w, h), color=(11, 15, 23))  # #0B0F17 Obsidian
    draw = ImageDraw.Draw(canvas)

    im1, im2 = None, None
    try:
        headers = {"User-Agent": "Mozilla/5.0"}
        u1 = "https://images.unsplash.com/photo-1580582932707-520aed937b7b?w=600&auto=format&fit=crop&q=80"
        u2 = "https://images.unsplash.com/photo-1588196749597-9ff075ee6b5b?w=600&auto=format&fit=crop&q=80"
        req1 = urllib.request.Request(u1, headers=headers)
        req2 = urllib.request.Request(u2, headers=headers)
        with urllib.request.urlopen(req1, timeout=5) as r1, urllib.request.urlopen(req2, timeout=5) as r2:
            im1 = Image.open(io.BytesIO(r1.read())).convert("RGB")
            im2 = Image.open(io.BytesIO(r2.read())).convert("RGB")
    except Exception as exc:
        stdout.write(f"Notice: Network image fetch fallback used: {exc}")

    draw.rectangle([(0, 0), (w, 55)], fill=(16, 24, 39))
    draw.line([(0, 55), (w, 55)], fill=(30, 41, 59), width=2)
    draw.text((w // 2, 28), "DTM MULTI-LEVEL (CEFR) EXAMINATION — SPEAKING PART 1.2", fill=(241, 245, 249), anchor="mm")

    slot_w, slot_h = 540, 470

    x1, y1 = 40, 75
    if im1:
        im1_r = im1.resize((slot_w, slot_h), Image.Resampling.LANCZOS)
        canvas.paste(im1_r, (x1, y1))
    else:
        draw.rectangle([(x1, y1), (x1 + slot_w, y1 + slot_h)], fill=(15, 23, 42))
        draw.text((x1 + slot_w // 2, y1 + slot_h // 2), "TRADITIONAL IN-PERSON CLASSROOM", fill=(148, 163, 184), anchor="mm")

    draw.rectangle([(x1 - 2, y1 - 2), (x1 + slot_w + 1, y1 + slot_h + 1)], outline=(51, 65, 85), width=2)
    draw.rectangle([(x1 + 15, y1 + 15), (x1 + 340, y1 + 55)], fill=(5, 150, 105))
    draw.text((x1 + 177, y1 + 35), "PICTURE A: Traditional Classroom", fill=(255, 255, 255), anchor="mm")

    x2, y2 = 620, 75
    if im2:
        im2_r = im2.resize((slot_w, slot_h), Image.Resampling.LANCZOS)
        canvas.paste(im2_r, (x2, y2))
    else:
        draw.rectangle([(x2, y2), (x2 + slot_w, y2 + slot_h)], fill=(15, 23, 42))
        draw.text((x2 + slot_w // 2, y2 + slot_h // 2), "ONLINE DISTANCE STUDY", fill=(148, 163, 184), anchor="mm")

    draw.rectangle([(x2 - 2, y2 - 2), (x2 + slot_w + 1, y2 + slot_h + 1)], outline=(51, 65, 85), width=2)
    draw.rectangle([(x2 + 15, y2 + 15), (x2 + 330, y2 + 55)], fill=(37, 99, 235))
    draw.text((x2 + 172, y2 + 35), "PICTURE B: Online Distance Study", fill=(255, 255, 255), anchor="mm")

    draw.rectangle([(0, h - 60), (w, h)], fill=(16, 24, 39))
    draw.line([(0, h - 60), (w, h - 60)], fill=(30, 41, 59), width=2)
    draw.text(
        (w // 2, h - 30),
        "Candidate Task: Compare the two study environments. (10s preparation, 45s speaking)",
        fill=(203, 213, 225),
        anchor="mm",
    )

    canvas.save(str(target_path), "PNG")
    for extra_path in (legacy_path, cbt_img_path):
        try:
            extra_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(str(target_path), str(extra_path))
        except Exception:
            pass

    stdout.write(f"Generated comparison image asset at {target_path}")
    return IMAGE_RELATIVE_PATH


def seed_mock_test_1(stdout, style=None) -> MockExam:
    """Idempotently seeds all 4 skills (Listening, Reading, Writing, Speaking) for Mock Test 1."""
    audio_keys = ensure_listening_audio_assets(stdout)
    image_asset_key = ensure_picture_comparison_asset(stdout)

    with transaction.atomic():
        now = timezone.now()
        creator = User.objects.filter(role__in=["super_admin", "admin"]).first()
        creator_id = creator.id if creator else str(uuid4())

        exam, _ = MockExam.objects.update_or_create(
            id=EXAM_ID,
            defaults={
                "title": "Multi-Level (CEFR) Mock Test 1: Gym Membership & Vegetarian Diet",
                "description": (
                    "Rasmiy DTM Multi-Level (CEFR B1-C1) Test 1: Listening (Parts 1-6), Reading (Parts 1-5), "
                    "Writing (Gym Membership & Vegetarian Diet) va Speaking (Sports, Healthy Lifestyle & Classroom vs Online). "
                    "OpenRouter DeepSeek / Qwen AI va Ustoz nazorati bilan baholanadi."
                ),
                "level": "B1-C1",
                "practice_level": "B2",
                "type": "multilevel",
                "assessment_policy": "FULL_MOCK_AI_WITH_REVIEW",
                "speaking_profile_version": CURRENT_SPEAKING_PROFILE,
                "specification_version": CURRENT_SPEC,
                "is_published": True,
                "is_demo": True,
                "price": 0,
                "is_free_for_approved": True,
                "created_by_id": creator_id,
                "created_at": now,
                "updated_at": now,
                "profile": "full_mock",
                "content_version": 2,
            },
        )
        if not exam.created_at:
            exam.created_at = now
            exam.save(update_fields=["created_at"])

        # Resolve any open import review issues on this exam
        MockImportReviewIssue.objects.filter(import_record__exam_id=EXAM_ID, status="open").update(status="resolved")

        # ------------------------------------------------------------------
        # 1. LISTENING SECTION (6 Parts, 35 Questions, 45 Minutes)
        # ------------------------------------------------------------------
        l_section, _ = MockSection.objects.update_or_create(
            id="ml-test01-sec-listening",
            defaults={
                "exam": exam,
                "skill": "listening",
                "title": "Listening",
                "sort_order": 0,
                "duration_minutes": 45,
                "instructions": (
                    "The Listening paper consists of 6 parts and 35 questions (45 minutes). "
                    "You will hear each recording twice. Answer all questions as you listen."
                ),
            },
        )

        # Part 1: 8 Multiple Choice Questions (3 options each)
        lg1, _ = MockQuestionGroup.objects.update_or_create(
            id="ml-test01-grp-l1",
            defaults={
                "section": l_section,
                "sort_order": 0,
                "part_number": 1,
                "title": "Part 1 — Short Exchanges",
                "instructions": "Questions 1–8. You will hear eight short recordings. For each question, choose the correct answer (A, B, or C).",
                "audio_key": audio_keys[1],
                "audio_duration_sec": 180,
                "audio_play_limit": 2,
                "audio_script": "Short dialogues on gym registration, nutrition seminars, community sports, and healthy habits.",
                "created_at": now,
            },
        )
        l_part1_items = [
            ("Where does the conversation about the new fitness membership take place?", ["At a sports centre reception", "In a university library", "At a pharmacy counter"], 0),
            ("What time does the morning aerobics class begin on weekdays?", ["At 6:30 a.m.", "At 7:15 a.m.", "At 8:00 a.m."], 1),
            ("Why did the woman decide to try a vegetarian diet?", ["To improve her athletic recovery", "Because her doctor recommended it", "To reduce her weekly grocery expenses"], 0),
            ("Which facility at the community gym is currently closed for renovation?", ["The indoor heated swimming pool", "The main weight-training hall", "The upstairs yoga studio"], 0),
            ("What should new members bring to their first personal training session?", ["A medical clearance form", "Their own resistance bands", "A printed timetable"], 0),
            ("How much is the discounted monthly student fee at the fitness club?", ["Twenty-five dollars", "Thirty-five dollars", "Forty-five dollars"], 0),
            ("What did the man enjoy most about the weekend wellness workshop?", ["The practical cooking demonstration", "The lecture on sleep cycles", "The group running session"], 0),
            ("How will the sports centre notify members about schedule changes?", ["By sending an instant mobile notification", "By posting a notice on the locker room door", "By calling each member directly"], 0),
        ]
        for idx, (prompt, opts, correct_idx) in enumerate(l_part1_items):
            q_num = idx + 1
            MockQuestion.objects.update_or_create(
                id=f"ml-test01-q-l1-{q_num}",
                defaults={
                    "group": lg1,
                    "number": q_num,
                    "sort_order": idx,
                    "type": "multiple_choice",
                    "prompt": prompt,
                    "options": opts,
                    "correct_answers": [opts[correct_idx]],
                    "accepted_variants": None,
                    "points": 1,
                    "word_limit": None,
                    "answer_rule": None,
                    "created_at": now,
                },
            )

        # Part 2: 6 Note Completion Questions (1 word and/or number)
        lg2, _ = MockQuestionGroup.objects.update_or_create(
            id="ml-test01-grp-l2",
            defaults={
                "section": l_section,
                "sort_order": 1,
                "part_number": 2,
                "title": "Part 2 — Fitness Club Orientation Notes",
                "instructions": "Questions 9–14. Complete the membership orientation notes below. Write ONE WORD AND/OR A NUMBER for each answer.",
                "passage_text": (
                    "GREENVALE FITNESS & WELLNESS CENTRE\n"
                    "• Main entrance is located opposite the central (9) ________.\n"
                    "• Complimentary (10) ________ are provided at the locker room desk.\n"
                    "• Every new member receives a free assessment with a certified (11) ________.\n"
                    "• Evening nutrition seminars are held every (12) ________ at 6:00 p.m.\n"
                    "• Plant-based smoothies rich in (13) ________ are served at the club café.\n"
                    "• Annual memberships include a (14) ________ percent discount on guest passes."
                ),
                "audio_key": audio_keys[2],
                "audio_duration_sec": 180,
                "audio_play_limit": 2,
                "audio_script": "Orientation talk by the head coordinator of Greenvale Fitness & Wellness Centre.",
                "created_at": now,
            },
        )
        l_part2_items = [
            (9, "Main entrance is located opposite the central ________.", "park"),
            (10, "Complimentary ________ are provided at the locker room desk.", "towels"),
            (11, "Every new member receives a free assessment with a certified ________.", "trainer"),
            (12, "Evening nutrition seminars are held every ________ at 6:00 p.m.", "thursday"),
            (13, "Plant-based smoothies rich in ________ are served at the club café.", "protein"),
            (14, "Annual memberships include a ________ percent discount on guest passes.", "20"),
        ]
        for idx, (q_num, prompt, ans) in enumerate(l_part2_items):
            MockQuestion.objects.update_or_create(
                id=f"ml-test01-q-l2-{q_num}",
                defaults={
                    "group": lg2,
                    "number": q_num,
                    "sort_order": idx,
                    "type": "note_completion",
                    "prompt": prompt,
                    "options": None,
                    "correct_answers": [ans],
                    "accepted_variants": None,
                    "points": 1,
                    "word_limit": 1,
                    "answer_rule": "ONE_WORD_AND_OR_NUMBER",
                    "created_at": now,
                },
            )

        # Part 3: 4 Matching Questions (6 options, non-reusable)
        l_part3_options = [
            "A: Extended weekend opening hours",
            "B: Modernized cardio machines with screen coaching",
            "C: Affordable vegetarian meal-prep delivery",
            "D: Smaller group sizes in evening yoga classes",
            "E: Dedicated outdoor running track maintenance",
            "F: Free physiotherapy consultations for athletes",
        ]
        lg3, _ = MockQuestionGroup.objects.update_or_create(
            id="ml-test01-grp-l3",
            defaults={
                "section": l_section,
                "sort_order": 2,
                "part_number": 3,
                "title": "Part 3 — Member Feedback Matching",
                "instructions": "Questions 15–18. You will hear four club members talking about improvements they want at their sports club. Match each speaker (15–18) with the improvement they prioritize (A–F). There are two extra options.",
                "options_reusable": False,
                "content_layout": "speakers",
                "audio_key": audio_keys[3],
                "audio_duration_sec": 180,
                "audio_play_limit": 2,
                "created_at": now,
            },
        )
        for idx in range(4):
            q_num = 15 + idx
            MockQuestion.objects.update_or_create(
                id=f"ml-test01-q-l3-{q_num}",
                defaults={
                    "group": lg3,
                    "number": q_num,
                    "sort_order": idx,
                    "type": "matching",
                    "prompt": f"Speaker {idx + 1}: Which improvement does this member value most?",
                    "options": l_part3_options,
                    "correct_answers": [l_part3_options[idx]],
                    "accepted_variants": None,
                    "points": 1,
                    "word_limit": None,
                    "answer_rule": None,
                    "created_at": now,
                },
            )

        # Part 4: 5 Matching Questions (8 options, non-reusable)
        l_part4_options = [
            "A: Boosted daily energy levels during morning lectures",
            "B: Learned to cook balanced plant-based meals at home",
            "C: Overcame a recurring knee injury through swimming",
            "D: Met supportive training partners in a running club",
            "E: Improved sleep quality by reducing late-night caffeine",
            "F: Saved money by cycling to work instead of driving",
            "G: Completed a regional half-marathon for charity",
            "H: Gained confidence in public speaking through coaching",
        ]
        lg4, _ = MockQuestionGroup.objects.update_or_create(
            id="ml-test01-grp-l4",
            defaults={
                "section": l_section,
                "sort_order": 3,
                "part_number": 4,
                "title": "Part 4 — Lifestyle & Health Experiences",
                "instructions": "Questions 19–23. You will hear five people talking about a lifestyle or diet change they made. Match each speaker (19–23) with the main benefit they experienced (A–H). There are three extra options.",
                "options_reusable": False,
                "content_layout": "speakers",
                "audio_key": audio_keys[4],
                "audio_duration_sec": 180,
                "audio_play_limit": 2,
                "created_at": now,
            },
        )
        for idx in range(5):
            q_num = 19 + idx
            MockQuestion.objects.update_or_create(
                id=f"ml-test01-q-l4-{q_num}",
                defaults={
                    "group": lg4,
                    "number": q_num,
                    "sort_order": idx,
                    "type": "matching",
                    "prompt": f"Speaker {idx + 1}: What primary outcome does the speaker describe?",
                    "options": l_part4_options,
                    "correct_answers": [l_part4_options[idx]],
                    "accepted_variants": None,
                    "points": 1,
                    "word_limit": None,
                    "answer_rule": None,
                    "created_at": now,
                },
            )

        # Part 5: 6 Multiple Choice Questions (3 options each)
        lg5, _ = MockQuestionGroup.objects.update_or_create(
            id="ml-test01-grp-l5",
            defaults={
                "section": l_section,
                "sort_order": 4,
                "part_number": 5,
                "title": "Part 5 — Interview with a Sports Nutritionist",
                "instructions": "Questions 24–29. You will hear an interview with Dr. Elena Vance, a sports nutritionist researching vegetarian diets among endurance athletes. Choose the correct answer (A, B, or C).",
                "audio_key": audio_keys[5],
                "audio_duration_sec": 210,
                "audio_play_limit": 2,
                "created_at": now,
            },
        )
        l_part5_items = [
            ("What initially motivated Dr. Vance to study plant-based diets in athletics?", ["Questions raised by university marathon runners", "A government public-health research grant", "Her own transition to competitive cycling"], 0),
            ("According to Dr. Vance, what is the most common misconception about vegetarian athletes?", ["That they cannot consume sufficient complete proteins", "That they require expensive synthetic supplements", "That they must train for shorter durations"], 0),
            ("Which nutrient does Dr. Vance advise plant-based athletes to monitor most carefully?", ["Iron and Vitamin B12 levels", "Simple carbohydrate intake", "Dietary sodium balance"], 0),
            ("What did Dr. Vance's two-year study reveal about muscle recovery times?", ["Athletes on whole-food plant diets experienced less inflammation", "Recovery times were identical regardless of diet quality", "High-sugar sports drinks were more effective than whole foods"], 0),
            ("How should community gyms support members who want healthier eating habits?", ["By offering evidence-based nutrition workshops", "By banning all snack machines from reception areas", "By requiring weekly weigh-ins for all members"], 0),
            ("What will Dr. Vance's team investigate in their upcoming project?", ["The impact of hydration timing on cognitive focus", "The history of Olympic training facilities", "The cost of home fitness equipment"], 0),
        ]
        for idx, (prompt, opts, correct_idx) in enumerate(l_part5_items):
            q_num = 24 + idx
            MockQuestion.objects.update_or_create(
                id=f"ml-test01-q-l5-{q_num}",
                defaults={
                    "group": lg5,
                    "number": q_num,
                    "sort_order": idx,
                    "type": "multiple_choice",
                    "prompt": prompt,
                    "options": opts,
                    "correct_answers": [opts[correct_idx]],
                    "accepted_variants": None,
                    "points": 1,
                    "word_limit": None,
                    "answer_rule": None,
                    "created_at": now,
                },
            )

        # Part 6: 6 Note Completion Questions (1 word)
        lg6, _ = MockQuestionGroup.objects.update_or_create(
            id="ml-test01-grp-l6",
            defaults={
                "section": l_section,
                "sort_order": 5,
                "part_number": 6,
                "title": "Part 6 — Academic Lecture on Public Health & Urban Fitness",
                "instructions": "Questions 30–35. Listen to a university lecture on urban design and physical activity. Write ONE WORD ONLY for each answer.",
                "passage_text": (
                    "URBAN DESIGN & ACTIVE COMMUNITIES\n"
                    "• Walkable neighbourhoods encourage daily physical (30) ________ among residents.\n"
                    "• Accessible public parks significantly reduce long-term healthcare (31) ________.\n"
                    "• Workplace wellness initiatives improve employee (32) ________ and morale.\n"
                    "• Subsidized gym memberships help overcome financial (33) ________ for students.\n"
                    "• Community gardens promote awareness of fresh seasonal (34) ________.\n"
                    "• Sustainable health policies combine education with supportive (35) ________."
                ),
                "audio_key": audio_keys[6],
                "audio_duration_sec": 210,
                "audio_play_limit": 2,
                "created_at": now,
            },
        )
        l_part6_items = [
            (30, "Walkable neighbourhoods encourage daily physical ________ among residents.", "movement"),
            (31, "Accessible public parks significantly reduce long-term healthcare ________.", "costs"),
            (32, "Workplace wellness initiatives improve employee ________ and morale.", "productivity"),
            (33, "Subsidized gym memberships help overcome financial ________ for students.", "barriers"),
            (34, "Community gardens promote awareness of fresh seasonal ________.", "vegetables"),
            (35, "Sustainable health policies combine education with supportive ________.", "infrastructure"),
        ]
        for idx, (q_num, prompt, ans) in enumerate(l_part6_items):
            MockQuestion.objects.update_or_create(
                id=f"ml-test01-q-l6-{q_num}",
                defaults={
                    "group": lg6,
                    "number": q_num,
                    "sort_order": idx,
                    "type": "note_completion",
                    "prompt": prompt,
                    "options": None,
                    "correct_answers": [ans],
                    "accepted_variants": None,
                    "points": 1,
                    "word_limit": 1,
                    "answer_rule": "ONE_WORD",
                    "created_at": now,
                },
            )

        # ------------------------------------------------------------------
        # 2. READING SECTION (5 Parts, 35 Questions, 60 Minutes)
        # ------------------------------------------------------------------
        r_section, _ = MockSection.objects.update_or_create(
            id="ml-test01-sec-reading",
            defaults={
                "exam": exam,
                "skill": "reading",
                "title": "Reading",
                "sort_order": 1,
                "duration_minutes": 60,
                "instructions": (
                    "The Reading paper consists of 5 parts and 35 questions (60 minutes). "
                    "Read each passage carefully and answer all questions."
                ),
            },
        )

        # Reading Part 1: 6 Sentence Completion Questions (1 word)
        rg1, _ = MockQuestionGroup.objects.update_or_create(
            id="ml-test01-grp-r1",
            defaults={
                "section": r_section,
                "audio_play_limit": 0,
                "sort_order": 0,
                "part_number": 1,
                "title": "Part 1 — Club Member Notice & Update",
                "instructions": "Questions 1–6. Read the notice from the Metro Fitness & Nutrition Club and complete the sentences using ONE WORD ONLY from the text.",
                "passage_text": (
                    "METRO FITNESS & NUTRITION CLUB — ANNUAL FACILITY UPDATE\n\n"
                    "Starting next month, our main training studio will undergo a scheduled upgrade to install modern ventilation "
                    "and low-impact flooring. During this period, morning stretching sessions will relocate to the rooftop terrace. "
                    "Members who wish to freeze their monthly subscription during maintenance must submit a written request at reception "
                    "before Friday. Additionally, our licensed dietitian will host a complimentary seminar on balanced vegetarian recipes "
                    "every Saturday afternoon in the lecture lounge. Participants will receive a printed booklet containing seasonal meal plans "
                    "and shopping checklists."
                ),
                "created_at": now,
            },
        )
        r_part1_items = [
            (1, "The main training studio is being upgraded with new flooring and modern ________.", "ventilation"),
            (2, "Morning stretching classes will temporarily take place on the rooftop ________.", "terrace"),
            (3, "Members can freeze their monthly ________ by submitting a request before Friday.", "subscription"),
            (4, "A licensed ________ will lead a free seminar on vegetarian cooking every Saturday.", "dietitian"),
            (5, "The weekend nutrition seminar will be held in the lecture ________.", "lounge"),
            (6, "Every seminar attendee will be given a printed ________ with meal plans.", "booklet"),
        ]
        for idx, (q_num, prompt, ans) in enumerate(r_part1_items):
            MockQuestion.objects.update_or_create(
                id=f"ml-test01-q-r1-{q_num}",
                defaults={
                    "group": rg1,
                    "number": q_num,
                    "sort_order": idx,
                    "type": "sentence_completion",
                    "prompt": prompt,
                    "options": None,
                    "correct_answers": [ans],
                    "accepted_variants": None,
                    "points": 1,
                    "word_limit": 1,
                    "answer_rule": "ONE_WORD",
                    "created_at": now,
                },
            )

        # Reading Part 2: 8 Matching Questions (10 options, non-reusable)
        r_part2_options = [
            "Club A — Apex Strength & Conditioning",
            "Club B — AquaFlow Olympic Swim Centre",
            "Club C — GreenLeaf Holistic Yoga & Café",
            "Club D — Campus Track & Field Hub",
            "Club E — Sunrise Senior Mobility Studio",
            "Club F — Metro Express 24-Hour Gym",
            "Club G — Alpine Indoor Climbing & Bouldering",
            "Club H — Harmony Family Recreation Complex",
            "Club I — Pulse High-Intensity Cycling Lab",
            "Club J — BioFit Rehabilitation & Physiotherapy",
        ]
        rg2, _ = MockQuestionGroup.objects.update_or_create(
            id="ml-test01-grp-r2",
            defaults={
                "section": r_section,
                "audio_play_limit": 0,
                "sort_order": 1,
                "part_number": 2,
                "title": "Part 2 — Choosing a Fitness & Wellness Facility",
                "instructions": "Questions 7–14. Read the descriptions of eight people looking for a sports facility (7–14) and the reviews of ten clubs (A–J). Match each person with the most suitable club. There are two extra clubs.",
                "options_reusable": False,
                "content_layout": "short_texts",
                "passage_text": (
                    "Club A — Apex Strength & Conditioning: Specializes in heavy barbell training, powerlifting platforms, and individual strength coaching.\n\n"
                    "Club B — AquaFlow Olympic Swim Centre: Features a 50-metre heated lap pool, diving boards, and evening water-aerobics courses.\n\n"
                    "Club C — GreenLeaf Holistic Yoga & Café: Combines daily mindfulness yoga with an on-site organic vegetarian kitchen and nutrition workshops.\n\n"
                    "Club D — Campus Track & Field Hub: Offers discounted student memberships, a synthetic 400m running track, and weekend sprint clinics.\n\n"
                    "Club E — Sunrise Senior Mobility Studio: Designed for older adults seeking gentle joint-friendly posture exercises and balance therapy.\n\n"
                    "Club F — Metro Express 24-Hour Gym: Open round-the-clock with automated keycard entry for shift workers needing late-night cardio access.\n\n"
                    "Club G — Alpine Indoor Climbing & Bouldering: Provides vertical climbing walls, rope safety instruction, and upper-body endurance challenges.\n\n"
                    "Club H — Harmony Family Recreation Complex: Includes supervised children's play zones alongside adult badminton courts and weekend family passes.\n\n"
                    "Club I — Pulse High-Intensity Cycling Lab: Focuses on rhythm-based indoor spin classes with live heart-rate telemetry boards.\n\n"
                    "Club J — BioFit Rehabilitation & Physiotherapy: Staffed by sports doctors offering post-injury recovery programs and hydrotherapy."
                ),
                "created_at": now,
            },
        )
        r_part2_prompts = [
            "7. Aziza wants a quiet studio where she can practice yoga and enjoy healthy vegetarian meals after her workout.",
            "8. Sardor works night shifts at a hospital and needs a gym he can access after midnight using a keycard.",
            "9. Dilnoza is a university student on a tight budget who is training for a 400-metre sprint competition.",
            "10. Rustam wants to build maximum barbell lifting strength under the supervision of a powerlifting coach.",
            "11. Malika and her husband want a sports centre with supervised childcare while they play badminton on weekends.",
            "12. Jasur is recovering from a ligament operation and needs exercises supervised by qualified sports physiotherapists.",
            "13. Kamola prefers low-impact full-body workouts in a heated 50-metre swimming pool.",
            "14.bekzod is looking for an adventurous upper-body workout involving indoor rock walls and rope safety training.",
        ]
        r_part2_Mapping = [2, 5, 3, 0, 7, 9, 1, 6]
        for idx, (prompt, opt_idx) in enumerate(zip(r_part2_prompts, r_part2_Mapping)):
            q_num = 7 + idx
            MockQuestion.objects.update_or_create(
                id=f"ml-test01-q-r2-{q_num}",
                defaults={
                    "group": rg2,
                    "number": q_num,
                    "sort_order": idx,
                    "type": "matching",
                    "prompt": prompt,
                    "options": r_part2_options,
                    "correct_answers": [r_part2_options[opt_idx]],
                    "accepted_variants": None,
                    "points": 1,
                    "word_limit": None,
                    "answer_rule": None,
                    "created_at": now,
                },
            )

        # Reading Part 3: 6 Matching Headings Questions (8 options, non-reusable)
        r_part3_headings = [
            "Heading i: The historical roots of plant-based athletic diets",
            "Heading ii: How plant antioxidants accelerate post-exercise recovery",
            "Heading iii: Combining complementary plant proteins for muscle repair",
            "Heading iv: Environmental sustainability and resource conservation",
            "Heading v: Addressing micronutrient gaps through smart planning",
            "Heading vi: Changing attitudes among professional sports teams",
            "Heading vii: Why extreme calorie restriction harms endurance",
            "Heading viii: Financial challenges of managing commercial stadiums",
        ]
        rg3, _ = MockQuestionGroup.objects.update_or_create(
            id="ml-test01-grp-r3",
            defaults={
                "section": r_section,
                "audio_play_limit": 0,
                "sort_order": 2,
                "part_number": 3,
                "title": "Part 3 — Plant-Based Nutrition and Athletic Performance",
                "instructions": "Questions 15–20. Choose the correct heading for paragraphs A–F from the list of headings (i–viii). There are two extra headings.",
                "options_reusable": False,
                "content_layout": "headings",
                "passage_text": (
                    "Paragraph A\n"
                    "Contrary to modern assumptions that athletic success requires heavy meat consumption, historical chronicles reveal "
                    "that ancient endurance runners and gladiators relied predominantly on barley, lentils, and dried figs to fuel grueling training regimens.\n\n"
                    "Paragraph B\n"
                    "Intense physical exertion generates oxidative stress within muscle fibers. Whole plant foods—such as berries, leafy greens, and legumes—"
                    "deliver dense concentrations of polyphenols and antioxidants that neutralize free radicals and shorten recovery windows between workouts.\n\n"
                    "Paragraph C\n"
                    "While individual plant sources may have lower levels of specific amino acids compared to animal tissue, pairing grains with legumes "
                    "across daily meals supplies all essential amino acids needed for robust myofibrillar protein synthesis.\n\n"
                    "Paragraph D\n"
                    "Sports dietitians emphasize that eliminating animal products requires deliberate attention to Vitamin B12, iron, zinc, and omega-3 fatty acids. "
                    "Fortified foods and targeted blood screening ensure vegetarian athletes avoid fatigue and maintain peak oxygen transport.\n\n"
                    "Paragraph E\n"
                    "Over the past decade, elite football clubs, marathon champions, and Olympic weightlifting squads have increasingly integrated vegetarian "
                    "menus into their training tables, shifting plant-based eating from a niche lifestyle to mainstream sports science.\n\n"
                    "Paragraph F\n"
                    "Beyond personal physiology, athletes and event organizers recognize that plant-centric catering substantially lowers agricultural water usage "
                    "and greenhouse gas emissions associated(with) international sporting tournaments."
                ),
                "created_at": now,
            },
        )
        r_part3_mapping = [0, 1, 2, 4, 5, 3]
        for idx, opt_idx in enumerate(r_part3_mapping):
            q_num = 15 + idx
            para_letter = chr(65 + idx)
            MockQuestion.objects.update_or_create(
                id=f"ml-test01-q-r3-{q_num}",
                defaults={
                    "group": rg3,
                    "number": q_num,
                    "sort_order": idx,
                    "type": "matching_headings",
                    "prompt": f"Question {q_num}: Choose the best heading for Paragraph {para_letter}.",
                    "options": r_part3_headings,
                    "correct_answers": [r_part3_headings[opt_idx]],
                    "accepted_variants": None,
                    "points": 1,
                    "word_limit": None,
                    "answer_rule": None,
                    "created_at": now,
                },
            )

        # Reading Part 4: 9 Questions (4 Multiple Choice with 4 options + 5 True/False/Not Given)
        rg4, _ = MockQuestionGroup.objects.update_or_create(
            id="ml-test01-grp-r4",
            defaults={
                "section": r_section,
                "audio_play_limit": 0,
                "sort_order": 3,
                "part_number": 4,
                "title": "Part 4 — The Economics and Psychology of Gym Memberships",
                "instructions": "Questions 21–29. Read the article on fitness club pricing models and member retention. Answer questions 21–24 (Multiple Choice) and questions 25–29 (True / False / Not Given).",
                "passage_text": (
                    "THE ECONOMICS AND PSYCHOLOGY OF GYM MEMBERSHIPS\n\n"
                    "Every January, health clubs across the world experience a dramatic surge in new enrollments driven by seasonal resolutions. "
                    "Behavioural economists have long observed, however, that nearly sixty percent of new members reduce their attendance sharply "
                    "within the first twelve weeks. Traditional commercial gyms historically relied on this phenomenon—keeping monthly fees relatively low "
                    "while enrolling far more members than their physical floor space could accommodate simultaneously.\n\n"
                    "In recent years, rising utility bills, commercial rent, and demand for specialized digital equipment have forced many community "
                    "fitness centres to revise their pricing structures. When clubs announce membership fee increases, member retention depends heavily "
                    "on transparency and perceived value. Surveys conducted by the European Active Leisure Institute demonstrate that members are significantly "
                    "more willing to accept a moderate fee rise when management clearly communicates concrete upgrades—such as extended opening hours, "
                    "certified group instructors, and modernized ventilation—rather than vague administrative excuses.\n\n"
                    "Furthermore, clubs that actively solicit member feedback through open forums and flexible tier options experience forty percent lower "
                    "cancellation rates. Offering off-peak student discounts and small-group coaching packages transforms a passive subscription into an "
                    "engaged community partnership."
                ),
                "created_at": now,
            },
        )
        r_part4_mc = [
            (
                21,
                "What pattern do behavioural economists observe among new January gym members?",
                [
                    "More than half reduce their attendance significantly within three months",
                    "Most members upgrade to personal training within two weeks",
                    "Attendance remains completely steady throughout the calendar year",
                    "New members prefer outdoor running over indoor equipment",
                ],
                0,
            ),
            (
                22,
                "How did traditional commercial gyms historically keep monthly membership fees low?",
                [
                    "By enrolling more people than could use the facility at the same time",
                    "By receiving direct subsidies from municipal health departments",
                    "By closing their facilities during weekend afternoons",
                    "By hiring only volunteer university students as instructors",
                ],
                0,
            ),
            (
                23,
                "According to the European Active Leisure Institute, when do members accept fee increases more readily?",
                [
                    "When management explains specific facility and service improvements",
                    "When the price increase is announced without prior notice",
                    "When competing sports centres in the neighbourhood close down",
                    "When free merchandise is distributed at the entrance",
                ],
                0,
            ),
            (
                24,
                "What effect does actively asking members for feedback have on fitness clubs?",
                [
                    "It reduces membership cancellation rates by forty percent",
                    "It eliminates the need for air-conditioning maintenance",
                    "It doubles the cost of insurance for club owners",
                    "It decreases the popularity of group fitness classes",
                ],
                0,
            ),
        ]
        for idx, (q_num, prompt, opts, correct_idx) in enumerate(r_part4_mc):
            MockQuestion.objects.update_or_create(
                id=f"ml-test01-q-r4-{q_num}",
                defaults={
                    "group": rg4,
                    "number": q_num,
                    "sort_order": idx,
                    "type": "multiple_choice",
                    "prompt": prompt,
                    "options": opts,
                    "correct_answers": [opts[correct_idx]],
                    "accepted_variants": None,
                    "points": 1,
                    "word_limit": None,
                    "answer_rule": None,
                    "created_at": now,
                },
            )

        r_part4_tfng = [
            (25, "Gym enrollment numbers typically reach their lowest point in January.", "FALSE"),
            (26, "Rising energy costs and equipment upgrades have contributed to higher gym fees.", "TRUE"),
            (27, "The European Active Leisure Institute surveyed more than ten thousand swimming pools.", "NOT GIVEN"),
            (28, "Members prefer vague administrative explanations over specific upgrade plans.", "FALSE"),
            (29, "Providing off-peak student discounts helps foster a stronger sense of community.", "TRUE"),
        ]
        for offset, (q_num, prompt, ans) in enumerate(r_part4_tfng):
            MockQuestion.objects.update_or_create(
                id=f"ml-test01-q-r4-{q_num}",
                defaults={
                    "group": rg4,
                    "number": q_num,
                    "sort_order": 4 + offset,
                    "type": "true_false_notgiven",
                    "prompt": prompt,
                    "options": ["TRUE", "FALSE", "NOT GIVEN"],
                    "correct_answers": [ans],
                    "accepted_variants": None,
                    "points": 1,
                    "word_limit": None,
                    "answer_rule": None,
                    "created_at": now,
                },
            )

        # Reading Part 5: 6 Questions (4 Summary Completion with word_limit=1 + 2 Multiple Choice with 4 options)
        rg5, _ = MockQuestionGroup.objects.update_or_create(
            id="ml-test01-grp-r5",
            defaults={
                "section": r_section,
                "audio_play_limit": 0,
                "sort_order": 4,
                "part_number": 5,
                "title": "Part 5 — Preventative Public Health and Workplace Wellness",
                "instructions": "Questions 30–35. Read the passage on workplace wellness and dietary education. Complete questions 30–33 using ONE WORD ONLY, and choose the correct option (A, B, C, or D) for questions 34–35.",
                "passage_text": (
                    "PREVENTATIVE PUBLIC HEALTH AND WORKPLACE WELLNESS\n\n"
                    "Modern public health strategies increasingly prioritize preventative lifestyle interventions over costly clinical treatments. "
                    "Organizations that introduce structured movement breaks and subsidize wholesome vegetarian cafeteria options report measurable "
                    "declines in cardiovascular risk factors among staff. Furthermore, regular aerobic exercise stimulates neurogenesis in the hippocampus, "
                    "sharpening memory retention and emotional resilience during demanding cognitive tasks.\n\n"
                    "Critics occasionally argue that dietary choices and physical fitness should remain strictly private matters. However, epidemiologists "
                    "point out that urban environments heavily shape individual habits: when nutritious plant-based foods are affordable and safe cycling "
                    "lanes connect residential districts to workplaces, healthy choices become effortless defaults rather than exhausting struggles."
                ),
                "created_at": now,
            },
        )
        r_part5_summary = [
            (30, "Modern health policies focus on preventative ________ interventions rather than clinical treatment alone.", "lifestyle"),
            (31, "Companies offering movement breaks and vegetarian meals see lower ________ risk among employees.", "cardiovascular"),
            (32, "Aerobic exercise supports brain function by improving ________ retention and emotional resilience.", "memory"),
            (33, "Safe cycling lanes and affordable produce make healthy habits effortless ________ for citizens.", "defaults"),
        ]
        for idx, (q_num, prompt, ans) in enumerate(r_part5_summary):
            MockQuestion.objects.update_or_create(
                id=f"ml-test01-q-r5-{q_num}",
                defaults={
                    "group": rg5,
                    "number": q_num,
                    "sort_order": idx,
                    "type": "summary_completion",
                    "prompt": prompt,
                    "options": None,
                    "correct_answers": [ans],
                    "accepted_variants": None,
                    "points": 1,
                    "word_limit": 1,
                    "answer_rule": "ONE_WORD",
                    "created_at": now,
                },
            )

        r_part5_mc = [
            (
                34,
                "What is the main argument made by epidemiologists in the second paragraph?",
                [
                    "Supportive urban environments make healthy personal choices much easier to sustain",
                    "Employers should fine workers who refuse to cycle to the office",
                    "Clinical treatments are no longer necessary in modern cities",
                    "Cafeterias should only serve cold meals during summer months",
                ],
                0,
            ),
            (
                35,
                "Which title best summarizes the passage as a whole?",
                [
                    "Building Healthier Communities Through Preventative Fitness and Nutrition",
                    "The History of Hospital Architecture in the Twentieth Century",
                    "Why Professional Athletes Avoid Office Employment",
                    "A Comparative Guide to Commercial Gym Franchises",
                ],
                0,
            ),
        ]
        for offset, (q_num, prompt, opts, correct_idx) in enumerate(r_part5_mc):
            MockQuestion.objects.update_or_create(
                id=f"ml-test01-q-r5-{q_num}",
                defaults={
                    "group": rg5,
                    "number": q_num,
                    "sort_order": 4 + offset,
                    "type": "multiple_choice",
                    "prompt": prompt,
                    "options": opts,
                    "correct_answers": [opts[correct_idx]],
                    "accepted_variants": None,
                    "points": 1,
                    "word_limit": None,
                    "answer_rule": None,
                    "created_at": now,
                },
            )

        # ------------------------------------------------------------------
        # 3. WRITING SECTION (Task 1.1, Task 1.2, Task 2 — 60 Minutes)
        # ------------------------------------------------------------------
        w_section, _ = MockSection.objects.update_or_create(
            id="ml-test01-sec-writing",
            defaults={
                "exam": exam,
                "skill": "writing",
                "title": "Writing",
                "sort_order": 2,
                "duration_minutes": 60,
                "instructions": (
                    "The Writing paper consists of two parts (60 minutes). Part 1 has two tasks based on a shared stimulus "
                    "(Task 1.1 Informal Letter and Task 1.2 Formal Letter on Gym Membership). Part 2 is an opinion essay on Vegetarian Diet & Health."
                ),
            },
        )

        gym_stimulus = (
            "Dear Member,\n\n"
            "I am sorry to inform you that the membership fees will increase from next month due to rising maintenance costs "
            "and plans to improve our facilities. We aim to offer better equipment and more fitness classes. "
            "What other improvements would you like to see in our services? Do you think our current schedule meets your needs? "
            "We truly value your feedback.\n\n"
            "— The Instructor"
        )

        wg1, _ = MockQuestionGroup.objects.update_or_create(
            id="ml-test01-grp-w1",
            defaults={
                "section": w_section,
                "sort_order": 0,
                "part_number": 1,
                "title": "Task 1.1 — Informal Letter",
                "instructions": "You are a member of a fitness club. You received a letter from your instructor about fee increases.",
                "passage_text": gym_stimulus,
                "stimulus_ref": "gym-membership-increase",
                "max_score": 5,
                "audio_play_limit": 0,
                "created_at": now,
            },
        )
        MockQuestion.objects.update_or_create(
            id="ml-test01-q-w1-1",
            defaults={
                "group": wg1,
                "number": 1,
                "sort_order": 0,
                "type": "essay_task1",
                "prompt": (
                    "Write a letter to your friend about the increase in club membership fees with your feelings about it "
                    "and suggest what the management should do.\n\n"
                    "Write about 50 words."
                ),
                "options": None,
                "correct_answers": None,
                "accepted_variants": None,
                "word_limit": None,
                "points": 5,
                "answer_rule": None,
                "created_at": now,
            },
        )

        wg2, _ = MockQuestionGroup.objects.update_or_create(
            id="ml-test01-grp-w2",
            defaults={
                "section": w_section,
                "sort_order": 1,
                "part_number": 1,
                "title": "Task 1.2 — Formal Letter",
                "instructions": "You are a member of a fitness club. You received a letter from your instructor about fee increases.",
                "passage_text": gym_stimulus,
                "stimulus_ref": "gym-membership-increase",
                "max_score": 5,
                "audio_play_limit": 0,
                "created_at": now,
            },
        )
        MockQuestion.objects.update_or_create(
            id="ml-test01-q-w1-2",
            defaults={
                "group": wg2,
                "number": 2,
                "sort_order": 1,
                "type": "essay_task1",
                "prompt": (
                    "Write a letter to the gym instructor. Explain your opinion about the current changes. "
                    "Express your concerns and suggest what improvements could be made.\n\n"
                    "Write about 120–150 words."
                ),
                "options": None,
                "correct_answers": None,
                "accepted_variants": None,
                "word_limit": None,
                "points": 5,
                "answer_rule": None,
                "created_at": now,
            },
        )

        wg3, _ = MockQuestionGroup.objects.update_or_create(
            id="ml-test01-grp-w3",
            defaults={
                "section": w_section,
                "sort_order": 2,
                "part_number": 2,
                "title": "Task 2 — Publication / Forum Discussion",
                "instructions": "You are participating in an online discussion for language learners. Write a response giving reasons and examples (180–200 words).",
                "stimulus_ref": None,
                "max_score": 6,
                "audio_play_limit": 0,
                "created_at": now,
            },
        )
        MockQuestion.objects.update_or_create(
            id="ml-test01-q-w2",
            defaults={
                "group": wg3,
                "number": 3,
                "sort_order": 2,
                "type": "essay_task2",
                "prompt": (
                    "Some people say a vegetarian diet is better for health. Do you agree?\n\n"
                    "Post your response in the discussion forum, giving clear reasons and relevant examples from your own knowledge or experience.\n\n"
                    "Write about 180–200 words."
                ),
                "options": None,
                "correct_answers": None,
                "accepted_variants": None,
                "word_limit": None,
                "points": 6,
                "answer_rule": None,
                "created_at": now,
            },
        )

        # ------------------------------------------------------------------
        # 4. SPEAKING SECTION (Parts 1.1, 1.2, 2, 3 — 30 Minutes)
        # ------------------------------------------------------------------
        s_section, _ = MockSection.objects.update_or_create(
            id="ml-test01-sec-speaking",
            defaults={
                "exam": exam,
                "skill": "speaking",
                "title": "Speaking",
                "sort_order": 3,
                "duration_minutes": 30,
                "instructions": (
                    "The Speaking paper consists of Part 1.1 (Personal Questions on Sports & Healthy Lifestyle), "
                    "Part 1.2 (Picture Comparison), Part 2 (Cue Card Monologue), and Part 3 (Abstract Discussion)."
                ),
            },
        )

        sg1, _ = MockQuestionGroup.objects.update_or_create(
            id="ml-test01-grp-s1",
            defaults={
                "section": s_section,
                "sort_order": 0,
                "part_number": 1,
                "title": "Part 1.1",
                "instructions": "Topic: Sports, Fitness & Healthy Lifestyle\nAnswer each question spontaneously. You have 5 seconds to prepare and 30 seconds to speak per question.",
                "max_score": 5,
                "audio_play_limit": 0,
                "created_at": now,
            },
        )
        s_part1_prompts = [
            "1. What kinds of sports or physical activities do you enjoy doing in your free time?",
            "2. How important is maintaining a balanced diet and regular exercise in your daily routine?",
            "3. Do people in your country prefer exercising at a gym or outdoors in public parks? Why?",
        ]
        for idx, prompt in enumerate(s_part1_prompts):
            q_num = idx + 1
            MockQuestion.objects.update_or_create(
                id=f"ml-test01-q-s1-{q_num}",
                defaults={
                    "group": sg1,
                    "number": q_num,
                    "sort_order": idx,
                    "type": "speaking_task",
                    "prompt": prompt,
                    "options": None,
                    "correct_answers": None,
                    "accepted_variants": None,
                    "word_limit": None,
                    "answer_rule": None,
                    "points": 5,
                    "created_at": now,
                },
            )

        sg1_2, _ = MockQuestionGroup.objects.update_or_create(
            id="ml-test01-grp-s1-2",
            defaults={
                "section": s_section,
                "sort_order": 1,
                "part_number": 2,
                "title": "Part 1.2",
                "instructions": "Look at the two pictures showing different ways of learning and training: Traditional Classroom vs Online Distance Study. Compare the pictures and answer the questions.",
                "image_key": image_asset_key,
                "max_score": 5,
                "audio_play_limit": 0,
                "created_at": now,
            },
        )
        s_part1_2_prompts = [
            "1. Describe and compare the two environments shown in the pictures. (10 seconds to think, 45 seconds to speak)",
            "2. Do you think online classes and virtual fitness coaching are popular in your country?",
            "3. What are the main advantages of training or studying in person compared to online?",
        ]
        for idx, prompt in enumerate(s_part1_2_prompts):
            q_num = 4 + idx
            MockQuestion.objects.update_or_create(
                id=f"ml-test01-q-s1-2-{idx + 1}",
                defaults={
                    "group": sg1_2,
                    "number": q_num,
                    "sort_order": 3 + idx,
                    "type": "speaking_task",
                    "prompt": prompt,
                    "options": None,
                    "correct_answers": None,
                    "accepted_variants": None,
                    "word_limit": None,
                    "answer_rule": None,
                    "points": 5,
                    "created_at": now,
                },
            )

        cue_card_text = (
            "Describe a sports facility you visited or a positive diet/lifestyle change you made.\n\n"
            "You should say:\n"
            "• What the sports facility or diet change was\n"
            "• When and why you decided to try it\n"
            "• What challenges or benefits you experienced\n"
            "• And explain how this experience influenced your attitude toward health and fitness."
        )
        sg2, _ = MockQuestionGroup.objects.update_or_create(
            id="ml-test01-grp-s2",
            defaults={
                "section": s_section,
                "sort_order": 2,
                "part_number": 3,
                "title": "Part 2",
                "instructions": "Describe a sports facility or diet change. You have 1 minute to think and 2 minutes to speak.",
                "passage_text": cue_card_text,
                "stimulus_ref": "speaking-cue-card-learning-experience",
                "max_score": 5,
                "audio_play_limit": 0,
                "created_at": now,
            },
        )
        MockQuestion.objects.update_or_create(
            id="ml-test01-q-s2-1",
            defaults={
                "group": sg2,
                "number": 7,
                "sort_order": 6,
                "type": "speaking_task",
                "prompt": cue_card_text,
                "options": None,
                "correct_answers": None,
                "accepted_variants": None,
                "word_limit": None,
                "answer_rule": None,
                "points": 5,
                "created_at": now,
            },
        )

        discussion_text = (
            "Discussion Topic: Public Health vs. Personal Choice\n\n"
            "Should governments actively regulate unhealthy foods and subsidize gym memberships, or should diet and exercise "
            "remain strictly a matter of personal choice and responsibility? How can schools and workplaces best encourage lifelong healthy habits?"
        )
        sg3, _ = MockQuestionGroup.objects.update_or_create(
            id="ml-test01-grp-s3",
            defaults={
                "section": s_section,
                "sort_order": 3,
                "part_number": 4,
                "title": "Part 3",
                "instructions": "Answer the discussion questions in depth. You have 1 minute to think and 2 minutes to speak.",
                "passage_text": discussion_text,
                "stimulus_ref": "speaking-part3-future-education",
                "max_score": 6,
                "audio_play_limit": 0,
                "created_at": now,
            },
        )
        MockQuestion.objects.update_or_create(
            id="ml-test01-q-s3-1",
            defaults={
                "group": sg3,
                "number": 8,
                "sort_order": 7,
                "type": "speaking_task",
                "prompt": discussion_text,
                "options": None,
                "correct_answers": None,
                "accepted_variants": None,
                "word_limit": None,
                "answer_rule": None,
                "points": 6,
                "created_at": now,
            },
        )

        # Clean up any legacy manual questions across all exams that had word_limit > 50 or invalid answer_rule
        MockQuestion.objects.filter(type__in=["essay_task1", "essay_task2", "speaking_task"]).update(
            word_limit=None,
            answer_rule=None,
        )

    if style:
        stdout.write(style.SUCCESS(f"Successfully seeded all 4 skills (81 tasks) for exam: {EXAM_ID}"))
    else:
        stdout.write(f"Successfully seeded all 4 skills (81 tasks) for exam: {EXAM_ID}")
    return exam


class Command(BaseCommand):
    help = "Seeds complete 4-skill DTM Multi-Level Mock Test 1 — Gym Membership & Vegetarian Diet."

    def handle(self, *args, **options):
        self.stdout.write("Seeding complete 4-skill DTM Multi-Level Mock Test 1: Gym Membership & Vegetarian Diet...")
        seed_mock_test_1(self.stdout, self.style)
