"""Comprehensive test suite for Adaptive 10-Minute Express Placement Test & Guest Session Engine."""
import json
import uuid
from unittest.mock import MagicMock, patch

from django.core.cache import cache
from django.test import SimpleTestCase
from django.test.client import RequestFactory
from django.utils import timezone

from apps.core.study_plan_service import get_student_mistake_vault
from apps.exams.placement_views import (
    PLACEMENT_QUESTIONS,
    RATE_LIMIT_PREFIX,
    RESULT_PREFIX,
    SESSION_PREFIX,
    placement_claim_view,
    placement_questions_view,
    placement_submit_view,
)


class PlacementTestEngineTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        self.factory = RequestFactory()

        # Mock student user
        self.student_user = MagicMock()
        self.student_user.id = "student-test-uuid-123"
        self.student_user.name = "Jasur Aliyev"
        self.student_user.phone = "+998901234567"
        self.student_user.role = "student"
        self.student_user.is_authenticated = True

        # Mock student profile
        self.student_profile = MagicMock()
        self.student_profile.user_id = self.student_user.id
        self.student_profile.initial_level = None
        self.student_profile.diagnostic_cefr_score = None

    def test_get_placement_questions_structure_and_security(self):
        """GET /api/v1/placement-test/questions returns 20 questions and never leaks correct answers."""
        req = self.factory.get("/api/v1/placement-test/questions", REMOTE_ADDR="192.168.1.101")
        response = placement_questions_view(req)
        self.assertEqual(response.status_code, 200)

        data = json.loads(response.content.decode("utf-8"))
        self.assertTrue(data.get("success"))
        payload = data["data"]

        self.assertIn("guest_session_id", payload)
        self.assertEqual(payload["total_questions"], 20)
        self.assertEqual(payload["duration_minutes"], 10)

        questions = payload["questions"]
        self.assertEqual(len(questions), 20)

        # Check difficulty distribution: 4 A1/A2, 6 B1, 6 B2, 4 C1
        levels = [q["level"] for q in questions]
        self.assertEqual(levels.count("A1/A2"), 4)
        self.assertEqual(levels.count("B1"), 6)
        self.assertEqual(levels.count("B2"), 6)
        self.assertEqual(levels.count("C1"), 4)

        # SECURITY CHECK: verify no correct answers or explanations leaked to the client
        for q in questions:
            self.assertNotIn("correct_option", q)
            self.assertNotIn("correct_answer", q)
            self.assertNotIn("explanation", q)
            self.assertEqual(len(q["options"]), 4)
            self.assertTrue(all("key" in opt and "text" in opt for opt in q["options"]))

    def test_placement_test_ip_rate_limiting(self):
        """IP is rate-limited to 5 requests per hour. The 6th request receives 429."""
        ip = "192.168.1.200"

        for i in range(5):
            req = self.factory.get("/api/v1/placement-test/questions", REMOTE_ADDR=ip)
            res = placement_questions_view(req)
            self.assertEqual(res.status_code, 200, f"Request {i+1} should succeed")

        # 6th request from the same IP must be rejected
        blocked_req = self.factory.get("/api/v1/placement-test/questions", REMOTE_ADDR=ip)
        blocked_res = placement_questions_view(blocked_req)
        self.assertEqual(blocked_res.status_code, 429)
        data = json.loads(blocked_res.content.decode("utf-8"))
        self.assertFalse(data["success"])
        self.assertIn("Rate limit exceeded", data["error"])

    @patch("apps.exams.placement_views.PlacementTestResult.objects.create")
    def test_submit_placement_test_and_b2_calibration(self, mock_create):
        """Submitting 14/20 correct answers results in B2 level, 70% accuracy and weak topics."""
        mock_rec = MagicMock()
        mock_create.return_value = mock_rec

        # Start session
        req1 = self.factory.get("/api/v1/placement-test/questions", REMOTE_ADDR="192.168.1.50")
        start_res = placement_questions_view(req1)
        session_id = json.loads(start_res.content.decode("utf-8"))["data"]["guest_session_id"]

        # Build answers: answer first 14 correctly, remaining 6 incorrectly
        answers = {}
        for idx, q in enumerate(PLACEMENT_QUESTIONS):
            if idx < 14:
                answers[q["id"]] = q["correct_option"]
            else:
                wrong_opt = "B" if q["correct_option"] != "B" else "C"
                answers[q["id"]] = wrong_opt

        submit_payload = {
            "guest_session_id": session_id,
            "answers": answers,
        }

        submit_req = self.factory.post(
            "/api/v1/placement-test/submit",
            data=json.dumps(submit_payload),
            content_type="application/json",
            REMOTE_ADDR="192.168.1.50",
        )
        res = placement_submit_view(submit_req)
        self.assertEqual(res.status_code, 200)

        data = json.loads(res.content.decode("utf-8"))
        self.assertTrue(data.get("success"))
        result = data["data"]

        self.assertEqual(result["score"], 14)
        self.assertEqual(result["total_questions"], 20)
        self.assertEqual(result["score_percent"], 70)
        self.assertEqual(result["cefr_level"], "B2")
        self.assertIn("Upper-Intermediate", result["cefr_label"])
        self.assertEqual(result["estimated_ielts_band"], "6.0 - 6.5")

        self.assertTrue(len(result["weak_topics"]) >= 1)
        self.assertTrue(result["result_token"].startswith("pt_"))
        mock_create.assert_called_once()

    @patch("apps.exams.placement_views.PlacementTestResult.objects.create")
    def test_submit_placement_different_calibrations(self, mock_create):
        """Test A2, B1, and C1 score thresholds and IELTS band mappings."""
        # 1. Test A2 (4 correct)
        answers_a2 = {q["id"]: q["correct_option"] for q in PLACEMENT_QUESTIONS[:4]}
        req_a2 = self.factory.post(
            "/api/v1/placement-test/submit",
            data=json.dumps({"guest_session_id": "sess-a2", "answers": answers_a2}),
            content_type="application/json",
        )
        res_a2 = placement_submit_view(req_a2)
        data_a2 = json.loads(res_a2.content.decode("utf-8"))["data"]
        self.assertEqual(data_a2["cefr_level"], "A2")
        self.assertEqual(data_a2["estimated_ielts_band"], "3.5 - 4.5")

        # 2. Test B1 (8 correct)
        answers_b1 = {q["id"]: q["correct_option"] for q in PLACEMENT_QUESTIONS[:8]}
        req_b1 = self.factory.post(
            "/api/v1/placement-test/submit",
            data=json.dumps({"guest_session_id": "sess-b1", "answers": answers_b1}),
            content_type="application/json",
        )
        res_b1 = placement_submit_view(req_b1)
        data_b1 = json.loads(res_b1.content.decode("utf-8"))["data"]
        self.assertEqual(data_b1["cefr_level"], "B1")
        self.assertEqual(data_b1["estimated_ielts_band"], "5.0 - 5.5")

        # 3. Test C1 (19 correct)
        answers_c1 = {q["id"]: q["correct_option"] for q in PLACEMENT_QUESTIONS[:19]}
        req_c1 = self.factory.post(
            "/api/v1/placement-test/submit",
            data=json.dumps({"guest_session_id": "sess-c1", "answers": answers_c1}),
            content_type="application/json",
        )
        res_c1 = placement_submit_view(req_c1)
        data_c1 = json.loads(res_c1.content.decode("utf-8"))["data"]
        self.assertEqual(data_c1["cefr_level"], "C1")
        self.assertEqual(data_c1["estimated_ielts_band"], "7.0 - 8.0")

    @patch("apps.exams.placement_views.transaction.atomic")
    @patch("apps.exams.placement_views._sync_profile_placement")
    @patch("apps.exams.placement_views.PlacementTestResult.objects.filter")
    @patch("apps.exams.placement_views.get_authenticated_user_from_request")
    def test_claim_placement_result_and_student_profile_migration(
        self, mock_get_user, mock_filter, mock_sync, mock_atomic
    ):
        mock_atomic.return_value.__enter__.return_value = None
        """POST /api/v1/placement-test/claim links guest result to student profile."""
        mock_get_user.return_value = self.student_user

        mock_record = MagicMock()
        mock_record.result_token = "pt_valid123"
        mock_record.cefr_level = "B2"
        mock_record.score_percent = 75
        mock_record.estimated_ielts_band = "6.0 - 6.5"
        mock_record.is_claimed = False
        mock_record.student_id = None
        mock_record.claimed_at = None

        mock_filter.return_value.first.return_value = mock_record

        claim_req = self.factory.post(
            "/api/v1/placement-test/claim",
            data=json.dumps({"result_token": "pt_valid123"}),
            content_type="application/json",
        )
        res = placement_claim_view(claim_req)
        self.assertEqual(res.status_code, 200)

        data = json.loads(res.content.decode("utf-8"))
        self.assertTrue(data["success"])
        self.assertEqual(data["data"]["initial_level"], "B2")
        self.assertEqual(data["data"]["diagnostic_cefr_score"], 75)
        self.assertTrue(mock_record.is_claimed)
        mock_record.save.assert_called_once()
        mock_sync.assert_called_once_with(self.student_user, "B2", 75)

    def test_claim_unauthenticated_fails(self):
        """Claim without authentication or valid user returns 401."""
        req = self.factory.post(
            "/api/v1/placement-test/claim",
            data=json.dumps({"result_token": "pt_fake123"}),
            content_type="application/json",
        )
        res = placement_claim_view(req)
        self.assertEqual(res.status_code, 401)
        data = json.loads(res.content.decode("utf-8"))
        self.assertFalse(data["success"])

    @patch("apps.exams.placement_views.get_authenticated_user_from_request")
    @patch("apps.exams.placement_views.PlacementTestResult.objects.filter")
    def test_claim_invalid_or_already_claimed_by_other_user(self, mock_filter, mock_get_user):
        """Claiming non-existent token returns 404, already claimed by other returns 409."""
        mock_get_user.return_value = self.student_user

        # 404 test
        mock_filter.return_value.first.return_value = None
        req_404 = self.factory.post(
            "/api/v1/placement-test/claim",
            data=json.dumps({"result_token": "pt_nonexistent"}),
            content_type="application/json",
        )
        res_404 = placement_claim_view(req_404)
        self.assertEqual(res_404.status_code, 404)

        # 409 test: record already claimed by another student
        mock_other = MagicMock()
        mock_other.is_claimed = True
        mock_other.student_id = "other-student-999"
        mock_filter.return_value.first.return_value = mock_other

        req_409 = self.factory.post(
            "/api/v1/placement-test/claim",
            data=json.dumps({"result_token": "pt_already_claimed"}),
            content_type="application/json",
        )
        res_409 = placement_claim_view(req_409)
        self.assertEqual(res_409.status_code, 409)

    @patch("apps.core.models.PlacementTestResult.objects.filter")
    def test_mistake_vault_enrichment_with_placement_results(self, mock_filter):
        """Verify MistakeVault enriches categories with placement test weak topics."""
        mock_placement = MagicMock()
        mock_placement.weak_topics = [
            {
                "topic": "Mixed Conditionals",
                "mistakes_count": 2,
                "recommendation": "12-dars: Mixed Conditionals darsini ko'rib chiqing.",
            }
        ]
        mock_filter.return_value.order_by.return_value.first.return_value = mock_placement

        vault = get_student_mistake_vault(self.student_user)
        self.assertIn("categories", vault)
        category_names = [c["name"] for c in vault["categories"]]
        self.assertIn("Mixed Conditionals", category_names)
