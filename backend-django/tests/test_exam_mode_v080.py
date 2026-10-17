"""Unit and integration tests for BestWay v0.8.0:
- Smart 40-question Text Parser & Bulk Import (exam_import_service)
- Excel (.xlsx) & CSV Template + 40-question Importer
- Single Audio & Part Timestamps (Listening)
- Multi-Level (0-75 CEFR: A2/B1/B2/C1) & IELTS (0-9.0) Score Prediction Engine (prediction_service)
- Teacher 6-Digit PIN Live Exam Room, Real-Time Monitor & Excel Export (live_exam_service)
"""
from __future__ import annotations

from io import BytesIO
from types import SimpleNamespace
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase
from openpyxl import load_workbook
from rest_framework.test import APIClient

from apps.core import exam_import_service, live_exam_service, prediction_service


class SmartTextParserAndExcelTests(SimpleTestCase):
    def test_parse_40_questions_copied_from_word(self):
        """Verification Checklist #1: Word-copied 40-question text with Multiple Choice,
        TFNG, Matching, and Short Answer + Answer Key parses cleanly into 40 questions."""
        lines = ["PART 1", "Read the passage about urban architecture and answer questions 1-10."]
        # Q1-10: Multiple Choice
        for q in range(1, 11):
            lines.append(f"{q}. What is the main feature described in paragraph {q}?")
            lines.append("A) Sustainable materials")
            lines.append("B) Historical preservation")
            lines.append("C) Modernist steel frames")
            lines.append("D) Solar roof integration")

        lines.append("PART 2")
        lines.append("Questions 11-20: Do the following statements agree with the information? Write TRUE, FALSE or NOT GIVEN.")
        for q in range(11, 21):
            lines.append(f"{q}. The municipal council approved the budget in {2010 + q}.")

        lines.append("PART 3")
        lines.append("Questions 21-30: Match each researcher with the correct finding (A-F).")
        lines.append("List of Findings:")
        lines.append("A) Thermal efficiency")
        lines.append("B) Acoustic insulation")
        lines.append("C) Wind resistance")
        lines.append("D) Cost reduction")
        lines.append("E) Carbon neutrality")
        lines.append("F) Rapid assembly")
        for q in range(21, 31):
            lines.append(f"{q}. Dr. Researcher {q - 20}")

        lines.append("PART 4")
        lines.append("Questions 31-40: Complete the sentences below. Write ONE WORD ONLY.")
        for q in range(31, 41):
            lines.append(f"{q}. The primary foundation relies on reinforced ________ to prevent subsidence.")

        lines.append("Answers:")
        ans_entries = []
        for q in range(1, 11):
            ans_entries.append(f"{q}. B")
        for q in range(11, 21):
            ans_entries.append(f"{q}. {'TRUE' if q % 2 == 0 else 'NOT GIVEN'}")
        for q in range(21, 31):
            ans_entries.append(f"{q}. C")
        for q in range(31, 41):
            ans_entries.append(f"{q}. concrete")
        lines.append(", ".join(ans_entries))

        raw_text = "\n".join(lines)
        parsed = exam_import_service.parse_smart_exam_text(raw_text, default_skill="reading", exam_type="ielts_academic")

        self.assertEqual(parsed["count"], 40)
        self.assertEqual(len(parsed["questions"]), 40)
        self.assertEqual(parsed["summary"]["total"], 40)
        self.assertEqual(parsed["summary"]["withAnswers"], 40)

        q1 = parsed["questions"][0]
        self.assertEqual(q1["number"], 1)
        self.assertEqual(q1["type"], "multiple_choice")
        self.assertEqual(len(q1["options"]), 4)
        self.assertIn("B", q1["correctAnswers"])
        self.assertIn("Historical preservation", q1["correctAnswers"])

        q12 = parsed["questions"][11]
        self.assertEqual(q12["number"], 12)
        self.assertEqual(q12["type"], "true_false_notgiven")
        self.assertIn("TRUE", q12["correctAnswers"])

        q25 = parsed["questions"][24]
        self.assertEqual(q25["number"], 25)
        self.assertEqual(q25["type"], "matching")
        self.assertIn("C", q25["correctAnswers"])

        q35 = parsed["questions"][34]
        self.assertEqual(q35["number"], 35)
        self.assertIn(q35["type"], ("sentence_completion", "short_answer"))
        self.assertIn("concrete", q35["correctAnswers"])

    def test_excel_template_generation_and_roundtrip_parse(self):
        """Verification Checklist #2: Excel template generates 40 questions and round-trip parses all 40."""
        xlsx_bytes, filename = exam_import_service.generate_excel_template(exam_type="ielts_academic", skill="reading")
        self.assertTrue(filename.endswith(".xlsx"))
        self.assertGreater(len(xlsx_bytes), 3000)

        wb = load_workbook(BytesIO(xlsx_bytes))
        self.assertIn("Questions Import", wb.sheetnames)

        parsed = exam_import_service.parse_spreadsheet_bytes(xlsx_bytes, filename=filename)
        self.assertEqual(parsed["count"], 40)
        self.assertEqual(len(parsed["questions"]), 40)
        self.assertEqual(parsed["summary"]["withAnswers"], 40)
        self.assertGreaterEqual(len(parsed["parts"]), 3)

    def test_csv_spreadsheet_parse(self):
        csv_content = (
            "Part,QuestionNumber,QuestionType,Prompt,OptionA,OptionB,OptionC,OptionD,CorrectAnswer,Points,WordLimit\n"
            "1,1,multiple_choice,What is the capital?,London,Paris,Berlin,Rome,A,1,\n"
            "1,2,true_false_notgiven,The Thames is in London.,TRUE,FALSE,NOT GIVEN,,TRUE,1,\n"
            "2,3,short_answer,Complete: The tower is made of ____.,,,,,,steel,1,1\n"
        ).encode("utf-8")
        parsed = exam_import_service.parse_spreadsheet_bytes(csv_content, filename="sample.csv")
        self.assertEqual(parsed["count"], 3)
        self.assertEqual(parsed["questions"][0]["type"], "multiple_choice")
        self.assertIn("London", parsed["questions"][0]["correctAnswers"])
        self.assertEqual(parsed["questions"][1]["type"], "true_false_notgiven")
        self.assertEqual(parsed["questions"][2]["wordLimit"], 1)

    def test_smart_parse_and_excel_template_http_endpoints(self):
        client = APIClient()
        teacher = SimpleNamespace(id="teacher-1", role="teacher", is_authenticated=True)
        client.force_authenticate(teacher)

        resp = client.post(
            "/v1/mock/smart-parse",
            {
                "text": "1. Choose the best option\nA) Alpha\nB) Beta\nC) Gamma\nAnswer: B\n2. Fill in the ____ (Answer: river)",
                "skill": "reading",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["data"]["count"], 2)
        self.assertIn("Beta", resp.data["data"]["questions"][0]["correctAnswers"])
        self.assertIn("river", resp.data["data"]["questions"][1]["correctAnswers"])

        tpl_resp = client.get("/v1/mock/import-template/excel?examType=ielts_academic&skill=listening")
        self.assertEqual(tpl_resp.status_code, 200)
        self.assertEqual(
            tpl_resp["Content-Type"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )

        upload = SimpleUploadedFile(
            "test40.xlsx",
            tpl_resp.content,
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        preview_resp = client.post("/v1/mock/import-excel?previewOnly=true", {"file": upload}, format="multipart")
        self.assertEqual(preview_resp.status_code, 200)
        self.assertEqual(preview_resp.data["data"]["count"], 40)


class ScorePredictionEngineTests(SimpleTestCase):
    def test_multilevel_cefr_scale_thresholds(self):
        """Verification Checklist #3: Multi-Level (0-75) CEFR boundaries:
        A2: 0-33, B1: 34-45, B2: 46-59, C1: 60-75."""
        self.assertEqual(prediction_service.multilevel_cefr_from_score(0), "A2")
        self.assertEqual(prediction_service.multilevel_cefr_from_score(25), "A2")
        self.assertEqual(prediction_service.multilevel_cefr_from_score(33), "A2")
        self.assertEqual(prediction_service.multilevel_cefr_from_score(34), "B1")
        self.assertEqual(prediction_service.multilevel_cefr_from_score(45), "B1")
        self.assertEqual(prediction_service.multilevel_cefr_from_score(46), "B2")
        self.assertEqual(prediction_service.multilevel_cefr_from_score(59), "B2")
        self.assertEqual(prediction_service.multilevel_cefr_from_score(60), "C1")
        self.assertEqual(prediction_service.multilevel_cefr_from_score(75), "C1")

    def test_dual_scale_conversions(self):
        self.assertEqual(prediction_service.raw_to_multilevel_75(35, 35), 75.0)
        self.assertEqual(prediction_service.raw_to_multilevel_75(28, 35), 60.0)
        self.assertEqual(prediction_service.raw_to_ielts_band(39, 40, skill="listening"), 9.0)
        self.assertEqual(prediction_service.raw_to_ielts_band(30, 40, skill="reading", exam_type="ielts_academic"), 7.0)
        self.assertGreaterEqual(prediction_service.multilevel_to_ielts_band(65), 7.0)
        self.assertGreaterEqual(prediction_service.ielts_band_to_multilevel(7.0), 60.0)

    @patch("apps.core.prediction_service.StudentProfile")
    @patch("apps.core.prediction_service.User")
    @patch("apps.core.prediction_service.ensure_target_table")
    @patch("apps.core.prediction_service.get_student_target")
    @patch("apps.core.prediction_service._analyze_weak_modules")
    @patch("apps.core.prediction_service.TestAttempt")
    @patch("apps.core.prediction_service.MockAttempt")
    def test_dynamic_prediction_from_recent_attempts(
        self,
        mock_attempt_cls,
        test_attempt_cls,
        mock_weak_modules,
        mock_get_target,
        _mock_ensure_table,
        mock_user_cls,
        mock_profile_cls,
    ):
        mock_user_cls.objects.filter.return_value.first.return_value = SimpleNamespace(id="student-1", name="Test Student")
        mock_profile_cls.objects.filter.return_value.first.return_value = SimpleNamespace(user_id="student-1", active_program="MULTILEVEL")
        mock_get_target.return_value = {
            "targetIeltsBand": 7.5,
            "targetMultilevelScore": 65.0,
            "targetCefr": "C1",
        }
        mock_weak_modules.return_value = [
            {
                "module": "Reading — Matching Headings",
                "skill": "reading",
                "questionType": "matching_headings",
                "partLabel": "Reading Part 2",
                "totalQuestions": 18,
                "correctCount": 7,
                "errorCount": 11,
                "accuracyPercent": 39,
                "errorRatePercent": 61,
                "severity": "high",
                "recommendation": "Practice paragraph skimming for main ideas before looking at headings.",
            }
        ]

        # Simulate 4 chronological attempts showing improvement
        fake_attempts = [
            SimpleNamespace(
                id="att-4",
                exam_id="ex-4",
                exam=SimpleNamespace(title="Mock 4", type="multilevel"),
                overall_band=None,
                overall_score=62.0,
                cefr_level="C1",
                raw_scores={"listening": {"score": 29, "max": 35}, "reading": {"score": 28, "max": 35}},
                section_bands={},
                standard_scores={"listening": {"estimatedStandardScore": 63}, "reading": {"estimatedStandardScore": 61}},
                finished_at=SimpleNamespace(isoformat=lambda: "2026-10-16T10:00:00Z"),
                started_at=SimpleNamespace(isoformat=lambda: "2026-10-16T09:00:00Z"),
            ),
            SimpleNamespace(
                id="att-3",
                exam_id="ex-3",
                exam=SimpleNamespace(title="Mock 3", type="multilevel"),
                overall_band=None,
                overall_score=54.0,
                cefr_level="B2",
                raw_scores={"listening": {"score": 25, "max": 35}, "reading": {"score": 24, "max": 35}},
                section_bands={},
                standard_scores={"listening": {"estimatedStandardScore": 55}, "reading": {"estimatedStandardScore": 53}},
                finished_at=SimpleNamespace(isoformat=lambda: "2026-10-12T10:00:00Z"),
                started_at=SimpleNamespace(isoformat=lambda: "2026-10-12T09:00:00Z"),
            ),
            SimpleNamespace(
                id="att-2",
                exam_id="ex-2",
                exam=SimpleNamespace(title="Mock 2", type="multilevel"),
                overall_band=None,
                overall_score=44.0,
                cefr_level="B1",
                raw_scores={"listening": {"score": 20, "max": 35}, "reading": {"score": 21, "max": 35}},
                section_bands={},
                standard_scores={"listening": {"estimatedStandardScore": 44}, "reading": {"estimatedStandardScore": 44}},
                finished_at=SimpleNamespace(isoformat=lambda: "2026-10-08T10:00:00Z"),
                started_at=SimpleNamespace(isoformat=lambda: "2026-10-08T09:00:00Z"),
            ),
        ]
        mock_attempt_cls.objects.filter.return_value.select_related.return_value.order_by.return_value.__getitem__.return_value = fake_attempts
        test_attempt_cls.objects.filter.return_value.select_related.return_value.order_by.return_value.__getitem__.return_value = []

        pred = prediction_service.get_student_prediction("student-1", limit=5)
        self.assertEqual(pred["attemptsAnalyzed"], 3)
        self.assertEqual(pred["trend"], "improving")
        self.assertEqual(pred["multilevel"]["currentScore"], 62.0)
        self.assertGreaterEqual(pred["multilevel"]["predictedScore"], 60.0)
        self.assertEqual(pred["multilevel"]["cefrLevel"], "C1")
        self.assertEqual(len(pred["history"]), 3)
        self.assertEqual(pred["weakModules"][0]["module"], "Reading — Matching Headings")


class LiveExamServiceExportTests(SimpleTestCase):
    @patch("apps.core.live_exam_service.get_monitor_data")
    def test_live_session_excel_export_generates_valid_xlsx(self, mock_monitor):
        mock_monitor.return_value = {
            "session": {
                "id": "room-1",
                "pin": "482915",
                "title": "IELTS Full Live Mock",
                "examTitle": "IELTS Academic Test 1",
                "examType": "ielts_academic",
                "groupName": "IELTS Intensive A",
                "simulatorMode": "cdi",
                "status": "active",
            },
            "summary": {
                "totalParticipants": 2,
                "inProgressCount": 1,
                "completedCount": 1,
                "averageBand": 7.5,
                "averageScore": 66.0,
            },
            "participants": [
                {
                    "studentId": "st-1",
                    "name": "Ali Valiyev",
                    "phone": "+998901112233",
                    "status": "completed",
                    "currentSkill": "reading",
                    "currentQuestionNumber": 40,
                    "answeredCount": 40,
                    "totalQuestions": 40,
                    "flaggedCount": 0,
                    "antiCheatCount": 0,
                    "rawScore": 35.0,
                    "bandScore": 8.0,
                    "multilevelScore": 72.0,
                    "cefrLevel": "C1",
                    "joinedAt": "2026-10-17T09:00:00Z",
                    "finishedAt": "2026-10-17T09:55:00Z",
                },
                {
                    "studentId": "st-2",
                    "name": "Malika Karimova",
                    "phone": "+998902223344",
                    "status": "in_progress",
                    "currentSkill": "listening",
                    "currentQuestionNumber": 18,
                    "answeredCount": 17,
                    "totalQuestions": 40,
                    "flaggedCount": 2,
                    "antiCheatCount": 1,
                    "rawScore": 15.0,
                    "bandScore": 5.5,
                    "multilevelScore": 45.0,
                    "cefrLevel": "B1",
                    "joinedAt": "2026-10-17T09:02:00Z",
                    "finishedAt": None,
                },
            ],
        }
        actor = SimpleNamespace(id="teacher-1", role="teacher", is_authenticated=True)
        xlsx_bytes, filename = live_exam_service.export_session_excel(actor, "room-1")
        self.assertTrue(filename.endswith(".xlsx"))
        wb = load_workbook(BytesIO(xlsx_bytes))
        ws = wb.active
        values = [[cell.value for cell in row] for row in ws.iter_rows()]
        flat_text = " ".join(str(cell) for row in values for cell in row if cell is not None)
        self.assertIn("Ali Valiyev", flat_text)
        self.assertIn("Malika Karimova", flat_text)
        self.assertIn("482915", flat_text)
        self.assertIn("C1", flat_text)
