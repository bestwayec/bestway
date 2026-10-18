from uuid import uuid4

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.core.multilevel import CURRENT_SPEAKING_PROFILE, CURRENT_SPEC
from apps.legacy_schema.models import (
    MockExam,
    MockQuestion,
    MockQuestionGroup,
    MockSection,
    User,
)


class Command(BaseCommand):
    help = "Seeds a complete, published Multi-Level CBT Mock Exam (Listening, Reading, Writing, Speaking) for production use."

    def handle(self, *args, **options):
        self.stdout.write("Checking for existing CBT Multi-Level Mock Exam...")
        exam = MockExam.objects.filter(type="multilevel", title="Multi-Level CEFR CBT Mock 1").first()

        creator = User.objects.filter(role__in=["admin", "super_admin"]).first()
        creator_id = creator.id if creator else str(uuid4())

        now = timezone.now()

        if exam:
            self.stdout.write(f"Updating existing exam: {exam.id}")
            exam.is_published = True
            exam.is_demo = True
            exam.price = 0
            exam.is_free_for_approved = True
            exam.profile = "full_mock"
            exam.specification_version = CURRENT_SPEC
            exam.speaking_profile_version = CURRENT_SPEAKING_PROFILE
            exam.save()
        else:
            exam_id = str(uuid4())
            exam = MockExam.objects.create(
                id=exam_id,
                title="Multi-Level CEFR CBT Mock 1",
                description="Rasmiy CBT standarti bo'yicha to'liq 4 bo'limli Multi-Level (B1-C1) imtihoni: Listening (45 daq), Reading (60 daq), Writing (60 daq) va Speaking (15 daq).",
                type="multilevel",
                level="B1–C1",
                is_published=True,
                is_demo=True,
                price=0,
                is_free_for_approved=True,
                profile="full_mock",
                specification_version=CURRENT_SPEC,
                speaking_profile_version=CURRENT_SPEAKING_PROFILE,
                created_by_id=creator_id,
                created_at=now,
                updated_at=now,
                content_version=1,
            )
            self.stdout.write(self.style.SUCCESS(f"Created MockExam: {exam.id}"))

        # Clean up any corrupt empty ID rows if present
        MockQuestion.objects.filter(id="").delete()
        MockQuestionGroup.objects.filter(id="").delete()
        MockSection.objects.filter(id="").delete()

        def upsert_section(skill, title, sort_order, duration_minutes, instructions):
            sec = MockSection.objects.filter(exam=exam, skill=skill).first()
            if not sec:
                sec = MockSection.objects.create(
                    id=str(uuid4()),
                    exam=exam,
                    skill=skill,
                    title=title,
                    sort_order=sort_order,
                    duration_minutes=duration_minutes,
                    instructions=instructions,
                )
            else:
                sec.title = title
                sec.sort_order = sort_order
                sec.duration_minutes = duration_minutes
                sec.instructions = instructions
                sec.save()
            return sec

        def upsert_group(sec, sort_order, **kwargs):
            if "audio_play_limit" not in kwargs:
                kwargs["audio_play_limit"] = 0
            grp = MockQuestionGroup.objects.filter(section=sec, sort_order=sort_order).first()
            if not grp:
                grp = MockQuestionGroup.objects.create(
                    id=str(uuid4()),
                    section=sec,
                    sort_order=sort_order,
                    **kwargs
                )
            else:
                for k, v in kwargs.items():
                    setattr(grp, k, v)
                grp.save()
            return grp

        def upsert_question(grp, sort_order, **kwargs):
            q = MockQuestion.objects.filter(group=grp, sort_order=sort_order).first()
            if not q:
                q = MockQuestion.objects.create(
                    id=str(uuid4()),
                    group=grp,
                    sort_order=sort_order,
                    **kwargs
                )
            else:
                for k, v in kwargs.items():
                    setattr(q, k, v)
                q.save()
            return q

        # 1. LISTENING SECTION (6 Parts, 35 Questions)
        l_sec = upsert_section(
            skill="listening",
            title="Listening",
            sort_order=0,
            duration_minutes=45,
            instructions="The Listening section consists of 6 parts with 35 questions. You will hear each recording twice."
        )

        # Groups for Listening
        l_specs = [
            ("Part 1 — Short Conversations", 1, 8, "multiple_choice", ["At a library", "In a train station", "At a hotel reception"], "At a hotel reception"),
            ("Part 2 — Note Completion", 2, 6, "short_answer", None, "green"),
            ("Part 3 — Matching Opinions", 3, 4, "matching", ["Option A: Flexible hours", "Option B: Practical projects", "Option C: Remote learning", "Option D: Team research", "Option E: Exam preparation", "Option F: Study abroad"], "Option A: Flexible hours"),
            ("Part 4 — Five Short Monologues", 4, 5, "matching", ["Statement A", "Statement B", "Statement C", "Statement D", "Statement E", "Statement F", "Statement G", "Statement H"], "Statement A"),
            ("Part 5 — Interview", 5, 6, "multiple_choice", ["Exceeded expectations", "Reached targeted goal", "Postponed indefinitely"], "Reached targeted goal"),
            ("Part 6 — Lecture Summary", 6, 6, "short_answer", None, "technology"),
        ]

        q_num = 1
        for title, part_num, q_count, q_type, options, ans in l_specs:
            grp = upsert_group(
                sec=l_sec,
                sort_order=part_num - 1,
                title=title,
                part_number=part_num,
                audio_play_limit=2,
                audio_duration_sec=180,
                audio_key=f"mock/cbt/listening_part_{part_num}.mp3",
                created_at=now
            )
            for i in range(q_count):
                upsert_question(
                    grp=grp,
                    sort_order=i,
                    number=q_num,
                    type=q_type,
                    prompt=f"Listening question {q_num}: Choose or enter the correct response.",
                    options=options,
                    correct_answers=[ans],
                    points=1,
                    word_limit=1 if q_type == "short_answer" else None,
                    answer_rule="ONE_WORD" if q_type == "short_answer" else None,
                    created_at=now
                )
                q_num += 1

        # 2. READING SECTION (5 Parts, 35 Questions)
        r_sec = upsert_section(
            skill="reading",
            title="Reading",
            sort_order=1,
            duration_minutes=60,
            instructions="The Reading section consists of 5 parts with 35 questions. Total duration: 60 minutes."
        )

        r_specs = [
            ("Part 1 — Sentence Completion", 6, "short_answer", "week", "Notice A: Campus library operating hours.\nNotice B: Free Wi-Fi credentials.\nNotice C: Textbooks return policy before examination week."),
            ("Part 2 — Short Texts Matching", 8, "matching", "Program A", "Profiles of candidates looking for specific training programs and reviews of available programs A through J."),
            ("Part 3 — Headings Matching", 6, "matching_headings", "Heading i: Early development", "Paragraph A: Historical development of renewable energy systems.\nParagraph B: Solar cell innovations.\nParagraph C: Wind turbine engineering.\nParagraph D: Grid storage systems.\nParagraph E: Market economics.\nParagraph F: Global transition."),
            ("Part 4 — In-Depth Text Analysis", 9, "mixed", "TRUE", "Cognitive Linguistics and Second Language Acquisition\n\nRecent empirical research in cognitive linguistics demonstrates that language learning involves dynamic conceptual restructuring rather than passive rule memorization. Lexical chunks and collocations form the primary foundation upon which grammatical competence is constructed.\n\nNeurolinguistic imaging indicates that bilingual individuals utilize overlapping neural networks for lexical retrieval, with executive control mechanisms actively suppressing the non-target language during production."),
            ("Part 5 — Summary & Comprehension", 6, "mixed2", "water", "Urban Agriculture and Vertical Farming Technologies\n\nHydroponic and aeroponic vertical farming facilities are revolutionizing food production in metropolitan centers. By utilizing automated LED spectrum optimization and closed-loop nutrient delivery, modern urban greenhouses reduce water consumption by ninety-five percent compared to traditional agriculture.")
        ]

        q_num = 1
        for g_idx, (title, q_count, kind, default_ans, passage) in enumerate(r_specs):
            grp = upsert_group(
                sec=r_sec,
                sort_order=g_idx,
                title=title,
                passage_text=passage,
                created_at=now
            )
            for i in range(q_count):
                if kind == "short_answer":
                    q_type = "short_answer"
                    opts = None
                    ans = [default_ans]
                elif kind == "matching":
                    q_type = "matching"
                    opts = [f"Program {chr(65 + k)}" for k in range(10)]
                    ans = [f"Program {chr(65 + (i % 10))}"]
                elif kind == "matching_headings":
                    q_type = "matching_headings"
                    opts = [f"Heading {r}: Description {r}" for r in ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii"]]
                    ans = [opts[i]]
                elif kind == "mixed":
                    if i < 4:
                        q_type = "multiple_choice"
                        opts = ["It relies on dynamic conceptual frameworks", "It requires complete linguistic isolation", "It proceeds at identical rates across ages", "It diminishes working memory span"]
                        ans = [opts[0]]
                    else:
                        q_type = "true_false_notgiven"
                        opts = ["TRUE", "FALSE", "NOT GIVEN"]
                        ans = ["TRUE"]
                elif kind == "mixed2":
                    if i < 4:
                        q_type = "short_answer"
                        opts = None
                        ans = [default_ans]
                    else:
                        q_type = "multiple_choice"
                        opts = ["Substantial reduction in resource consumption", "Elimination of seasonal workforce requirements", "Universal compatibility with legacy designs", "Complete reliance on passive geothermal ventilation"]
                        ans = [opts[0]]

                upsert_question(
                    grp=grp,
                    sort_order=i,
                    number=q_num,
                    type=q_type,
                    prompt=f"Reading question {q_num}: Complete the question based on the passage text.",
                    options=opts,
                    correct_answers=ans,
                    points=1,
                    word_limit=1 if q_type == "short_answer" else None,
                    answer_rule="ONE_WORD" if q_type == "short_answer" else None,
                    created_at=now
                )
                q_num += 1

        # 3. WRITING SECTION (Task 1.1, Task 1.2, Task 2)
        w_sec = upsert_section(
            skill="writing",
            title="Writing",
            sort_order=2,
            duration_minutes=60,
            instructions="The Writing section consists of Task 1 (Informal and Formal letters) and Task 2 (Publication essay). Total duration: 60 minutes."
        )
        shared_stimulus = "You are planning a weekend trip to Samarkand with your study group, but you need to inform your friend and also coordinate with the hotel manager regarding the reservation details."

        w_groups = [
            ("Task 1.1 — Informal Letter", 0, 5, "essay_task1", "writing-task-1", shared_stimulus, "Write an informal letter to your friend about the weekend trip. Explain the itinerary, meeting point, and what items to bring. Write at least 150 words.", 150),
            ("Task 1.2 — Formal Letter", 1, 5, "essay_task1", "writing-task-1", shared_stimulus, "Write a formal email to the hotel manager in Samarkand confirming group reservation dates, dietary preferences, and late check-in procedures. Write at least 150 words.", 150),
            ("Task 2 — Publication Essay", 2, 6, "essay_task2", None, None, "Some people believe that artificial intelligence will replace human educators, while others argue that empathetic mentorship is irreplaceable. Discuss both views and give your opinion. Write at least 250 words.", 250),
        ]

        for title, s_order, max_sc, q_type, s_ref, stim, prompt, w_limit in w_groups:
            grp = upsert_group(
                sec=w_sec,
                sort_order=s_order,
                title=title,
                max_score=max_sc,
                stimulus_ref=s_ref,
                passage_text=stim,
                created_at=now
            )
            upsert_question(
                grp=grp,
                sort_order=0,
                number=s_order + 1,
                type=q_type,
                prompt=prompt,
                points=max_sc,
                word_limit=w_limit,
                created_at=now
            )

        # 4. SPEAKING SECTION (Part 1.1, Part 1.2, Part 2, Part 3)
        s_sec = upsert_section(
            skill="speaking",
            title="Speaking",
            sort_order=3,
            duration_minutes=15,
            instructions="The Speaking section consists of 3 parts with prompt-driven automated scoring. Ensure your microphone is calibrated."
        )

        s_groups = [
            ("Part 1.1 — Personal Interview", 0, 5, [
                "Tell me about your hometown. What is the most attractive feature of the area where you live?",
                "How do you organize your study schedule when preparing for examinations?",
                "Do you prefer studying alone or in a study group with classmates? Why?"
            ]),
            ("Part 1.2 — Picture Comparison", 1, 5, [
                "Compare traditional library research with modern digital tablet learning. What are the key contrasts?",
                "Which learning style do you find more productive for long-term concentration, and why?",
                "In your opinion, will physical libraries remain relevant in the next two decades?"
            ]),
            ("Part 2 — Topic Monologue", 2, 5, [
                "Describe an ambitious project or skill you successfully completed. You should say what it was, why you undertook it, what challenges you faced, and how you felt once finished."
            ]),
            ("Part 3 — Discussion & Analysis", 3, 6, [
                "How does student motivation vary between intrinsic passion and external social rewards? What role should educational institutions play in nurturing curiosity?"
            ]),
        ]

        q_num = 1
        for title, s_order, max_sc, prompts in s_groups:
            grp = upsert_group(
                sec=s_sec,
                sort_order=s_order,
                title=title,
                max_score=max_sc,
                image_key="mock/cbt/speaking_p12_pictures.png" if s_order == 1 else None,
                created_at=now
            )
            for i, prompt in enumerate(prompts):
                upsert_question(
                    grp=grp,
                    sort_order=i,
                    number=q_num,
                    type="speaking_task",
                    prompt=prompt,
                    points=max_sc,
                    created_at=now
                )
                q_num += 1

        self.stdout.write(self.style.SUCCESS(f"Successfully seeded Multi-Level CBT Mock Exam '{exam.title}' ({exam.id}). Published=True, Demo=True, 4 Sections complete."))
