"""Tests for v0.7.0 Writing Vision OCR, 3-Tier Gemini Fallback, Teacher Groups/Analytics, Excel Export, and Superadmin."""
from __future__ import annotations
from contextlib import nullcontext

import json
import os
from datetime import UTC, datetime
from io import BytesIO
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import SimpleTestCase
from openpyxl import load_workbook
from rest_framework.test import APIClient
import config.urls

from apps.core import assessment_providers, assessment_worker, writing_ocr
from tests.test_assessment_quality import fixture as quality_fixture


class WritingOcrAndGeminiFallbackTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()

    def test_extract_and_evaluate_images_multi_page_with_gemini_fallback(self):
        page1 = (b"Page 1 essay: Education plays a pivotal role in modern society.", "image/jpeg")
        page2 = (b"Page 2 essay: Furthermore, technology empowers students globally.", "image/png")

        def fail_post(url, payload, headers, timeout=8.0):
            if "openrouter.ai" in url or "xkiro.com" in url:
                raise RuntimeError("Primary/secondary unavailable")
            if "generativelanguage.googleapis.com" in url:
                if "inline_data" in json.dumps(payload):
                    return {
                        "candidates": [
                            {
                                "content": {
                                    "parts": [
                                        {"text": "Extracted handwritten paragraph from Gemini Vision."}
                                    ]
                                }
                            }
                        ]
                    }
                return {
                    "candidates": [
                        {
                            "content": {
                                "parts": [
                                    {
                                        "text": json.dumps({
                                            "task_achievement": 7.0,
                                            "coherence_cohesion": 7.5,
                                            "lexical_resource": 7.0,
                                            "grammatical_range": 6.5,
                                            "overall_band": 7.0,
                                            "strengths": ["Strong paragraphing", "Academic vocabulary"],
                                            "weaknesses": ["Minor article omissions"],
                                            "feedback": "Well-structured Task 2 essay with clear arguments.",
                                        })
                                    }
                                ]
                            }
                        }
                    ]
                }
            raise RuntimeError("Unknown URL")

        with patch.dict(os.environ, {"OPENROUTER_API_KEY": "or-key", "XKIRO_API_KEY": "xk-key", "GEMINI_API_KEY": "gm-test-key"}, clear=False), \
             patch.object(writing_ocr, "_post_json", side_effect=fail_post):
            res = writing_ocr.extract_and_evaluate_images([page1, page2], task_prompt="Discuss education.", task_type="task2")
            self.assertEqual(len(res["pages"]), 2)
            self.assertIn("Extracted handwritten paragraph from Gemini Vision.", res["ocrText"])
            self.assertEqual(res["overall_band"], 7.0)
            self.assertEqual(res["task_achievement"], 7.0)
            self.assertEqual(res["coherence_cohesion"], 7.5)
            self.assertEqual(res["provider"], "gemini")

    def test_unapproved_gemini_does_not_receive_assessment_input(self):
        input_data, _ = quality_fixture("writing")
        env = {"ASSESSMENT_PROVIDER": "openrouter", "OPENROUTER_API_KEY": "fixture", "GEMINI_API_KEY": "fixture"}
        with patch.dict(os.environ, env, clear=True), patch.object(assessment_providers, "provider_json") as http:
            with self.assertRaisesRegex(assessment_providers.ProviderError, "ASSESSMENT_EXTERNAL_AI_DISABLED"):
                assessment_providers.assess(input_data, "PRIMARY")
        http.assert_not_called()

    def test_writing_ocr_upload_endpoint_saves_images_and_updates_mock_answer(self):
        student = SimpleNamespace(id="student-1", role="student", is_authenticated=True)
        self.client.force_authenticate(student)

        attempt = SimpleNamespace(id="att-100", student_id="student-1", exam_id="exam-1", status="in_progress")
        img1 = SimpleUploadedFile("page1.jpg", b"\xff\xd8\xff\xe0Handwritten page one text here.", content_type="image/jpeg")
        img2 = SimpleUploadedFile("page2.png", b"\x89PNG\r\n\x1a\nHandwritten page two text here.", content_type="image/png")

        with TemporaryDirectory() as tmp_dir, \
             patch.dict(os.environ, {"STORAGE_DIR": tmp_dir}), \
             patch("apps.core.mock_attempt_views.writable_handwriting") as authorized, \
             patch("apps.core.mock_attempt_views.transaction.atomic", new=nullcontext), \
             patch("apps.core.mock_attempt_views.attempt_signature.verify_request"), \
             patch("apps.core.mock_attempt_views.exam_session.guard"), \
             patch("apps.legacy_schema.models.MockAnswer.objects.filter") as mock_ans_filter, \
             patch("apps.legacy_schema.models.MockAnswer.objects.update_or_create") as mock_upsert, \
             patch.object(writing_ocr, "extract_text_from_images", return_value={
                 "ocrText": "First page paragraph.\n\nSecond page conclusion.",
                 "pages": ["First page paragraph.", "Second page conclusion."],
                 "wordCount": 6,
                 "provider": "gemini",
             }):
            authorized.return_value = attempt
            mock_ans_filter.return_value.first.return_value = None

            response = self.client.post(
                "/v1/mock/attempts/att-100/writing/q-writing-2/ocr",
                {"images": [img1, img2]},
                format="multipart",
            )
            self.assertEqual(response.status_code, 200)
            data = response.data["data"]
            self.assertEqual(data["questionId"], "q-writing-2")
            self.assertEqual(data["ocrText"], "First page paragraph.\n\nSecond page conclusion.")
            self.assertEqual(data["wordCount"], 6)
            self.assertEqual(len(data["imageKeys"]), 2)
            self.assertEqual(len(data["imageUrls"]), 2)
            mock_upsert.assert_called_once()
            call_kwargs = mock_upsert.call_args.kwargs
            self.assertEqual(call_kwargs["attempt_id"], "att-100")
            self.assertEqual(call_kwargs["question_id"], "q-writing-2")
            self.assertEqual(call_kwargs["defaults"]["response"], "First page paragraph.\n\nSecond page conclusion.")
            self.assertEqual(len(call_kwargs["defaults"]["rubric_scores"]["imageKeys"]), 2)

    def test_assessment_worker_finish_triggers_telegram_notification(self):
        fake_job = SimpleNamespace(id="job-99", attempt_id="att-99", skill="writing", status="SUCCEEDED", final_score_source="TEACHER")
        with patch("apps.core.telegram_delivery.notify_submission_result", create=True) as mock_notify:
            assessment_worker.finish(fake_job)
            mock_notify.assert_called_once_with(fake_job)


