"""Tests for Teacher Workspace: Cohorts, Assignments and Student Monitoring."""
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.core.teacher_views import (
    cohort_analytics_view,
    generate_cohort_invite_code,
    student_join_cohort_view,
    student_my_assignments_view,
    student_submit_assignment_view,
    teacher_assignments_view,
    teacher_cohorts_view,
)


class TeacherWorkspaceTests(SimpleTestCase):
    def setUp(self):
        self.factory = APIRequestFactory()

        self.teacher_user = MagicMock(
            id="teacher-1",
            role="teacher",
            phone="+998901112233",
            email="teacher@bestwayec.uz",
            is_authenticated=True,
        )
        self.teacher_user.name = "Ulug'bek Teacher"

        self.other_teacher = MagicMock(
            id="teacher-2",
            role="teacher",
            phone="+998902223344",
            email="ziyoda@bestwayec.uz",
            is_authenticated=True,
        )
        self.other_teacher.name = "Ziyoda Teacher"

        self.admin_user = MagicMock(
            id="admin-1",
            role="admin",
            phone="+998903334455",
            email="admin@bestwayec.uz",
            is_authenticated=True,
        )
        self.admin_user.name = "Administrator"

        self.student_user = MagicMock(
            id="student-1",
            role="student",
            phone="+998904445566",
            email="anvar@bestwayec.uz",
            is_authenticated=True,
        )
        self.student_user.name = "Anvar Student"

    @patch("apps.core.teacher_views.Cohort.objects.filter")
    def test_generate_cohort_invite_code(self, mock_filter):
        """Invite code should start with BW- and have 4 characters following."""
        mock_filter.return_value.exists.return_value = False
        code = generate_cohort_invite_code()
        self.assertTrue(code.startswith("BW-"))
        self.assertEqual(len(code), 7)

    @patch("apps.core.teacher_views.Cohort.objects.create")
    @patch("apps.core.teacher_views.Cohort.objects.filter")
    def test_teacher_create_cohort_success(self, mock_filter, mock_create):
        """Teacher creates a new cohort with generated invite code."""
        mock_filter.return_value.exists.return_value = False

        fake_cohort = MagicMock(
            id="cohort-100",
            teacher=self.teacher_user,
            teacher_id="teacher-1",
            description="Grammar & Vocabulary focus",
            invite_code="BW-5555",
            created_at=datetime(2026, 10, 27, 10, 0, tzinfo=timezone.utc),
        )
        fake_cohort.name = "CEFR B2 Fast Track"
        mock_create.return_value = fake_cohort

        request = self.factory.post(
            "/v1/teacher/cohorts",
            {"name": "CEFR B2 Fast Track", "description": "Grammar & Vocabulary focus", "invite_code": "BW-5555"},
            format="json",
        )
        force_authenticate(request, user=self.teacher_user)

        resp = teacher_cohorts_view(request)
        self.assertEqual(resp.status_code, 201)
        data = resp.data["data"]
        self.assertEqual(data["id"], "cohort-100")
        self.assertEqual(data["name"], "CEFR B2 Fast Track")
        self.assertEqual(data["invite_code"], "BW-5555")

    def test_teacher_create_cohort_validation_error(self):
        """Creating cohort without name raises 400 validation error."""
        request = self.factory.post("/v1/teacher/cohorts", {"name": "   "}, format="json")
        force_authenticate(request, user=self.teacher_user)

        resp = teacher_cohorts_view(request)
        self.assertEqual(resp.status_code, 400)

    def test_student_forbidden_to_create_cohort(self):
        """Student role is rejected with 403 Forbidden."""
        request = self.factory.post("/v1/teacher/cohorts", {"name": "Unauthorized Cohort"}, format="json")
        force_authenticate(request, user=self.student_user)

        resp = teacher_cohorts_view(request)
        self.assertEqual(resp.status_code, 403)

    @patch("apps.core.teacher_views.Cohort.objects.filter")
    def test_teacher_list_cohorts(self, mock_filter):
        """Teacher lists only their cohorts with student count and assignment count."""
        cohort1 = MagicMock(
            id="c-1",
            description="Weekend group",
            invite_code="BW-1111",
            teacher=self.teacher_user,
            teacher_id="teacher-1",
            created_at=datetime(2026, 10, 27, 9, 0, tzinfo=timezone.utc),
        )
        cohort1.name = "IELTS Group 1"
        cohort1.memberships.filter.return_value.count.return_value = 14
        cohort1.assignments.count.return_value = 3

        mock_filter.return_value.select_related.return_value = [cohort1]

        request = self.factory.get("/v1/teacher/cohorts")
        force_authenticate(request, user=self.teacher_user)

        resp = teacher_cohorts_view(request)
        self.assertEqual(resp.status_code, 200)
        items = resp.data["data"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["name"], "IELTS Group 1")
        self.assertEqual(items[0]["student_count"], 14)
        self.assertEqual(items[0]["assignment_count"], 3)

    @patch("apps.core.teacher_views.Cohort.objects.all")
    def test_admin_list_all_cohorts(self, mock_all):
        """Admin sees cohorts from all teachers."""
        c1 = MagicMock(
            id="c-1",
            description="",
            invite_code="BW-1111",
            teacher=self.teacher_user,
            teacher_id="teacher-1",
            created_at=datetime(2026, 10, 27, 9, 0, tzinfo=timezone.utc),
        )
        c1.name = "Cohort A"
        c1.memberships.filter.return_value.count.return_value = 10
        c1.assignments.count.return_value = 2

        mock_all.return_value.select_related.return_value = [c1]

        request = self.factory.get("/v1/teacher/cohorts")
        force_authenticate(request, user=self.admin_user)

        resp = teacher_cohorts_view(request)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data["data"]), 1)

    @patch("apps.core.teacher_views.CohortMembership.objects.update_or_create")
    @patch("apps.core.teacher_views.Cohort.objects.filter")
    def test_student_join_cohort_success(self, mock_filter, mock_update_or_create):
        """Student successfully joins cohort with valid invite code."""
        cohort = MagicMock(
            id="cohort-target",
            invite_code="BW-8899",
            teacher=self.teacher_user,
        )
        cohort.name = "Grammar Foundations"
        mock_filter.return_value.select_related.return_value.first.return_value = cohort

        membership = MagicMock(status="active")
        mock_update_or_create.return_value = (membership, True)

        request = self.factory.post("/v1/student/join-cohort", {"invite_code": "bw-8899"}, format="json")
        force_authenticate(request, user=self.student_user)

        resp = student_join_cohort_view(request)
        self.assertEqual(resp.status_code, 200)
        data = resp.data["data"]
        self.assertEqual(data["cohort_id"], "cohort-target")
        self.assertEqual(data["cohort_name"], "Grammar Foundations")
        self.assertEqual(data["joined"], True)

    @patch("apps.core.teacher_views.Cohort.objects.filter")
    def test_student_join_cohort_invalid_code(self, mock_filter):
        """Invalid invite code returns 404 Not Found."""
        mock_filter.return_value.select_related.return_value.first.return_value = None

        request = self.factory.post("/v1/student/join-cohort", {"invite_code": "BW-XXXX"}, format="json")
        force_authenticate(request, user=self.student_user)

        resp = student_join_cohort_view(request)
        self.assertEqual(resp.status_code, 404)

    @patch("apps.core.teacher_views.HomeworkAssignment.objects.create")
    @patch("apps.core.teacher_views.Lesson.objects.filter")
    @patch("apps.core.teacher_views.Cohort.objects.get")
    def test_teacher_create_assignment_lesson(self, mock_get_cohort, mock_lesson, mock_create):
        """Teacher creates homework assignment tied to a video lesson."""
        cohort = MagicMock(id="c-1", teacher_id="teacher-1")
        cohort.name = "Morning IELTS"
        mock_get_cohort.return_value = cohort

        fake_lesson = MagicMock(id="lesson-7", title="Past Perfect Tense")
        mock_lesson.return_value.first.return_value = fake_lesson

        fake_assignment = MagicMock(
            id="assign-1",
            cohort=cohort,
            title="Watch Past Perfect and Complete Quiz",
            lesson_id="lesson-7",
            lesson=fake_lesson,
            exam_id=None,
            exam=None,
            deadline=datetime(2026, 10, 30, 23, 59, tzinfo=timezone.utc),
            min_pass_percent=80,
            created_at=datetime(2026, 10, 27, 10, 0, tzinfo=timezone.utc),
        )
        mock_create.return_value = fake_assignment

        request = self.factory.post(
            "/v1/teacher/assignments",
            {
                "cohort_id": "c-1",
                "title": "Watch Past Perfect and Complete Quiz",
                "lesson_id": "lesson-7",
                "deadline": "2026-10-30T23:59:00Z",
                "min_pass_percent": 80,
            },
            format="json",
        )
        force_authenticate(request, user=self.teacher_user)

        resp = teacher_assignments_view(request)
        self.assertEqual(resp.status_code, 201)
        data = resp.data["data"]
        self.assertEqual(data["title"], "Watch Past Perfect and Complete Quiz")
        self.assertEqual(data["lesson_id"], "lesson-7")
        self.assertEqual(data["min_pass_percent"], 80)

    @patch("apps.core.teacher_views.HomeworkAssignment.objects.create")
    @patch("apps.core.teacher_views.MockExam.objects.filter")
    @patch("apps.core.teacher_views.Cohort.objects.get")
    def test_teacher_create_assignment_exam(self, mock_get_cohort, mock_exam, mock_create):
        """Teacher creates homework assignment tied to a mock exam."""
        cohort = MagicMock(id="c-1", teacher_id="teacher-1")
        cohort.name = "Morning IELTS"
        mock_get_cohort.return_value = cohort

        fake_exam = MagicMock(id="exam-cefr-1", title="CEFR Mock Test 1")
        mock_exam.return_value.first.return_value = fake_exam

        fake_assignment = MagicMock(
            id="assign-2",
            cohort=cohort,
            title="Complete Mock Test 1 Writing & Speaking",
            lesson_id=None,
            lesson=None,
            exam_id="exam-cefr-1",
            exam=fake_exam,
            deadline=datetime(2026, 11, 1, 18, 0, tzinfo=timezone.utc),
            min_pass_percent=70,
            created_at=datetime(2026, 10, 27, 10, 0, tzinfo=timezone.utc),
        )
        mock_create.return_value = fake_assignment

        request = self.factory.post(
            "/v1/teacher/assignments",
            {
                "cohort_id": "c-1",
                "title": "Complete Mock Test 1 Writing & Speaking",
                "exam_id": "exam-cefr-1",
                "deadline": "2026-11-01T18:00:00Z",
                "min_pass_percent": 70,
            },
            format="json",
        )
        force_authenticate(request, user=self.teacher_user)

        resp = teacher_assignments_view(request)
        self.assertEqual(resp.status_code, 201)
        data = resp.data["data"]
        self.assertEqual(data["exam_id"], "exam-cefr-1")

    @patch("apps.core.teacher_views.HomeworkSubmission.objects.filter")
    @patch("apps.core.teacher_views.HomeworkAssignment.objects.filter")
    @patch("apps.core.teacher_views.CohortMembership.objects.filter")
    def test_student_view_my_assignments(self, mock_memberships, mock_assignments, mock_subs):
        """Student retrieves their assignments and submission status."""
        mock_memberships.return_value.values_list.return_value = ["c-1"]

        fake_cohort = MagicMock(id="c-1", teacher=self.teacher_user)
        fake_cohort.name = "Grammar Cohort"

        assignment1 = MagicMock(
            id="a-1",
            title="Past Simple Exercises",
            cohort=fake_cohort,
            lesson_id="lesson-4",
            lesson=MagicMock(title="Past Simple", order_index=4),
            exam_id=None,
            exam=None,
            deadline=datetime(2026, 10, 31, 23, 59, tzinfo=timezone.utc),
            min_pass_percent=80,
        )
        mock_assignments.return_value.select_related.return_value.order_by.return_value = [assignment1]

        sub1 = MagicMock(
            assignment_id="a-1",
            score_percent=95,
            is_passed=True,
            completed_at=datetime(2026, 10, 27, 14, 0, tzinfo=timezone.utc),
        )
        mock_subs.return_value = [sub1]

        request = self.factory.get("/v1/student/my-assignments")
        force_authenticate(request, user=self.student_user)

        resp = student_my_assignments_view(request)
        self.assertEqual(resp.status_code, 200)
        items = resp.data["data"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["title"], "Past Simple Exercises")
        self.assertEqual(items[0]["is_submitted"], True)
        self.assertEqual(items[0]["is_passed"], True)
        self.assertEqual(items[0]["score_percent"], 95)
        self.assertEqual(items[0]["status"], "passed")

    @patch("apps.core.teacher_views.HomeworkSubmission.objects.update_or_create")
    @patch("apps.core.teacher_views.CohortMembership.objects.filter")
    @patch("apps.core.teacher_views.HomeworkAssignment.objects.select_related")
    def test_student_submit_assignment_passed(self, mock_assign_sr, mock_membership, mock_sub_create):
        """Student submits assignment with score >= min_pass_percent (is_passed=True)."""
        fake_assign = MagicMock(
            id="a-1",
            cohort=MagicMock(id="c-1"),
            min_pass_percent=80,
        )
        mock_assign_sr.return_value.get.return_value = fake_assign
        mock_membership.return_value.exists.return_value = True

        fake_sub = MagicMock(
            id="sub-1",
            score_percent=85,
            is_passed=True,
            completed_at=datetime(2026, 10, 27, 15, 0, tzinfo=timezone.utc),
        )
        mock_sub_create.return_value = (fake_sub, True)

        request = self.factory.post("/v1/student/assignments/a-1/submit", {"score_percent": 85}, format="json")
        force_authenticate(request, user=self.student_user)

        resp = student_submit_assignment_view(request, "a-1")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data["data"]["is_passed"])
        self.assertEqual(resp.data["data"]["score_percent"], 85)

    @patch("apps.core.teacher_views.HomeworkSubmission.objects.update_or_create")
    @patch("apps.core.teacher_views.CohortMembership.objects.filter")
    @patch("apps.core.teacher_views.HomeworkAssignment.objects.select_related")
    def test_student_submit_assignment_failed(self, mock_assign_sr, mock_membership, mock_sub_create):
        """Student submits assignment with score < min_pass_percent (is_passed=False)."""
        fake_assign = MagicMock(
            id="a-1",
            cohort=MagicMock(id="c-1"),
            min_pass_percent=80,
        )
        mock_assign_sr.return_value.get.return_value = fake_assign
        mock_membership.return_value.exists.return_value = True

        fake_sub = MagicMock(
            id="sub-2",
            score_percent=65,
            is_passed=False,
            completed_at=datetime(2026, 10, 27, 15, 0, tzinfo=timezone.utc),
        )
        mock_sub_create.return_value = (fake_sub, True)

        request = self.factory.post("/v1/student/assignments/a-1/submit", {"score_percent": 65}, format="json")
        force_authenticate(request, user=self.student_user)

        resp = student_submit_assignment_view(request, "a-1")
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.data["data"]["is_passed"])
        self.assertEqual(resp.data["data"]["score_percent"], 65)

    @patch("apps.core.teacher_views.UserLessonProgress.objects.filter")
    @patch("apps.core.teacher_views.HomeworkSubmission.objects.filter")
    @patch("apps.core.teacher_views.Cohort.objects.select_related")
    def test_cohort_analytics_progress_matrix(self, mock_cohort_sr, mock_subs, mock_progress):
        """Teacher accesses cohort analytics and gets students progress matrix."""
        cohort = MagicMock(
            id="c-1",
            teacher_id="teacher-1",
            teacher=self.teacher_user,
            invite_code="BW-9900",
            description="Autumn Cohort",
        )
        cohort.name = "CEFR Intensive"

        assign = MagicMock(
            id="a-1",
            title="Grammar Unit 1",
            lesson_id="l-1",
            lesson=MagicMock(title="Present Simple"),
            exam_id=None,
            exam=None,
            deadline=datetime(2026, 10, 31, 20, 0, tzinfo=timezone.utc),
            min_pass_percent=80,
        )
        cohort.assignments.select_related.return_value.order_by.return_value = [assign]

        student_membership = MagicMock(
            student=self.student_user,
            joined_at=datetime(2026, 10, 20, 10, 0, tzinfo=timezone.utc),
        )
        cohort.memberships.filter.return_value.select_related.return_value.order_by.return_value = [student_membership]

        mock_cohort_sr.return_value.get.return_value = cohort

        sub = MagicMock(
            assignment_id="a-1",
            score_percent=90,
            is_passed=True,
            completed_at=datetime(2026, 10, 26, 12, 0, tzinfo=timezone.utc),
        )
        mock_subs.return_value = [sub]
        mock_progress.return_value.count.return_value = 8

        request = self.factory.get("/v1/teacher/cohorts/c-1/analytics")
        force_authenticate(request, user=self.teacher_user)

        resp = cohort_analytics_view(request, "c-1")
        self.assertEqual(resp.status_code, 200)
        data = resp.data["data"]
        self.assertEqual(data["cohort"]["name"], "CEFR Intensive")
        self.assertEqual(len(data["assignments"]), 1)
        self.assertEqual(len(data["students"]), 1)
        student_row = data["students"][0]
        self.assertEqual(student_row["student_id"], "student-1")
        self.assertEqual(student_row["lessons_completed"], 8)
        self.assertEqual(student_row["average_score"], 90)
        self.assertTrue(student_row["submissions"]["a-1"]["is_passed"])

    @patch("apps.core.teacher_views.Cohort.objects.select_related")
    def test_other_teacher_forbidden_cohort_analytics(self, mock_cohort_sr):
        """Another teacher cannot access a cohort they don't teach (403 Forbidden)."""
        cohort = MagicMock(
            id="c-1",
            teacher_id="teacher-1",
            teacher=self.teacher_user,
        )
        cohort.name = "Teacher 1 Group"
        mock_cohort_sr.return_value.get.return_value = cohort

        request = self.factory.get("/v1/teacher/cohorts/c-1/analytics")
        force_authenticate(request, user=self.other_teacher)  # id="teacher-2"

        resp = cohort_analytics_view(request, "c-1")
        self.assertEqual(resp.status_code, 403)
