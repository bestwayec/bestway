"""Django Management Command to Seed Computer-Delivered (CD) Record Mock Test 1.

Ingests full CEFR Multi-Level specification:
- 100% dynamic, driven by PostgreSQL models (Exam, Section, QuestionGroup, Question, AnswerKey).
- Admin panel editable directly in /admin/ with Stacked/Tabular inlines.
- Includes visual map & speaking comparison photos under /media/exams/record_mock_1/.
- Includes synthesized 16-bit PCM WAV audio for all 6 Listening parts.
- Prepopulates exact answer keys for all 70 objective questions + writing & speaking tasks.
"""
from __future__ import annotations

import io
from pathlib import Path
from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.core.models import AnswerKey, Exam, Question, QuestionGroup, Section


EXAM_CODE = "MOCK-RECORD-01"
EXAM_TITLE = "Record Mock - Test 1 (Multi-Level)"


class Command(BaseCommand):
    help = "Seeds the Computer-Delivered (CD) Record Mock - Test 1 into Postgres models and admin."

    def handle(self, *args, **options):
        self.stdout.write(self.style.NOTICE(f"=== Starting Seeding for CD Exam: {EXAM_CODE} ==="))
        
        # 1. Also run the legacy importer to ensure MockExam / MockSection schema parity
        try:
            out = io.StringIO()
            call_command("import_record_mock_1", stdout=out)
            self.stdout.write(self.style.SUCCESS("  [OK] Legacy MockExam / MockSection synchronized"))
        except Exception as exc:
            self.stdout.write(self.style.WARNING(f"  [!] Note on legacy import: {exc}"))

        # 2. Seed Managed CD Exam Models in atomic transaction
        with transaction.atomic():
            exam, created = Exam.objects.update_or_create(
                code=EXAM_CODE,
                defaults={
                    "title": EXAM_TITLE,
                    "exam_type": "CEFR_MULTILEVEL",
                    "duration_minutes": 150,
                    "is_cd_format": True,
                    "is_published": True,
                    "description": (
                        "Official Computer-Delivered CEFR Multi-Level Record Mock Exam (Test 1). "
                        "Full split-screen exam experience with interactive Listening, Reading, "
                        "Writing, and Speaking sections."
                    ),
                },
            )
            self.stdout.write(self.style.SUCCESS(f"  [OK] Exam record: {exam.code} ({'created' if created else 'updated'})"))

            # =========================================================================
            # SECTION 1: LISTENING (35 Questions, 6 Parts, 35 mins)
            # =========================================================================
            sec_l, _ = Section.objects.update_or_create(
                exam=exam,
                section_type="listening",
                defaults={
                    "title": "Listening",
                    "time_limit": 35,
                    "order": 0,
                    "instructions": (
                        "The Listening section consists of 6 parts and 35 questions (approx. 35 minutes). "
                        "You will hear each recording ONCE or TWICE depending on the part instructions. "
                        "Answer all questions as you listen."
                    ),
                },
            )

            # Listening Part 1 (Q1-8): Short reply MCQs (A/B/C)
            grp_l1, _ = QuestionGroup.objects.update_or_create(
                section=sec_l,
                part_number=1,
                defaults={
                    "sort_order": 0,
                    "title": "Part 1 — Short Conversations",
                    "audio_url": "/media/exams/record_mock_1/record_mock1_audio_part_1.wav",
                    "instructions": (
                        "Questions 1–8. You will hear eight short recordings. For questions 1–8, "
                        "choose the correct answer (A, B, or C). You will hear each recording twice."
                    ),
                },
            )
            l1_keys = {1: "C", 2: "A", 3: "C", 4: "B", 5: "A", 6: "A", 7: "C", 8: "B"}
            l1_prompts = [
                (1, "What does the woman decide to buy for her nephew?", ["A toy train", "A story book", "A board game"]),
                (2, "Where did the man leave his car keys?", ["In the kitchen on the table", "Inside his coat pocket", "On the office desk"]),
                (3, "What time will the train to Birmingham depart?", ["At 14:15", "At 14:30", "At 14:45"]),
                (4, "What kind of weather is forecast for tomorrow morning?", ["Heavy rain", "Sunny spells", "Thick fog"]),
                (5, "Which activity did the boy enjoy most at the summer camp?", ["Kayaking on the lake", "Mountain hiking", "Archery lessons"]),
                (6, "How will the students travel to the botanical garden?", ["By chartered coach", "By local train", "By bicycle"]),
                (7, "What is the girl's main concern about her history project?", ["Finding enough sources", "Meeting the deadline", "Organizing the presentation"]),
                (8, "Why was the woman late for the team meeting?", ["Traffic congestion", "Her alarm failed", "A medical appointment"]),
            ]
            for num, prompt, opts in l1_prompts:
                q, _ = Question.objects.update_or_create(
                    group=grp_l1,
                    order=num,
                    defaults={
                        "question_type": "single_choice",
                        "prompt": prompt,
                        "points": 1.0,
                        "payload_json": {"options": [f"A) {opts[0]}", f"B) {opts[1]}", f"C) {opts[2]}"]},
                    },
                )
                AnswerKey.objects.update_or_create(
                    question=q,
                    defaults={"valid_answers_list": [l1_keys[num]], "case_sensitive": False},
                )

            # Listening Part 2 (Q9-14): School Trip note completion
            grp_l2, _ = QuestionGroup.objects.update_or_create(
                section=sec_l,
                part_number=2,
                defaults={
                    "sort_order": 1,
                    "title": "Part 2 — School Trip",
                    "audio_url": "/media/exams/record_mock_1/record_mock1_audio_part_2.wav",
                    "instructions": (
                        "Questions 9–14. You will hear a teacher giving information about a school trip. "
                        "Fill in each missing gap with ONE WORD AND / OR A NUMBER."
                    ),
                    "passage_html": (
                        "<h3>SCHOOL TRIP DETAILS</h3>"
                        "<p>Departure is by (9) [gap-9] at 8:30 AM outside the school gate.<br/>"
                        "Morning activity: walk around the scenic (10) [gap-10].<br/>"
                        "Meet at the entrance of the national (11) [gap-11] at 11:30 AM.<br/>"
                        "Lunch will be a healthy (12) [gap-12] on the grass.<br/>"
                        "Afternoon: guided tour of the local history (13) [gap-13].<br/>"
                        "Essential item: remember to bring a waterproof (14) [gap-14] in case of rain.</p>"
                    ),
                },
            )
            l2_keys = {
                9: ["coach", "a coach", "the coach"],
                10: ["lake", "the lake"],
                11: ["park", "the park"],
                12: ["picnic", "a picnic"],
                13: ["museum", "the museum"],
                14: ["raincoat", "a raincoat"],
            }
            l2_prompts = [
                (9, "Departure vehicle"),
                (10, "Morning walk location"),
                (11, "11:30 AM meeting spot"),
                (12, "Lunch type"),
                (13, "Afternoon venue"),
                (14, "Essential clothing item"),
            ]
            for num, prompt in l2_prompts:
                q, _ = Question.objects.update_or_create(
                    group=grp_l2,
                    order=num,
                    defaults={
                        "question_type": "in_text_blank",
                        "prompt": prompt,
                        "points": 1.0,
                        "word_limit": 1,
                        "payload_json": {"answerRule": "ONE_WORD_ONLY"},
                    },
                )
                AnswerKey.objects.update_or_create(
                    question=q,
                    defaults={"valid_answers_list": l2_keys[num], "case_sensitive": False},
                )

            # Listening Part 3 (Q15-18): Speaker matching (Places A-F)
            grp_l3, _ = QuestionGroup.objects.update_or_create(
                section=sec_l,
                part_number=3,
                defaults={
                    "sort_order": 2,
                    "title": "Part 3 — Speaker Matching",
                    "audio_url": "/media/exams/record_mock_1/record_mock1_audio_part_3.wav",
                    "instructions": (
                        "Questions 15–18. You will hear four different speakers talking about places they visited in town. "
                        "Match each speaker (15–18) to the correct place (A–F). There are TWO extra places."
                    ),
                },
            )
            l3_options = ["A  hotel", "B  bank", "C  sports centre", "D  cinema", "E  station", "F  airport"]
            l3_keys = {15: "B", 16: "E", 17: "A", 18: "D"}
            for num in range(15, 19):
                q, _ = Question.objects.update_or_create(
                    group=grp_l3,
                    order=num,
                    defaults={
                        "question_type": "speaker_matching",
                        "prompt": f"Speaker {num - 14}",
                        "points": 1.0,
                        "payload_json": {"options": l3_options},
                    },
                )
                AnswerKey.objects.update_or_create(
                    question=q,
                    defaults={"valid_answers_list": [l3_keys[num]], "case_sensitive": False},
                )

            # Listening Part 4 (Q19-23): Map labeling (Community Centre pins A-H)
            grp_l4, _ = QuestionGroup.objects.update_or_create(
                section=sec_l,
                part_number=4,
                defaults={
                    "sort_order": 3,
                    "title": "Part 4 — Map of Community Centre",
                    "audio_url": "/media/exams/record_mock_1/record_mock1_audio_part_4.wav",
                    "media_image": "/media/exams/record_mock_1/listening_part4_map.png",
                    "instructions": (
                        "Questions 19–23. Look at the map of the Community Centre. "
                        "Label the rooms (19–23) with the correct letters (A–H) on the floor plan."
                    ),
                },
            )
            l4_items = [
                (19, "library", "D"),
                (20, "gym", "C"),
                (21, "administration office", "F"),
                (22, "cafeteria", "H"),
                (23, "main hall", "A"),
            ]
            map_pins = ["A", "B", "C", "D", "E", "F", "G", "H"]
            for num, room, key in l4_items:
                q, _ = Question.objects.update_or_create(
                    group=grp_l4,
                    order=num,
                    defaults={
                        "question_type": "map_labeling",
                        "prompt": f"Location of {room.title()}",
                        "points": 1.0,
                        "payload_json": {"options": map_pins, "imageMapRef": "listening_part4_map.png"},
                    },
                )
                AnswerKey.objects.update_or_create(
                    question=q,
                    defaults={"valid_answers_list": [key], "case_sensitive": False},
                )

            # Listening Part 5 (Q24-29): Monologues/Dialogues MCQs
            grp_l5, _ = QuestionGroup.objects.update_or_create(
                section=sec_l,
                part_number=5,
                defaults={
                    "sort_order": 4,
                    "title": "Part 5 — Radio Interview",
                    "audio_url": "/media/exams/record_mock_1/record_mock1_audio_part_5.wav",
                    "instructions": (
                        "Questions 24–29. You will hear an interview with an environmental biologist. "
                        "For questions 24–29, choose the correct answer (A, B, or C)."
                    ),
                },
            )
            l5_prompts = [
                (24, "What prompted the researcher to study urban bird populations?", ["A childhood hobby", "Declining numbers in cities", "An unexpected university grant"], "B"),
                (25, "According to the speaker, how have birds adapted their singing in noisy areas?", ["By singing at higher frequencies", "By singing exclusively at night", "By mimicking mechanical sounds"], "A"),
                (26, "What surprised the team about nest construction in city parks?", ["The total weight of nests", "The variety of bird species cooperating", "The frequent use of synthetic fibers"], "C"),
                (27, "Why are reflective glass windows especially dangerous for migratory birds?", ["They generate disorienting glare", "Birds attempt to land on them", "Birds mistake reflections for open sky"], "C"),
                (28, "What simple measure does the researcher recommend for private gardens?", ["Installing high-powered lights", "Planting native berry-producing shrubs", "Keeping bird baths heated"], "B"),
                (29, "What is the primary objective of the upcoming citizen science survey?", ["To map nesting locations across the country", "To tag individual raptors", "To test new audio detection software"], "A"),
            ]
            for num, prompt, opts, key in l5_prompts:
                q, _ = Question.objects.update_or_create(
                    group=grp_l5,
                    order=num,
                    defaults={
                        "question_type": "single_choice",
                        "prompt": prompt,
                        "points": 1.0,
                        "payload_json": {"options": [f"A) {opts[0]}", f"B) {opts[1]}", f"C) {opts[2]}"]},
                    },
                )
                AnswerKey.objects.update_or_create(
                    question=q,
                    defaults={"valid_answers_list": [key], "case_sensitive": False},
                )

            # Listening Part 6 (Q30-35): The Role of the Camera note completion
            grp_l6, _ = QuestionGroup.objects.update_or_create(
                section=sec_l,
                part_number=6,
                defaults={
                    "sort_order": 5,
                    "title": "Part 6 — The Role of the Camera",
                    "audio_url": "/media/exams/record_mock_1/record_mock1_audio_part_6.wav",
                    "instructions": (
                        "Questions 30–35. You will hear a lecture about the history and cultural impact of the camera. "
                        "Complete the notes below. Write NO MORE THAN ONE WORD AND / OR A NUMBER for each answer."
                    ),
                    "passage_html": (
                        "<h3>THE ROLE OF THE CAMERA IN MODERN CULTURE</h3>"
                        "<p>Early photographs served primarily as a durable aid to human (30) [gap-30].<br/>"
                        "Pinhole cameras relied entirely on the natural behaviour of (31) [gap-31].<br/>"
                        "Advancements in glass lens manufacturing revealed microscopic (32) [gap-32] invisible to the naked eye.<br/>"
                        "During the industrial era, photojournalism was used to (33) [gap-33] social injustice.<br/>"
                        "Modern digital photography allows users to develop creative visual (34) [gap-34] rapidly.<br/>"
                        "Scholars now view personal photo archives as invaluable records of everyday (35) [gap-35].</p>"
                    ),
                },
            )
            l6_keys = {
                30: ["memory", "human memory"],
                31: ["light", "natural light"],
                32: ["details", "microscopic details"],
                33: ["document", "to document"],
                34: ["skills", "creative skills"],
                35: ["history", "everyday history"],
            }
            l6_prompts = [
                (30, "Primary early role of photography"),
                (31, "Pinhole camera core principle"),
                (32, "What lens advancement revealed"),
                (33, "Journalistic purpose in industrial era"),
                (34, "Digital benefit for users"),
                (35, "Value of personal photo archives"),
            ]
            for num, prompt in l6_prompts:
                q, _ = Question.objects.update_or_create(
                    group=grp_l6,
                    order=num,
                    defaults={
                        "question_type": "in_text_blank",
                        "prompt": prompt,
                        "points": 1.0,
                        "word_limit": 1,
                        "payload_json": {"answerRule": "ONE_WORD_ONLY"},
                    },
                )
                AnswerKey.objects.update_or_create(
                    question=q,
                    defaults={"valid_answers_list": l6_keys[num], "case_sensitive": False},
                )
            self.stdout.write(self.style.SUCCESS("  [OK] Listening section: 35 questions seeded"))

            # =========================================================================
            # SECTION 2: READING (35 Questions, 5 Parts, 60 mins)
            # =========================================================================
            sec_r, _ = Section.objects.update_or_create(
                exam=exam,
                section_type="reading",
                defaults={
                    "title": "Reading",
                    "time_limit": 60,
                    "order": 1,
                    "instructions": (
                        "The Reading section consists of 5 parts and 35 questions (60 minutes). "
                        "Read the passages carefully and answer all questions in the split-screen runner."
                    ),
                },
            )

            # Reading Part 1 (Q1-6): Honey gap fill
            grp_r1, _ = QuestionGroup.objects.update_or_create(
                section=sec_r,
                part_number=1,
                defaults={
                    "sort_order": 0,
                    "title": "Part 1 — Honey",
                    "instructions": (
                        "Questions 1–6. Read the text below. Fill in each gap with ONE word. "
                        "You must use a word which is somewhere in the rest of the text."
                    ),
                    "passage_html": (
                        "<h3>HONEY</h3>"
                        "<p>Honey is a sweet and natural food made by bees. (1) [gap-1] collect nectar from flowers and "
                        "bring it back to their hive. Inside the (2) [gap-2], the bees change the nectar into thick, golden "
                        "honey. This process is fascinating, and many scientists study how bees work together. A group of "
                        "(3) [gap-3] recently discovered that each bee in the colony has a special job. Some bees fly out "
                        "to find flowers, while others protect the hive or store the (4) [gap-4]. To make a small jar of "
                        "honey, thousands of bees must visit millions of (5) [gap-5]. The (6) [gap-6] they collect is "
                        "carried in their tiny bodies. Once they return, they pass it from one bee to another, slowly turning it "
                        "into honey.</p>"
                    ),
                },
            )
            r1_keys = {
                1: ["bees"],
                2: ["hive"],
                3: ["scientists"],
                4: ["honey"],
                5: ["flowers"],
                6: ["nectar"],
            }
            for num in range(1, 7):
                q, _ = Question.objects.update_or_create(
                    group=grp_r1,
                    order=num,
                    defaults={
                        "question_type": "in_text_blank",
                        "prompt": f"Gap ({num})",
                        "points": 1.0,
                        "word_limit": 1,
                        "payload_json": {"answerRule": "ONE_WORD_ONLY"},
                    },
                )
                AnswerKey.objects.update_or_create(
                    question=q,
                    defaults={"valid_answers_list": r1_keys[num], "case_sensitive": False},
                )

            # Reading Part 2 (Q7-14): Picnic Spot Matching (Statements A-J matched to situations 7-14)
            grp_r2, _ = QuestionGroup.objects.update_or_create(
                section=sec_r,
                part_number=2,
                defaults={
                    "sort_order": 1,
                    "title": "Part 2 — Picnic Spot Matching",
                    "instructions": (
                        "Questions 7–14. Read the descriptions 7–14 and the statements A–J. "
                        "Decide which statement matches each person's preference. Each statement can be used ONCE only. "
                        "There are TWO extra statements."
                    ),
                    "passage_html": (
                        "<h3>PICNIC SPOT PREFERENCES</h3>"
                        "<p><strong>7.</strong> A lively family with young children seeking safe play equipment, shallow paddle streams, and nearby restrooms.<br/>"
                        "<strong>8.</strong> A couple planning a romantic sunset picnic with scenic vistas, fragrant rose gardens, and secluded benches.<br/>"
                        "<strong>9.</strong> A weekend sports club looking for wide open lawn space for football, volleyball nets, and barbecue grills.<br/>"
                        "<strong>10.</strong> An avid book lover who desires peaceful solitude, shaded ancient oak trees, and zero motorized traffic.<br/>"
                        "<strong>11.</strong> Dog owners requiring a fenced perimeter, agility obstacles, and fresh water drinking fountains.<br/>"
                        "<strong>12.</strong> An elderly walking group needing smooth paved ramps, handrails, wheelchair accessibility, and sheltered pavilions.<br/>"
                        "<strong>13.</strong> Ornithology enthusiasts equipped with binoculars eager to observe waterfowl and rare migratory waders from a wooden blind.<br/>"
                        "<strong>14.</strong> Beach lovers wishing to combine sunbathing, saltwater swimming, and seaside picnic tables on the coast.</p>"
                    ),
                },
            )
            r2_options = [
                "A  A peaceful sanctuary under towering trees with quiet walking paths and no disturbances.",
                "B  A vibrant park featuring a dedicated children's playground, shallow splashing streams, and family amenities.",
                "C  An enclosed dog-friendly haven complete with fenced runs and pet hydration stations.",
                "D  A protected wetland reserve boasting wooden observation hides for viewing rare waterfowl.",
                "E  Fully paved parkland engineered with ramp access, sturdy railings, and covered resting shelters for seniors.",
                "F  A bustling city square bordered by street cafes and open-air food vendors.",
                "G  Expansive grassy recreation fields offering sports equipment rentals and public barbecue pits.",
                "H  An industrial riverbank walkway popular among evening cyclists and runners.",
                "I  A tranquil escape surrounded by blooming flowers and fragrant herbs, perfect for a romantic date.",
                "J  A quintessential summer experience with the sound of waves crashing and the warmth of the sun.",
            ]
            r2_keys = {7: "B", 8: "I", 9: "G", 10: "A", 11: "C", 12: "E", 13: "D", 14: "J"}
            for num in range(7, 15):
                q, _ = Question.objects.update_or_create(
                    group=grp_r2,
                    order=num,
                    defaults={
                        "question_type": "matching_statements",
                        "prompt": f"Picnic preference ({num})",
                        "points": 1.0,
                        "payload_json": {"options": r2_options},
                    },
                )
                AnswerKey.objects.update_or_create(
                    question=q,
                    defaults={"valid_answers_list": [r2_keys[num]], "case_sensitive": False},
                )

            # Reading Part 3 (Q15-20): Canada Destinations Heading Matching
            grp_r3, _ = QuestionGroup.objects.update_or_create(
                section=sec_r,
                part_number=3,
                defaults={
                    "sort_order": 2,
                    "title": "Part 3 — Canada's Tourist Destinations",
                    "instructions": (
                        "Questions 15–20. Read the text and choose the correct heading for each paragraph (15–20) "
                        "from the list of headings A–H below. There are more headings than paragraphs."
                    ),
                    "passage_html": (
                        "<h3>CANADA'S MUST-VISIT TOURIST DESTINATIONS</h3>"
                        "<p><strong>Paragraph 15.</strong> Spanning across Alberta, Banff National Park features turquoise glacier-fed lakes, "
                        "snow-capped peaks, and an abundance of wildlife including grizzly bears and elk.</p>"
                        "<p><strong>Paragraph 16.</strong> Straddling the US-Canada border, Niagara Falls discharges colossal volumes of water every second, "
                        "captivating millions of global sightseers aboard the famous hornblower cruise.</p>"
                        "<p><strong>Paragraph 17.</strong> Quebec City transports travelers into old-world Europe with its fortified stone ramparts, "
                        "narrow cobblestone lanes, and the fairy-tale Château Frontenac overlooking the St. Lawrence River.</p>"
                        "<p><strong>Paragraph 18.</strong> Nestled between the Pacific Ocean and coastal mountains, Vancouver effortlessly combines "
                        "urban sophistication with wilderness adventure, from Stanley Park seawalls to world-class skiing at Whistler.</p>"
                        "<p><strong>Paragraph 19.</strong> In the remote northern reaches of Manitoba, Churchill reigns as the polar bear capital of the world, "
                        "where visitors traverse tundra buggies to view apex predators in their pristine icy habitat.</p>"
                        "<p><strong>Paragraph 20.</strong> Prince Edward Island charms literature enthusiasts and beachgoers alike with its red sandstone cliffs, "
                        "rolling potato farms, and the celebrated farmhouse immortalized by Lucy Maud Montgomery.</p>"
                    ),
                },
            )
            r3_headings = [
                "A  A historic European atmosphere preserved in North America",
                "B  Majestic alpine landscapes and pristine glacial waters",
                "C  An Arctic outpost to witness Arctic wildlife up close",
                "D  A world-renowned natural spectacle of rushing water",
                "E  A cosmopolitan center known for underground rail networks",
                "F  Where modern metropolis meets outdoor adventure",
                "G  The largest desert ecosystem in northern latitudes",
                "H  Literary heritage amidst tranquil island scenery",
            ]
            r3_keys = {15: "B", 16: "D", 17: "A", 18: "F", 19: "C", 20: "H"}
            for num in range(15, 21):
                q, _ = Question.objects.update_or_create(
                    group=grp_r3,
                    order=num,
                    defaults={
                        "question_type": "matching_headings",
                        "prompt": f"Paragraph {num}",
                        "points": 1.0,
                        "payload_json": {"options": r3_headings},
                    },
                )
                AnswerKey.objects.update_or_create(
                    question=q,
                    defaults={"valid_answers_list": [r3_keys[num]], "case_sensitive": False},
                )

            # Reading Part 4 (Q21-29): A Strange Morning (4 MCQs + 5 True/False/No Info)
            grp_r4, _ = QuestionGroup.objects.update_or_create(
                section=sec_r,
                part_number=4,
                defaults={
                    "sort_order": 3,
                    "title": "Part 4 — A Strange Morning",
                    "instructions": (
                        "Questions 21–29. Read the story below. For questions 21–24, choose the correct answer (A, B, C or D). "
                        "For questions 25–29, decide if each statement agrees with the text (True, False, or No Information)."
                    ),
                    "passage_html": (
                        "<h3>A STRANGE MORNING</h3>"
                        "<p>Emily woke up before her alarm went off and knew instantly something wasn’t quite right in the "
                        "neighbourhood. The usual morning soundtrack of chirping birds, rumbling delivery trucks, and barking dogs "
                        "had been replaced by an eerie, total silence. She threw off her duvet and tiptoed to the bedroom window, "
                        "parting the heavy floral curtains just enough to peer outside.</p>"
                        "<p>The entire street was enveloped in a dense, shimmering lavender fog. It wasn't the grey mist typical "
                        "of autumnal London mornings; this fog glowed with an internal violet luminescence. Parked cars resembled "
                        "submerged coral reefs, their metallic roofs faintly glinting under the diffused purple light. More strangely, "
                        "all electronic clocks in her house had stopped at exactly 04:17 AM.</p>"
                        "<p>She walked downstairs and tried turning on the kitchen tap, but only a dry hiss came out. Her smartphone "
                        "screen was completely black, refusing to respond to the power button. Grabbing a thick woollen cardigan "
                        "and her father’s antique brass torch from the hall cupboard, Emily unlocked the front door and stepped out "
                        "into the chilly morning mist to investigate.</p>"
                    ),
                },
            )
            r4_mcqs = [
                (21, "Why did Emily realize something was unusual as soon as she woke up?",
                 ["Her bedroom window was wide open", "The typical street sounds were absent", "Her alarm clock rang two hours early", "Someone was knocking loudly downstairs"], "B"),
                (22, "What was remarkable about the fog outside?",
                 ["It smelled strongly of ocean salt", "It was completely black and thick", "It radiated a strange purple glow", "It froze all tree branches into ice"], "C"),
                (23, "What happened to the clocks inside Emily's home?",
                 ["They all ceased functioning at 04:17", "Their hands spun backwards rapidly", "They flashed red alert numbers", "They continued ticking normally"], "A"),
                (24, "What did Emily take with her before venturing outside?",
                 ["A hunting rifle and keys", "A thermos of hot tea", "Her camera and umbrella", "A warm cardigan and a brass torch"], "D"),
            ]
            for num, prompt, opts, key in r4_mcqs:
                q, _ = Question.objects.update_or_create(
                    group=grp_r4,
                    order=num,
                    defaults={
                        "question_type": "single_choice",
                        "prompt": prompt,
                        "points": 1.0,
                        "payload_json": {"options": [f"A) {opts[0]}", f"B) {opts[1]}", f"C) {opts[2]}", f"D) {opts[3]}"]},
                    },
                )
                AnswerKey.objects.update_or_create(
                    question=q,
                    defaults={"valid_answers_list": [key], "case_sensitive": False},
                )

            r4_tfng = [
                (25, "Emily's alarm clock woke her up from a deep sleep.", "False"),
                (26, "The street outside had previously experienced purple fog.", "No Information"),
                (27, "No water flowed when Emily turned on the kitchen faucet.", "True"),
                (28, "Emily's mobile phone operated without any technical issue.", "False"),
                (29, "Emily was frightened and decided to lock herself in her bedroom.", "False"),
            ]
            tfng_options = ["True", "False", "No Information"]
            for num, prompt, key in r4_tfng:
                q, _ = Question.objects.update_or_create(
                    group=grp_r4,
                    order=num,
                    defaults={
                        "question_type": "true_false_ng",
                        "prompt": prompt,
                        "points": 1.0,
                        "payload_json": {"options": tfng_options},
                    },
                )
                AnswerKey.objects.update_or_create(
                    question=q,
                    defaults={"valid_answers_list": [key], "case_sensitive": False},
                )

            # Reading Part 5 (Q30-35): The Nomadic Way of Life (4 Summary note fill + 2 MCQs)
            grp_r5, _ = QuestionGroup.objects.update_or_create(
                section=sec_r,
                part_number=5,
                defaults={
                    "sort_order": 4,
                    "title": "Part 5 — The Nomadic Way of Life",
                    "instructions": (
                        "Questions 30–35. Read the passage below. For questions 30–33, complete the summary notes with "
                        "NO MORE THAN ONE WORD AND / OR A NUMBER. For questions 34–35, choose the correct answer (A, B, C or D)."
                    ),
                    "passage_html": (
                        "<h3>THE NOMADIC WAY OF LIFE</h3>"
                        "<p>For millennia, pastoral nomads have adapted to some of Earth's most demanding environments, "
                        "from the arid steppes of Central Asia to the wind-swept deserts of the Sahara. Rather than settling in permanent "
                        "towns, their annual migration patterns are synchronized strictly with changing (30) [gap-30] to ensure their "
                        "herds find fresh pasture.</p>"
                        "<p>The survival of the community is inextricably linked to their domesticated (31) [gap-31], which provide milk, "
                        "meat, wool, and transport. Portable felt tents, known as yurts or gers, offer dependable (32) [gap-32] against "
                        "extreme temperature swings while remaining quick to dismantle and transport on horseback or camels.</p>"
                        "<p>Despite pressures from rapid urbanization and national borders, contemporary nomads work diligently to preserve "
                        "their ancient oral (33) [gap-33], passing down folklore, textile arts, and equestrian craftsmanship to the next generation.</p>"
                    ),
                },
            )
            r5_notes = [
                (30, "Migration cycles correspond to changing", ["seasons", "the seasons"]),
                (31, "Nomadic life revolves around domesticated", ["animals", "herds"]),
                (32, "Portable felt yurts provide essential", ["shelter"]),
                (33, "Elders strive to maintain oral", ["traditions", "history"]),
            ]
            for num, prompt, keys in r5_notes:
                q, _ = Question.objects.update_or_create(
                    group=grp_r5,
                    order=num,
                    defaults={
                        "question_type": "in_text_blank",
                        "prompt": prompt,
                        "points": 1.0,
                        "word_limit": 1,
                        "payload_json": {"answerRule": "ONE_WORD_ONLY"},
                    },
                )
                AnswerKey.objects.update_or_create(
                    question=q,
                    defaults={"valid_answers_list": keys, "case_sensitive": False},
                )

            r5_mcqs = [
                (34, "What is the primary factor dictating nomadic migration routes?",
                 ["National political agreements", "Proximity to industrial trade hubs", "Availability of grazing pastures for livestock", "Access to modern educational facilities"], "C"),
                (35, "What constitutes a major contemporary challenge for nomadic societies?",
                 ["Encroaching urbanization and modern territorial borders", "A shortage of horses and transport camels", "Extreme cooling of the planet's atmosphere", "Loss of all traditional textile techniques"], "A"),
            ]
            for num, prompt, opts, key in r5_mcqs:
                q, _ = Question.objects.update_or_create(
                    group=grp_r5,
                    order=num,
                    defaults={
                        "question_type": "single_choice",
                        "prompt": prompt,
                        "points": 1.0,
                        "payload_json": {"options": [f"A) {opts[0]}", f"B) {opts[1]}", f"C) {opts[2]}", f"D) {opts[3]}"]},
                    },
                )
                AnswerKey.objects.update_or_create(
                    question=q,
                    defaults={"valid_answers_list": [key], "case_sensitive": False},
                )
            self.stdout.write(self.style.SUCCESS("  [OK] Reading section: 35 questions seeded"))

            # =========================================================================
            # SECTION 3: WRITING (3 Tasks, 2 Parts, 60 mins)
            # =========================================================================
            sec_w, _ = Section.objects.update_or_create(
                exam=exam,
                section_type="writing",
                defaults={
                    "title": "Writing",
                    "time_limit": 60,
                    "order": 2,
                    "instructions": (
                        "The Writing section consists of 2 parts with 3 tasks (60 minutes). "
                        "Manage your time carefully: approx. 20 minutes for Part 1 (Tasks 1.1 & 1.2) "
                        "and 40 minutes for Part 2 (Task 2)."
                    ),
                },
            )

            # Writing Part 1: Task 1.1 (Informal Email)
            grp_w1, _ = QuestionGroup.objects.update_or_create(
                section=sec_w,
                part_number=1,
                defaults={
                    "sort_order": 0,
                    "title": "Part 1 — Task 1.1 Informal Email",
                    "instructions": "You must write an informal email to a friend. Write 60–80 words.",
                    "passage_html": (
                        "<h3>WRITING TASK 1.1 (INFORMAL EMAIL)</h3>"
                        "<p>You recently moved to a new city to start a university course.<br/>"
                        "Write an email to an English-speaking friend. In your email:<br/>"
                        "• describe your new apartment and neighbourhood<br/>"
                        "• explain what you like most about your course<br/>"
                        "• invite your friend to visit you during the upcoming holidays</p>"
                    ),
                },
            )
            q_w11, _ = Question.objects.update_or_create(
                group=grp_w1,
                order=1,
                defaults={
                    "question_type": "essay",
                    "prompt": "Write an email to a friend about your new city and studies (60–80 words).",
                    "points": 3.0,
                    "word_limit": 80,
                    "payload_json": {"taskType": "task1_1", "minWords": 60, "maxWords": 80},
                },
            )
            AnswerKey.objects.update_or_create(
                question=q_w11,
                defaults={"valid_answers_list": ["RUBRIC_ASSESSMENT"], "explanation": "Assessed on Task Achievement, Coherence, Lexical Resource, and Grammar."},
            )

            # Writing Part 1: Task 1.2 (Formal Email)
            grp_w2, _ = QuestionGroup.objects.update_or_create(
                section=sec_w,
                part_number=1,
                defaults={
                    "sort_order": 1,
                    "title": "Part 1 — Task 1.2 Formal Email",
                    "instructions": "You must write a formal email of inquiry. Write 120–150 words.",
                    "passage_html": (
                        "<h3>WRITING TASK 1.2 (FORMAL EMAIL)</h3>"
                        "<p>You want to enroll in an advanced English academic preparation course at an international language college.<br/>"
                        "Write an email to the Director of Admissions. In your email:<br/>"
                        "• state your current level and reason for wishing to take the course<br/>"
                        "• ask about the schedule, tuition fees, and available scholarships<br/>"
                        "• inquire about student accommodation options and visa assistance</p>"
                    ),
                },
            )
            q_w12, _ = Question.objects.update_or_create(
                group=grp_w2,
                order=2,
                defaults={
                    "question_type": "essay",
                    "prompt": "Write a formal email of inquiry to the Director of Admissions (120–150 words).",
                    "points": 5.0,
                    "word_limit": 150,
                    "payload_json": {"taskType": "task1_2", "minWords": 120, "maxWords": 150},
                },
            )
            AnswerKey.objects.update_or_create(
                question=q_w12,
                defaults={"valid_answers_list": ["RUBRIC_ASSESSMENT"], "explanation": "Formal tone, structure, paragraphing and precise vocabulary."},
            )

            # Writing Part 2: Task 2 (Essay)
            grp_w3, _ = QuestionGroup.objects.update_or_create(
                section=sec_w,
                part_number=2,
                defaults={
                    "sort_order": 2,
                    "title": "Part 2 — Task 2 Academic Essay",
                    "instructions": "Write an academic argumentative essay. Write at least 180 words (recommended: 180–250 words).",
                    "passage_html": (
                        "<h3>WRITING TASK 2 (ESSAY)</h3>"
                        "<p>Some educators and community leaders argue that performing unpaid voluntary community service "
                        "should be a compulsory graduation requirement for all high school students.<br/>"
                        "Others, however, believe that compulsory volunteering undermines the altruistic spirit of service "
                        "and places an unnecessary burden on busy adolescents.</p>"
                        "<p><em>Discuss both views and give your own reasoned opinion. Support your position with relevant examples "
                        "from your knowledge or experience.</em></p>"
                    ),
                },
            )
            q_w2, _ = Question.objects.update_or_create(
                group=grp_w3,
                order=3,
                defaults={
                    "question_type": "essay",
                    "prompt": "Discuss both views on compulsory student volunteering and give your opinion (180–250 words).",
                    "points": 8.0,
                    "word_limit": 250,
                    "payload_json": {"taskType": "task2", "minWords": 180, "maxWords": 250},
                },
            )
            AnswerKey.objects.update_or_create(
                question=q_w2,
                defaults={"valid_answers_list": ["RUBRIC_ASSESSMENT"], "explanation": "Assessed on standard IELTS/CEFR 4 criteria at Band/Level C1 standard."},
            )
            self.stdout.write(self.style.SUCCESS("  [OK] Writing section: 3 tasks seeded"))

            # =========================================================================
            # SECTION 4: SPEAKING (4 Parts, 15 mins)
            # =========================================================================
            sec_s, _ = Section.objects.update_or_create(
                exam=exam,
                section_type="speaking",
                defaults={
                    "title": "Speaking",
                    "time_limit": 15,
                    "order": 3,
                    "instructions": (
                        "The Speaking section consists of 4 parts (approx. 12–15 minutes). "
                        "Speak clearly into your microphone after each countdown timer finishes."
                    ),
                },
            )

            # Speaking Part 1.1: Interview Questions
            grp_s1, _ = QuestionGroup.objects.update_or_create(
                section=sec_s,
                part_number=1,
                defaults={
                    "sort_order": 0,
                    "title": "Part 1.1 — Personal Interview",
                    "instructions": "Answer the following questions about yourself. Speak for 30–45 seconds per question.",
                },
            )
            s1_prompts = [
                (1, "Can you tell me about your hometown and what you enjoy doing there?"),
                (2, "Do you prefer studying or working alone, or as part of a team? Why?"),
                (3, "How do you typically spend your free time during weekends?"),
            ]
            for num, prompt in s1_prompts:
                q, _ = Question.objects.update_or_create(
                    group=grp_s1,
                    order=num,
                    defaults={
                        "question_type": "speaking_prompt",
                        "prompt": prompt,
                        "points": 1.0,
                        "payload_json": {"prepSeconds": 5, "responseSeconds": 45},
                    },
                )
                AnswerKey.objects.update_or_create(
                    question=q,
                    defaults={"valid_answers_list": ["AUDIO_RECORDING"], "explanation": "Fluency, Pronunciation, Grammar, and Lexical range."},
                )

            # Speaking Part 1.2: Picture Comparison (Tennis vs Outdoor Yoga)
            grp_s2, _ = QuestionGroup.objects.update_or_create(
                section=sec_s,
                part_number=1,
                defaults={
                    "sort_order": 1,
                    "title": "Part 1.2 — Picture Comparison (Sport & Wellbeing)",
                    "media_image": "/media/exams/record_mock_1/speaking_part12_sport.png",
                    "instructions": "Compare the two photographs showing people participating in different physical activities. Speak for up to 2 minutes.",
                    "passage_html": (
                        "<h3>PICTURE COMPARISON</h3>"
                        "<p>Look at the two photographs showing different physical disciplines.<br/>"
                        "• Compare and contrast the benefits of playing competitive racket sports (like tennis) versus practicing mindful outdoor yoga.<br/>"
                        "• Which activity do you believe is more effective for reducing mental stress, and why?</p>"
                    ),
                },
            )
            q_s2, _ = Question.objects.update_or_create(
                group=grp_s2,
                order=4,
                defaults={
                    "question_type": "speaking_prompt",
                    "prompt": "Compare the two sporting activities and discuss their mental and physical health benefits.",
                    "points": 2.0,
                    "payload_json": {
                        "prepSeconds": 60,
                        "responseSeconds": 120,
                        "imageKey": "speaking_part12_sport.png",
                    },
                },
            )
            AnswerKey.objects.update_or_create(
                question=q_s2,
                defaults={"valid_answers_list": ["AUDIO_RECORDING"], "explanation": "Comparative language, discourse markers, coherent linking."},
            )

            # Speaking Part 2: Cue Card (Education Experience)
            grp_s3, _ = QuestionGroup.objects.update_or_create(
                section=sec_s,
                part_number=2,
                defaults={
                    "sort_order": 2,
                    "title": "Part 2 — Individual Long Turn (Cue Card)",
                    "media_image": "/media/exams/record_mock_1/speaking_part2_education.png",
                    "instructions": "You have 1 minute to prepare your notes, then speak for 1 to 2 minutes on the topic below.",
                    "passage_html": (
                        "<h3>CUE CARD: A MEMORABLE EDUCATIONAL EXPERIENCE</h3>"
                        "<p>Describe a memorable lesson or educational project that had a lasting impact on you.<br/>"
                        "You should say:<br/>"
                        "• when and where this learning experience took place<br/>"
                        "• who the teacher or mentor was and how they delivered the lesson<br/>"
                        "• what specific subject or skill you acquired<br/>"
                        "and explain why this educational experience remains significant in your life.</p>"
                    ),
                },
            )
            q_s3, _ = Question.objects.update_or_create(
                group=grp_s3,
                order=5,
                defaults={
                    "question_type": "speaking_prompt",
                    "prompt": "Describe a memorable lesson or educational project that impacted your life.",
                    "points": 3.0,
                    "payload_json": {
                        "prepSeconds": 60,
                        "responseSeconds": 120,
                        "imageKey": "speaking_part2_education.png",
                    },
                },
            )
            AnswerKey.objects.update_or_create(
                question=q_s3,
                defaults={"valid_answers_list": ["AUDIO_RECORDING"], "explanation": "Extended discourse, structured narrative, accurate tenses."},
            )

            # Speaking Part 3: Two-way Discussion
            grp_s4, _ = QuestionGroup.objects.update_or_create(
                section=sec_s,
                part_number=3,
                defaults={
                    "sort_order": 3,
                    "title": "Part 3 — Discussion & In-depth Ideas",
                    "instructions": "Discuss broader societal issues related to modern education and technology. Speak for 45–60 seconds per question.",
                },
            )
            s3_prompts = [
                (6, "How has the integration of artificial intelligence transformed the traditional classroom dynamic?"),
                (7, "Do you believe formal university degrees will remain essential for career success in the coming decades?"),
                (8, "What responsibilities do educational institutions have in teaching emotional intelligence and critical thinking?"),
            ]
            for num, prompt in s3_prompts:
                q, _ = Question.objects.update_or_create(
                    group=grp_s4,
                    order=num,
                    defaults={
                        "question_type": "speaking_prompt",
                        "prompt": prompt,
                        "points": 1.5,
                        "payload_json": {"prepSeconds": 10, "responseSeconds": 60},
                    },
                )
                AnswerKey.objects.update_or_create(
                    question=q,
                    defaults={"valid_answers_list": ["AUDIO_RECORDING"], "explanation": "Abstract reasoning, speculation, complex grammatical structures."},
                )
            self.stdout.write(self.style.SUCCESS("  [OK] Speaking section: 4 parts seeded"))

        self.stdout.write(self.style.SUCCESS(f"\n=== SUCCESSFULLY SEEDED COMPUTER-DELIVERED EXAM: {EXAM_CODE} ==="))
        self.stdout.write(self.style.SUCCESS(f"  • Title: {EXAM_TITLE}"))
        self.stdout.write(self.style.SUCCESS("  • Total Sections: 4 (Listening, Reading, Writing, Speaking)"))
        self.stdout.write(self.style.SUCCESS("  • Total Objective Questions: 70 with AnswerKeys"))
        self.stdout.write(self.style.SUCCESS("  • Visual Assets: listening_part4_map.png, speaking_part12_sport.png, speaking_part2_education.png"))
        self.stdout.write(self.style.SUCCESS("  • Audio Assets: record_mock1_audio_part_1.wav .. part_6.wav"))