class TeacherGroupsAnalyticsAndExcelExportTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()

    def test_teacher_can_create_group_and_defaults_teacher_id(self):
        teacher = SimpleNamespace(id="teacher-77", role="teacher", is_authenticated=True, name="Mr. Teacher")
        self.client.force_authenticate(teacher)

        created_group = SimpleNamespace(
            id="grp-new",
            name="IELTS Intensive 7.5",
            teacher_id="teacher-77",
            teacher=SimpleNamespace(name="Mr. Teacher"),
            schedule=[{"day": "mon", "startTime": "14:00", "endTime": "16:00"}],
            created_at=datetime(2026, 10, 16, tzinfo=UTC),
        )

        class DummyAtomic:
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False

        with patch("apps.core.groups.transaction.atomic", return_value=DummyAtomic()), \
             patch("apps.core.groups.Group.objects.create", return_value=created_group) as mock_create, \
             patch("apps.core.groups.audit"), \
             patch("apps.core.groups.get_group", return_value=created_group), \
             patch("apps.core.groups.StudentProfile.objects.filter") as mock_sp_filter:
            mock_sp_filter.return_value.select_related.return_value.order_by.return_value = []

            res = self.client.post(
                "/v1/groups",
                {
                    "name": "IELTS Intensive 7.5",
                    "schedule": [{"day": "mon", "startTime": "14:00", "endTime": "16:00"}],
                },
                format="json",
            )
            self.assertEqual(res.status_code, 201)
            self.assertEqual(res.data["data"]["teacherId"], "teacher-77")
            self.assertEqual(res.data["data"]["name"], "IELTS Intensive 7.5")
            mock_create.assert_called_once()
            self.assertEqual(mock_create.call_args.kwargs["teacher_id"], "teacher-77")

    def test_group_detail_includes_student_scores_and_group_analytics(self):
        teacher = SimpleNamespace(id="teacher-1", role="teacher", is_authenticated=True)
        self.client.force_authenticate(teacher)

        group_obj = SimpleNamespace(
            id="grp-1",
            name="IELTS Pro",
            teacher_id="teacher-1",
            teacher=SimpleNamespace(name="Teacher One"),
            schedule=[],
            created_at=datetime(2026, 10, 1, tzinfo=UTC),
        )
        student_profile = SimpleNamespace(
            user_id="stu-1",
            is_approved=True,
            current_points=180,
            user=SimpleNamespace(
                id="stu-1",
                name="Madina Karimova",
                phone="+998901112233",
                email="madina@example.com",
                is_active=True,
            ),
        )
        attempt_obj = SimpleNamespace(
            id="att-1",
            student_id="stu-1",
            status="completed",
            section_bands={"listening": 7.5, "reading": 7.0, "writing": 6.5, "speaking": 7.0},
            standard_scores=None,
            raw_scores=None,
            overall_band=7.0,
            overall_score=None,
            cefr_level="C1",
            finished_at=datetime(2026, 10, 15, 12, 0, tzinfo=UTC),
            submitted_at=datetime(2026, 10, 15, 12, 0, tzinfo=UTC),
            started_at=datetime(2026, 10, 15, 10, 0, tzinfo=UTC),
            exam=SimpleNamespace(title="IELTS Mock #1"),
        )

        with patch("apps.core.groups.get_group", return_value=group_obj), \
             patch("apps.core.groups.StudentProfile.objects.filter") as mock_sp, \
             patch("apps.core.teacher_analytics.classroom_attempts") as mock_att, \
             patch("apps.core.groups.TestAttempt.objects.filter") as mock_leg:
            mock_sp.return_value.select_related.return_value.order_by.return_value = [student_profile]
            mock_att.return_value.filter.return_value.select_related.return_value.order_by.return_value = [attempt_obj]
            mock_leg.return_value.order_by.return_value = []

            res = self.client.get("/v1/groups/grp-1")
            self.assertEqual(res.status_code, 200)
            payload = res.data["data"]
            self.assertEqual(payload["analytics"]["averageBandScore"], 7.0)
            self.assertEqual(payload["analytics"]["totalCompletedAttempts"], 1)
            self.assertEqual(payload["analytics"]["activeStudentsCount"], 1)
            stu = payload["students"][0]
            self.assertEqual(stu["completedExamsCount"], 1)
            self.assertEqual(stu["writingScore"], 6.5)
            self.assertEqual(stu["speakingScore"], 7.0)
            self.assertEqual(stu["overallBand"], 7.0)

    def test_group_excel_export_generates_valid_openpyxl_workbook(self):
        teacher = SimpleNamespace(id="teacher-1", role="teacher", is_authenticated=True)
        self.client.force_authenticate(teacher)

        report = {
            "groupName": "IELTS Band 8",
            "teacherName": "Teacher One",
            "totalStudents": 1,
            "totalMockAttempts": 2,
            "students": [{"name": "Sardor Aliyev", "attendanceRate": None, "mockAttemptsCount": 2,
                          "scoresByScale": {"ielts_academic": 7.5, "multilevel": 61},
                          "phone": "+998901234567", "feedback": "Private feedback"}],
        }
        with patch("apps.core.group_report.get_group_analytics", return_value=report) as analytics:
            res = self.client.get("/v1/groups/grp-excel/export/excel?track=ielts_academic")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res["Content-Type"], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        self.assertIn(".xlsx", res["Content-Disposition"])
        analytics.assert_called_once_with(teacher, "grp-excel", {"track": "ielts_academic"})
        wb = load_workbook(BytesIO(res.content))
        sheet = wb["O'quvchilar"]
        self.assertEqual(sheet["A2"].value, "Sardor Aliyev")
        self.assertEqual(sheet["D2"].value, 7.5)
        self.assertEqual(sheet["F2"].value, 61)
        self.assertNotIn("+998901234567", list(sheet.values)[1])
        self.assertNotIn("Private feedback", list(sheet.values)[1])

    def test_only_superadmin_can_delete_mock_exam(self):
        for role in ("teacher", "admin", "student"):
            actor = SimpleNamespace(id="actor", role=role, is_authenticated=True)
            self.client.force_authenticate(actor)
            with patch("apps.core.mock_authoring.delete_exam") as delete:
                response = self.client.delete("/v1/mock/exams/exam-del-1")
                self.assertEqual(response.status_code, 403)
                delete.assert_not_called()
        actor = SimpleNamespace(id="super", role="super_admin", is_authenticated=True)
        self.client.force_authenticate(actor)
        with patch("apps.core.mock_authoring.delete_exam", return_value={"deleted": True}) as delete:
            response = self.client.delete("/v1/mock/exams/exam-del-1")
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.data["data"]["deleted"])
            delete.assert_called_once_with(actor, "exam-del-1")

    def test_ensure_superadmin_management_command_sets_telegram_id_5582178765(self):
        existing_admin = SimpleNamespace(
            id="super-1",
            email="superadmin@bestwayec.uz",
            role="admin",
            is_active=False,
            telegram_chat_id=None,
        )
        with patch("apps.core.management.commands.ensure_superadmin.User.objects.filter") as mock_user_filter, \
             patch("apps.core.management.commands.ensure_superadmin.StudentProfile.objects.filter"):
            mock_user_filter.return_value.order_by.return_value.first.return_value = existing_admin
            mock_update = mock_user_filter.return_value.update

            from io import StringIO
            out = StringIO()
            call_command("ensure_superadmin", "--telegram-id", "5582178765", stdout=out)
            mock_update.assert_called_once()
            update_kwargs = mock_update.call_args.kwargs
            self.assertEqual(update_kwargs["role"], "super_admin")
            self.assertTrue(update_kwargs["is_active"])
            self.assertEqual(update_kwargs["telegram_chat_id"], "5582178765")
