"""Unit and integration tests for Unified Desktop & Mobile Deep Link Authorization,
1-Click Telegram & Magic Token Login, and Universal Assessment Overview API.
"""
from __future__ import annotations

import base64
import hashlib
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core import (
    assessment_overview_service,
    assessment_views,
    auth_service,
    telegram_views,
)
from apps.legacy_schema import models
from common.api.exceptions import ContractAPIException
from common.auth.authentication import LegacyUser
from common.auth.jwt import issue_access


class UnifiedDesktopAuthTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.verifier = "test_verifier_string_123456789"
        digest = hashlib.sha256(self.verifier.encode("utf-8")).digest()
        self.challenge = base64.urlsafe_b64encode(digest).decode("utf-8").rstrip("=")
        self.device_id = "device_desktop_12345"
        self.state = "state_1234567890abcdef"

    def test_desktop_authorize_accepts_both_redirect_schemes(self):
        """Verify DESKTOP_REDIRECT_URIS accepts bestway-exam:// and bestway:// schemes."""
        student_user = ("s-1", "Student One", "+998901111111", "student", datetime.now(UTC), "hash", True, None)
        with patch.object(auth_service, "fetch_user", return_value=student_user), \
             patch("apps.core.auth_service.connection.cursor"):
            # Scheme 1: bestway-exam://auth/callback
            res1 = auth_service.authorize_desktop(
                "s-1",
                device_id=self.device_id,
                state=self.state,
                challenge=self.challenge,
                redirect="bestway-exam://auth/callback",
            )
            self.assertIn("code", res1)
            self.assertEqual(res1["state"], self.state)

            # Scheme 2: bestway://auth/callback
            res2 = auth_service.authorize_desktop(
                "s-1",
                device_id=self.device_id,
                state=self.state,
                challenge=self.challenge,
                redirect="bestway://auth/callback",
            )
            self.assertIn("code", res2)
            self.assertEqual(res2["state"], self.state)

    def test_desktop_authorize_rejects_unauthorized_redirect(self):
        student_user = ("s-1", "Student One", "+998901111111", "student", datetime.now(UTC), "hash", True, None)
        with patch.object(auth_service, "fetch_user", return_value=student_user):
            with self.assertRaises(ContractAPIException) as ctx:
                auth_service.authorize_desktop(
                    "s-1",
                    device_id=self.device_id,
                    state=self.state,
                    challenge=self.challenge,
                    redirect="https://malicious-site.com/callback",
                )
            self.assertEqual(ctx.exception.contract_code, "INVALID_REDIRECT")

    def test_teacher_and_admin_desktop_authorization(self):
        """Verify teachers, admins, and super_admins can authorize and exchange on desktop."""
        for role in ("teacher", "admin", "super_admin"):
            with self.subTest(role=role):
                user_tuple = (f"u-{role}", f"User {role.title()}", "+998902222222", role, datetime.now(UTC), "hash", True, None)
                with patch.object(auth_service, "fetch_user", return_value=user_tuple), \
                     patch("apps.core.auth_service.connection.cursor"):
                    auth_res = auth_service.authorize_desktop(
                        f"u-{role}",
                        device_id=self.device_id,
                        state=self.state,
                        challenge=self.challenge,
                        redirect="bestway://auth/callback",
                    )
                    self.assertIn("code", auth_res)

    def test_disallowed_role_desktop_authorization_rejected(self):
        parent_user = ("p-1", "Parent One", "+998903333333", "parent", datetime.now(UTC), "hash", True, None)
        with patch.object(auth_service, "fetch_user", return_value=parent_user):
            with self.assertRaises(ContractAPIException) as ctx:
                auth_service.authorize_desktop(
                    "p-1",
                    device_id=self.device_id,
                    state=self.state,
                    challenge=self.challenge,
                    redirect="bestway://auth/callback",
                )
            self.assertEqual(ctx.exception.contract_code, "FORBIDDEN")

    def test_desktop_authorize_view_endpoint_allows_teacher(self):
        """Verify desktop_authorize_view endpoint accepts authenticated teacher."""
        teacher = LegacyUser(id="t-100", name="Teacher Aziz", phone="+998901234567", role="teacher", is_active=True)
        payload = {
            "deviceId": self.device_id,
            "state": self.state,
            "codeChallenge": self.challenge,
            "redirect": "bestway://auth/callback",
        }
        with patch("common.auth.authentication.BestwayJWTAuthentication.authenticate", return_value=(teacher, "mock-token")), \
             patch.object(auth_service, "fetch_user", return_value=("t-100", "Teacher Aziz", "+998901234567", "teacher", datetime.now(UTC), "hash", True, None)), \
             patch("apps.core.auth_service.connection.cursor"):
            response = self.client.post("/v1/auth/desktop/authorize", payload, format="json", HTTP_AUTHORIZATION="Bearer mock-token")
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.data["success"])
            self.assertIn("code", response.data["data"])

    def test_exchange_desktop_for_teacher_succeeds(self):
        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.fetchone.return_value = (
            "code-id-1", "t-1", self.challenge, self.device_id,
            auth_service.db_now() + timedelta(minutes=5), None,
            "t-1", "Teacher Aziz", "+998901112233", "teacher",
            auth_service.db_now(), "hash", True, None,
        )
        with patch.object(auth_service.transaction, "atomic"), \
             patch.object(auth_service, "connection", MagicMock(cursor=MagicMock(return_value=cursor))), \
             patch.object(auth_service, "issue_tokens", return_value={"accessToken": "at_teacher", "refreshToken": "rt_teacher"}):
            result = auth_service.exchange_desktop("code-123", self.verifier, self.device_id)
            self.assertEqual(result["user"]["role"], "teacher")
            self.assertEqual(result["accessToken"], "at_teacher")


