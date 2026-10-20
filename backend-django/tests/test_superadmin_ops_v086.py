"""Unit test suite for Superadmin Student Deletion, Initial 100 Points Grant,
and Exam Quick Content Question Authoring (v0.8.6).
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.core.management import call_command
from django.test import SimpleTestCase

from apps.core import auth_service, mock_authoring, user_admin
from common.api.exceptions import ContractAPIException


class InitialPointsTests(SimpleTestCase):
    def test_initial_points_defaults_to_100_when_setting_missing(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = None
        points = auth_service.initial_points(cursor)
        self.assertEqual(points, 100)

    def test_initial_points_defaults_to_100_when_setting_is_zero(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = ["0"]
        points = auth_service.initial_points(cursor)
        self.assertEqual(points, 100)

    def test_initial_points_returns_custom_positive_value(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = [200]
        points = auth_service.initial_points(cursor)
        self.assertEqual(points, 200)


class SuperadminStudentCascadeDeletionTests(SimpleTestCase):
    def setUp(self):
        self.superadmin = SimpleNamespace(id="superadmin-1", role="super_admin")
        self.admin = SimpleNamespace(id="admin-1", role="admin")
        self.target_student = SimpleNamespace(id="student-1", name="Ali Valiyev", phone="+998901112233", role="student")

    @patch("apps.core.user_admin.User.objects.filter")
    def test_cannot_delete_if_actor_not_superadmin(self, mock_user_filter):
        mock_user_filter.return_value.first.return_value = self.target_student
        with self.assertRaises(ContractAPIException) as ctx:
            user_admin.delete_student_cascade(self.admin, "student-1")
        self.assertEqual(ctx.exception.status_code, 403)

    @patch("apps.core.user_admin.User.objects.filter")
    def test_cannot_delete_self(self, mock_user_filter):
        mock_user_filter.return_value.first.return_value = self.superadmin
        with self.assertRaises(ContractAPIException) as ctx:
            user_admin.delete_student_cascade(self.superadmin, "superadmin-1")
        self.assertEqual(ctx.exception.status_code, 403)

    @patch("apps.core.user_admin.User.objects.filter")
    def test_cannot_delete_another_superadmin(self, mock_user_filter):
        target_super = SimpleNamespace(id="superadmin-2", role="super_admin")
        mock_user_filter.return_value.first.return_value = target_super
        with self.assertRaises(ContractAPIException) as ctx:
            user_admin.delete_student_cascade(self.superadmin, "superadmin-2")
        self.assertEqual(ctx.exception.status_code, 403)

    @patch("django.db.models.query.QuerySet.delete")
    @patch("django.db.transaction.atomic")
    @patch("apps.core.user_admin.audit")
    @patch("apps.core.user_admin.User.objects.filter")
    def test_superadmin_can_cascade_delete_student(
        self,
        mock_user_admin_filter,
        mock_audit,
        mock_atomic,
        mock_qs_delete,
    ):
        mock_atomic.return_value.__enter__.return_value = None
        mock_atomic.return_value.__exit__.return_value = None
        mock_user_admin_filter.return_value.first.return_value = self.target_student

        with patch("apps.legacy_schema.models.MockAttempt.objects.filter") as mock_attempt:
            mock_attempt.return_value.values_list.return_value = ["attempt-1"]
            with patch("apps.legacy_schema.models.AssessmentJob.objects.filter") as mock_job:
                mock_job.return_value.values_list.return_value = ["job-1"]
                with patch("apps.legacy_schema.models.TestAttempt.objects.filter") as mock_legacy:
                    mock_legacy.return_value.values_list.return_value = []
                    result = user_admin.delete_student_cascade(self.superadmin, "student-1")

        self.assertTrue(result["deleted"])
        self.assertEqual(result["id"], "student-1")
        mock_audit.assert_called_once()
        self.assertTrue(mock_qs_delete.called)


class FixInitialPointsCommandTests(SimpleTestCase):
    @patch("django.db.transaction.atomic")
    @patch("apps.legacy_schema.models.Notification.objects.create")
    @patch("apps.legacy_schema.models.PointsLog.objects.create")
    @patch("apps.legacy_schema.models.StudentProfile.objects.filter")
    @patch("apps.legacy_schema.models.Setting.objects.update_or_create")
    @patch("apps.legacy_schema.models.Setting.objects.filter")
    def test_fix_initial_points_awards_100_points_to_zero_balance_students(
        self,
        mock_setting_filter,
        mock_setting_update,
        mock_student_filter,
        mock_points_create,
        mock_notif_create,
        mock_atomic,
    ):
        mock_atomic.return_value.__enter__.return_value = None
        mock_atomic.return_value.__exit__.return_value = None
        mock_setting_filter.return_value.first.return_value = SimpleNamespace(key="initialPoints", value=0)
        p1 = MagicMock(user_id="s1", current_points=0)
        p2 = MagicMock(user_id="s2", current_points=0)
        mock_qs = MagicMock()
        mock_qs.count.return_value = 2
        mock_qs.__iter__.return_value = iter([p1, p2])
        mock_student_filter.return_value = mock_qs

        call_command("fix_initial_points")

        mock_setting_update.assert_called_once_with(
            key="initialPoints",
            defaults={"value": 100},
        )
        self.assertEqual(p1.current_points, 100)
        self.assertEqual(p2.current_points, 100)
        self.assertEqual(mock_points_create.call_count, 2)
        self.assertEqual(mock_notif_create.call_count, 2)


class MockExamQuickContentTests(SimpleTestCase):
    @patch("apps.core.mock_authoring.audit_event")
    @patch("apps.core.mock_authoring._locked_mutation")
    @patch("apps.core.mock_authoring.MockExam.objects.get")
    @patch("apps.core.mock_authoring.assert_author")
    @patch("apps.core.mock_authoring.locked_exam")
    def test_save_quick_content_invokes_locked_mutation_and_audits(
        self,
        mock_locked,
        mock_assert_author,
        mock_get,
        mock_mutation,
        mock_audit,
    ):
        exam = SimpleNamespace(id="exam-1", type="ielts", is_published=False, content_version=1)
        mock_locked.return_value = exam
        fresh_exam = SimpleNamespace(
            id="exam-1",
            type="ielts",
            title="IELTS Test",
            description="IELTS mock description",
            level="B2",
            practice_level="B2",
            assessment_policy="STANDARD",
            speaking_profile_version="v1",
            specification_version="v1",
            is_published=True,
            is_demo=False,
            price=0,
            is_free_for_approved=True,
            created_by_id="author-1",
            created_at=None,
            updated_at=None,
            profile="practice",
            content_version=2,
            blueprint_ref=None,
        )
        mock_get.return_value = fresh_exam

        actor = SimpleNamespace(id="admin-1", role="super_admin")
        data = {
            "writing": {
                "task1": {"prompt": "Describe chart", "passageText": "Chart data", "wordLimit": 150},
                "task2": {"prompt": "Discuss both views", "wordLimit": 250},
            },
            "speaking": {
                "part1": ["Where do you live?", "What is your job?", "Do you like tea?"],
                "part2": {"cueCard": "Describe a book"},
                "part3": {"discussion": "Why do people read?"},
            },
            "publish": True,
        }

        with patch("apps.core.mock_authoring.MockSection.objects.filter", return_value=[]):
            result = mock_authoring.save_quick_content(actor, "exam-1", data)

        mock_mutation.assert_called_once()
        mock_audit.assert_called_once()
        self.assertEqual(result["id"], "exam-1")
        self.assertTrue(result["isPublished"])
