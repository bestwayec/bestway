"""Tests for Classroom Student Transfers, History Tracking, and Roster Access Control."""
from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

from django.test import SimpleTestCase
from rest_framework.test import APIClient

from apps.core import classroom_roster, group_views, groups
from common.api.exceptions import ContractAPIException


class DummyAtomic:
    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def __call__(self, func):
        return func


class ClassroomTransferAndHistoryTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()
        self.teacher_1 = SimpleNamespace(
            id="teacher-1",
            role="teacher",
            is_authenticated=True,
            name="Teacher One",
        )
        self.teacher_2 = SimpleNamespace(
            id="teacher-2",
            role="teacher",
            is_authenticated=True,
            name="Teacher Two",
        )
        self.admin = SimpleNamespace(
            id="admin-1",
            role="admin",
            is_authenticated=True,
            name="Admin User",
        )
        self.student = SimpleNamespace(
            id="student-1",
            role="student",
            is_authenticated=True,
            name="Student One",
        )

    def test_record_enrollment_no_op_when_groups_identical(self):
        """When old_group == new_group, record_enrollment returns immediately without DB writes."""
        with patch.object(classroom_roster.ClassroomEnrollment.objects, "filter") as mock_filter, \
             patch.object(classroom_roster.ClassroomEnrollment.objects, "create") as mock_create:
            classroom_roster.record_enrollment("student-1", "group-a", "group-a")
            mock_filter.assert_not_called()
            mock_create.assert_not_called()

    def test_record_enrollment_closes_old_and_opens_new(self):
        """Moving from group-a to group-b closes active enrollment and creates new started_at record."""
        now = datetime(2026, 11, 20, 12, 0, tzinfo=timezone.utc)
        active_enrollment = SimpleNamespace(group_id="group-a")
        mock_qs = MagicMock()
        mock_qs.first.return_value = active_enrollment

        with patch("django.utils.timezone.now", return_value=now), \
             patch.object(classroom_roster.ClassroomEnrollment.objects, "filter", return_value=mock_qs) as mock_filter, \
             patch.object(classroom_roster.ClassroomEnrollment.objects, "create") as mock_create:
            classroom_roster.record_enrollment("student-1", "group-a", "group-b")

            mock_filter.assert_called_once_with(student_id="student-1", ended_at__isnull=True)
            mock_qs.update.assert_called_once_with(ended_at=now)
            mock_create.assert_called_once_with(student_id="student-1", group_id="group-b", started_at=now)

    def test_record_enrollment_on_removal_only_closes(self):
        """Removing student from group-a closes enrollment without opening a new one."""
        now = datetime(2026, 11, 20, 12, 0, tzinfo=timezone.utc)
        active_enrollment = SimpleNamespace(group_id="group-a")
        mock_qs = MagicMock()
        mock_qs.first.return_value = active_enrollment

        with patch("django.utils.timezone.now", return_value=now), \
             patch.object(classroom_roster.ClassroomEnrollment.objects, "filter", return_value=mock_qs) as mock_filter, \
             patch.object(classroom_roster.ClassroomEnrollment.objects, "create") as mock_create:
            classroom_roster.record_enrollment("student-1", "group-a", None)

            mock_filter.assert_called_once_with(student_id="student-1", ended_at__isnull=True)
            mock_qs.update.assert_called_once_with(ended_at=now)
            mock_create.assert_not_called()

    def test_add_student_rejects_unauthorized_hijack_between_teachers(self):
        """Teacher 2 cannot hijack a student already assigned to Teacher 1's group."""
        group_target = SimpleNamespace(id="group-b", teacher_id="teacher-2", name="Group B")
        mock_user = SimpleNamespace(id="student-1", role="student")
        mock_profile = SimpleNamespace(user_id="student-1", group_id="group-a")

        with patch("apps.core.groups.transaction.atomic", return_value=DummyAtomic()), \
             patch("apps.core.groups.get_group", return_value=group_target), \
             patch("apps.core.classroom_roster.assert_active"), \
             patch("apps.core.groups.User.objects.select_for_update") as mock_user_qs, \
             patch("apps.core.groups.StudentProfile.objects.select_for_update") as mock_sp_qs, \
             patch("apps.core.groups.Group.objects.filter") as mock_grp_qs:
            mock_user_qs.return_value.filter.return_value.first.return_value = mock_user
            mock_sp_qs.return_value.filter.return_value.first.return_value = mock_profile
            # Group A does NOT belong to teacher-2:
            mock_grp_qs.return_value.exists.return_value = False

            add_student_fn = getattr(groups.add_student, "__wrapped__", groups.add_student)
            with self.assertRaises(ContractAPIException) as ctx:
                add_student_fn(self.teacher_2, "group-b", "student-1")

            self.assertEqual(ctx.exception.status_code, 403)
            self.assertIn("ruxsat berilmagan", str(ctx.exception.detail))

    def test_add_student_allows_transfer_between_own_groups(self):
        """Teacher 1 CAN transfer a student from their own group-a to their own group-b."""
        group_target = SimpleNamespace(id="group-b", teacher_id="teacher-1", name="Group B")
        mock_user = SimpleNamespace(id="student-1", role="student")
        mock_profile = MagicMock(user_id="student-1", group_id="group-a")

        with patch("apps.core.groups.transaction.atomic", return_value=DummyAtomic()), \
             patch("apps.core.groups.get_group", return_value=group_target), \
             patch("apps.core.classroom_roster.assert_active"), \
             patch("apps.core.groups.User.objects.select_for_update") as mock_user_qs, \
             patch("apps.core.groups.StudentProfile.objects.select_for_update") as mock_sp_qs, \
             patch("apps.core.groups.Group.objects.filter") as mock_grp_qs, \
             patch("apps.core.classroom_roster.record_enrollment") as mock_record, \
             patch("apps.core.groups.audit"):
            mock_user_qs.return_value.filter.return_value.first.return_value = mock_user
            mock_sp_qs.return_value.filter.return_value.first.return_value = mock_profile
            # Group A DOES belong to teacher-1:
            mock_grp_qs.return_value.exists.return_value = True

            add_student_fn = getattr(groups.add_student, "__wrapped__", groups.add_student)
            result = add_student_fn(self.teacher_1, "group-b", "student-1")

            self.assertEqual(result, {"groupId": "group-b", "studentId": "student-1", "added": True})
            self.assertEqual(mock_profile.group_id, "group-b")
            mock_profile.save.assert_called_once_with(update_fields=["group_id"])
            mock_record.assert_called_once_with("student-1", "group-a", "group-b")

    def test_add_student_allows_admin_to_transfer_across_any_teachers(self):
        """Admin can transfer any student across groups regardless of assigned teachers."""
        group_target = SimpleNamespace(id="group-b", teacher_id="teacher-2", name="Group B")
        mock_user = SimpleNamespace(id="student-1", role="student")
        mock_profile = MagicMock(user_id="student-1", group_id="group-a")

        with patch("apps.core.groups.transaction.atomic", return_value=DummyAtomic()), \
             patch("apps.core.groups.get_group", return_value=group_target), \
             patch("apps.core.classroom_roster.assert_active"), \
             patch("apps.core.groups.User.objects.select_for_update") as mock_user_qs, \
             patch("apps.core.groups.StudentProfile.objects.select_for_update") as mock_sp_qs, \
             patch("apps.core.classroom_roster.record_enrollment") as mock_record, \
             patch("apps.core.groups.audit"):
            mock_user_qs.return_value.filter.return_value.first.return_value = mock_user
            mock_sp_qs.return_value.filter.return_value.first.return_value = mock_profile

            add_student_fn = getattr(groups.add_student, "__wrapped__", groups.add_student)
            result = add_student_fn(self.admin, "group-b", "student-1")

            self.assertEqual(result, {"groupId": "group-b", "studentId": "student-1", "added": True})
            self.assertEqual(mock_profile.group_id, "group-b")
            mock_profile.save.assert_called_once_with(update_fields=["group_id"])
            mock_record.assert_called_once_with("student-1", "group-a", "group-b")

    def test_student_cannot_call_add_student_endpoint(self):
        """Students cannot add or transfer members in groups (403 Forbidden)."""
        self.client.force_authenticate(self.student)
        res = self.client.post("/v1/groups/group-a/students", {"studentId": "student-2"}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_member_history_requires_staff_role(self):
        """Student role is rejected from viewing classroom member history."""
        self.client.force_authenticate(self.student)
        res = self.client.get("/v1/groups/group-a/member-history")
        self.assertEqual(res.status_code, 403)

    def test_member_history_returns_paginated_enrolled_and_past_members(self):
        """Teacher querying member history gets enrolled flags and pagination."""
        self.client.force_authenticate(self.teacher_1)
        group_obj = SimpleNamespace(id="group-a", teacher_id="teacher-1", name="Group A")

        with patch("apps.core.groups.get_group", return_value=group_obj), \
             patch("apps.core.classroom_roster.ClassroomEnrollment.objects.filter") as mock_enroll, \
             patch("apps.core.classroom_roster.StudentProfile.objects.filter") as mock_sp, \
             patch("apps.core.classroom_roster.User.objects.filter") as mock_users:
            mock_enroll.return_value.values.return_value = [{"student_id": "stu-1"}, {"student_id": "stu-2"}]
            mock_sp.return_value.values.return_value = [{"user_id": "stu-1"}]
            
            # mock user queryset
            mock_qs = MagicMock()
            mock_qs.order_by.return_value.values.return_value = [
                {"id": "stu-1", "name": "Ali Valiyev"},
                {"id": "stu-2", "name": "Bobur Mirzo"},
            ]
            mock_users.return_value = mock_qs
            # stu-1 is currently enrolled; stu-2 was transferred out
            mock_sp.return_value.values_list.return_value = ["stu-1"]

            res = self.client.get("/v1/groups/group-a/member-history?search=Ali&page=1")
            self.assertEqual(res.status_code, 200)
            data = res.data["data"]
            self.assertEqual(data["page"], 1)
            self.assertFalse(data["hasNext"])
            self.assertEqual(len(data["members"]), 2)
            self.assertEqual(data["members"][0]["id"], "stu-1")
            self.assertTrue(data["members"][0]["currentlyEnrolled"])
            self.assertEqual(data["members"][1]["id"], "stu-2")
            self.assertFalse(data["members"][1]["currentlyEnrolled"])
