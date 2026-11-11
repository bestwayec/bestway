"""Homework results come from the server: the exam attempt or the teacher."""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase
from rest_framework.test import APIClient

from apps.core import homework_scoring as scoring


def attempt(status="completed", raw=None):
    return SimpleNamespace(id="att-1", status=status, raw_scores=raw)


class HomeworkScoringTests(SimpleTestCase):
    def setUp(self):
        self.assignment = SimpleNamespace(id="a-1", exam_id="exam-1", min_pass_percent=60, created_at=None)
        subs = patch.object(scoring.HomeworkSubmission, "objects").start()
        subs.filter.return_value.first.return_value = None
        subs.update_or_create.side_effect = lambda **kw: (SimpleNamespace(**kw["defaults"]), True)
        self.subs = subs
        self.addCleanup(patch.stopall)

    def sync(self, att):
        with patch.object(scoring, "latest_attempt", return_value=att):
            return scoring.sync_from_exam(self.assignment, "stu-1")

    def test_percent_is_the_attempts_own_raw_result(self):
        self.assertEqual(scoring.attempt_percent(attempt(raw={"reading": {"max": 35, "score": 21}, "listening": {"max": 35, "score": 14}})), 50)
        self.assertIsNone(scoring.attempt_percent(attempt(raw=None)))

    def test_completed_attempt_grades_the_homework(self):
        sub = self.sync(attempt(raw={"reading": {"max": 10, "score": 7}}))
        self.assertEqual((sub.status, sub.score_percent, sub.is_passed, sub.source), ("graded", 70, True, "exam_attempt"))
        sub = self.sync(attempt(raw={"reading": {"max": 10, "score": 5}}))
        self.assertFalse(sub.is_passed)

    def test_attempt_still_grading_waits_and_does_not_pass(self):
        sub = self.sync(attempt(status="grading", raw={"reading": {"max": 10, "score": 10}}))
        self.assertEqual((sub.status, sub.is_passed, sub.score_percent), ("awaiting_result", False, 0))

    def test_attempt_without_objective_result_goes_to_the_teacher(self):
        sub = self.sync(attempt(raw=None))
        self.assertEqual((sub.status, sub.is_passed), ("awaiting_review", False))

    def test_no_attempt_creates_nothing(self):
        self.assertIsNone(self.sync(None))
        self.subs.update_or_create.assert_not_called()

    def test_teacher_grade_is_never_overwritten_by_sync(self):
        self.subs.filter.return_value.first.return_value = SimpleNamespace(source="teacher", status="graded")
        self.assertEqual(self.sync(attempt(raw={"reading": {"max": 10, "score": 1}})).source, "teacher")
        self.subs.update_or_create.assert_not_called()


class TeacherGradeEndpointTests(SimpleTestCase):
    def post(self, user, body):
        client = APIClient()
        client.force_authenticate(user)
        assignment = MagicMock(id="a-1", cohort=MagicMock(teacher_id="t-1"), min_pass_percent=60)
        with patch("apps.core.teacher_views.HomeworkAssignment.objects.select_related") as rows, \
             patch("apps.core.teacher_views.CohortMembership.objects.filter") as members, \
             patch("apps.core.homework_scoring.HomeworkSubmission.objects") as subs:
            rows.return_value.get.return_value = assignment
            members.return_value.exists.return_value = True
            subs.update_or_create.side_effect = lambda **kw: (MagicMock(
                id="s", assignment_id="a-1", student_id="stu-1", completed_at=None, attempt_id=None, **{k: v for k, v in kw["defaults"].items() if k != "attempt_id"}), True)
            return client.post("/v1/teacher/assignments/a-1/grade", body, format="json"), subs

    def test_cohort_teacher_sets_the_score(self):
        teacher = SimpleNamespace(id="t-1", role="teacher", is_authenticated=True)
        resp, _ = self.post(teacher, {"student_id": "stu-1", "score_percent": 75})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual((resp.data["data"]["status"], resp.data["data"]["score_percent"], resp.data["data"]["is_passed"]), ("graded", 75, True))

    def test_foreign_teacher_student_and_bad_scores_are_refused(self):
        other = SimpleNamespace(id="t-2", role="teacher", is_authenticated=True)
        self.assertEqual(self.post(other, {"student_id": "stu-1", "score_percent": 75})[0].status_code, 403)
        student = SimpleNamespace(id="stu-1", role="student", is_authenticated=True)
        self.assertEqual(self.post(student, {"student_id": "stu-1", "score_percent": 100})[0].status_code, 403)
        teacher = SimpleNamespace(id="t-1", role="teacher", is_authenticated=True)
        for bad in (101, -1, "90", True, None):
            self.assertEqual(self.post(teacher, {"student_id": "stu-1", "score_percent": bad})[0].status_code, 400)
