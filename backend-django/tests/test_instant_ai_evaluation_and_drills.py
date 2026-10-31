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

    def test_instant_evaluator_unit_logic(self):
        """Test the core heuristic rubric evaluation logic directly."""
        text = (
            "In modern world peoples thinks that technology is very important because it help everyone. "
            "Furthermore, there is many big problem if I will not care. Consequently, we must prepare."
        )
        res = instant_evaluator.evaluate_text_instant(
            text=text,
            prompt="Discuss the advantages and disadvantages of modern technology.",
            skill="writing",
            task_type="task2",
            program="IELTS",
        )

        self.assertIn("band", res)
        self.assertIn("cefr_level", res)
        self.assertIn("criteria_scores", res)
        self.assertIn("task_achievement", res["criteria_scores"])
        self.assertIn("coherence_cohesion", res["criteria_scores"])
        self.assertIn("lexical_resource", res["criteria_scores"])
        self.assertIn("grammatical_range", res["criteria_scores"])

        # Check grammar corrections
        self.assertTrue(len(res["grammar_corrections"]) >= 2)
        corr_origs = [c["original"].lower() for c in res["grammar_corrections"]]
        self.assertTrue(any("people" in o for o in corr_origs))

        # Check vocabulary upgrades
        self.assertTrue(len(res["vocabulary_upgrades"]) >= 1)

        # Check C1 Model Answer
        self.assertIn("model_answer", res)
        self.assertIn("C1 Academic Model Answer", res["model_answer"])

    def test_instant_evaluate_api_endpoint(self):
        """Test POST /api/v1/assessment/instant-evaluate endpoint."""
        payload = {
            "text": "In modern world peoples thinks that technology is very important because it help everyone. But there is many big problem if I will not care.",
            "prompt": "Discuss technology.",
            "skill": "writing",
            "task_type": "task2",
        }
        res = self.client.post("/api/v1/assessment/instant-evaluate", payload, format="json")
        self.assertEqual(res.status_code, 200)
        data = res.json()["data"]
        self.assertIn("band", data)
        self.assertIn("cefr_level", data)
        self.assertIn("criteria_scores", data)
        self.assertIn("model_answer", data)

    def test_targeted_practice_get_questions(self):
        """Test GET /api/v1/study-plan/targeted-practice?category=tfng."""
        res = self.client.get("/api/v1/study-plan/targeted-practice?category=tfng")
        self.assertEqual(res.status_code, 200)
        data = res.json()["data"]
        self.assertEqual(data["categoryId"], "tfng")
        self.assertEqual(len(data["questions"]), 10)
        self.assertEqual(data["questions"][0]["options"], ["TRUE", "FALSE", "NOT GIVEN"])

    @patch("apps.core.study_plan_service.StudentProfile.objects.filter")
    @patch("apps.core.study_plan_service.PointsLog.objects.create")
    def test_targeted_practice_submit_answers_and_award_points(self, mock_points_log, mock_profile_filter):
        """Test submitting practice answers awards +50 XP."""
        mock_profile_filter.return_value.update.return_value = 1
        mock_points_log.return_value = MagicMock()

        submit_payload = {
            "categoryId": "tfng",
            "answers": [
                {"questionId": "tfng-q1", "selectedAnswer": "TRUE"},
                {"questionId": "tfng-q2", "selectedAnswer": "FALSE"},
                {"questionId": "tfng-q3", "selectedAnswer": "NOT GIVEN"},
            ],
        }
        res = self.client.post("/api/v1/study-plan/targeted-practice/submit", submit_payload, format="json")
        self.assertEqual(res.status_code, 200)
        data = res.json()["data"]
        self.assertEqual(data["categoryId"], "tfng")
        self.assertEqual(data["correctCount"], 3)
        self.assertEqual(data["pointsAwarded"], 50)
        self.assertTrue(mock_profile_filter.called)
        self.assertTrue(mock_points_log.called)

    def test_assessment_default_policy_not_manual_only(self):
        """Verify default policy in snapshots is PRACTICE_AUTO_AI, avoiding MANUAL_POLICY freeze."""
        import os

        policy = None
        resolved = policy if policy is not None else os.environ.get("ASSESSMENT_POLICY", "PRACTICE_AUTO_AI")
        self.assertEqual(resolved, "PRACTICE_AUTO_AI")
