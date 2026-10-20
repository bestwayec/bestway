"""Unit test suite for Standalone Writing & Speaking Exams, OCR Extraction, and Teacher Override."""
from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.core import assessment, mock_attempts, multilevel, writing_ocr
from apps.core.mock_attempt_views import writing_ocr_view
from common.api.exceptions import ContractAPIException


class StandaloneWritingSpeakingReadinessTests(SimpleTestCase):
    def test_multilevel_readiness_allows_writing_speaking_profile(self):
        """Standalone writing_speaking profile must be supported without requiring all 4 sections."""
        exam_dict = {
            "specification_version": "UZBMB_MULTILEVEL_EN_2026_V2",
            "profile": "writing_speaking",
            "sections": [
                {
                    "skill": "writing",
                    "groups": [
                        {
                            "questions": [{"type": "essay_task1", "points": 5}],
                            "max_score": 5,
                        }
                    ],
                },
                {
                    "skill": "speaking",
                    "groups": [
                        {
                            "questions": [{"type": "speaking_task", "points": 5}],
                            "max_score": 5,
                        }
                    ],
                },
            ],
        }
        res = multilevel.readiness(exam_dict)
        self.assertTrue(res["supported"])
        self.assertEqual(res["issues"], [])

    def test_blueprint_issues_does_not_enforce_4_sections_when_not_full(self):
        """When full=False (partial practice or standalone), missing listening/reading is not an issue."""
        sections = [{"skill": "writing", "groups": []}]
        issues = multilevel.blueprint_issues(sections, full=False, specification_version="UZBMB_MULTILEVEL_EN_2026_V2")
        self.assertNotIn("Full Multilevel mock requires all four sections", issues)


class TeacherOverrideServiceTests(SimpleTestCase):
    def setUp(self):
        self.teacher = SimpleNamespace(id="teacher-1", name="Teacher Komil", role="teacher")
        self.admin = SimpleNamespace(id="admin-1", name="Admin Boss", role="admin")
        self.student = SimpleNamespace(id="student-1", name="Student Alisher", role="student")

        self.fake_attempt = SimpleNamespace(
            id="attempt-123",
            student_id="student-1",
            overall_band=None,
            section_bands={},
            standard_scores={},
            media_state={},
            status="in_progress",
            finished_at=None,
            save=MagicMock(),
        )

        self.fake_job_w = SimpleNamespace(
            id="job-w-1",
            skill="writing",
            ai_score=6.0,
            teacher_score=None,
            final_score=None,
            final_score_source="AI",
            status="PROCESSING",
            approved_feedback={},
            final_result={},
        )
        self.fake_job_s = SimpleNamespace(
            id="job-s-1",
            skill="speaking",
            ai_score=6.0,
            teacher_score=None,
            final_score=None,
            final_score_source="AI",
            status="PROCESSING",
            approved_feedback={},
            final_result={},
        )

    def test_teacher_grade_forbidden_for_student(self):
        with self.assertRaises(ContractAPIException) as ctx:
            assessment.teacher_grade_attempt(self.student, "attempt-123", {"final_score": 7.0})
        self.assertEqual(ctx.exception.status_code, 403)

    @patch("apps.core.assessment.MockAttempt.objects.filter")
    def test_teacher_grade_attempt_not_found(self, mock_att_filter):
        mock_att_filter.return_value.select_related.return_value.first.return_value = None
        with self.assertRaises(ContractAPIException) as ctx:
            assessment.teacher_grade_attempt(self.teacher, "unknown-id", {"final_score": 7.0})
        self.assertEqual(ctx.exception.status_code, 404)

    @patch("apps.core.assessment.MockAttempt.objects.filter")
    def test_teacher_grade_requires_score(self, mock_att_filter):
        mock_att_filter.return_value.select_related.return_value.first.return_value = self.fake_attempt
        with self.assertRaises(ContractAPIException) as ctx:
            assessment.teacher_grade_attempt(self.teacher, "attempt-123", {"teacher_comment": "No score here"})
        self.assertEqual(ctx.exception.status_code, 400)

    @patch("apps.core.assessment.MockAnswer.objects.filter")
    @patch("apps.core.assessment.AssessmentJob.objects.filter")
    @patch("apps.core.assessment.MockAttempt.objects.filter")
    def test_teacher_grade_attempt_success(self, mock_att_filter, mock_job_filter, mock_ans_filter):
        mock_att_filter.return_value.select_related.return_value.first.return_value = self.fake_attempt
        
        mock_job_qs = MagicMock()
        mock_job_qs.__iter__.return_value = [self.fake_job_w, self.fake_job_s]
        mock_job_filter.return_value = mock_job_qs

        mock_ans_qs = MagicMock()
        mock_ans_filter.return_value = mock_ans_qs

        payload = {
            "final_score": 7.0,
            "writing_score": 7.5,
            "speaking_score": 6.5,
            "teacher_comment": "Excellent handwriting and coherence.",
            "criteria_scores": {
                "task_achievement": 8.0,
                "coherence_cohesion": 7.5,
                "lexical_resource": 7.0,
                "grammatical_range": 7.0,
            },
        }

        result = assessment.teacher_grade_attempt(self.teacher, "attempt-123", payload)
        self.assertTrue(result["success"])
        self.assertTrue(result["isTeacherReviewed"])
        self.assertEqual(result["finalScore"], 7.0)
        self.assertEqual(result["sectionBands"]["writing"], 7.5)
        self.assertEqual(result["sectionBands"]["speaking"], 6.5)
        self.assertEqual(result["teacherComment"], "Excellent handwriting and coherence.")

        # Ensure attempt save was called
        self.fake_attempt.save.assert_called_once()
        self.assertEqual(self.fake_attempt.status, "completed")
        self.assertEqual(self.fake_attempt.media_state["is_teacher_reviewed"], True)


