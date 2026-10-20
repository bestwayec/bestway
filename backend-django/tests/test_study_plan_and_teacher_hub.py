"""Comprehensive test suite for Adaptive Study Plan, Mistake Vault,
Teacher Group Analytics, Smart Attendance, and Monthly B2B PDF/Excel Reports.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from apps.core import group_report, study_plan_service, teacher_analytics
from apps.legacy_schema.models import Attendance, Group, MockAttempt, StudentProfile, User


class AdaptiveStudyPlanServiceTests(SimpleTestCase):
    @patch("apps.core.study_plan_service.MockAttempt.objects.filter")
    def test_study_plan_1_month_intensive_workload(self, mock_attempts):
        mock_qs = MagicMock()
        mock_qs.order_by.return_value = []
        mock_qs.__iter__.return_value = iter([])
        mock_attempts.return_value = mock_qs

        user = SimpleNamespace(id="student-1", name="Sardor Aliyev", role="student")
        plan = study_plan_service.get_student_study_plan(user, target_months=1)
        self.assertEqual(plan["intensityLevel"], "intensive")
        self.assertEqual(plan["baseDailyQuestionsTarget"], 35)
        self.assertTrue(plan["dailyQuestionsTarget"] >= 35)
        self.assertIn("35 ta", plan["dailyHeadline"])
        self.assertTrue(len(plan["dailyTasks"]) >= 3)

    @patch("apps.core.study_plan_service.MockAttempt.objects.filter")
    def test_study_plan_3_months_balanced_workload(self, mock_attempts):
        mock_qs = MagicMock()
        mock_qs.order_by.return_value = []
        mock_qs.__iter__.return_value = iter([])
        mock_attempts.return_value = mock_qs

        user = SimpleNamespace(id="student-2", name="Malika Karimova", role="student")
        plan = study_plan_service.get_student_study_plan(user, target_months=3)
        self.assertEqual(plan["intensityLevel"], "balanced")
        self.assertEqual(plan["baseDailyQuestionsTarget"], 20)
        self.assertTrue(plan["dailyQuestionsTarget"] >= 20)
        self.assertIn("20 ta", plan["dailyHeadline"])

    @patch("apps.core.study_plan_service.MockAttempt.objects.filter")
    def test_study_plan_dynamic_rebalancing_when_behind(self, mock_attempts):
        mock_qs = MagicMock()
        mock_qs.order_by.return_value = []
        mock_qs.__iter__.return_value = iter([])
        mock_attempts.return_value = mock_qs

        user = SimpleNamespace(id="student-3", name="Javohir Zokirov", role="student")
        # Simulating low completed questions
        plan = study_plan_service.get_student_study_plan(user, target_months=1)
        # In clean mock environment, weekly completion is 0%, which triggers rebalance
        self.assertTrue(plan["isBehindSchedule"])
        self.assertTrue(plan["rebalanceAdjustment"] > 0)
        self.assertIsNotNone(plan["rebalanceMessage"])
        self.assertIn("qayta muvozanatlashtirdi", plan["rebalanceMessage"])

    def test_mistake_vault_diagnostics_and_targeted_practice(self):
        user = SimpleNamespace(id="student-4", name="Dilnoza Rahimova", role="student")
        vault = study_plan_service.get_student_mistake_vault(user)
        self.assertTrue(vault["totalMistakes"] > 0)
        self.assertTrue(len(vault["categories"]) >= 4)
        
        # Test 1-click targeted practice generation
        practice = study_plan_service.generate_targeted_practice(user, category_id="tfng")
        self.assertEqual(practice["questionCount"], 10)
        self.assertEqual(len(practice["questions"]), 10)
        self.assertEqual(practice["categoryId"], "tfng")
        self.assertIn("TRUE", practice["questions"][0]["options"])


class TeacherAnalyticsAndReportTests(SimpleTestCase):
    @patch("apps.core.teacher_analytics.get_group")
    @patch("apps.core.teacher_analytics.StudentProfile.objects.filter")
    @patch("apps.core.teacher_analytics.MockAttempt.objects.filter")
    @patch("apps.core.teacher_analytics.Attendance.objects.filter")
    def test_group_analytics_metrics(self, mock_att, mock_attempts, mock_profiles, mock_group):
        teacher = SimpleNamespace(id="t-1", name="Ustoz Nodir", role="teacher")
        group = SimpleNamespace(id="g-101", name="IELTS Morning", teacher_id="t-1", teacher=teacher)
        mock_group.return_value = group

        st_user = SimpleNamespace(id="st-1", name="Azizbek", phone="+998901112233", is_active=True)
        st_profile = SimpleNamespace(user_id="st-1", user=st_user, current_points=120)
        mock_profiles.return_value.select_related.return_value.order_by.return_value = [st_profile]

        attempt_mock = SimpleNamespace(
            student_id="st-1",
            overall_band=7.0,
            overall_score=None,
            finished_at=datetime(2026, 10, 18, 14, 30),
            current_skill="writing",
            submitted_sections=["writing"],
        )
        mock_attempts.return_value.select_related.return_value.order_by.return_value = [attempt_mock]
        mock_att.return_value = []

        analytics = teacher_analytics.get_group_analytics(teacher, "g-101")
        self.assertEqual(analytics["groupName"], "IELTS Morning")
        self.assertEqual(analytics["totalStudents"], 1)
        self.assertEqual(analytics["students"][0]["averageScore"], 7.0)
        self.assertTrue(len(analytics["weakTopicsHeatmap"]) >= 3)

    @patch("apps.core.group_report.get_group_analytics")
    def test_monthly_pdf_and_csv_generation(self, mock_analytics):
        teacher = SimpleNamespace(id="t-1", name="Ustoz Nodir", role="teacher")
        mock_analytics.return_value = {
            "groupId": "g-101",
            "groupName": "IELTS Morning",
            "teacherName": "Ustoz Nodir",
            "totalStudents": 1,
            "groupAverageScore": 7.0,
            "totalMockAttempts": 5,
            "students": [
                {
                    "studentId": "st-1",
                    "name": "Azizbek",
                    "phone": "+998901112233",
                    "isActive": True,
                    "attendanceRate": 95,
                    "mockAttemptsCount": 5,
                    "essaysCount": 3,
                    "scoreLabel": "7.0",
                    "lastActiveAt": "2026-10-19 12:00",
                }
            ],
            "weakTopicsHeatmap": [
                {
                    "topic": "True / False / Not Given",
                    "groupErrorRate": 30,
                    "recommendation": "Qo'shimcha dars",
                }
            ],
        }

        # 1. Test PDF generation (ReportLab)
        pdf_bytes = group_report.generate_group_monthly_pdf(teacher, "g-101", "2026-10")
        self.assertTrue(len(pdf_bytes) > 1000)
        self.assertTrue(pdf_bytes.startswith(b"%PDF"))

        # 2. Test CSV generation
        csv_text = group_report.generate_group_monthly_csv(teacher, "g-101", "2026-10")
        self.assertIn("Azizbek", csv_text)
        self.assertIn("IELTS Morning", csv_text)
        self.assertIn("95%", csv_text)