class TelegramOneClickLoginTests(TestCase):
    """One-click login accepts only single-use tokens issued by the bot."""

    def setUp(self):
        from django.core.cache import cache
        cache.clear()
        self.client = APIClient()
        self.row = ("user-uuid-tg", "Telegram Student", "+998907778899", "student",
                    datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC), "hash", True, "123456789", "student@bestwayec.uz")

    def _patched(self):
        from contextlib import ExitStack, nullcontext
        stack = ExitStack()
        conn = MagicMock()
        conn.vendor = "postgresql"
        conn.cursor.return_value.__enter__.return_value.fetchone.return_value = self.row
        stack.enter_context(patch("apps.core.telegram_views.connection", conn))
        stack.enter_context(patch("apps.core.telegram_views.transaction.atomic", return_value=nullcontext()))
        stack.enter_context(patch("apps.core.auth_service.issue_tokens", return_value={"accessToken": "at_tg", "refreshToken": "rt_tg"}))
        return stack

    def test_telegram_login_with_bot_sso_token_succeeds(self):
        from apps.core import telegram_sso
        token = telegram_sso.issue_sso_token("123456789", "Telegram")
        with self._patched():
            res = telegram_views.telegram_login({"sso_token": token})
        self.assertEqual(res["user"]["id"], "user-uuid-tg")
        self.assertEqual(res["user"]["email"], "student@bestwayec.uz")
        self.assertEqual(res["user"]["telegramChatId"], "123456789")
        self.assertEqual(res["accessToken"], "at_tg")
        self.assertEqual(res["refreshToken"], "rt_tg")

    def test_link_tokens_and_legacy_magic_keys_are_not_login_credentials(self):
        for payload in ({"magic_token": "x"}, {"token": "x"}, {"sso_token": "not-issued"}):
            with self.subTest(payload=payload), self._patched(), self.assertRaises(ContractAPIException) as ctx:
                telegram_views.telegram_login(payload)
            self.assertIn(ctx.exception.contract_code, ("INVALID_TOKEN", "INVALID_CREDENTIALS", "TELEGRAM_DISABLED"))

    def test_telegram_login_with_expired_or_used_token_fails(self):
        from apps.core import telegram_sso
        token = telegram_sso.issue_sso_token("123456789")
        with self._patched():
            telegram_views.telegram_login({"sso_token": token})
            with self.assertRaises(ContractAPIException) as ctx:
                telegram_views.telegram_login({"sso_token": token})
        self.assertEqual(ctx.exception.contract_code, "INVALID_TOKEN")

    def test_telegram_login_endpoint_post_200(self):
        from apps.core import telegram_sso
        token = telegram_sso.issue_sso_token("123456789")
        with self._patched():
            response = self.client.post("/v1/telegram/login", {"sso_token": token}, format="json")
        self.assertEqual(response.status_code, 200)
        data = response.data["data"]
        self.assertEqual(data["user"]["id"], "user-uuid-tg")
        self.assertEqual(data["accessToken"], "at_tg")


class UniversalAssessmentOverviewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.student_user = LegacyUser(
            id="student-overview-1",
            name="Overview Student",
            phone="+998901112244",
            role="student",
            is_active=True,
        )

    def test_assessment_overview_service_structure(self):
        """Verify get_assessment_overview returns complete normalized schema."""
        mock_user = SimpleNamespace(id="student-overview-1", name="Overview Student", phone="+998901112244", role="student")

        fake_prediction = {
            "studentId": "student-overview-1",
            "studentName": "Overview Student",
            "activeProgram": "IELTS",
            "attemptsAnalyzed": 1,
            "trend": "stable",
            "ielts": {"currentBand": 7.0, "predictedBand": 7.5, "targetBand": 7.5},
            "multilevel": {"currentScore": 62.0, "predictedScore": 65.0, "targetScore": 65.0},
        }

        fake_mock_attempt = SimpleNamespace(
            id="att-mock-1",
            exam_id="exam-ielts-1",
            exam=SimpleNamespace(title="IELTS Mock Exam 1", type="ielts_academic"),
            status="completed",
            started_at=datetime(2026, 10, 15, 9, 0, 0, tzinfo=UTC),
            finished_at=datetime(2026, 10, 15, 11, 45, 0, tzinfo=UTC),
            submitted_at=None,
            overall_band=7.0,
            overall_score=None,
            raw_scores={"listening": {"score": 32, "max": 40}, "reading": {"score": 30, "max": 40}},
            section_bands={"listening": 7.5, "reading": 7.0, "writing": 6.5, "speaking": 7.0},
            standard_scores={},
            cefr_level="C1",
        )

        fake_writing_job = SimpleNamespace(
            id="job-writing-1",
            attempt_id="att-mock-1",
            attempt=fake_mock_attempt,
            skill="writing",
            final_score=6.5,
            teacher_score=6.5,
            ai_score=6.5,
            final_score_source="TEACHER",
            approved_feedback={
                "feedback": "Strong coherence, expand on lexical range in Task 2.",
                "criteria": {"taskAchievement": 7.0, "coherenceCohesion": 7.0, "lexicalResource": 6.0, "grammaticalRange": 6.0},
            },
            final_result=None,
            created_at=datetime(2026, 10, 15, 11, 50, 0, tzinfo=UTC),
            completed_at=datetime(2026, 10, 15, 12, 0, 0, tzinfo=UTC),
        )

        fake_speaking_job = SimpleNamespace(
            id="job-speaking-1",
            attempt_id="att-mock-1",
            attempt=fake_mock_attempt,
            skill="speaking",
            final_score=7.0,
            teacher_score=None,
            ai_score=7.0,
            final_score_source="AI",
            approved_feedback=None,
            final_result={
                "feedback": "Natural fluency with accurate pronunciation.",
                "criteria": {"fluency": 7.5, "pronunciation": 7.0, "lexical": 7.0, "grammar": 6.5},
            },
            created_at=datetime(2026, 10, 15, 12, 5, 0, tzinfo=UTC),
            completed_at=datetime(2026, 10, 15, 12, 10, 0, tzinfo=UTC),
        )

        with patch("apps.core.prediction_service.get_student_prediction", return_value=fake_prediction), \
             patch("apps.legacy_schema.models.MockAttempt.objects.filter") as mock_att_filter, \
             patch("apps.legacy_schema.models.TestAttempt.objects.filter") as leg_att_filter, \
             patch("apps.legacy_schema.models.AssessmentJob.objects.filter") as job_filter, \
             patch.object(auth_service, "fetch_user", return_value=("student-overview-1", "Overview Student", "+998901112244", "student", datetime.now(UTC))):

            # Setup MockAttempt mocks
            mock_att_filter.return_value.select_related.return_value.order_by.return_value = [fake_mock_attempt]
            mock_att_filter.return_value.__iter__.return_value = [fake_mock_attempt]
            mock_att_filter.return_value.count.return_value = 1

            # Setup legacy TestAttempt mocks
            leg_att_filter.return_value.select_related.return_value.order_by.return_value = []
            leg_att_filter.return_value.__iter__.return_value = []
            leg_att_filter.return_value.count.return_value = 0

            # Setup AssessmentJob mocks
            def job_filter_side_effect(**kwargs):
                skill = kwargs.get("skill")
                m = MagicMock()
                if skill == "writing":
                    m.select_related.return_value.order_by.return_value = [fake_writing_job]
                elif skill == "speaking":
                    m.select_related.return_value.order_by.return_value = [fake_speaking_job]
                else:
                    m.select_related.return_value.order_by.return_value = []
                return m
            job_filter.side_effect = job_filter_side_effect

            overview = assessment_overview_service.get_assessment_overview(mock_user)

            self.assertIn("user", overview)
            self.assertEqual(overview["user"]["id"], "student-overview-1")

            self.assertIn("prediction", overview)
            self.assertEqual(overview["prediction"]["ielts"]["predictedBand"], 7.5)

            self.assertIn("recentAttempts", overview)
            self.assertEqual(len(overview["recentAttempts"]), 1)
            att = overview["recentAttempts"][0]
            self.assertEqual(att["examTitle"], "IELTS Mock Exam 1")
            self.assertEqual(att["status"], "evaluated")
            self.assertEqual(att["overallBand"], 7.0)
            self.assertIn("listening", att["skills"])

            self.assertIn("writingAssessments", overview)
            self.assertEqual(len(overview["writingAssessments"]), 1)
            self.assertEqual(overview["writingAssessments"][0]["band"], 6.5)
            self.assertEqual(overview["writingAssessments"][0]["criteria"]["taskAchievement"], 7.0)

            self.assertIn("speakingAssessments", overview)
            self.assertEqual(len(overview["speakingAssessments"]), 1)
            self.assertEqual(overview["speakingAssessments"][0]["band"], 7.0)
            self.assertEqual(overview["speakingAssessments"][0]["criteria"]["fluency"], 7.5)

            self.assertIn("statistics", overview)
            self.assertEqual(overview["statistics"]["totalAttempts"], 1)
            self.assertEqual(overview["statistics"]["highestBand"], 7.0)
            self.assertGreater(overview["statistics"]["practiceHours"], 0.0)

    def test_assessment_overview_endpoint_get_200(self):
        """Verify GET /v1/assessment/overview returns 200 OK with success envelope."""
        fake_data = {
            "user": {"id": "student-overview-1", "name": "Overview Student"},
            "prediction": {"studentId": "student-overview-1"},
            "recentAttempts": [],
            "writingAssessments": [],
            "speakingAssessments": [],
            "statistics": {"totalAttempts": 0, "averageBand": 0.0, "highestBand": 0.0, "averageMultilevelScore": 0.0, "practiceHours": 0.0},
        }
        with patch("common.auth.authentication.BestwayJWTAuthentication.authenticate", return_value=(self.student_user, "mock-token")), \
             patch("apps.core.assessment_overview_service.get_assessment_overview", return_value=fake_data):

            for url in ("/v1/assessment/overview", "/v1/assessment/overview/", "/api/v1/assessment/overview", "/api/v1/assessment/overview/"):
                with self.subTest(url=url):
                    response = self.client.get(url, HTTP_AUTHORIZATION="Bearer mock-token")
                    self.assertEqual(response.status_code, 200)
                    self.assertTrue(response.data["success"])
                    self.assertEqual(response.data["data"]["user"]["id"], "student-overview-1")
                    self.assertIn("statistics", response.data["data"])
