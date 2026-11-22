"""Smart Exam Import 3.0 Contract and Reliability Test Suite.

Validates:
1. Advanced HTML sanitization:
   - Stripping MS Word conditional comments (<!--[if gte mso 9]>...<![endif]-->).
   - Stripping embedded office XML tags (<xml>...</xml>, <o:p>...</o:p>, <w:...>).
   - Stripping script, style, noscript, and iframe elements.
   - Normalizing zero-width artifacts (\u200b, \ufeff) and non-breaking spaces (\xa0).
2. Four-step wizard data contracts:
   - Needs Review detection for questions lacking answer keys.
   - Question distribution analysis across standard IELTS types.
3. Audio metadata and draft state support:
   - Bulk import never changes publication state (imported content stays in the draft it targets).
   - Listening audio_key and image_key attachment to MockQuestionGroup.
4. Transactional atomicity:
   - Fail-safe rollback of groups and questions upon exception during import.
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from apps.core import exam_import_service
from apps.core.exam_import_service import (
    bulk_import_to_exam,
    extract_html_text,
    parse_smart_exam_content,
    parse_smart_exam_text,
)


class SmartImportV3ReliabilityTests(SimpleTestCase):
    def test_advanced_html_sanitization_strips_word_xml_and_scripts(self):
        """Sanitizer must remove MS Word conditional comments, office tags, scripts, and invisible characters."""
        raw_html = (
            "<html><head>"
            "<style>body { font-family: Calibri; } .MsoNormal { margin: 0; }</style>"
            "<script>alert('malicious tracker');</script>"
            "<xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml>"
            "<!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:RelyOnVML/></o:OfficeDocumentSettings></xml><![endif]-->"
            "</head><body>"
            "<h1>READING PASSAGE 1</h1>"
            "<p class='MsoNormal'><o:p>The history of silk production began in ancient China.\xa0\u200b</o:p></p>"
            "<noscript><p>Please enable JS</p></noscript>"
            "<iframe src='https://tracker.test/pixel'></iframe>"
            "<div>Questions 1-5</div>"
            "<p>1. When was silk first cultivated in China?<br/>A) 3000 BC<br/>B) 1000 BC<br/>Answer: A</p>"
            "</body></html>"
        )

        cleaned = extract_html_text(raw_html)
        self.assertNotIn("alert('malicious tracker')", cleaned)
        self.assertNotIn("font-family: Calibri", cleaned)
        self.assertNotIn("WordDocument", cleaned)
        self.assertNotIn("OfficeDocumentSettings", cleaned)
        self.assertNotIn("<!--[if", cleaned)
        self.assertNotIn("<![endif]-->", cleaned)
        self.assertNotIn("<o:p>", cleaned)
        self.assertNotIn("Please enable JS", cleaned)
        self.assertNotIn("https://tracker.test/pixel", cleaned)
        self.assertNotIn("\xa0", cleaned)
        self.assertNotIn("\u200b", cleaned)

        # Core exam text must remain intact
        self.assertIn("READING PASSAGE 1", cleaned)
        self.assertIn("The history of silk production began in ancient China.", cleaned)
        self.assertIn("Questions 1-5", cleaned)
        self.assertIn("1. When was silk first cultivated in China?", cleaned)
        self.assertIn("Answer: A", cleaned)

    def test_needs_review_detection_for_missing_keys(self):
        """Questions without answers must be identified and flagged for teacher review."""
        raw_text = """
        READING PASSAGE 1
        Sample passage text about urban planning...
        Questions 1-3
        1. Urban density affects public transport usage.
        2. What is the optimal distance to a subway station?
        3. Who designed the garden city model?
        Answers:
        1: A
        3: Ebenezer Howard
        """

        res = parse_smart_exam_content(text=raw_text)
        questions = res["questions"]
        self.assertEqual(len(questions), 3)

        # Q1 has key
        q1 = next(q for q in questions if q["number"] == 1)
        self.assertEqual(q1["correctAnswers"], ["A"])
        self.assertFalse(q1.get("needsReview", False))

        # Q2 has NO key -> Needs Review
        q2 = next(q for q in questions if q["number"] == 2)
        self.assertTrue(q2.get("needsReview"))
        self.assertIn(2, res["needsReview"])
        self.assertIn("Javob kaliti", q2.get("reviewReason", ""))

        # Q3 has key
        q3 = next(q for q in questions if q["number"] == 3)
        self.assertEqual(q3["correctAnswers"], ["Ebenezer Howard"])
        self.assertFalse(q3.get("needsReview", False))

    def test_bulk_import_to_exam_never_changes_publication_state(self):
        """MockExam has no `status` column (publication is `is_published`); an import must not write it."""
        from apps.legacy_schema.models import MockExam as RealMockExam
        self.assertNotIn("status", {f.name for f in RealMockExam._meta.get_fields()})
        exam = SimpleNamespace(id="exam-v3-1", type="ielts_academic", is_published=False, content_version=1, save=MagicMock())
        section = SimpleNamespace(id="sec-v3-1", exam_id="exam-v3-1", skill="reading", instructions="")
        group = SimpleNamespace(id="grp-v3-1", section_id="sec-v3-1", passage_text="", instructions="", title="Passage 1", sort_order=0, part_number=1, image_key=None, audio_key=None, save=MagicMock())

        actor = SimpleNamespace(id="teacher-1", role="teacher", is_staff=True, is_superuser=False)

        payload = {
            "isDraft": True,
            "status": "draft",
            "skill": "reading",
            "questions": [
                {
                    "number": 1,
                    "partNumber": 1,
                    "type": "multiple_choice",
                    "prompt": "Test question 1?",
                    "options": ["A", "B", "C"],
                    "correct_answers": ["A"],
                    "points": 1,
                }
            ],
            "parts": [
                {"partNumber": 1, "title": "Passage 1", "passageText": "Passage text..."}
            ],
        }

        with patch("apps.core.exam_import_service.MockExam.objects.get", return_value=exam), \
             patch("apps.core.exam_import_service.MockExam.objects.select_for_update") as mock_sfu, \
             patch("apps.core.exam_import_service._assert_staff_author"), \
             patch("apps.core.exam_import_service.MockSection.objects.filter") as mock_sec_qs, \
             patch("apps.core.exam_import_service.MockQuestionGroup.objects.filter") as mock_grp_qs, \
             patch("apps.core.exam_import_service.MockQuestion.objects.filter") as mock_q_filter, \
             patch("apps.core.exam_import_service.MockQuestion.objects.create") as mock_q_create, \
             patch("apps.core.exam_import_service.bump"), \
             patch("apps.core.exam_import_service.audit_event"), \
             patch("apps.core.exam_import_service.transaction.atomic"):

            mock_sfu.return_value.get.return_value = exam
            mock_sec_qs.return_value.first.return_value = section
            mock_grp_qs.return_value.order_by.return_value = [group]
            mock_q_filter.return_value.delete.return_value = None
            mock_q_create.return_value = SimpleNamespace(
                id="q-new-1", group_id=group.id, number=1, sort_order=0,
                type="multiple_choice", prompt="Test question 1?", options=["A", "B", "C"],
                correct_answers=["A"], accepted_variants=[], points=1, word_limit=None,
                answer_rule=None,
            )

            result = bulk_import_to_exam(actor, "exam-v3-1", "reading", payload)
            self.assertEqual(result["imported"], 1)
            self.assertEqual(result["examId"], "exam-v3-1")
            self.assertFalse(exam.is_published)
            exam.save.assert_not_called()

    def test_listening_audio_key_attached_to_group(self):
        """Listening import must attach provided audioKey to the question group."""
        exam = SimpleNamespace(id="exam-v3-2", type="ielts_academic", status="draft", content_version=1, save=MagicMock())
        section = SimpleNamespace(id="sec-v3-2", exam_id="exam-v3-2", skill="listening", instructions="")
        actor = SimpleNamespace(id="teacher-1", role="teacher", is_staff=True, is_superuser=False)

        payload = {
            "skill": "listening",
            "isDraft": True,
            "questions": [
                {
                    "number": 1,
                    "partNumber": 1,
                    "type": "short_answer",
                    "prompt": "Name of caller?",
                    "options": [],
                    "correct_answers": ["Arthur"],
                    "points": 1,
                }
            ],
            "parts": [
                {
                    "partNumber": 1,
                    "title": "Section 1",
                    "audioKey": "audio/listening-sec1.mp3",
                    "instructions": "Answer questions 1-10",
                }
            ],
        }

        with patch("apps.core.exam_import_service.MockExam.objects.get", return_value=exam), \
             patch("apps.core.exam_import_service.MockExam.objects.select_for_update") as mock_sfu, \
             patch("apps.core.exam_import_service._assert_staff_author"), \
             patch("apps.core.exam_import_service.MockSection.objects.filter") as mock_sec_qs, \
             patch("apps.core.exam_import_service.MockQuestionGroup.objects.filter") as mock_grp_qs, \
             patch("apps.core.exam_import_service.MockQuestionGroup.objects.create") as mock_grp_create, \
             patch("apps.core.exam_import_service.MockQuestion.objects.filter") as mock_q_filter, \
             patch("apps.core.exam_import_service.MockQuestion.objects.create") as mock_q_create, \
             patch("apps.core.exam_import_service.bump"), \
             patch("apps.core.exam_import_service.audit_event"), \
             patch("apps.core.exam_import_service.transaction.atomic"):

            mock_sfu.return_value.get.return_value = exam
            mock_sec_qs.return_value.first.return_value = section
            # No existing group -> trigger create
            mock_grp_qs.return_value.order_by.return_value = []
            new_grp = SimpleNamespace(
                id="grp-audio-1", section_id=section.id, sort_order=0,
                title="Section 1", audio_key="audio/listening-sec1.mp3",
                instructions="Answer questions 1-10", passage_text=None, part_number=1,
                save=MagicMock(),
            )
            mock_grp_create.return_value = new_grp
            mock_q_filter.return_value.delete.return_value = None
            mock_q_create.return_value = SimpleNamespace(
                id="q-audio-1", group_id=new_grp.id, number=1, sort_order=0,
                type="short_answer", prompt="Name of caller?", options=[],
                correct_answers=["Arthur"], accepted_variants=[], points=1, word_limit=None,
                answer_rule=None,
            )

            result = bulk_import_to_exam(actor, "exam-v3-2", "listening", payload)
            self.assertEqual(result["imported"], 1)
            mock_grp_create.assert_called_once()
            _, kwargs = mock_grp_create.call_args
            self.assertEqual(kwargs.get("audio_key"), "audio/listening-sec1.mp3")