class ForAttemptOverviewTests(SimpleTestCase):
    @patch("apps.core.assessment.assert_can_view")
    @patch("apps.core.assessment.SpeechTranscript.objects.filter")
    @patch("apps.core.assessment.AssessmentEvaluation.objects.filter")
    @patch("apps.core.assessment.MockAnswer.objects.filter")
    @patch("apps.core.assessment.AssessmentJob.objects.filter")
    @patch("apps.core.assessment.MockAttempt.objects.filter")
    def test_for_attempt_includes_ocr_images_and_teacher_review(
        self, mock_att_filter, mock_job_filter, mock_ans_filter, mock_eval_filter, mock_stt_filter, mock_can_view
    ):
        teacher = SimpleNamespace(id="teacher-1", name="Teacher Komil", role="teacher")
        attempt = SimpleNamespace(
            id="attempt-456",
            student_id="student-1",
            overall_band=7.0,
            status="completed",
            media_state={"is_teacher_reviewed": True, "teacher_comment": "Good job!", "teacher_reviewed_by": "Teacher Komil"},
        )
        mock_att_filter.return_value.select_related.return_value.first.return_value = attempt

        job_w = SimpleNamespace(
            id="job-w-1",
            skill="writing",
            program="IELTS",
            status="SUCCEEDED",
            policy_mode="FULL_MOCK_AI_WITH_REVIEW",
            version=1,
            ai_score=6.5,
            teacher_score=7.0,
            final_score=7.0,
            final_score_source="TEACHER",
            confidence=0.9,
            rubric_version="V1",
            prompt_version="V1",
            failure_code=None,
            final_result={},
            approved_feedback={"teacherComment": "Good job!"},
            selected_evaluation_id=None,
            input_snapshot={
                "parts": [
                    {
                        "id": "part1",
                        "max": 9,
                        "task": "Task 2 Essay",
                        "context": "",
                        "responses": [
                            {
                                "questionId": "q-w-1",
                                "partNumber": 1,
                                "prompt": "Prompt 1",
                                "originalResponse": "Student essay text",
                            }
                        ],
                    }
                ]
            },
        )
        mock_job_filter.return_value.order_by.return_value = [job_w]
        mock_eval_filter.return_value.order_by.return_value = []
        mock_stt_filter.return_value.order_by.return_value = []

        fake_ans = SimpleNamespace(
            question_id="q-w-1",
            response="Student essay text",
            rubric_scores={"imageKeys": ["writing-ocr/p1.jpg"], "ocrText": "Student essay text"},
            score=7.0,
            graded_by_id="teacher-1",
            feedback="Good job!",
        )
        mock_ans_filter.return_value = [fake_ans]

        overview = assessment.for_attempt(teacher, "attempt-456")
        self.assertEqual(overview["attemptId"], "attempt-456")
        self.assertTrue(overview["is_teacher_reviewed"])
        self.assertTrue(overview["teacher_confirmed"])
        self.assertEqual(overview["teacher_comment"], "Good job!")

        sub = overview["assessments"][0]["submissions"][0]
        self.assertEqual(sub["imageKeys"], ["writing-ocr/p1.jpg"])
        self.assertEqual(sub["imageUrls"], ["/media/writing-ocr/p1.jpg"])
        self.assertEqual(sub["ocrText"], "Student essay text")


class WritingOcrViewTests(SimpleTestCase):
    @patch("apps.legacy_schema.models.MockAnswer.objects.update_or_create")
    @patch("apps.legacy_schema.models.MockAnswer.objects.filter")
    @patch("apps.core.content_media.storage_path")
    @patch("apps.core.writing_ocr.extract_text_from_images")
    @patch("apps.legacy_schema.models.MockAttempt.objects.filter")
    def test_writing_ocr_view_flow(
        self, mock_att_filter, mock_ocr, mock_storage, mock_ans_filter, mock_update_or_create
    ):
        student = SimpleNamespace(id="student-1", role="student", is_authenticated=True)
        attempt = SimpleNamespace(id="attempt-789", student_id="student-1", exam_id="exam-1")
        mock_att_filter.return_value.first.return_value = attempt
        mock_ans_filter.return_value.first.return_value = None

        mock_target = MagicMock()
        mock_storage.return_value = mock_target

        mock_ocr.return_value = {
            "ocrText": "Extracted essay text from handwritten page.",
            "pages": ["Extracted essay text from handwritten page."],
            "wordCount": 6,
            "provider": "openrouter",
        }

        rf = APIRequestFactory()
        fake_file = SimpleUploadedFile("page1.jpg", b"fake image bytes", content_type="image/jpeg")
        req = rf.post(
            "/api/backend/v1/mock/attempts/attempt-789/writing-ocr",
            {"file": fake_file, "questionId": "q-123"},
            format="multipart",
        )
        force_authenticate(req, user=student)

        resp = writing_ocr_view(req, "attempt-789", "q-123")
        self.assertEqual(resp.status_code, 200)
        data = resp.data
        self.assertEqual(data["data"]["ocrText"], "Extracted essay text from handwritten page.")
        self.assertEqual(len(data["data"]["imageUrls"]), 1)
        mock_update_or_create.assert_called_once()
