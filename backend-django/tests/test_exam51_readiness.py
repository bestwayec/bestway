"""5.1 CBT 2.0: the readiness screen gets the assignment's real timing from the eligibility endpoint."""
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.core.teacher_views import student_assignment_exam_view


class AssignmentReadinessTests(SimpleTestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.student = MagicMock(id="student-1", role="student", is_authenticated=True)

    def call(self):
        request = self.factory.get("/v1/student/assignments/a-1/exam")
        force_authenticate(request, user=self.student)
        return student_assignment_exam_view(request, "a-1")

    @patch("apps.core.teacher_views.HomeworkSubmission.objects.filter")
    @patch("apps.core.mock_catalog.access_for", return_value="granted")
    @patch("apps.core.teacher_views.classrooms.student_homework_scope", return_value=MagicMock())
    @patch("apps.core.teacher_views.HomeworkAssignment.objects.filter")
    def test_returns_the_assignment_window(self, mock_filter, _scope, _access, mock_subs):
        closes = datetime.now(timezone.utc) + timedelta(hours=2)
        opens = datetime.now(timezone.utc) - timedelta(minutes=5)
        assignment = MagicMock(exam_id="exam-1", exam=MagicMock(type="ielts"), title="Mock 1", timing_policy="fixed_close",
                               opens_at=opens, deadline=closes)
        mock_filter.return_value.select_related.return_value.first.return_value = assignment
        mock_subs.return_value.exists.return_value = False
        resp = self.call()
        self.assertEqual(resp.status_code, 200)
        data = resp.data["data"]
        self.assertEqual((data["id"], data["type"], data["timingPolicy"], data["assignmentTitle"]), ("exam-1", "ielts", "fixed_close", "Mock 1"))
        self.assertEqual(data["deadline"], closes.isoformat())
        self.assertEqual(data["opensAt"], opens.isoformat())

    @patch("apps.core.teacher_views.HomeworkSubmission.objects.filter")
    @patch("apps.core.mock_catalog.access_for", return_value="granted")
    @patch("apps.core.teacher_views.classrooms.student_homework_scope", return_value=MagicMock())
    @patch("apps.core.teacher_views.HomeworkAssignment.objects.filter")
    def test_closed_assignment_is_still_refused(self, mock_filter, _scope, _access, mock_subs):
        assignment = MagicMock(exam_id="exam-1", exam=MagicMock(type="ielts"), title="Mock 1", timing_policy="individual",
                               opens_at=None, deadline=datetime.now(timezone.utc) - timedelta(minutes=1))
        mock_filter.return_value.select_related.return_value.first.return_value = assignment
        mock_subs.return_value.exists.return_value = False
        resp = self.call()
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.data["error"]["code"], "ASSIGNMENT_EXPIRED")
