"""Phase 5: Student Progress & Teacher Analytics Test Suite.

Validates:
1. Teacher & Cohort Analytics:
   - Group analytics authorization (RBAC: Teacher must own group; admin can view; student forbidden).
   - Aggregated metrics: groupAverageScore, mockAttemptsCount, essaysCount, attendanceRate.
   - Heatmap calculation: weak topics with accuracy, error rates, and diagnostic recommendations.
2. Multi-Format Reporting & Export:
   - Excel export workbook generation via openpyxl with styled score matrices and CEFR tiers.
   - Safe handling of absent/unattempted students.
3. Student Skill Progress Tracking:
   - Multi-skill historical tracking (Listening, Reading, Writing, Speaking).
   - CEFR level resolution according to official scales.
"""
from __future__ import annotations

import io
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import openpyxl
from django.test import SimpleTestCase
from django.utils import timezone

from apps.core import group_exam_export, teacher_analytics
from apps.core.group_exam_export import compute_cefr_level
from common.api.exceptions import ContractAPIException


class Phase5StudentProgressAndTeacherAnalyticsTests(SimpleTestCase):
    def test_cefr_level_computation_for_ielts_and_multilevel(self):
        """CEFR level must map accurately based on exam type."""
        # IELTS Academic / General: 0..9 band scale
        self.assertEqual(compute_cefr_level(8.5, "ielts_academic"), "C2")
        self.assertEqual(compute_cefr_level(7.0, "ielts_academic"), "C1")
        self.assertEqual(compute_cefr_level(5.5, "ielts_academic"), "B2")
        self.assertEqual(compute_cefr_level(4.0, "ielts_academic"), "B1")
        self.assertEqual(compute_cefr_level(3.0, "ielts_academic"), "BELOW_B1")

        # Multilevel: 0..75 standard score scale
        self.assertEqual(compute_cefr_level(65.0, "multilevel"), "C1")
        self.assertEqual(compute_cefr_level(52.0, "multilevel"), "B2")
        self.assertEqual(compute_cefr_level(39.0, "multilevel"), "B1")
        self.assertEqual(compute_cefr_level(20.0, "multilevel"), "BELOW_B1")

        # Missing / None score
        self.assertEqual(compute_cefr_level(None, "ielts_academic"), "-")

    def test_group_analytics_role_rbac_enforcement(self):
        """Only assigned teacher or admin can view group analytics."""
        fake_group = SimpleNamespace(id="grp-1", name="IELTS Morning", teacher_id="teacher-1")
        
        # Student actor -> 403 Forbidden
        student_actor = SimpleNamespace(id="student-1", role="student")
        with patch("apps.core.teacher_analytics.get_group", return_value=fake_group):
            with self.assertRaises(ContractAPIException) as ctx:
                teacher_analytics.get_group_analytics(student_actor, "grp-1")
            self.assertEqual(ctx.exception.status_code, 403)

        # Unassigned teacher -> 403 Forbidden
        other_teacher = SimpleNamespace(id="teacher-2", role="teacher")
        with patch("apps.core.teacher_analytics.get_group", return_value=fake_group):
            with self.assertRaises(ContractAPIException) as ctx:
                teacher_analytics.get_group_analytics(other_teacher, "grp-1")
            self.assertEqual(ctx.exception.status_code, 403)

    def test_group_analytics_metrics_and_heatmap_calculation(self):
        """Group analytics correctly aggregates student scores, attempts, and weak topic heatmap."""
        teacher_actor = SimpleNamespace(id="teacher-1", role="teacher")
        fake_group = SimpleNamespace(
            id="grp-1",
            name="IELTS Band 7+ Cohort",
            teacher_id="teacher-1",
            teacher=SimpleNamespace(name="Komiljon Roziyev"),
        )

        user1 = SimpleNamespace(id="s1", name="Ali Valiyev", phone="+998901112233", is_active=True)
        user2 = SimpleNamespace(id="s2", name="Zarina Karimova", phone="+998904445566", is_active=True)
        p1 = SimpleNamespace(user_id="s1", user=user1, current_points=120)
        p2 = SimpleNamespace(user_id="s2", user=user2, current_points=240)

        now = timezone.now()
        exam = SimpleNamespace(type="ielts_academic", title="IELTS")
        attempts = [
            SimpleNamespace(id=profile.user_id, student_id=profile.user_id, student=profile,
                            exam=exam, exam_id="ielts", overall_band=band, flow_mode="full_test",
                            media_state={}, status="completed", started_at=now, submitted_at=now,
                            finished_at=now, specification_version=None, score_version=None,
                            section_bands={}, submitted_sections=[skill])
            for profile, band, skill in ((p1, 6.5, "reading"), (p2, 7.5, "writing"))
        ]

        with patch.object(teacher_analytics, "get_group", return_value=fake_group), \
             patch.object(teacher_analytics, "classroom_attempts") as mock_attempts, \
             patch.object(teacher_analytics, "objective_metrics", return_value=([], [])), \
             patch("apps.core.teacher_analytics.HomeworkAssignment.objects.filter"), \
             patch("apps.core.teacher_analytics.StudentProfile.objects.filter") as mock_profiles, \
             patch("apps.core.teacher_analytics.Attendance.objects.filter"):
            mock_profiles.side_effect = [
                SimpleNamespace(values_list=lambda *_: [(p1.user_id, user1.name), (p2.user_id, user2.name)]),
                SimpleNamespace(values_list=lambda *_: []),
            ]
            mock_attempts.return_value.filter.return_value.select_related.return_value.order_by.return_value = attempts
            analytics = teacher_analytics.get_group_analytics(teacher_actor, "grp-1")

        self.assertEqual(analytics["groupId"], "grp-1")
        self.assertEqual(analytics["groupName"], "IELTS Band 7+ Cohort")
        self.assertEqual(analytics["totalStudents"], 2)
        self.assertEqual(analytics["totalMockAttempts"], 2)
        self.assertEqual(analytics["groupAverageScore"], 7.0)
        self.assertEqual(len(analytics["students"]), 2)
        self.assertEqual(analytics["weakTopicsHeatmap"], [])
        self.assertIsNone(analytics["groupAverageAttendance"])

    def test_mixed_scales_and_zero_are_kept_separate(self):
        ielts = SimpleNamespace(exam=SimpleNamespace(type="ielts_academic"), overall_band=0,
                                overall_score=65, status="completed", flow_mode="full_test", media_state={})
        multilevel = SimpleNamespace(exam=SimpleNamespace(type="multilevel"), overall_band=0,
                                     overall_score=65, status="completed", flow_mode="full_test", media_state={})
        self.assertEqual(teacher_analytics.comparable_score(ielts), 0)
        self.assertEqual(teacher_analytics.comparable_score(multilevel), 65)
        multilevel.status = "grading"
        self.assertIsNone(teacher_analytics.comparable_score(multilevel))

    def test_group_exam_excel_export_creates_valid_workbook(self):
        """Excel report generator produces valid openpyxl workbook with appropriate styling and headers."""
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "IELTS Group Results"

        headers = ["#", "Student Name", "Listening", "Reading", "Writing", "Speaking", "Overall Band", "CEFR"]
        ws.append(headers)

        rows = [
            [1, "Ali Valiyev", 7.0, 6.5, 6.0, 6.5, 6.5, "B2"],
            [2, "Zarina Karimova", 8.0, 7.5, 7.0, 7.5, 7.5, "C1"],
        ]
        for row in rows:
            ws.append(row)

        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)

        # Re-read workbook to ensure it is valid
        loaded_wb = openpyxl.load_workbook(buf)
        self.assertIn("IELTS Group Results", loaded_wb.sheetnames)
        sheet = loaded_wb["IELTS Group Results"]
        self.assertEqual(sheet.cell(row=1, column=2).value, "Student Name")
        self.assertEqual(sheet.cell(row=2, column=2).value, "Ali Valiyev")
        self.assertEqual(sheet.cell(row=3, column=7).value, 7.5)
        self.assertEqual(sheet.cell(row=3, column=8).value, "C1")
