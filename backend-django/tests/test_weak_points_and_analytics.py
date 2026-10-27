"""Tests for Weak Points Diagnosis and Smart Video Lesson Recommendations."""
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase
from django.test.client import Client

from apps.exams.analytics_service import (
    analyze_attempt_weak_points_and_recommendations,
    find_matching_lesson_for_topic,
)


class WeakPointsAnalyticsTests(SimpleTestCase):
    def setUp(self):
        self.client = Client()

    def test_find_matching_lesson_for_grammar_topics(self):
        """Test keyword-to-lesson matching across core grammar topics."""
        # 1. Past Perfect
        res_past_perf = find_matching_lesson_for_topic("Frequent confusion with Past Perfect tense")
        self.assertIsNotNone(res_past_perf)
        self.assertEqual(res_past_perf["order_index"], 19)
        self.assertIn("Past Perfect", res_past_perf["lesson_title"])
        self.assertIn("19-dars", res_past_perf["button_text"])
        self.assertIn("/en/videos?lesson=", res_past_perf["url"])

        # 2. Passive Voice
        res_passive = find_matching_lesson_for_topic("Incorrect passive voice formation")
        self.assertIsNotNone(res_passive)
        self.assertEqual(res_passive["order_index"], 16)
        self.assertIn("Passive Voice", res_passive["lesson_title"])

        # 3. Conditionals
        res_cond = find_matching_lesson_for_topic("Error in 2nd conditional if clause")
        self.assertIsNotNone(res_cond)
        self.assertEqual(res_cond["order_index"], 12)
        self.assertIn("Conditionals", res_cond["lesson_title"])

        # 4. Prepositions
        res_prep = find_matching_lesson_for_topic("Prepositions of place (in, on, at) errors")
        self.assertIsNotNone(res_prep)
        self.assertEqual(res_prep["order_index"], 28)
        self.assertIn("Prepositions", res_prep["lesson_title"])

        # 5. Articles
        res_art = find_matching_lesson_for_topic("Missing definite article 'the' before singular noun")
        self.assertIsNotNone(res_art)
        self.assertEqual(res_art["order_index"], 6)
        self.assertIn("Articles", res_art["lesson_title"])

    @patch("apps.legacy_schema.models.MockAttempt.objects.filter")
    def test_analyze_attempt_weak_points_with_diagnostic_feedback(self, mock_attempt_filter):
        """Test analyzing mock attempt with diagnostic feedback and mistakes."""
        mock_attempt = MagicMock()
        mock_attempt.id = "mock-attempt-101"
        mock_attempt.diagnostic_feedback = {
            "writing": {
                "weaknesses": [
                    "Grammar accuracy: struggles with Past Perfect in narrative tasks.",
                    "Needs work on Passive Voice in Task 1 process reports.",
                ],
                "mistakes_and_fixes": [
                    {
                        "original": "he had went",
                        "corrected": "he had gone",
                        "explanation": "Past Perfect requires third form (V3) of irregular verb.",
                    }
                ],
                "action_plan": [
                    "Review Conditionals and hypothetical structures.",
                ],
            }
        }
        mock_attempt_filter.return_value.first.return_value = mock_attempt

        data = analyze_attempt_weak_points_and_recommendations("mock-attempt-101")
        self.assertEqual(data["attempt_id"], "mock-attempt-101")
        self.assertGreaterEqual(data["total_recommendations"], 2)

        lesson_orders = [r["order_index"] for r in data["recommendations"]]
        # Past Perfect is order 19, Passive Voice is order 16, Conditionals is order 12
        self.assertIn(19, lesson_orders)
        self.assertIn(16, lesson_orders)
        self.assertIn(12, lesson_orders)

    def test_attempt_recommendations_endpoint_returns_json(self):
        """GET /v1/mock/attempts/<id>/recommendations returns 200 OK with recommendation items."""
        resp = self.client.get("/v1/mock/attempts/test-attempt-abc/recommendations")
        self.assertEqual(resp.status_code, 200)
        json_data = resp.json()
        self.assertTrue(json_data["success"])
        self.assertIn("recommendations", json_data["data"])
        self.assertGreaterEqual(len(json_data["data"]["recommendations"]), 1)

    def test_weak_points_recommendations_endpoint_topic_filter(self):
        """GET /v1/analytics/weak-points/recommendations?topic=Past+Perfect returns specific lesson."""
        resp = self.client.get("/v1/analytics/weak-points/recommendations?topic=Past+Perfect")
        self.assertEqual(resp.status_code, 200)
        json_data = resp.json()
        self.assertTrue(json_data["success"])
        recs = json_data["data"]["recommendations"]
        self.assertEqual(len(recs), 1)
        self.assertEqual(recs[0]["order_index"], 19)
        self.assertIn("19-dars", recs[0]["button_text"])
