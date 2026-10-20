"""Unit test suite for Dual-Layer Grading (Teacher Override) & Group Exam Multi-Format Exports (Excel/PDF)."""
from __future__ import annotations

import io
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import openpyxl
from django.test import SimpleTestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.core import assessment, group_exam_export
from apps.core.assessment_views import teacher_grade
from apps.core.group_report_views import (
    group_exam_export_excel_view,
    group_exam_export_pdf_view,
)
from common.api.exceptions import ContractAPIException


class TeacherGradingOverrideTests(SimpleTestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.teacher = SimpleNamespace(
            id="teacher-001",
            name="Teacher Roziyev",
            role="teacher",
            phone="+998901234567",
            is_authenticated=True,
        )
        self.other_teacher = SimpleNamespace(
            id="teacher-002",
            name="Teacher Stranger",
            role="teacher",
            phone="+998909999999",
            is_authenticated=True,
        )
        self.admin = SimpleNamespace(
            id="admin-001",
            name="Admin User",
            role="admin",
            phone="+998900000000",
            is_authenticated=True,
        )
        self.student = SimpleNamespace(
            id="student-001",
            name="Student Komil",
            role="student",
            phone="+998901112233",
            is_authenticated=True,
        )

        self.fake_attempt = SimpleNamespace(
            id="att-123",
            overall_band=5.0,
            overall_score=50.0,
            section_bands={"writing": 5.0, "speaking": 5.0},
            standard_scores={"writing": 50, "speaking": 50},
            media_state={},
            status="in_progress",
            finished_at=None,
            save=MagicMock(),
            student=SimpleNamespace(group=SimpleNamespace(teacher_id="teacher-001")),
        )

        self.fake_job_w = SimpleNamespace(
            id="job-w",
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
            id="job-s",
            skill="speaking",
            ai_score=6.0,
            teacher_score=None,
            final_score=None,
            final_score_source="AI",
            status="PROCESSING",
            approved_feedback={},
            final_result={},
        )

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
            "writing_score": 6.5,
            "speaking_score": 7.0,
            "final_score": 6.75,
            "teacher_comment": "Excellent coherence and vocabulary range.",
        }

        res = assessment.teacher_grade_attempt(self.teacher, "att-123", payload)

        self.assertTrue(res["success"])
        self.assertTrue(res["isTeacherReviewed"])
        self.assertTrue(res["is_reviewed_by_teacher"])
        self.assertEqual(res["finalScore"], 6.75)
        self.assertEqual(res["final_score"], 6.75)
        self.assertEqual(res["teacherComment"], "Excellent coherence and vocabulary range.")
        self.assertEqual(self.fake_attempt.status, "completed")
        self.fake_attempt.save.assert_called_once()

    @patch("apps.core.assessment.MockAnswer.objects.filter")
    @patch("apps.core.assessment.AssessmentJob.objects.filter")
    @patch("apps.core.assessment.MockAttempt.objects.filter")
    def test_teacher_grade_with_total_score_fallback(self, mock_att_filter, mock_job_filter, mock_ans_filter):
        mock_att_filter.return_value.select_related.return_value.first.return_value = self.fake_attempt

        mock_job_qs = MagicMock()
        mock_job_qs.__iter__.return_value = []
        mock_job_filter.return_value = mock_job_qs
        mock_ans_filter.return_value = MagicMock()

        payload = {
            "total_score": 7.5,
            "teacher_comment": "Great performance overall.",
        }

        res = assessment.teacher_grade_attempt(self.admin, "att-123", payload)
        self.assertTrue(res["success"])
        self.assertEqual(res["final_score"], 7.5)
        self.assertEqual(res["total_score"], 7.5)

    def test_teacher_grade_forbidden_for_student(self):
        with self.assertRaises(ContractAPIException) as ctx:
            assessment.teacher_grade_attempt(self.student, "att-123", {"final_score": 6.0})
        self.assertEqual(ctx.exception.status_code, 403)

    @patch("apps.core.assessment.MockAttempt.objects.filter")
    def test_teacher_grade_forbidden_for_unassigned_teacher(self, mock_att_filter):
        mock_att_filter.return_value.select_related.return_value.first.return_value = self.fake_attempt

        with self.assertRaises(ContractAPIException) as ctx:
            assessment.teacher_grade_attempt(self.other_teacher, "att-123", {"final_score": 6.0})
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertIn("biriktirilmagan", ctx.exception.contract_message)


