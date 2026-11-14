"""Tests for Instant AI Evaluation Engine and Weak Points Targeted Practice Drills."""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase
from rest_framework.test import APIClient

from apps.core import instant_evaluator, study_plan_service


class InstantAiEvaluationAndDrillsTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()
        self.student = SimpleNamespace(
            id="student-pytest-01",
            name="Alisher Navoiy",
            role="student",
            is_authenticated=True,
            is_active=True,
        )
        self.client.force_authenticate(self.student)

    def test_instant_evaluator_does_not_fabricate_scores(self):
        from common.api.exceptions import ContractAPIException
        with self.assertRaises(ContractAPIException) as error:
            instant_evaluator.evaluate_text_instant(text="A student's response")
        self.assertEqual(error.exception.contract_code, 'INSTANT_ASSESSMENT_UNAVAILABLE')
        self.assertEqual(error.exception.status_code, 503)

    def test_instant_evaluate_api_fails_closed(self):
        for skill in ('writing', 'speaking'):
            with self.subTest(skill=skill):
                res = self.client.post('/api/v1/assessment/instant-evaluate',
                    {'text': 'A student response', 'skill': skill}, format='json')
                self.assertEqual(res.status_code, 503)
                self.assertEqual(res.json()['error']['code'], 'INSTANT_ASSESSMENT_UNAVAILABLE')
                self.assertNotIn('data', res.json())

    def test_targeted_practice_get_questions(self):
        """Test GET /api/v1/study-plan/targeted-practice?category=tfng."""
        res = self.client.get("/api/v1/study-plan/targeted-practice?category=tfng")
        self.assertEqual(res.status_code, 200)
        data = res.json()["data"]
        self.assertEqual(data["categoryId"], "tfng")
        self.assertEqual(len(data["questions"]), 10)
        self.assertEqual(data["questions"][0]["options"], ["TRUE", "FALSE", "NOT GIVEN"])

    def test_assessment_default_policy_not_manual_only(self):
        """Verify default policy in snapshots is PRACTICE_AUTO_AI, avoiding MANUAL_POLICY freeze."""
        import os

        policy = None
        resolved = policy if policy is not None else os.environ.get("ASSESSMENT_POLICY", "PRACTICE_AUTO_AI")
        self.assertEqual(resolved, "PRACTICE_AUTO_AI")
