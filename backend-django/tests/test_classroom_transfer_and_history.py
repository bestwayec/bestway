"""Tests for Classroom Student Transfers, History Tracking, and Roster Access Control."""
from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

from django.test import SimpleTestCase
from rest_framework.test import APIClient

from apps.core import classroom_roster, group_views, groups
from common.api.exceptions import ContractAPIException


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

    def test_record_enrollment_closes_only_the_source_and_opens_destination(self):
        old, new = MagicMock(), MagicMock()
        old.update.return_value = 1
        now = datetime(2026, 11, 20, 12, 0, tzinfo=timezone.utc)
        with patch.object(classroom_roster, "active_enrollments", side_effect=[old, new]) as active, \
             patch.object(classroom_roster.timezone, "now", return_value=now):
            classroom_roster.record_enrollment("student-1", "group-a", "group-b", source="transfer")
        self.assertEqual(active.call_args_list, [
            call(student_id="student-1", group_id="group-a"),
            call(student_id="student-1", group_id="group-b"),
        ])
        old.update.assert_called_once_with(ended_at=now)
        new.get_or_create.assert_called_once_with(
            student_id="student-1", group_id="group-b", defaults={"started_at": now, "source": "transfer"},
        )

    def test_record_enrollment_on_removal_only_closes(self):
        now = datetime(2026, 11, 20, 12, 0, tzinfo=timezone.utc)
        with patch.object(classroom_roster, "active_enrollments") as active, \
             patch.object(classroom_roster.timezone, "now", return_value=now):
            active.return_value.update.return_value = 1
            classroom_roster.record_enrollment("student-1", "group-a", None)
        active.assert_called_once_with(student_id="student-1", group_id="group-a")
        active.return_value.update.assert_called_once_with(ended_at=now)
        active.return_value.get_or_create.assert_not_called()

    def test_transfer_requires_permission_on_both_groups(self):
        source = SimpleNamespace(teacher_id="teacher-1")
        target = SimpleNamespace(teacher_id="teacher-2")
        with patch.object(groups, "get_group", side_effect=[source, target]), \
             patch.object(classroom_roster, "assert_active"), patch.object(groups, "lock_student") as lock:
            with self.assertRaises(ContractAPIException) as ctx:
                groups.add_student.__wrapped__(
                    self.teacher_2, "group-b", "student-1", source_group_id="group-a",
                )
        self.assertEqual(ctx.exception.status_code, 403)
        lock.assert_not_called()

    def test_teacher_and_admin_can_transfer_authorized_groups(self):
        for actor, destination_teacher in [(self.teacher_1, "teacher-1"), (self.admin, "teacher-2")]:
            source = SimpleNamespace(teacher_id="teacher-1")
            target = SimpleNamespace(teacher_id=destination_teacher)
            with self.subTest(actor=actor.role), patch.object(groups, "get_group", side_effect=[source, target]), \
                 patch.object(classroom_roster, "assert_active"), patch.object(groups, "lock_student", return_value=self.student), \
                 patch.object(groups, "close_membership", return_value=True) as close, \
                 patch.object(groups, "add_member", return_value=True) as add, patch.object(groups, "audit"):
                result = groups.add_student.__wrapped__(
                    actor, "group-b", "student-1", source_group_id="group-a",
                )
            self.assertEqual(result, {"groupId": "group-b", "studentId": "student-1", "added": True})
            close.assert_called_once_with("group-a", "student-1")
            add.assert_called_once_with("group-b", self.student, source="transfer")

    def test_default_add_preserves_existing_memberships(self):
        group = SimpleNamespace(teacher_id="teacher-2")
        with patch.object(groups, "get_group", return_value=group), patch.object(classroom_roster, "assert_active"), \
             patch.object(groups, "lock_student", return_value=self.student), patch.object(groups, "audit"), \
             patch.object(groups, "close_membership") as close, patch.object(groups, "add_member", return_value=True) as add:
            groups.add_student.__wrapped__(self.teacher_2, "group-b", "student-1")
        close.assert_not_called()
        add.assert_called_once_with("group-b", self.student, source="staff")

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
             patch("apps.core.classroom_roster.active_enrollments") as current, \
             patch("apps.core.classroom_roster.User.objects.filter") as mock_users:
            mock_enroll.return_value.values.return_value = [{"student_id": "stu-1"}, {"student_id": "stu-2"}]
            
            # mock user queryset
            mock_qs = MagicMock()
            mock_qs.order_by.return_value.values.return_value = [
                {"id": "stu-1", "name": "Ali Valiyev"},
                {"id": "stu-2", "name": "Bobur Mirzo"},
            ]
            mock_users.return_value = mock_qs
            # stu-1 is currently enrolled; stu-2 was transferred out
            current.return_value.filter.return_value.values_list.return_value = ["stu-1"]

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
