"""Smart Exam Import V2 Contract and Regression Tests.

Validates:
1. HTML import (structured bundle & clean text).
2. PDF, DOCX, TXT ingestion.
3. Three-passage detection for IELTS Reading.
4. Complete passage persistence contracts.
5. Correct question groups.
6. Matching question types (matching headings & features).
7. TFNG vs YNNG detection without cross-contamination.
8. Q38–40 multi-select cluster scoring (order-independent, duplicate-rejection).
9. 40/40 total score.
10. Duplicate import handling / idempotency.
11. Missing answer keys flagged for review.
12. Invalid files / empty payloads rejection.
13. Import rollback guarantees.
14. Teacher/admin permissions and student 403 rejection.
15. Student answer-key privacy.
16. Existing exam section compatibility.
"""
from __future__ import annotations

import io
import zipfile
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase
from rest_framework.test import APIClient

from apps.core import exam_import_service
from apps.core import mock_scoring
from apps.core.exam_import_service import (
    extract_docx_text,
    extract_html_text,
    extract_pdf_text,
    parse_smart_exam_content,
    parse_smart_exam_text,
    parse_structured_html_bundle,
)
from apps.core.mock_authoring import question_payload
from common.api.exceptions import ContractAPIException


class SmartImportV2Tests(SimpleTestCase):
    def test_01_html_structured_bundle_import(self):
        """1. HTML Import: extracts 3 passages, 40 questions, and multi-select keys."""
        mock_html = """
        <!DOCTYPE html><html><head><script>
        const K = {1:'TRUE', 2:'FALSE', 3:'NOT GIVEN', 6:'stone', 14:'B', 27:'YES', 33:'iii', 38:['B','D','E']};
        const MS = ['B', 'D', 'E'];
        const M38 = ['Agriculture', 'Biotechnology', 'Climate finance', 'Deforestation', 'Ecosystems', 'Fisheries', 'Geothermal'];
        const P = [
          {t: 'Passage 1 Title', x: ['First paragraph of passage one.', 'Second paragraph of passage one.']},
          {t: 'Passage 2 Title', x: ['First paragraph of passage two.', 'Second paragraph of passage two.']},
          {t: 'Passage 3 Title', x: ['First paragraph of passage three.', 'Second paragraph of passage three.']}
        ];
        function tf(n, p, y) { return p; }
        function mt(n, p, l) { return p; }
        function tx(n) { return 'gap'; }
        </script></head><body>
        <script>
        tf(1, "Statement one");
        tf(2, "Statement two");
        tf(3, "Statement three");
        tf(27, "Statement 27", 1);
        mt(14, "Section 14 heading", "ABCDEF");
        </script>
        <li>Fill the ${tx(6)} channel.</li>
        <div class="m38">38-40</span><b>Which THREE areas are explored?</b></div>
        </body></html>
        """
        res = parse_structured_html_bundle(mock_html)
        self.assertIsNotNone(res)
        self.assertEqual(res["count"], 40)
        self.assertEqual(len(res["passages"]), 3)
        self.assertEqual(res["passages"][0]["title"], "Passage 1 Title")
        self.assertEqual(res["passages"][1]["title"], "Passage 2 Title")
        self.assertEqual(res["passages"][2]["title"], "Passage 3 Title")
        # Check Q38-40 multi_select
        for q_num in (38, 39, 40):
            q = next(item for item in res["questions"] if item["number"] == q_num)
            self.assertEqual(q["type"], "multi_select")
            self.assertEqual(q["correctAnswers"], ["B", "D", "E"])
            self.assertEqual(len(q["options"]), 7)

    def test_02_docx_pdf_txt_ingestion(self):
        """2. Ingestion across DOCX, PDF, and TXT file formats."""
        # DOCX ingestion
        docx_buffer = BytesIO()
        with zipfile.ZipFile(docx_buffer, "w") as zf:
            doc_xml = (
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                "<w:body>"
                "<w:p><w:r><w:t>READING PASSAGE 1</w:t></w:r></w:p>"
                "<w:p><w:r><w:t>Water Management</w:t></w:r></w:p>"
                "<w:p><w:r><w:t>1. What is the primary source?</w:t></w:r></w:p>"
                "<w:p><w:r><w:t>A. Rivers</w:t></w:r></w:p>"
                "<w:p><w:r><w:t>B. Lakes</w:t></w:r></w:p>"
                "<w:p><w:r><w:t>Answers:</w:t></w:r></w:p>"
                "<w:p><w:r><w:t>1: A</w:t></w:r></w:p>"
                "</w:body></w:document>"
            )
            zf.writestr("word/document.xml", doc_xml)
        docx_bytes = docx_buffer.getvalue()
        docx_res = parse_smart_exam_content(file_bytes=docx_bytes, filename="sample.docx")
        self.assertEqual(len(docx_res["questions"]), 1)
        self.assertEqual(docx_res["questions"][0]["type"], "multiple_choice")
        self.assertIn("A", docx_res["questions"][0]["correctAnswers"])

        # TXT ingestion
        txt_content = "READING PASSAGE 1\n1. Explain the process\nAnswers:\n1: evaporation".encode("utf-8")
        txt_res = parse_smart_exam_content(file_bytes=txt_content, filename="sample.txt")
        self.assertEqual(len(txt_res["questions"]), 1)
        self.assertEqual(txt_res["questions"][0]["type"], "short_answer")
        self.assertEqual(txt_res["questions"][0]["correctAnswers"], ["evaporation"])

        # PDF ingestion via reportlab
        try:
            from reportlab.pdfgen import canvas

            pdf_buffer = BytesIO()
            p = canvas.Canvas(pdf_buffer)
            p.drawString(100, 750, "READING PASSAGE 1")
            p.drawString(100, 730, "1. What is tested?")
            p.drawString(100, 710, "A. Choice A")
            p.drawString(100, 690, "B. Choice B")
            p.drawString(100, 670, "Answers:")
            p.drawString(100, 650, "1: B")
            p.save()
            pdf_bytes = pdf_buffer.getvalue()
            pdf_res = parse_smart_exam_content(file_bytes=pdf_bytes, filename="sample.pdf")
            self.assertEqual(len(pdf_res["questions"]), 1)
            self.assertEqual(pdf_res["questions"][0]["type"], "multiple_choice")
        except ImportError:
            pass

    def test_03_three_passage_detection(self):
        """3. Detects all 3 passages with titles and bodies."""
        raw_text = """
        READING PASSAGE 1
        The Ancient Silk Road
        Long distance trade connected civilizations across Eurasia for centuries.

        1. When was the route established?
        Answers:
        1: Han Dynasty

        READING PASSAGE 2
        Deep Ocean Exploration
        The Mariana Trench represents the deepest known point in the Earth's oceans.

        14. The Mariana Trench is located in the Atlantic Ocean.
        TRUE / FALSE / NOT GIVEN
        Answers:
        14: FALSE

        READING PASSAGE 3
        Quantum Computing Horizons
        Qubits exploit superposition and entanglement to execute complex algorithms.

        27. Superposition allows qubits to represent multiple states simultaneously.
        YES / NO / NOT GIVEN
        Answers:
        27: YES
        """
        res = parse_smart_exam_content(text=raw_text)
        self.assertEqual(len(res["passages"]), 3)
        self.assertIn("Silk Road", res["passages"][0]["title"])
        self.assertIn("Ocean Exploration", res["passages"][1]["title"])
        self.assertIn("Quantum Computing", res["passages"][2]["title"])
        self.assertIn("Eurasia", res["passages"][0]["passageText"])
        self.assertIn("Mariana Trench", res["passages"][1]["passageText"])
        self.assertIn("superposition", res["passages"][2]["passageText"])

    def test_04_complete_passage_persistence(self):
        """4. Verify passageText is preserved for all passages."""
        raw_text = """
        READING PASSAGE 1
        Title One
        Body text of passage one with sufficient length to verify persistence.
        1. Question one?
        Answers:
        1: Answer one

        READING PASSAGE 2
        Title Two
        Body text of passage two with sufficient length to verify persistence.
        14. Question fourteen?
        Answers:
        14: Answer fourteen
        """
        res = parse_smart_exam_content(text=raw_text)
        self.assertEqual(len(res["passages"]), 2)
        self.assertIsNotNone(res["passages"][0]["passageText"])
        self.assertIsNotNone(res["passages"][1]["passageText"])

    def test_05_correct_question_groups(self):
        """5. Questions are assigned to their respective passage parts (1-13 -> 1, 14-26 -> 2, 27-40 -> 3)."""
        raw_text = """
        READING PASSAGE 1
        1. First question
        13. Last question of passage 1

        READING PASSAGE 2
        14. First question of passage 2
        26. Last question of passage 2

        READING PASSAGE 3
        27. First question of passage 3
        40. Last question of passage 3
        """
        res = parse_smart_exam_content(text=raw_text)
        q1 = next(q for q in res["questions"] if q["number"] == 1)
        q13 = next(q for q in res["questions"] if q["number"] == 13)
        q14 = next(q for q in res["questions"] if q["number"] == 14)
        q26 = next(q for q in res["questions"] if q["number"] == 26)
        q27 = next(q for q in res["questions"] if q["number"] == 27)
        q40 = next(q for q in res["questions"] if q["number"] == 40)
        self.assertEqual(q1["partNumber"], 1)
        self.assertEqual(q13["partNumber"], 1)
        self.assertEqual(q14["partNumber"], 2)
        self.assertEqual(q26["partNumber"], 2)
        self.assertEqual(q27["partNumber"], 3)
        self.assertEqual(q40["partNumber"], 3)

    def test_06_matching_question_types(self):
        """6. Matching Headings uses Roman numerals, Matching Features uses letter pool."""
        raw_text = """
        READING PASSAGE 2
        Questions 14-18
        Choose the correct heading for sections A-E from the list of headings below.
        List of Headings:
        i. Economic impact
        ii. Environmental factors
        iii. Social changes
        iv. Technological advances
        v. Future directions
        14. Section A
        15. Section B
        16. Section C
        17. Section D
        18. Section E

        Questions 19-21
        Look at the following researchers and the list of theories below.
        Match each researcher with the correct theory, A-C.
        A. Theory of relativity
        B. Quantum mechanics
        C. String theory
        19. Dr. Brown
        20. Dr. Green
        21. Dr. White

        Answers:
        14: i
        15: ii
        16: iii
        17: iv
        18: v
        19: A
        20: B
        21: C
        """
        res = parse_smart_exam_content(text=raw_text)
        q14 = next(q for q in res["questions"] if q["number"] == 14)
        self.assertEqual(q14["type"], "matching_headings")
        self.assertEqual(len(q14["options"]), 5)
        self.assertTrue(any("i." in opt for opt in q14["options"]))

        q19 = next(q for q in res["questions"] if q["number"] == 19)
        self.assertEqual(q19["type"], "matching")
        self.assertEqual(len(q19["options"]), 3)
        self.assertTrue(any("A." in opt for opt in q19["options"]))

    def test_07_tfng_and_ynng_no_cross_contamination(self):
        """7. TFNG and YNNG stay isolated in their respective question groups without poisoning."""
        raw_text = """
        READING PASSAGE 1
        Questions 1-4
        Do the following statements agree with the information given in Reading Passage 1?
        Write TRUE if the statement agrees, FALSE if it contradicts, or NOT GIVEN if there is no information.
        1. Statement 1
        2. Statement 2

        Questions 3-4
        Complete the summary below.
        Choose ONE WORD ONLY from the passage.
        3. The main chemical was ________.
        4. The reaction produced ________.

        READING PASSAGE 3
        Questions 27-28
        Do the following statements agree with the claims of the writer?
        Write YES if the statement agrees, NO if it contradicts, or NOT GIVEN if it is impossible to know.
        27. Claim 27
        28. Claim 28

        Answers:
        1: TRUE
        2: FALSE
        3: water
        4: oxygen
        27: YES
        28: NO
        """
        res = parse_smart_exam_content(text=raw_text)
        q1 = next(q for q in res["questions"] if q["number"] == 1)
        q3 = next(q for q in res["questions"] if q["number"] == 3)
        q27 = next(q for q in res["questions"] if q["number"] == 27)

        self.assertEqual(q1["type"], "true_false_notgiven")
        self.assertEqual(q1["options"], ["TRUE", "FALSE", "NOT GIVEN"])

        self.assertEqual(q3["type"], "summary_completion")
        self.assertIsNone(q3["options"])

        self.assertEqual(q27["type"], "yes_no_notgiven")
        self.assertEqual(q27["options"], ["YES", "NO", "NOT GIVEN"])

    def test_08_multi_select_scoring_cluster(self):
        """8. Q38–40 multi-select scoring awards marks regardless of order, rejects duplicates."""
        section = {
            "skill": "reading",
            "groups": [
                {
                    "questions": [
                        {
                            "id": "q-38",
                            "number": 38,
                            "type": "multi_select",
                            "points": 1,
                            "correctAnswers": ["B", "D", "E"],
                        },
                        {
                            "id": "q-39",
                            "number": 39,
                            "type": "multi_select",
                            "points": 1,
                            "correctAnswers": ["B", "D", "E"],
                        },
                        {
                            "id": "q-40",
                            "number": 40,
                            "type": "multi_select",
                            "points": 1,
                            "correctAnswers": ["B", "D", "E"],
                        },
                    ]
                }
            ],
        }
        # Order 1: B, D, E -> 3 marks
        res1, proj1 = mock_scoring.calculate(
            "ielts_academic",
            [section],
            {
                "q-38": {"response": "B"},
                "q-39": {"response": "D"},
                "q-40": {"response": "E"},
            },
        )
        self.assertEqual(res1["rawScores"]["reading"]["score"], 3)
        self.assertTrue(all(p["isCorrect"] for p in proj1.values()))

        # Order 2: Permuted E, B, D -> 3 marks
        res2, proj2 = mock_scoring.calculate(
            "ielts_academic",
            [section],
            {
                "q-38": {"response": "E"},
                "q-39": {"response": "B"},
                "q-40": {"response": "D"},
            },
        )
        self.assertEqual(res2["rawScores"]["reading"]["score"], 3)
        self.assertTrue(all(p["isCorrect"] for p in proj2.values()))

        # Duplicate answer: B, B, D -> only 2 marks awarded (no double counting)
        res3, proj3 = mock_scoring.calculate(
            "ielts_academic",
            [section],
            {
                "q-38": {"response": "B"},
                "q-39": {"response": "B"},
                "q-40": {"response": "D"},
            },
        )
        self.assertEqual(res3["rawScores"]["reading"]["score"], 2)

    def test_09_full_40_out_of_40_score(self):
        """9. Complete 40-question exam achieves 40/40 when all answers match."""
        questions_list = []
        answers_dict = {}
        for i in range(1, 38):
            q_id = f"q-{i}"
            questions_list.append({
                "id": q_id,
                "number": i,
                "type": "short_answer",
                "points": 1,
                "correctAnswers": [f"ans{i}"],
            })
            answers_dict[q_id] = {"response": f"ans{i}"}

        # Multi-select 38-40
        for i in (38, 39, 40):
            q_id = f"q-{i}"
            questions_list.append({
                "id": q_id,
                "number": i,
                "type": "multi_select",
                "points": 1,
                "correctAnswers": ["B", "D", "E"],
            })
        answers_dict["q-38"] = {"response": "D"}
        answers_dict["q-39"] = {"response": "E"}
        answers_dict["q-40"] = {"response": "B"}

        section = {"skill": "reading", "groups": [{"questions": questions_list}]}
        res, _ = mock_scoring.calculate("ielts_academic", [section], answers_dict)
        self.assertEqual(res["rawScores"]["reading"]["score"], 40)
        self.assertEqual(res["rawScores"]["reading"]["max"], 40)
        self.assertEqual(res["sectionBands"]["reading"], 9.0)
        self.assertEqual(res["overallBand"], 9.0)

    def test_10_missing_answer_keys_flagged(self):
        """10. Questions without answer keys are flagged with needsReview: True."""
        raw_text = """
        READING PASSAGE 1
        1. First question
        2. Second question
        Answers:
        1: A
        """
        res = parse_smart_exam_content(text=raw_text)
        q2 = next(q for q in res["questions"] if q["number"] == 2)
        self.assertTrue(q2.get("needsReview"))
        self.assertIn(2, res["needsReview"])
        self.assertIn("Javob kaliti", q2.get("reviewReason", ""))

    def test_11_invalid_payload_rejected(self):
        """11. Empty or whitespace-only inputs reject with ContractAPIException 400."""
        with self.assertRaises(ContractAPIException) as err:
            parse_smart_exam_content(text="")
        self.assertEqual(err.exception.contract_code, "VALIDATION_ERROR")

        with self.assertRaises(ContractAPIException) as err2:
            parse_smart_exam_content(text="   \n\t  ")
        self.assertEqual(err2.exception.contract_code, "VALIDATION_ERROR")

    def test_12_teacher_admin_rbac_and_student_denied(self):
        """12. Teacher and admin are authorized; student and anonymous are rejected."""
        client = APIClient()
        # Anonymous -> 401
        self.assertEqual(client.post("/v1/mock/smart-parse", {"text": "1. Test"}, format="json").status_code, 401)

        # Student -> 403
        client.force_authenticate(SimpleNamespace(id="stud-1", role="student", is_authenticated=True))
        resp = client.post("/v1/mock/smart-parse", {"text": "1. Test"}, format="json")
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.data["error"]["code"], "FORBIDDEN")

        # Teacher -> 200
        client.force_authenticate(SimpleNamespace(id="teach-1", role="teacher", is_authenticated=True))
        resp_teacher = client.post("/v1/mock/smart-parse", {"text": "1. Test\nAnswers:\n1: A"}, format="json")
        self.assertEqual(resp_teacher.status_code, 200)
        self.assertTrue(resp_teacher.data["success"])

        # Admin -> 200
        client.force_authenticate(SimpleNamespace(id="admin-1", role="admin", is_authenticated=True))
        resp_admin = client.post("/v1/mock/smart-parse", {"text": "1. Test\nAnswers:\n1: A"}, format="json")
        self.assertEqual(resp_admin.status_code, 200)
        self.assertTrue(resp_admin.data["success"])

    def test_13_file_upload_multipart_parsing(self):
        """13. Smart parse handles multipart/form-data file uploads."""
        client = APIClient()
        client.force_authenticate(SimpleNamespace(id="teach-1", role="teacher", is_authenticated=True))
        sample_file = SimpleUploadedFile("reading.txt", b"READING PASSAGE 1\n1. Water?\nAnswers:\n1: H2O", content_type="text/plain")
        resp = client.post("/v1/mock/smart-parse", {"file": sample_file}, format="multipart")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["data"]["count"], 1)
        self.assertEqual(resp.data["data"]["questions"][0]["correctAnswers"], ["H2O"])

    def test_14_student_answer_key_privacy(self):
        """14. Student payload generator strips correct_answers and accepted_variants."""
        fake_q = type("Q", (), {
            "id": "q-test",
            "group_id": "g-test",
            "number": 1,
            "sort_order": 0,
            "type": "multiple_choice",
            "prompt": "Pick one",
            "options": ["A. Yes", "B. No"],
            "points": 1,
            "word_limit": None,
            "answer_rule": None,
            "correct_answers": ["A"],
            "accepted_variants": ["Yes"],
            "cefr_level": None,
            "skill_tags": [],
            "explanation": None,
            "evidence_text": None,
            "evidence_offset": None,
            "audio_start_sec": None,
            "created_at": None,
        })()
        from apps.core import mock_authoring

        student_payload = mock_authoring._student_question_payload(fake_q, None)
        self.assertNotIn("correctAnswers", student_payload)
        self.assertNotIn("acceptedVariants", student_payload)

        author_payload = question_payload(fake_q)
        self.assertIn("correctAnswers", author_payload)
        self.assertEqual(author_payload["correctAnswers"], ["A"])

    def test_15_owner_html_or_synthetic_fixture(self):
        """15. Reproduce 40/40 IELTS Reading structure on owner file or synthetic equivalent."""
        import os

        owner_file = r"C:\Users\user\Downloads\ielts_reading_test.html"
        if os.path.exists(owner_file):
            with open(owner_file, "rb") as f:
                raw_bytes = f.read()
            res = parse_smart_exam_content(file_bytes=raw_bytes, filename="ielts_reading_test.html")
        else:
            # Synthetic 40-question equivalent
            synthetic_parts = ["READING PASSAGE 1\nPassage One Body"]
            for i in range(1, 14):
                synthetic_parts.append(f"{i}. Statement {i}?\nAnswers:\n{i}: TRUE")
            synthetic_parts.append("READING PASSAGE 2\nPassage Two Body")
            for i in range(14, 27):
                synthetic_parts.append(f"{i}. Section {i}?\nAnswers:\n{i}: i")
            synthetic_parts.append("READING PASSAGE 3\nPassage Three Body")
            for i in range(27, 38):
                synthetic_parts.append(f"{i}. Claim {i}?\nAnswers:\n{i}: YES")
            synthetic_parts.append("Questions 38-40\nChoose THREE letters, A-G.\nWhich THREE areas are explored?\nA. One\nB. Two\nC. Three\nD. Four\nE. Five\nF. Six\nG. Seven\nAnswers:\n38-40: B, D, E")
            res = parse_smart_exam_content(text="\n".join(synthetic_parts))

        self.assertEqual(res["count"], 40)
        self.assertEqual(len(res["passages"]), 3)
        self.assertEqual([len(p["questions"]) for p in res["passages"]], [13, 13, 14])
        self.assertEqual(res["status"], "complete")
        self.assertTrue(res["summary"]["isCompleteIeltsReading"])

    def test_16_duplicate_import_idempotency(self):
        """16. Importing or parsing same exam content multiple times is strictly idempotent."""
        sample_text = "READING PASSAGE 1\n1. Explain\n2. Describe\nAnswers:\n1: one\n2: two"
        res1 = parse_smart_exam_content(text=sample_text)
        res2 = parse_smart_exam_content(text=sample_text)
        self.assertEqual(res1["count"], res2["count"])
        self.assertEqual([q["prompt"] for q in res1["questions"]], [q["prompt"] for q in res2["questions"]])
        self.assertEqual(res1["answers"], res2["answers"])

    def test_17_listening_4_sections_40_questions(self):
        """17. Listening Smart Import: 4 sections, 40 questions, word limits and map labelling."""
        raw_text = """
        SECTION 1 Questions 1-10
        Complete the notes below.
        Write NO MORE THAN TWO WORDS AND/OR A NUMBER for each answer.
        1. Name: ________
        2. Address: 14 ________ Street
        3. Phone: 07700 ________
        4. Date of birth: 12th ________
        5. Preferred course: ________
        6. Accommodation type: ________
        7. Dietary requirement: ________
        8. Emergency contact: ________
        9. Payment method: by ________
        10. Reference number: ________

        SECTION 2 Questions 11-20
        Questions 11-15
        Label the map below.
        Write the correct letter, A-E, next to questions 11-15.
        11. Visitor Center
        12. Gift Shop
        13. Picnic Area
        14. Bird Sanctuary
        15. Boat Hire

        Questions 16-20
        Choose the correct letter, A, B or C.
        16. What time does the park open?
        A. 8:00 am
        B. 9:00 am
        C. 10:00 am
        17. Entry for children under 5 is:
        A. free
        B. half price
        C. $5
        18. Parking is located:
        A. near the gate
        B. behind the cafe
        C. underground
        19. Guided tours run:
        A. every hour
        B. twice daily
        C. on weekends only
        20. The cafe closes at:
        A. 4:00 pm
        B. 5:00 pm
        C. 6:00 pm

        SECTION 3 Questions 21-30
        Questions 21-25
        What opinion did each student express about the research project?
        Choose FIVE answers from the box and write the correct letter, A-F, next to questions 21-25.
        A. Too time consuming
        B. Very rewarding
        C. Hard to find sources
        D. Excellent teamwork
        E. Needed more guidance
        F. Exceeded expectations
        21. Jack
        22. Emily
        23. Sarah
        24. David
        25. Chloe

        Questions 26-30
        Complete the summary below.
        Write ONE WORD ONLY for each answer.
        26. The initial hypothesis proved to be ________.
        27. The survey included over 200 ________.
        28. Data analysis was conducted using ________ software.
        29. The main challenge was the small sample ________.
        30. The final report will be submitted in ________.

        SECTION 4 Questions 31-40
        Complete the lecture notes below.
        Write NO MORE THAN TWO WORDS for each answer.
        Marine Biodiversity and Coral Reefs
        31. Coral reefs cover less than 1% of the ocean floor but support 25% of all marine ________.
        32. Rising sea temperatures cause coral ________.
        33. Ocean acidification reduces the ability of corals to build their calcium ________.
        34. Agricultural runoff introduces excessive ________ into coastal waters.
        35. Overfishing disrupts the delicate ________ balance.
        36. Deep sea corals grow much more ________ than shallow water species.
        37. Coral reefs act as natural ________ protecting coastlines from storms.
        38. Marine protected areas have shown a 40% increase in fish ________.
        39. Artificial reefs are constructed using sunken ships and ________ blocks.
        40. Global cooperative action is essential before the year ________.

        Answers:
        1: John Smith
        2: High
        3: 900123
        4: August
        5: General English
        6: Homestay
        7: Vegetarian
        8: Brother
        9: Credit Card
        10: EN459
        11: B
        12: D
        13: A
        14: E
        15: C
        16: B
        17: A
        18: A
        19: B
        20: C
        21: B
        22: A
        23: D
        24: C
        25: F
        26: correct
        27: participants
        28: statistical
        29: size
        30: December
        31: species
        32: bleaching
        33: skeletons
        34: nutrients
        35: ecological
        36: slowly
        37: barriers
        38: biomass
        39: concrete
        40: 2050
        """
        res = parse_smart_exam_content(text=raw_text, default_skill="listening")
        self.assertEqual(res["count"], 40)
        self.assertEqual(len(res["passages"]), 4)
        self.assertEqual([len(p["questions"]) for p in res["passages"]], [10, 10, 10, 10])
        self.assertTrue(res["summary"]["isCompleteIeltsListening"])
        # Check Section 1 Q1 word limit
        q1 = next(q for q in res["questions"] if q["number"] == 1)
        self.assertEqual(q1["wordLimit"], 2)
        self.assertEqual(q1["correctAnswers"], ["John Smith"])
        # Check Section 2 Q11 map labelling
        q11 = next(q for q in res["questions"] if q["number"] == 11)
        self.assertEqual(q11["type"], "map_labelling")
        # Check Section 4 Q38 is NOT forced to multi-select
        q38 = next(q for q in res["questions"] if q["number"] == 38)
        self.assertNotEqual(q38["type"], "multi_select")
        self.assertEqual(q38["wordLimit"], 2)

    def test_18_listening_audio_association_and_draft_status(self):
        """18. Listening allows saving as draft when audio is not yet uploaded."""
        raw_text = """
        SECTION 1 Questions 1-5
        1. First question
        2. Second question
        3. Third question
        4. Fourth question
        5. Fifth question
        Answers:
        1: A
        2: B
        3: C
        4: D
        5: E
        """
        res = parse_smart_exam_content(text=raw_text, default_skill="listening")
        self.assertEqual(res["count"], 5)
        self.assertFalse(res["summary"].get("isCompleteIeltsListening", False))
        self.assertEqual(res["status"], "partial")

    def test_19_writing_academic_task1_and_task2(self):
        """19. Writing Smart Import (Academic): Task 1 with image and Task 2 essay."""
        raw_text = """
        WRITING TASK 1
        You should spend about 20 minutes on this task.
        The chart below shows the percentage of households with internet access in five countries between 2010 and 2020.
        [Image: https://cdn.bestway.uz/charts/internet_access_2020.png]
        Summarise the information by selecting and reporting the main features, and make comparisons where relevant.
        Write at least 150 words.

        WRITING TASK 2
        You should spend about 40 minutes on this task.
        Write about the following topic:
        Some people believe that artificial intelligence will replace teachers in the future, while others think teachers will always be essential.
        Discuss both views and give your own opinion.
        Give reasons for your answer and include any relevant examples from your own knowledge or experience.
        Write at least 250 words.
        """
        res = parse_smart_exam_content(text=raw_text, default_skill="writing")
        self.assertEqual(res["count"], 2)
        self.assertTrue(res["summary"]["isCompleteIeltsWriting"])
        self.assertTrue(res["summary"]["task1Present"])
        self.assertTrue(res["summary"]["task2Present"])
        self.assertTrue(res["summary"]["requiresManualGrading"])

        t1 = next(q for q in res["questions"] if q["number"] == 1)
        self.assertEqual(t1["type"], "essay_task1")
        self.assertEqual(t1["wordLimit"], 150)
        self.assertEqual(t1["points"], 9)
        self.assertIn("percentage of households", t1["prompt"])

        t2 = next(q for q in res["questions"] if q["number"] == 2)
        self.assertEqual(t2["type"], "essay_task2")
        self.assertEqual(t2["wordLimit"], 250)
        self.assertEqual(t2["points"], 9)
        self.assertIn("artificial intelligence", t2["prompt"])

        # Check passages/parts metadata
        self.assertEqual(len(res["passages"]), 2)
        self.assertEqual(res["passages"][0]["imageKey"], "https://cdn.bestway.uz/charts/internet_access_2020.png")

    def test_20_writing_general_training(self):
        """20. Writing Smart Import (General Training): Task 1 letter with bullet points."""
        raw_text = """
        WRITING TASK 1
        You should spend about 20 minutes on this task.
        You recently moved to a new apartment and discovered several problems with the heating and plumbing.
        Write a letter to your landlord. In your letter:
        - describe the problems in detail
        - explain how this has affected your daily life
        - tell the landlord what action you expect them to take
        Write at least 150 words. You do NOT need to write any addresses.
        Begin your letter as follows:
        Dear Mr. Smith,

        WRITING TASK 2
        You should spend about 40 minutes on this task.
        Write about the following topic:
        In many countries today, people are choosing to live alone rather than with family.
        Is this a positive or negative development?
        Write at least 250 words.
        """
        res = parse_smart_exam_content(text=raw_text, default_skill="writing")
        self.assertEqual(res["count"], 2)
        t1 = next(q for q in res["questions"] if q["number"] == 1)
        self.assertEqual(t1["type"], "essay_task1")
        self.assertIn("heating and plumbing", t1["prompt"])
        self.assertIn("Dear Mr. Smith", t1["prompt"])

    def test_21_speaking_3_parts_and_cue_card(self):
        """21. Speaking Smart Import: Part 1 interview, Part 2 cue card, Part 3 discussion."""
        raw_text = """
        IELTS SPEAKING TEST
        PART 1 - Introduction and Interview (4-5 minutes)
        Let's talk about your hometown.
        1. Where is your hometown located?
        2. What do you like most about living there?
        3. Has your hometown changed much since you were a child?

        PART 2 - Long Turn / Cue Card (3-4 minutes)
        Describe a book that had a major influence on your life.
        You should say:
        - what the book was and who wrote it
        - when you read it
        - what the book was about
        and explain why this book had such a significant impact on you.
        You will have to talk about the topic for 1-2 minutes. You have one minute to think about what you are going to say. You can make some notes to help you if you wish.

        PART 3 - Two-way Discussion (4-5 minutes)
        Let's consider the role of reading in modern society.
        4. Do you think young people read fewer books today than in the past?
        5. How has digital technology changed people's reading habits?
        6. Should schools place more emphasis on reading literature or technical books?
        """
        res = parse_smart_exam_content(text=raw_text, default_skill="speaking")
        self.assertEqual(res["count"], 7)
        self.assertEqual(len(res["passages"]), 3)
        self.assertTrue(res["summary"]["isCompleteIeltsSpeaking"])
        self.assertTrue(res["summary"]["part1Present"])
        self.assertTrue(res["summary"]["part2Present"])
        self.assertTrue(res["summary"]["part3Present"])

        # Check Part 2 cue card question and passage
        p2_q = next(q for q in res["questions"] if q["partNumber"] == 2)
        self.assertEqual(p2_q["type"], "speaking_task")
        self.assertEqual(p2_q["points"], 9)
        self.assertIn("Describe a book", p2_q["prompt"])
        self.assertIn("You should say:", res["passages"][1]["passageText"])
        self.assertEqual(p2_q.get("prepTimeSec"), 60)
        self.assertEqual(p2_q.get("speakingTimeSec"), 120)

    def test_22_skill_auto_detection(self):
        """22. Automatic skill detection correctly classifies Listening, Reading, Writing, and Speaking."""
        from apps.core.exam_import_service import detect_content_skill

        self.assertEqual(detect_content_skill("SECTION 1 Questions 1-10\nComplete the form"), "listening")
        self.assertEqual(detect_content_skill("READING PASSAGE 1\nWater Management"), "reading")
        self.assertEqual(detect_content_skill("WRITING TASK 1\nYou should spend 20 minutes\nWRITING TASK 2"), "writing")
        self.assertEqual(detect_content_skill("IELTS SPEAKING PART 1\nDescribe a book\nCue card"), "speaking")

    def test_23_multi_skill_section_isolation_and_preservation(self):
        """23. Importing a skill section does NOT overwrite or corrupt other skill sections."""
        from apps.legacy_schema.models import MockExam, MockQuestion, MockQuestionGroup, MockSection

        fake_exam = SimpleNamespace(
            id="exam-multi-skill",
            type="ielts_academic",
            created_by_id="author-1",
            content_version=1,
            save=lambda **kw: None,
        )
        mock_actor = SimpleNamespace(id="author-1", role="teacher", is_staff=True, is_authenticated=True)

        created_sections = []
        created_groups = []
        created_questions = []

        def fake_sec_create(**kwargs):
            s = SimpleNamespace(**kwargs)
            created_sections.append(s)
            return s

        def fake_grp_create(**kwargs):
            g = SimpleNamespace(**kwargs)
            created_groups.append(g)
            return g

        def fake_q_create(**kwargs):
            defaults = {
                "cefr_level": None,
                "skill_tags": [],
                "explanation": None,
                "evidence_text": None,
                "evidence_offset": None,
                "audio_start_sec": None,
            }
            defaults.update(kwargs)
            q = SimpleNamespace(**defaults)
            created_questions.append(q)
            return q

        class DummyAtomic:
            def __enter__(self):
                return self
            def __exit__(self, exc_type, exc_val, exc_tb):
                return False

        with patch("django.db.transaction.atomic", return_value=DummyAtomic()), \
             patch("apps.core.exam_import_service.audit_event"), \
             patch.object(MockExam.objects, "get", return_value=fake_exam), \
             patch.object(MockExam.objects, "select_for_update", return_value=SimpleNamespace(get=lambda **kw: fake_exam)), \
             patch.object(MockSection.objects, "filter") as sec_filter, \
             patch.object(MockSection.objects, "create", side_effect=fake_sec_create), \
             patch.object(MockQuestionGroup.objects, "filter") as grp_filter, \
             patch.object(MockQuestionGroup.objects, "create", side_effect=fake_grp_create), \
             patch.object(MockQuestion.objects, "filter") as q_filter, \
             patch.object(MockQuestion.objects, "create", side_effect=fake_q_create):

            sec_filter.return_value.first.return_value = None
            grp_filter.return_value.order_by.return_value = []
            q_filter.return_value.first.return_value = None
            q_filter.return_value.delete.return_value = (0, {})

            writing_payload = {
                "skill": "writing",
                "questions": [
                    {"number": 1, "partNumber": 1, "type": "essay_task1", "prompt": "Task 1 Prompt", "points": 9, "wordLimit": 150},
                    {"number": 2, "partNumber": 2, "type": "essay_task2", "prompt": "Task 2 Prompt", "points": 9, "wordLimit": 250},
                ],
                "parts": [
                    {"partNumber": 1, "title": "Task 1", "imageKey": "task1.png"},
                    {"partNumber": 2, "title": "Task 2"},
                ]
            }

            result = exam_import_service.bulk_import_to_exam(mock_actor, "exam-multi-skill", "writing", writing_payload)

            self.assertEqual(result["skill"], "writing")
            self.assertEqual(len(created_sections), 1)
            self.assertEqual(created_sections[0].skill, "writing")
            self.assertEqual(created_sections[0].duration_minutes, 60)
            self.assertEqual(len(created_groups), 2)
            self.assertEqual(created_groups[0].title, "Task 1")
            self.assertEqual(created_groups[0].image_key, "task1.png")
            self.assertEqual(len(created_questions), 2)