class GroupExamExportServiceTests(SimpleTestCase):
    def setUp(self):
        self.teacher = SimpleNamespace(
            id="teacher-001",
            name="Komiljon Roziyev",
            role="teacher",
            phone="+998901234567",
            is_authenticated=True,
        )
        self.student = SimpleNamespace(
            id="student-001",
            name="Alisher Navoiy",
            role="student",
            phone="+998901112233",
            is_authenticated=True,
        )

    def test_compute_cefr_level(self):
        self.assertEqual(group_exam_export.compute_cefr_level(75), "C1")
        self.assertEqual(group_exam_export.compute_cefr_level(62), "B2")
        self.assertEqual(group_exam_export.compute_cefr_level(45), "B1")
        self.assertEqual(group_exam_export.compute_cefr_level(35), "A2")
        self.assertEqual(group_exam_export.compute_cefr_level(7.5), "C1")
        self.assertEqual(group_exam_export.compute_cefr_level(None), "-")
        self.assertEqual(group_exam_export.compute_cefr_level(None, existing_cefr="b2"), "B2")

    @patch("apps.core.group_exam_export.AssessmentJob.objects")
    @patch("apps.core.group_exam_export.MockAttempt.objects")
    @patch("apps.core.group_exam_export.StudentProfile.objects")
    @patch("apps.core.group_exam_export.MockExam.objects")
    @patch("apps.core.group_exam_export.Group.objects")
    def test_get_group_exam_export_data(
        self, mock_group_qs, mock_exam_qs, mock_roster_qs, mock_attempts_qs, mock_jobs_qs
    ):
        mock_group = MagicMock(id="group-1", teacher_id="teacher-001")
        mock_group.name = "IELTS Intensive Morning"
        mock_group.teacher = SimpleNamespace(name="Komiljon Roziyev", phone="+998901234567")
        mock_group_qs.filter.return_value.select_related.return_value.first.return_value = mock_group

        mock_exam = MagicMock(id="exam-1", type="multilevel")
        mock_exam.title = "Multi-Level Practice 1"
        mock_exam_qs.filter.return_value.first.return_value = mock_exam

        student_user = SimpleNamespace(id="u-1", name="Komiljon Roziyev", phone="+998901234567")
        st_profile = MagicMock(user_id="u-1", user=student_user)
        mock_roster_qs.filter.return_value.select_related.return_value.order_by.return_value = [st_profile]

        att = MagicMock(
            id="att-1",
            student_id="u-1",
            status="completed",
            overall_band=7.0,
            overall_score=70.0,
            section_bands={"writing": 6.5, "speaking": 7.5},
            standard_scores={"writing": 65, "speaking": 75},
            media_state={"is_teacher_reviewed": True, "teacher_score": 7.0, "teacher_comment": "Zo'r"},
            cefr_level="C1",
            submitted_at=None,
            started_at=None,
        )
        mock_attempts_qs.filter.return_value.order_by.return_value = [att]

        job_w = MagicMock(attempt_id="att-1", skill="writing", ai_score=6.0, teacher_score=6.5, final_score=6.5, final_score_source="TEACHER")
        job_s = MagicMock(attempt_id="att-1", skill="speaking", ai_score=7.0, teacher_score=7.5, final_score=7.5, final_score_source="TEACHER")
        mock_jobs_qs.filter.return_value.order_by.return_value = [job_w, job_s]

        data = group_exam_export.get_group_exam_export_data(self.teacher, "group-1", "exam-1")

        self.assertEqual(data["group"]["name"], "IELTS Intensive Morning")
        self.assertEqual(data["exam"]["title"], "Multi-Level Practice 1")
        self.assertEqual(data["totalStudents"], 1)
        self.assertEqual(data["submittedCount"], 1)
        self.assertEqual(data["averageFinalScore"], 7.0)
        self.assertEqual(data["cefrDistribution"]["C1"], 1)
        self.assertEqual(len(data["students"]), 1)
        st_row = data["students"][0]
        self.assertEqual(st_row["name"], "Komiljon Roziyev")
        self.assertEqual(st_row["writing_score"], 6.5)
        self.assertEqual(st_row["speaking_score"], 7.5)
        self.assertEqual(st_row["cefr_level"], "C1")
        self.assertEqual(st_row["status"], "Ko'rib chiqildi")

    def test_generate_group_exam_excel_output(self):
        sample_data = {
            "group": {"id": "group-1", "name": "B2 Exam Group", "teacherName": "Komiljon Roziyev"},
            "exam": {"id": "exam-1", "title": "DTM Multi-Level Test 1", "type": "multilevel"},
            "totalStudents": 2,
            "submittedCount": 2,
            "submissionRate": 100.0,
            "averageFinalScore": 6.5,
            "averageWritingScore": 6.0,
            "averageSpeakingScore": 7.0,
            "cefrDistribution": {"C1": 1, "B2": 1, "B1": 0, "A2": 0, "A1": 0},
            "exportedAt": "2026-10-20 20:30:00",
            "students": [
                {
                    "number": 1,
                    "student_id": "u-1",
                    "name": "Olimjon Shokirov",
                    "phone": "+998901112233",
                    "attempt_id": "att-1",
                    "submitted_at": "2026-10-20 18:00",
                    "writing_score": 6.0,
                    "speaking_score": 7.0,
                    "ai_score": 6.5,
                    "teacher_score": 6.5,
                    "final_score": 6.5,
                    "cefr_level": "B2",
                    "status": "Ko'rib chiqildi",
                },
                {
                    "number": 2,
                    "student_id": "u-2",
                    "name": "Zuhra Aliyeva",
                    "phone": "+998904445566",
                    "attempt_id": "att-2",
                    "submitted_at": "2026-10-20 18:30",
                    "writing_score": 7.0,
                    "speaking_score": 7.5,
                    "ai_score": 7.0,
                    "teacher_score": 7.5,
                    "final_score": 7.5,
                    "cefr_level": "C1",
                    "status": "Ko'rib chiqildi",
                },
            ],
        }

        excel_bytes = group_exam_export.generate_group_exam_excel(sample_data)
        self.assertTrue(excel_bytes.startswith(b"PK\x03\x04"))

        wb = openpyxl.load_workbook(io.BytesIO(excel_bytes))
        ws = wb.active
        self.assertEqual(ws.title, "Imtihon Natijalari")
        self.assertIn("GRAND EDUCATION", ws["A1"].value)
        self.assertEqual(ws["B8"].value, "Olimjon Shokirov")
        self.assertEqual(ws["B9"].value, "Zuhra Aliyeva")

    def test_generate_group_exam_pdf_output(self):
        sample_data = {
            "group": {"id": "group-1", "name": "B2 Exam Group", "teacherName": "Komiljon Roziyev"},
            "exam": {"id": "exam-1", "title": "DTM Multi-Level Test 1", "type": "multilevel"},
            "totalStudents": 1,
            "submittedCount": 1,
            "submissionRate": 100.0,
            "averageFinalScore": 6.5,
            "averageWritingScore": 6.0,
            "averageSpeakingScore": 7.0,
            "cefrDistribution": {"C1": 0, "B2": 1, "B1": 0, "A2": 0, "A1": 0},
            "exportedAt": "2026-10-20 20:30:00",
            "students": [
                {
                    "number": 1,
                    "student_id": "u-1",
                    "name": "Olimjon Shokirov",
                    "phone": "+998901112233",
                    "attempt_id": "att-1",
                    "submitted_at": "2026-10-20 18:00",
                    "writing_score": 6.0,
                    "speaking_score": 7.0,
                    "ai_score": 6.5,
                    "teacher_score": 6.5,
                    "final_score": 6.5,
                    "cefr_level": "B2",
                    "status": "Ko'rib chiqildi",
                }
            ],
        }

        pdf_bytes = group_exam_export.generate_group_exam_pdf(sample_data)
        self.assertTrue(pdf_bytes.startswith(b"%PDF"))
        self.assertGreater(len(pdf_bytes), 1000)


