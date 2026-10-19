"""Comprehensive regression and integration tests for Attempt Telemetry,
Anti-Cheat Proctoring, Unified Desktop & Telegram SSO Auth, and Universal Assessment Overview.
"""
from __future__ import annotations

import base64
import hashlib
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core import (
    assessment_overview_service,
    assessment_views,
    auth_service,
    mock_attempt_views,
    mock_attempts,
    prediction_service,
    telegram_views,
    views,
)
from apps.legacy_schema import models
from common.api.exceptions import ContractAPIException
from common.auth.authentication import LegacyUser


class AttemptTelemetryAndAntiCheatTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.student_id = "student-telemetry-1"
        self.student_user = LegacyUser(
            id=self.student_id,
            name="Telemetry Student",
            phone="+998901119988",
            role="student",
            is_active=True,
        )
        self.attempt_id = "att-telemetry-1"

    def test_telemetry_records_window_blur_and_increments_anticheat(self):
        """Verify window_blur increases anti-cheat count and records anomaly event."""
        fake_attempt = SimpleNamespace(
            id=self.attempt_id,
            student_id=self.student_id,
            status="in_progress",
            anti_cheat_count=0,
            save=MagicMock(),
        )

        with patch("apps.core.mock_attempts.own", return_value=fake_attempt), \
             patch("apps.legacy_schema.models.MockCheatEvent.objects.filter") as cheat_filter, \
             patch("apps.legacy_schema.models.MockCheatEvent.objects.create") as cheat_create, \
             patch("apps.core.mock_attempts.notify_teacher_proctoring_alert"):

            cheat_filter.return_value.count.return_value = 0

            payload = {
                "event": "window_blur",
                "timestamp": int(datetime.now(UTC).timestamp() * 1000),
                "blurCount": 1,
                "metadata": {"source": "browser_blur"},
            }

            res = mock_attempts.record_telemetry(self.student_user, self.attempt_id, payload)

            self.assertTrue(res["success"])
            self.assertTrue(res["recorded"])
            self.assertEqual(res["antiCheatCount"], 1)
            self.assertEqual(fake_attempt.anti_cheat_count, 1)
            fake_attempt.save.assert_called_once_with(update_fields=["anti_cheat_count"])
            cheat_create.assert_called_once()
            created_event_text = cheat_create.call_args[1]["event"]
            self.assertIn("telemetry:window_blur", created_event_text)

    def test_telemetry_records_fullscreen_exit_and_increments_anticheat(self):
        """Verify fullscreen_exit anomaly increases anti_cheat_count."""
        fake_attempt = SimpleNamespace(
            id=self.attempt_id,
            student_id=self.student_id,
            status="in_progress",
            anti_cheat_count=2,
            save=MagicMock(),
        )

        with patch("apps.core.mock_attempts.own", return_value=fake_attempt), \
             patch("apps.legacy_schema.models.MockCheatEvent.objects.filter") as cheat_filter, \
             patch("apps.legacy_schema.models.MockCheatEvent.objects.create") as cheat_create, \
             patch("apps.core.mock_attempts.notify_teacher_proctoring_alert"):

            cheat_filter.return_value.count.return_value = 2

            payload = {
                "event": "fullscreen_exit",
                "timestamp": int(datetime.now(UTC).timestamp() * 1000),
                "blurCount": 0,
                "metadata": {"mode": "escape_key"},
            }

            res = mock_attempts.record_telemetry(self.student_user, self.attempt_id, payload)

            self.assertTrue(res["success"])
            self.assertEqual(res["antiCheatCount"], 3)
            self.assertEqual(fake_attempt.anti_cheat_count, 3)
            fake_attempt.save.assert_called_once_with(update_fields=["anti_cheat_count"])
            cheat_create.assert_called_once()
            self.assertIn("telemetry:fullscreen_exit", cheat_create.call_args[1]["event"])

    def test_telemetry_benign_event_does_not_increment_anticheat_when_no_blurs(self):
        """Verify benign events (e.g. window_focus) without blurs do not increment anti_cheat_count."""
        fake_attempt = SimpleNamespace(
            id=self.attempt_id,
            student_id=self.student_id,
            status="in_progress",
            anti_cheat_count=1,
            save=MagicMock(),
        )

        with patch("apps.core.mock_attempts.own", return_value=fake_attempt), \
             patch("apps.legacy_schema.models.MockCheatEvent.objects.filter") as cheat_filter, \
             patch("apps.legacy_schema.models.MockCheatEvent.objects.create") as cheat_create, \
             patch("apps.core.mock_attempts.notify_teacher_proctoring_alert"):

            cheat_filter.return_value.count.return_value = 1

            payload = {
                "event": "window_focus",
                "timestamp": int(datetime.now(UTC).timestamp() * 1000),
                "blurCount": 0,
                "metadata": {},
            }

            res = mock_attempts.record_telemetry(self.student_user, self.attempt_id, payload)

            self.assertTrue(res["success"])
            self.assertEqual(res["antiCheatCount"], 1)
            self.assertEqual(fake_attempt.anti_cheat_count, 1)
            fake_attempt.save.assert_not_called()
            cheat_create.assert_called_once()

    def test_telemetry_endpoint_http_post_mock_and_assessment_routes(self):
        """Verify POST /v1/mock/attempts/<id>/telemetry and /v1/assessment/attempts/<id>/telemetry return 200 OK."""
        fake_record = {
            "success": True,
            "antiCheatCount": 2,
            "recorded": True,
        }

        with patch("common.auth.authentication.BestwayJWTAuthentication.authenticate", return_value=(self.student_user, "mock-token")), \
             patch("apps.core.mock_attempts.record_telemetry", return_value=fake_record):

            endpoints = (
                f"/v1/mock/attempts/{self.attempt_id}/telemetry",
                f"/v1/mock/attempts/{self.attempt_id}/telemetry/",
                f"/v1/assessment/attempts/{self.attempt_id}/telemetry",
                f"/v1/assessment/attempts/{self.attempt_id}/telemetry/",
            )

            for url in endpoints:
                with self.subTest(url=url):
                    response = self.client.post(
                        url,
                        data={
                            "event": "tab_switch",
                            "timestamp": 1729000000000,
                            "blurCount": 2,
                            "metadata": {"target": "alt_tab"},
                        },
                        format="json",
                        HTTP_AUTHORIZATION="Bearer mock-token",
                    )
                    self.assertEqual(response.status_code, 200)
                    self.assertTrue(response.data["success"])
                    self.assertEqual(response.data["antiCheatCount"], 2)
                    self.assertTrue(response.data["recorded"])


class DesktopVersionAndAuthParityTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_desktop_version_returns_0_8_4(self):
        """Verify GET /v1/desktop/version returns 0.8.4 with valid download URL."""
        response = self.client.get("/v1/desktop/version")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["success"])
        data = response.data["data"]
        self.assertEqual(data["version"], "0.8.4")
        self.assertIn("0.8.4", data["downloadUrl"])
        self.assertEqual(data["downloadUrl"], "https://bestwayec.uz/media/downloads/Bestway.App_0.8.4_x64-setup.exe")

    def test_desktop_update_json_manifest_returns_0_8_4(self):
        """Verify GET /v1/desktop/update.json returns Tauri v2 manifest for 0.8.4."""
        response = self.client.get("/v1/desktop/update.json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["version"], "0.8.4")
        self.assertIn("0.8.4", response.data["notes"])
        windows_platform = response.data["platforms"]["windows-x86_64"]
        self.assertEqual(windows_platform["url"], "https://bestwayec.uz/media/downloads/Bestway.App_0.8.4_x64-setup.exe")

    def test_desktop_auth_both_schemes_for_all_roles(self):
        """Verify both bestway-exam:// and bestway:// schemes work for student, teacher, admin, super_admin."""
        verifier = "verifier_test_string_xyz_987"
        digest = hashlib.sha256(verifier.encode("utf-8")).digest()
        challenge = base64.urlsafe_b64encode(digest).decode("utf-8").rstrip("=")
        device_id = "test-pc-device"
        state = "state-desktop-abc"

        for role in ("student", "teacher", "admin", "super_admin"):
            for scheme in ("bestway-exam://auth/callback", "bestway://auth/callback", "bestway://auth/callback/"):
                with self.subTest(role=role, scheme=scheme):
                    user_tuple = (
                        f"user-{role}",
                        f"Name {role}",
                        "+998901234567",
                        role,
                        datetime.now(UTC),
                        "hash",
                        True,
                        None,
                        f"{role}@bestwayec.uz",
                    )
                    with patch.object(auth_service, "fetch_user", return_value=user_tuple), \
                         patch("apps.core.auth_service.connection.cursor"):
                        auth_res = auth_service.authorize_desktop(
                            f"user-{role}",
                            device_id=device_id,
                            state=state,
                            challenge=challenge,
                            redirect=scheme,
                        )
                        self.assertIn("code", auth_res)
                        self.assertEqual(auth_res["state"], state)


class TelegramSSOAndMagicTokenTests(TestCase):
    def test_telegram_login_with_magic_token_returns_full_user(self):
        """Verify telegram_login handles magic/sso tokens and returns complete user object with role and email."""
        mock_user = SimpleNamespace(
            id="u-magic-1",
            name="SSO User",
            phone="+998909876543",
            role="teacher",
            email="sso_teacher@bestwayec.uz",
            is_active=True,
            telegram_chat_id="12345678",
            created_at=datetime(2026, 10, 10, 8, 0, 0, tzinfo=UTC),
            password_hash="pwdhash",
        )
        mock_link_token = SimpleNamespace(
            id="tok-1",
            user=mock_user,
            used_at=None,
            expires_at=datetime.now(UTC) + timedelta(minutes=10),
        )

        with patch("apps.legacy_schema.models.TelegramLinkToken.objects.filter") as filter_mock, \
             patch("apps.core.auth_service.issue_tokens", return_value={"accessToken": "at1", "refreshToken": "rt1"}):

            filter_mock.return_value.select_related.return_value.first.return_value = mock_link_token
            filter_mock.return_value.update.return_value = 1

            res = telegram_views.telegram_login({"magic_token": "valid_magic_token_string"})

            self.assertIn("user", res)
            u = res["user"]
            self.assertEqual(u["id"], "u-magic-1")
            self.assertEqual(u["role"], "teacher")
            self.assertEqual(u["email"], "sso_teacher@bestwayec.uz")
            self.assertTrue(u["isActive"])
            self.assertIn("accessToken", res)


class AssessmentOverviewParityTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.student_id = "std-overview-dual"
        self.student_user = LegacyUser(
            id=self.student_id,
            name="Dual Scale Student",
            phone="+998907778899",
            role="student",
            is_active=True,
        )

    def test_assessment_overview_contains_all_parity_fields(self):
        """Verify get_assessment_overview returns user, prediction, recentAttempts, writingAssessments, speakingAssessments, statistics."""
        fake_prediction = {
            "studentId": self.student_id,
            "studentName": "Dual Scale Student",
            "activeProgram": "IELTS",
            "attemptsAnalyzed": 2,
            "trend": "improving",
            "targetProgressPercent": 85,
            "weakModules": ["matching_headings"],
            "ielts": {
                "currentBand": 6.5,
                "predictedBand": 7.0,
                "trendDelta": 0.5,
                "targetBand": 7.5,
                "targetProgressPercent": 85,
                "gapToTarget": 0.5,
                "cefrLevel": "C1",
                "skillBreakdown": {"listening": 7.0, "reading": 7.0, "writing": 6.5, "speaking": 6.5},
            },
            "multilevel": {
                "currentScore": 58.0,
                "predictedScore": 62.0,
                "trendDelta": 4.0,
                "targetScore": 65.0,
                "targetCefr": "C1",
                "targetProgressPercent": 88,
                "gapToTarget": 3.0,
                "cefrLevel": "C1",
                "scaleBands": prediction_service.MULTILEVEL_SCALE_BANDS,
                "skillBreakdown": {"listening": 62.0, "reading": 62.0, "writing": 58.0, "speaking": 58.0},
            },
            "history": [],
        }

        fake_exam = SimpleNamespace(title="IELTS Mock #4", type="ielts_academic")
        fake_attempt = SimpleNamespace(
            id="att-ov-1",
            exam_id="exam-4",
            exam=fake_exam,
            status="completed",
            started_at=datetime(2026, 10, 16, 9, 0, 0, tzinfo=UTC),
            finished_at=datetime(2026, 10, 16, 11, 45, 0, tzinfo=UTC),
            submitted_at=None,
            overall_band=7.0,
            overall_score=None,
            raw_scores={"listening": {"score": 33, "max": 40}},
            section_bands={"listening": 7.5, "reading": 7.0, "writing": 6.5, "speaking": 7.0},
            standard_scores={},
            cefr_level="C1",
        )

        with patch("apps.core.prediction_service.get_student_prediction", return_value=fake_prediction), \
             patch("apps.legacy_schema.models.MockAttempt.objects.filter") as mock_att_filter, \
             patch("apps.legacy_schema.models.TestAttempt.objects.filter") as leg_att_filter, \
             patch("apps.legacy_schema.models.AssessmentJob.objects.filter") as job_filter, \
             patch.object(auth_service, "fetch_user", return_value=(self.student_id, "Dual Scale Student", "+998907778899", "student", datetime.now(UTC), "hash", True, None, "dual@bestwayec.uz")):

            mock_att_filter.return_value.select_related.return_value.order_by.return_value = [fake_attempt]
            mock_att_filter.return_value.__iter__.return_value = [fake_attempt]
            mock_att_filter.return_value.count.return_value = 1

            leg_att_filter.return_value.select_related.return_value.order_by.return_value = []
            leg_att_filter.return_value.__iter__.return_value = []
            leg_att_filter.return_value.count.return_value = 0

            fake_writing_job = SimpleNamespace(
                id="job-w-1",
                attempt_id="att-ov-1",
                attempt=fake_attempt,
                skill="writing",
                final_score=6.5,
                teacher_score=6.5,
                ai_score=6.5,
                final_score_source="TEACHER",
                approved_feedback={
                    "feedback": "Strong arguments and cohesion.",
                    "criteria": {"taskAchievement": 7.0, "coherenceCohesion": 7.0, "lexicalResource": 6.0, "grammaticalRange": 6.0},
                },
                final_result=None,
                created_at=datetime(2026, 10, 16, 12, 0, 0, tzinfo=UTC),
                completed_at=datetime(2026, 10, 16, 12, 10, 0, tzinfo=UTC),
            )

            fake_speaking_job = SimpleNamespace(
                id="job-s-1",
                attempt_id="att-ov-1",
                attempt=fake_attempt,
                skill="speaking",
                final_score=7.0,
                teacher_score=None,
                ai_score=7.0,
                final_score_source="AI",
                approved_feedback=None,
                final_result={
                    "feedback": "Natural fluency with precise grammar.",
                    "criteria": {"fluency": 7.0, "pronunciation": 7.0, "lexical": 7.0, "grammar": 7.0},
                },
                created_at=datetime(2026, 10, 16, 12, 15, 0, tzinfo=UTC),
                completed_at=datetime(2026, 10, 16, 12, 20, 0, tzinfo=UTC),
            )

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

            with patch("apps.legacy_schema.models.MockAnswer.objects.filter") as answer_filter:
                answer_filter.return_value.select_related.return_value.order_by.return_value = []

                overview = assessment_overview_service.get_assessment_overview(self.student_user)

                # 1. user
                self.assertIn("user", overview)
                self.assertEqual(overview["user"]["id"], self.student_id)
                self.assertEqual(overview["user"]["email"], "dual@bestwayec.uz")
                self.assertTrue(overview["user"]["isActive"])

                # 2. prediction
                self.assertIn("prediction", overview)
                pred = overview["prediction"]
                self.assertEqual(pred["targetProgressPercent"], 85)
                self.assertEqual(pred["weakModules"], ["matching_headings"])
                self.assertEqual(pred["ielts"]["predictedBand"], 7.0)
                self.assertEqual(pred["multilevel"]["predictedScore"], 62.0)

                # 3. recentAttempts
                self.assertIn("recentAttempts", overview)
                self.assertEqual(len(overview["recentAttempts"]), 1)
                att = overview["recentAttempts"][0]
                self.assertEqual(att["overallBand"], 7.0)
                self.assertEqual(att["cefrLevel"], "C1")
                self.assertIn("listening", att["skills"])

                # 4. writing & speaking assessments
                self.assertIn("writingAssessments", overview)
                self.assertEqual(len(overview["writingAssessments"]), 1)
                self.assertEqual(overview["writingAssessments"][0]["band"], 6.5)
                self.assertEqual(overview["writingAssessments"][0]["criteria"]["taskAchievement"], 7.0)

                self.assertIn("speakingAssessments", overview)
                self.assertEqual(len(overview["speakingAssessments"]), 1)
                self.assertEqual(overview["speakingAssessments"][0]["band"], 7.0)
                self.assertEqual(overview["speakingAssessments"][0]["criteria"]["fluency"], 7.0)

                # 5. statistics
                self.assertIn("statistics", overview)
                stats = overview["statistics"]
                self.assertEqual(stats["totalAttempts"], 1)
                self.assertEqual(stats["highestBand"], 7.0)
                self.assertGreaterEqual(stats["practiceHours"], 0.0)

    def test_assessment_overview_routes_active_and_200(self):
        """Verify assessment overview routes are registered in urls.py and return HTTP 200 OK."""
        from django.urls import resolve

        # Direct apps.core.urls route resolution
        r1 = resolve("/assessment/overview", urlconf="apps.core.urls")
        self.assertEqual(r1.func, assessment_views.assessment_overview_view)
        r2 = resolve("/v1/assessment/overview", urlconf="apps.core.urls")
        self.assertEqual(r2.func, assessment_views.assessment_overview_view)

        fake_data = {
            "user": {"id": self.student_id, "name": "Student Dual", "email": "s@bestwayec.uz", "role": "student"},
            "prediction": {"studentId": self.student_id, "targetProgressPercent": 80, "weakModules": []},
            "recentAttempts": [],
            "writingAssessments": [],
            "speakingAssessments": [],
            "statistics": {"totalAttempts": 0, "averageBand": 0.0, "highestBand": 0.0, "averageMultilevelScore": 0.0, "practiceHours": 0.0},
        }

        with patch("common.auth.authentication.BestwayJWTAuthentication.authenticate", return_value=(self.student_user, "mock-token")), \
             patch("apps.core.assessment_overview_service.get_assessment_overview", return_value=fake_data):

            for path in ("/v1/assessment/overview", "/v1/assessment/overview/", "/api/v1/assessment/overview", "/api/v1/assessment/overview/"):
                with self.subTest(path=path):
                    response = self.client.get(path, HTTP_AUTHORIZATION="Bearer mock-token")
                    self.assertEqual(response.status_code, 200)
                    self.assertTrue(response.data["success"])
                    self.assertEqual(response.data["data"]["user"]["id"], self.student_id)
