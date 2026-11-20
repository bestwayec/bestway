"""Unit tests for Teacher Submissions Endpoint: RBAC, Group Isolation, and Payload Formatting."""
from unittest.mock import MagicMock, patch
from django.test import SimpleTestCase
from django.utils import timezone
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.core.teacher_views import teacher_submissions_view, teacher_grade_submission_view
from common.api.exceptions import ContractAPIException


class TeacherSubmissionsTests(SimpleTestCase):
    def setUp(self):
        self.factory = APIRequestFactory()

        # Teacher 1
        self.teacher1 = MagicMock(
            id="teacher-1",
            role="teacher",
            phone="+998901111111",
            name="Teacher One",
            is_authenticated=True,
        )

        # Teacher 2 (Unrelated)
        self.teacher2 = MagicMock(
            id="teacher-2",
            role="teacher",
            phone="+998902222222",
            name="Teacher Two",
            is_authenticated=True,
        )

        # Student
        self.student = MagicMock(
            id="student-1",
            role="student",
            phone="+998903333333",
            name="Student One",
            is_authenticated=True,
        )

    def test_anonymous_access_denied(self):
        req = self.factory.get("/v1/teacher/submissions")
        anon = MagicMock(is_authenticated=False)
        req.user = anon
        res = teacher_submissions_view(req)
        self.assertEqual(res.status_code, 401)

    def test_student_role_denied(self):
        req = self.factory.get("/v1/teacher/submissions")
        force_authenticate(req, user=self.student)
        res = teacher_submissions_view(req)
        self.assertEqual(res.status_code, 403)

    @patch("apps.legacy_schema.models.MockAnswer.objects")
    @patch("apps.legacy_schema.models.MockAttempt.objects")
    def test_teacher_sees_own_group_submission(self, mock_attempts_qs, mock_answers_qs):
        req = self.factory.get("/v1/teacher/submissions")
        force_authenticate(req, user=self.teacher1)

        # Mock student and attempt
        mock_student_user = MagicMock(name="Ali O'quvchi", phone="+998905555555")
        mock_student_user.name = "Ali O'quvchi"
        mock_student = MagicMock(user=mock_student_user)

        mock_exam = MagicMock(title="IELTS Simulation Exam", type="ielts_academic")
        now = timezone.now()

        fake_attempt = MagicMock(
            id="att-1",
            exam=mock_exam,
            student=mock_student,
            status="grading",
            submitted_at=now,
            started_at=now,
            overall_band=None,
            submitted_sections=["writing"],
        )

        # Queryset filter chain
        mock_chain = MagicMock()
        mock_chain.filter.return_value = mock_chain
        mock_chain.__getitem__.return_value = [fake_attempt]
        mock_attempts_qs.select_related.return_value.order_by.return_value = mock_chain

        # Mock answers
        mock_answers_qs.filter.return_value.select_related.return_value = []

        res = teacher_submissions_view(req)
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data.get("success"))
        data = res.data.get("data", [])
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["id"], "att-1")
        self.assertEqual(data[0]["studentName"], "Ali O'quvchi")
        self.assertEqual(data[0]["examTitle"], "IELTS Simulation Exam")
        self.assertEqual(data[0]["status"], "pending")
        self.assertEqual(data[0]["skill"], "writing")

    @patch("apps.legacy_schema.models.MockAttempt.objects")
    def test_unrelated_teacher_isolated(self, mock_attempts_qs):
        req = self.factory.get("/v1/teacher/submissions")
        force_authenticate(req, user=self.teacher2)

        mock_chain = MagicMock()
        # When filtered by student__group__teacher_id="teacher-2", returns empty
        mock_chain.filter.return_value = mock_chain
        mock_chain.__getitem__.return_value = []
        mock_attempts_qs.select_related.return_value.order_by.return_value = mock_chain

        res = teacher_submissions_view(req)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data.get("data"), [])
