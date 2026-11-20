"""Unit tests for Teacher Submissions Endpoint: RBAC, Group Isolation, and Payload Formatting."""
from unittest.mock import MagicMock, patch
from django.test import SimpleTestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.core.teacher_views import teacher_submissions_view


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