class GroupExamExportApiEndpointTests(SimpleTestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.teacher = SimpleNamespace(
            id="teacher-001",
            name="Komiljon Roziyev",
            role="teacher",
            phone="+998901234567",
            is_authenticated=True,
        )
        self.student = SimpleNamespace(
            id="student-001",
            name="Alisher",
            role="student",
            phone="+998901112233",
            is_authenticated=True,
        )

    @patch("apps.core.group_exam_export.generate_group_exam_excel")
    @patch("apps.core.group_exam_export.get_group_exam_export_data")
    def test_group_exam_export_excel_api(self, mock_get_data, mock_gen_excel):
        mock_get_data.return_value = {"group": {"id": "g-1"}, "exam": {"id": "e-1"}}
        mock_gen_excel.return_value = b"PK\x03\x04fakexlsxdata"

        request = self.factory.get("/api/v1/groups/g-1/exams/e-1/export/excel")
        force_authenticate(request, user=self.teacher)

        response = group_exam_export_excel_view(request, group_id="g-1", exam_id="e-1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response["Content-Type"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        self.assertIn("attachment; filename=", response["Content-Disposition"])
        self.assertEqual(response.content, b"PK\x03\x04fakexlsxdata")

    @patch("apps.core.group_exam_export.generate_group_exam_pdf")
    @patch("apps.core.group_exam_export.get_group_exam_export_data")
    def test_group_exam_export_pdf_api(self, mock_get_data, mock_gen_pdf):
        mock_get_data.return_value = {"group": {"id": "g-1"}, "exam": {"id": "e-1"}}
        mock_gen_pdf.return_value = b"%PDF-1.4-fakepdfdata"

        request = self.factory.get("/api/v1/groups/g-1/exams/e-1/export/pdf")
        force_authenticate(request, user=self.teacher)

        response = group_exam_export_pdf_view(request, group_id="g-1", exam_id="e-1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertIn("inline; filename=", response["Content-Disposition"])
        self.assertEqual(response.content, b"%PDF-1.4-fakepdfdata")

    def test_group_exam_export_excel_denied_for_student(self):
        request = self.factory.get("/api/v1/groups/g-1/exams/e-1/export/excel")
        force_authenticate(request, user=self.student)

        response = group_exam_export_excel_view(request, group_id="g-1", exam_id="e-1")
        self.assertEqual(response.status_code, 403)
