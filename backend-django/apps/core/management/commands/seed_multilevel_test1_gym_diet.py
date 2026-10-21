from __future__ import annotations

import io
import os
import shutil
import urllib.request
from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone
from PIL import Image, ImageDraw

from apps.core.multilevel import CURRENT_SPEC
from apps.legacy_schema.models import (
    MockExam,
    MockQuestion,
    MockQuestionGroup,
    MockSection,
    User,
)

EXAM_ID = "multilevel-test-01-gym-vegetarian"
IMAGE_RELATIVE_PATH = "multilevel/assets/speaking-1.2-classroom-vs-online.png"
LEGACY_IMAGE_PATH = "multilevel/assets/speaking-1.2-two-picture.png"


def ensure_picture_comparison_asset(stdout) -> str:
    """Creates a high-resolution, professional DTM comparison asset (Classroom vs Online)."""
    media_root = Path(settings.MEDIA_ROOT).resolve()
    target_path = media_root / IMAGE_RELATIVE_PATH
    legacy_path = media_root / LEGACY_IMAGE_PATH

    if target_path.is_file() and target_path.stat().st_size > 5000:
        stdout.write(f"Picture comparison asset already exists at {target_path}")
        return IMAGE_RELATIVE_PATH

    target_path.parent.mkdir(parents=True, exist_ok=True)

    w, h = 1200, 675
    canvas = Image.new("RGB", (w, h), color=(11, 15, 23))  # #0B0F17 Obsidian
    draw = ImageDraw.Draw(canvas)

    im1, im2 = None, None
    try:
        headers = {"User-Agent": "Mozilla/5.0"}
        # Royalty-free educational photographs
        u1 = "https://images.unsplash.com/photo-1580582932707-520aed937b7b?w=600&auto=format&fit=crop&q=80"
        u2 = "https://images.unsplash.com/photo-1588196749597-9ff075ee6b5b?w=600&auto=format&fit=crop&q=80"
        req1 = urllib.request.Request(u1, headers=headers)
        req2 = urllib.request.Request(u2, headers=headers)
        with urllib.request.urlopen(req1, timeout=5) as r1, urllib.request.urlopen(req2, timeout=5) as r2:
            im1 = Image.open(io.BytesIO(r1.read())).convert("RGB")
            im2 = Image.open(io.BytesIO(r2.read())).convert("RGB")
    except Exception as exc:
        stdout.write(f"Notice: Network image fetch fallback used: {exc}")

    # Top Header Bar
    draw.rectangle([(0, 0), (w, 55)], fill=(16, 24, 39))
    draw.line([(0, 55), (w, 55)], fill=(30, 41, 59), width=2)
    draw.text((w // 2, 28), "DTM MULTI-LEVEL (CEFR) EXAMINATION — SPEAKING PART 1.2", fill=(241, 245, 249), anchor="mm")

    slot_w, slot_h = 540, 470

    # Panel 1: Traditional Classroom (Picture A)
    x1, y1 = 40, 75
    if im1:
        im1_r = im1.resize((slot_w, slot_h), Image.Resampling.LANCZOS)
        canvas.paste(im1_r, (x1, y1))
    else:
        draw.rectangle([(x1, y1), (x1 + slot_w, y1 + slot_h)], fill=(15, 23, 42))
        draw.text((x1 + slot_w // 2, y1 + slot_h // 2), "TRADITIONAL IN-PERSON CLASSROOM", fill=(148, 163, 184), anchor="mm")

    draw.rectangle([(x1 - 2, y1 - 2), (x1 + slot_w + 1, y1 + slot_h + 1)], outline=(51, 65, 85), width=2)
    draw.rectangle([(x1 + 15, y1 + 15), (x1 + 340, y1 + 55)], fill=(5, 150, 105))  # Emerald #059669
    draw.text((x1 + 177, y1 + 35), "PICTURE A: Traditional Classroom", fill=(255, 255, 255), anchor="mm")

    # Panel 2: Online Remote Study (Picture B)
    x2, y2 = 620, 75
    if im2:
        im2_r = im2.resize((slot_w, slot_h), Image.Resampling.LANCZOS)
        canvas.paste(im2_r, (x2, y2))
    else:
        draw.rectangle([(x2, y2), (x2 + slot_w, y2 + slot_h)], fill=(15, 23, 42))
        draw.text((x2 + slot_w // 2, y2 + slot_h // 2), "ONLINE DISTANCE STUDY", fill=(148, 163, 184), anchor="mm")

    draw.rectangle([(x2 - 2, y2 - 2), (x2 + slot_w + 1, y2 + slot_h + 1)], outline=(51, 65, 85), width=2)
    draw.rectangle([(x2 + 15, y2 + 15), (x2 + 330, y2 + 55)], fill=(37, 99, 235))  # Blue #2563EB
    draw.text((x2 + 172, y2 + 35), "PICTURE B: Online Distance Study", fill=(255, 255, 255), anchor="mm")

    # Bottom Instructions Bar
    draw.rectangle([(0, h - 60), (w, h)], fill=(16, 24, 39))
    draw.line([(0, h - 60), (w, h - 60)], fill=(30, 41, 59), width=2)
    draw.text(
        (w // 2, h - 30),
        "Candidate Task: Compare the two study environments. (10s preparation, 45s speaking)",
        fill=(203, 213, 225),
        anchor="mm",
    )

    canvas.save(str(target_path), "PNG")
    try:
        shutil.copyfile(str(target_path), str(legacy_path))
    except Exception:
        pass

    stdout.write(f"Generated comparison image asset at {target_path}")
    return IMAGE_RELATIVE_PATH


class Command(BaseCommand):
    help = "Seeds DTM Multi-Level Test 1 (Writing & Speaking) — Gym Membership & Vegetarian Diet."

    def handle(self, *args, **options):
        self.stdout.write("Seeding DTM Multi-Level Mock Test 1: Gym Membership & Vegetarian Diet...")

        image_asset_key = ensure_picture_comparison_asset(self.stdout)

        with transaction.atomic():
            now = timezone.now()
            creator = User.objects.filter(role__in=["super_admin", "admin"]).first()
            creator_id = creator.id if creator else str(uuid4())

            # 1. Clean up existing exam structure if re-running
            MockQuestion.objects.filter(group__section__exam_id=EXAM_ID).delete()
            MockQuestionGroup.objects.filter(section__exam_id=EXAM_ID).delete()
            MockSection.objects.filter(exam_id=EXAM_ID).delete()
            MockExam.objects.filter(id=EXAM_ID).delete()

            # 2. Create MockExam
            exam = MockExam.objects.create(
                id=EXAM_ID,
                title="Multi-Level (CEFR) Mock Test 1: Gym Membership & Vegetarian Diet",
                description=(
                    "Rasmiy DTM Multi-Level (CEFR B1-C1) Test 1: Writing (Gym Membership & Vegetarian Diet) "
                    "va Speaking (Interview & Classroom vs Online Learning). OpenRouter DeepSeek / Qwen AI "
                    "va Ustoz nazorati bilan baholanadi."
                ),
                level="B1-C1",
                practice_level="B2",
                type="multilevel",
                assessment_policy="FULL_MOCK_AI_WITH_REVIEW",
                speaking_profile_version="BESTWAY_MULTILEVEL_SPEAKING_2026_V2",
                specification_version=CURRENT_SPEC,
                is_published=True,
                is_demo=False,
                price=0,
                is_free_for_approved=True,
                created_by_id=creator_id,
                created_at=now,
                updated_at=now,
                profile="writing_speaking",
                content_version=1,
            )
            self.stdout.write(self.style.SUCCESS(f"Created MockExam: {exam.id}"))

            # 3. WRITING SECTION (Total time: 60 minutes)
            w_section = MockSection.objects.create(
                id="ml-test01-sec-writing",
                exam=exam,
                skill="writing",
                title="Writing",
                sort_order=0,
                duration_minutes=60,
                instructions=(
                    "The Writing paper consists of two parts. Part 1 has two tasks based on a shared stimulus "
                    "(Task 1.1 Informal Letter and Task 1.2 Formal Letter). Part 2 is an opinion post/essay."
                ),
            )

            gym_stimulus = (
                "Dear Member,\n\n"
                "I am sorry to inform you that the membership fees will increase from next month due to rising maintenance costs "
                "and plans to improve our facilities. We aim to offer better equipment and more fitness classes. "
                "What other improvements would you like to see in our services? Do you think our current schedule meets your needs? "
                "We truly value your feedback.\n\n"
                "— The Instructor"
            )

            # Task 1.1 Informal Letter
            wg1 = MockQuestionGroup.objects.create(
                id="ml-test01-grp-w1",
                section=w_section,
                sort_order=0,
                part_number=1,
                title="Task 1.1 — Informal Letter",
                instructions="You are a member of a fitness club. You received a letter from your instructor about fee increases.",
                passage_text=gym_stimulus,
                stimulus_ref="gym-membership-increase",
                max_score=5,
                audio_play_limit=0,
                created_at=now,
            )
            MockQuestion.objects.create(
                id="ml-test01-q-w1-1",
                group=wg1,
                number=1,
                sort_order=0,
                type="essay_task1",
                prompt=(
                    "Write a letter to your friend about the increase in club membership fees with your feelings about it "
                    "and suggest what the management should do.\n\n"
                    "Write about 50 words."
                ),
                word_limit=50,
                points=5,
                answer_rule="Informal letter to friend with feelings and suggestions (~50 words)",
                created_at=now,
            )

            # Task 1.2 Formal Letter
            wg2 = MockQuestionGroup.objects.create(
                id="ml-test01-grp-w2",
                section=w_section,
                sort_order=1,
                part_number=1,
                title="Task 1.2 — Formal Letter",
                instructions="You are a member of a fitness club. You received a letter from your instructor about fee increases.",
                passage_text=gym_stimulus,
                stimulus_ref="gym-membership-increase",
                max_score=5,
                audio_play_limit=0,
                created_at=now,
            )
            MockQuestion.objects.create(
                id="ml-test01-q-w1-2",
                group=wg2,
                number=2,
                sort_order=1,
                type="essay_task1",
                prompt=(
                    "Write a letter to the gym instructor. Explain your opinion about the current changes. "
                    "Express your concerns and suggest what improvements could be made.\n\n"
                    "Write about 120–150 words."
                ),
                word_limit=150,
                points=5,
                answer_rule="Formal letter to gym instructor explaining opinion, concerns and improvements (120–150 words)",
                created_at=now,
            )

            # Part 2 Discussion Essay / Forum Post
            wg3 = MockQuestionGroup.objects.create(
                id="ml-test01-grp-w3",
                section=w_section,
                sort_order=2,
                part_number=2,
                title="Task 2 — Publication / Forum Discussion",
                instructions="You are participating in an online discussion for language learners. Write a response giving reasons and examples (180–200 words).",
                stimulus_ref=None,
                max_score=6,
                audio_play_limit=0,
                created_at=now,
            )
            MockQuestion.objects.create(
                id="ml-test01-q-w2",
                group=wg3,
                number=3,
                sort_order=2,
                type="essay_task2",
                prompt=(
                    "Some people say a vegetarian diet is better for health. Do you agree?\n\n"
                    "Post your response in the discussion forum, giving clear reasons and relevant examples from your own knowledge or experience.\n\n"
                    "Write about 180–200 words."
                ),
                word_limit=200,
                points=6,
                answer_rule="Discussion post giving reasons and examples on vegetarian diet (180–200 words)",
                created_at=now,
            )
            self.stdout.write(self.style.SUCCESS("Created Writing Section (Task 1.1, Task 1.2, Task 2)"))

            # 4. SPEAKING SECTION (Parts 1.1, 1.2, 2, 3)
            s_section = MockSection.objects.create(
                id="ml-test01-sec-speaking",
                exam=exam,
                skill="speaking",
                title="Speaking",
                sort_order=1,
                duration_minutes=30,
                instructions="The Speaking paper consists of Part 1.1 (Interview), Part 1.2 (Picture Comparison), Part 2 (Long Turn), and Part 3 (Discussion).",
            )

            # Part 1.1 Interview (5s prep, 30s speak per question)
            sg1 = MockQuestionGroup.objects.create(
                id="ml-test01-grp-s1",
                section=s_section,
                sort_order=0,
                part_number=1,
                title="Part 1.1",
                instructions="Topic: Free Time & Personal Background\nAnswer each question spontaneously. You have 5 seconds to prepare and 30 seconds to speak per question.",
                max_score=5,
                audio_play_limit=0,
                created_at=now,
            )
            MockQuestion.objects.create(
                id="ml-test01-q-s1-1",
                group=sg1,
                number=1,
                sort_order=0,
                type="speaking_task",
                prompt="1. What do you do in your free time?",
                points=5,
                created_at=now,
            )
            MockQuestion.objects.create(
                id="ml-test01-q-s1-2",
                group=sg1,
                number=2,
                sort_order=1,
                type="speaking_task",
                prompt="2. Tell me about your country.",
                points=5,
                created_at=now,
            )
            MockQuestion.objects.create(
                id="ml-test01-q-s1-3",
                group=sg1,
                number=3,
                sort_order=2,
                type="speaking_task",
                prompt="3. Describe your first teacher.",
                points=5,
                created_at=now,
            )

            # Part 1.2 Picture Comparison & Description (10s prep, 45s speak + follow-ups)
            sg1_2 = MockQuestionGroup.objects.create(
                id="ml-test01-grp-s1-2",
                section=s_section,
                sort_order=1,
                part_number=2,
                title="Part 1.2",
                instructions="Look at the two pictures showing different ways of learning: Traditional Classroom vs Online Distance Study. Compare the pictures and answer the questions.",
                image_key=image_asset_key,
                max_score=5,
                audio_play_limit=0,
                created_at=now,
            )
            MockQuestion.objects.create(
                id="ml-test01-q-s1-2-1",
                group=sg1_2,
                number=4,
                sort_order=3,
                type="speaking_task",
                prompt="1. Describe and compare the two study environments shown in the pictures. (10 seconds to think, 45 seconds to speak)",
                points=5,
                created_at=now,
            )
            MockQuestion.objects.create(
                id="ml-test01-q-s1-2-2",
                group=sg1_2,
                number=5,
                sort_order=4,
                type="speaking_task",
                prompt="2. Do you think online classes are popular in your country? What do you like about studying in a classroom?",
                points=5,
                created_at=now,
            )
            MockQuestion.objects.create(
                id="ml-test01-q-s1-2-3",
                group=sg1_2,
                number=6,
                sort_order=5,
                type="speaking_task",
                prompt="3. What are the advantages of studying online compared to traditional classroom learning?",
                points=5,
                created_at=now,
            )

            # Part 2 Cue Card Long Turn (1 min prep, 2 min speak)
            cue_card_text = (
                "Describe an important learning experience or course you took (in a classroom or online).\n\n"
                "You should say:\n"
                "• What the subject or skill was\n"
                "• Where and how you studied it\n"
                "• What you found easy or challenging about it\n"
                "• And explain how this learning experience helped you or changed your view of education."
            )
            sg2 = MockQuestionGroup.objects.create(
                id="ml-test01-grp-s2",
                section=s_section,
                sort_order=2,
                part_number=3,
                title="Part 2",
                instructions="Describe an important learning experience or course. You have 1 minute to think and 2 minutes to speak.",
                passage_text=cue_card_text,
                stimulus_ref="speaking-cue-card-learning-experience",
                max_score=5,
                audio_play_limit=0,
                created_at=now,
            )
            MockQuestion.objects.create(
                id="ml-test01-q-s2-1",
                group=sg2,
                number=7,
                sort_order=6,
                type="speaking_task",
                prompt=cue_card_text,
                points=5,
                created_at=now,
            )

            # Part 3 Analytical Discussion (1 min prep, 2 min speak)
            discussion_text = (
                "Discussion Topic: Education, Technology and the Future of Learning\n\n"
                "In what ways do you think artificial intelligence and digital technology will change schools and universities in the future? "
                "Do you believe digital learning can ever completely replace traditional face-to-face teachers in the classroom? Give reasons and examples."
            )
            sg3 = MockQuestionGroup.objects.create(
                id="ml-test01-grp-s3",
                section=s_section,
                sort_order=3,
                part_number=4,
                title="Part 3",
                instructions="Answer the discussion questions in depth. You have 1 minute to think and 2 minutes to speak.",
                passage_text=discussion_text,
                stimulus_ref="speaking-part3-future-education",
                max_score=6,
                audio_play_limit=0,
                created_at=now,
            )
            MockQuestion.objects.create(
                id="ml-test01-q-s3-1",
                group=sg3,
                number=8,
                sort_order=7,
                type="speaking_task",
                prompt=discussion_text,
                points=6,
                created_at=now,
            )
            self.stdout.write(self.style.SUCCESS("Created Speaking Section (Parts 1.1, 1.2, 2, 3)"))

        self.stdout.write(self.style.SUCCESS(f"Successfully seeded exam: {EXAM_ID}"))
