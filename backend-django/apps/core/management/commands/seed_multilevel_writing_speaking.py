from __future__ import annotations

from uuid import uuid4

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.core.multilevel import CURRENT_SPEAKING_PROFILE, CURRENT_SPEC
from apps.legacy_schema.models import (
    MockExam,
    MockQuestion,
    MockQuestionGroup,
    MockSection,
    User,
)

EXAM_ID = "multilevel-writing-speaking-01"


class Command(BaseCommand):
    help = "Seeds the official Multi-Level CEFR Mock Exam with Writing (Tasks 1.1, 1.2, 2) and Speaking (Parts 1, 2)."

    def handle(self, *args, **options):
        self.stdout.write("Seeding Multi-Level Writing & Speaking Mock Exam...")

        with transaction.atomic():
            now = timezone.now()
            creator = User.objects.filter(role__in=["super_admin", "admin"]).first()
            creator_id = creator.id if creator else str(uuid4())

            # Clean up existing structure
            MockQuestion.objects.filter(group__section__exam_id=EXAM_ID).delete()
            MockQuestionGroup.objects.filter(section__exam_id=EXAM_ID).delete()
            MockSection.objects.filter(exam_id=EXAM_ID).delete()
            MockExam.objects.filter(id=EXAM_ID).delete()

            # 1. Mock Exam
            exam = MockExam.objects.create(
                id=EXAM_ID,
                title="Multi-Level (CEFR) Mock Exam: Writing & Speaking Mastery",
                description="Official Multi-Level (CEFR B1-C1) imtihoni: Writing (Tasks 1.1, 1.2, 2) va Speaking (Parts 1 & 2). Xkiro (Qwen) va OpenRouter (DeepSeek) orqali avtomatik baholanadi.",
                level="B1-C1",
                practice_level="B2",
                type="multilevel",
                assessment_policy="FULL_MOCK_AI_WITH_REVIEW",
                speaking_profile_version=CURRENT_SPEAKING_PROFILE,
                specification_version=CURRENT_SPEC,
                is_published=True,
                is_demo=True,
                price=0,
                is_free_for_approved=True,
                created_by_id=creator_id,
                created_at=now,
                updated_at=now,
                profile="practice",
                content_version=1,
            )
            self.stdout.write(self.style.SUCCESS(f"Created MockExam: {exam.id}"))

            # 2. Writing Section
            w_section = MockSection.objects.create(
                id="ml-ws01-sec-writing",
                exam=exam,
                skill="writing",
                title="Writing",
                sort_order=0,
                duration_minutes=60,
                instructions="The Writing paper consists of two parts. Part 1 has two tasks based on a shared stimulus (Task 1.1 and Task 1.2). Part 2 is an opinion post/essay.",
            )

            festival_stimulus = (
                "Dear guest,\n\n"
                "Thank you for joining us at the music festival! We'd love to hear what you enjoyed most. "
                "Also, do you have any suggestions for future performances or improvements?\n\n"
                "— Festival Team"
            )

            # Task 1.1 Informal Letter
            wg1 = MockQuestionGroup.objects.create(
                id="ml-ws01-grp-writing-1",
                section=w_section,
                sort_order=0,
                part_number=1,
                title="Task 1.1 — Informal Letter",
                instructions="You attended the opening night of a summer music festival in your city. A few days later, the organizers contacted you.",
                passage_text=festival_stimulus,
                stimulus_ref="summer-music-festival",
                max_score=5,
                audio_play_limit=0,
                created_at=now,
            )
            MockQuestion.objects.create(
                id="ml-ws01-q-w1-1",
                group=wg1,
                number=1,
                sort_order=0,
                type="essay_task1",
                prompt="Write a letter to your friend who loves music festivals. Say what you liked most and suggest going together next year. Write about 50 words.",
                word_limit=50,
                points=5,
                answer_rule="Informal letter to friend (~50 words)",
                created_at=now,
            )

            # Task 1.2 Formal Letter
            wg2 = MockQuestionGroup.objects.create(
                id="ml-ws01-grp-writing-2",
                section=w_section,
                sort_order=1,
                part_number=1,
                title="Task 1.2 — Formal Letter",
                instructions="You attended the opening night of a summer music festival in your city. A few days later, the organizers contacted you.",
                passage_text=festival_stimulus,
                stimulus_ref="summer-music-festival",
                max_score=5,
                audio_play_limit=0,
                created_at=now,
            )
            MockQuestion.objects.create(
                id="ml-ws01-q-w1-2",
                group=wg2,
                number=2,
                sort_order=1,
                type="essay_task1",
                prompt="Write a letter to the festival organizers. Say what you enjoyed at the festival and suggest improvements for future events. Write about 120–150 words.",
                word_limit=150,
                points=5,
                answer_rule="Formal letter to festival organizers (120–150 words)",
                created_at=now,
            )

            # Task 2 Opinion Post
            wg3 = MockQuestionGroup.objects.create(
                id="ml-ws01-grp-writing-3",
                section=w_section,
                sort_order=2,
                part_number=2,
                title="Task 2 — Publication",
                instructions="Write a post giving reasons and examples (180–200 words).",
                stimulus_ref=None,
                max_score=6,
                audio_play_limit=0,
                created_at=now,
            )
            MockQuestion.objects.create(
                id="ml-ws01-q-w2",
                group=wg3,
                number=3,
                sort_order=2,
                type="essay_task2",
                prompt="Some people believe that studying online is more effective than learning in a traditional classroom. Do you agree or disagree? Write a post giving reasons and examples (180–200 words).",
                word_limit=200,
                points=6,
                answer_rule="Opinion post giving reasons and examples (180–200 words)",
                created_at=now,
            )
            self.stdout.write(self.style.SUCCESS("Created Writing Section (Tasks 1.1, 1.2, 2)"))

            # 3. Speaking Section
            s_section = MockSection.objects.create(
                id="ml-ws01-sec-speaking",
                exam=exam,
                skill="speaking",
                title="Speaking",
                sort_order=1,
                duration_minutes=11,
                instructions="The Speaking paper consists of Part 1.1 (Interview), Part 1.2 (Picture Comparison), Part 2 (Long Turn), and Part 3 (Discussion).",
            )

            # Part 1.1 Free Time Interview
            sg1 = MockQuestionGroup.objects.create(
                id="ml-ws01-grp-speaking-1",
                section=s_section,
                sort_order=0,
                part_number=1,
                title="Part 1.1",
                instructions="Topic: Free Time\nAnswer each question spontaneously. Speak for about 30 seconds per question.",
                max_score=5,
                audio_play_limit=0,
                created_at=now,
            )
            MockQuestion.objects.create(
                id="ml-ws01-q-s1-1",
                group=sg1,
                number=1,
                sort_order=0,
                type="speaking_task",
                prompt="1. What do you usually do in your free time?",
                points=5,
                created_at=now,
            )
            MockQuestion.objects.create(
                id="ml-ws01-q-s1-2",
                group=sg1,
                number=2,
                sort_order=1,
                type="speaking_task",
                prompt="2. Do you prefer spending your free time alone or with friends? Why?",
                points=5,
                created_at=now,
            )
            MockQuestion.objects.create(
                id="ml-ws01-q-s1-3",
                group=sg1,
                number=3,
                sort_order=2,
                type="speaking_task",
                prompt="3. Is there a new hobby you would like to try in the future?",
                points=5,
                created_at=now,
            )

            # Part 1.2 Picture Comparison (Two-picture asset)
            sg1_2 = MockQuestionGroup.objects.create(
                id="ml-ws01-grp-speaking-1-2",
                section=s_section,
                sort_order=1,
                part_number=2,
                title="Part 1.2",
                instructions="Look at the two pictures showing different ways of learning. Compare the pictures and answer the questions.",
                image_key="multilevel/assets/speaking-1.2-two-picture.png",
                max_score=5,
                audio_play_limit=0,
                created_at=now,
            )
            MockQuestion.objects.create(
                id="ml-ws01-q-s1-2-1",
                group=sg1_2,
                number=4,
                sort_order=3,
                type="speaking_task",
                prompt="1. What are the key differences between the two study environments shown in the pictures?",
                points=5,
                created_at=now,
            )
            MockQuestion.objects.create(
                id="ml-ws01-q-s1-2-2",
                group=sg1_2,
                number=5,
                sort_order=4,
                type="speaking_task",
                prompt="2. What are the advantages and disadvantages of studying in each environment?",
                points=5,
                created_at=now,
            )
            MockQuestion.objects.create(
                id="ml-ws01-q-s1-2-3",
                group=sg1_2,
                number=6,
                sort_order=5,
                type="speaking_task",
                prompt="3. Which learning style suits you better and why?",
                points=5,
                created_at=now,
            )

            # Part 2 Cue Card Long Turn
            cue_card_text = (
                "Describe a person who has had a positive influence on your life.\n\n"
                "You should say:\n"
                "• Who this person is\n"
                "• How you met this person\n"
                "• What qualities this person has\n"
                "• And explain how this person has influenced your life."
            )
            sg2 = MockQuestionGroup.objects.create(
                id="ml-ws01-grp-speaking-2",
                section=s_section,
                sort_order=2,
                part_number=3,
                title="Part 2",
                instructions="Describe a person who has had a positive influence on your life. You have 1 minute to prepare and 2 minutes to speak.",
                passage_text=cue_card_text,
                stimulus_ref="speaking-cue-card-positive-influence",
                max_score=5,
                audio_play_limit=0,
                created_at=now,
            )
            MockQuestion.objects.create(
                id="ml-ws01-q-s2-1",
                group=sg2,
                number=7,
                sort_order=6,
                type="speaking_task",
                prompt=cue_card_text,
                points=5,
                created_at=now,
            )

            # Part 3 Discussion & Analytical Questions
            discussion_text = (
                "Discussion Topic: Role Models and Social Influence\n"
                "In what ways do role models and influential figures shape the values of young people in modern society? "
                "How has the concept of a role model changed with the rise of digital social media?"
            )
            sg3 = MockQuestionGroup.objects.create(
                id="ml-ws01-grp-speaking-3",
                section=s_section,
                sort_order=3,
                part_number=4,
                title="Part 3",
                instructions="Answer the discussion questions in depth. You have 1 minute to think and 2 minutes to speak.",
                passage_text=discussion_text,
                stimulus_ref="speaking-part3-role-models",
                max_score=6,
                audio_play_limit=0,
                created_at=now,
            )
            MockQuestion.objects.create(
                id="ml-ws01-q-s3-1",
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
