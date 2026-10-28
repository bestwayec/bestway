from types import SimpleNamespace
from unittest.mock import Mock, patch
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.runner_game_service import (
    RUNNER_QUESTION_BANK,
    get_runner_leaderboard,
    get_runner_questions,
    submit_runner_score,
)
from common.api.exceptions import ContractAPIException


class TestRunnerGameService(TestCase):
    def test_get_runner_questions_returns_requested_count(self):
        questions = get_runner_questions(limit=40)
        self.assertGreaterEqual(len(questions), 40)
        for q in questions:
            self.assertIn("id", q)
            self.assertIn("prompt", q)
            self.assertIn("correct", q)
            self.assertEqual(len(q["options"]), 3)
            self.assertIn(q["correct"], q["options"])

    def test_get_runner_questions_category_filter(self):
        questions = get_runner_questions(limit=10, category="Irregular Verbs")
        self.assertTrue(len(questions) > 0)
        for q in questions:
            self.assertEqual(q["category"], "Irregular Verbs")

    def test_anti_cheat_rejects_physically_impossible_speed(self):
        # 10,000 meters in 10 seconds = 1,000 m/s (cheating)
        with self.assertRaises(ContractAPIException) as ctx:
            submit_runner_score(None, {
                "score": 5000,
                "distance_meters": 10000,
                "duration_seconds": 10,
                "correct_count": 50,
            })
        self.assertEqual(ctx.exception.contract_code, "CHEATING_DETECTED")

    def test_anti_cheat_rejects_absurd_score_mismatch(self):
        # 0 correct answers, 50m distance, but 100,000 score
        with self.assertRaises(ContractAPIException) as ctx:
            submit_runner_score(None, {
                "score": 100000,
                "distance_meters": 50,
                "duration_seconds": 20,
                "correct_count": 0,
            })
        self.assertEqual(ctx.exception.contract_code, "CHEATING_DETECTED")

    def test_submit_runner_score_unauthenticated(self):
        res = submit_runner_score(None, {
            "score": 850,
            "distance_meters": 450,
            "duration_seconds": 60,
            "correct_count": 8,
        })
        self.assertEqual(res["score"], 850)
        self.assertGreater(res["xp_earned"], 0)
        self.assertFalse(res["saved"])

    def test_get_runner_leaderboard(self):
        leaderboard = get_runner_leaderboard(limit=5)
        self.assertIsInstance(leaderboard, list)
        self.assertTrue(len(leaderboard) > 0)
        self.assertIn("rank", leaderboard[0])
        self.assertIn("name", leaderboard[0])


class TestRunnerGameEndpoints(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_questions_endpoint(self):
        response = self.client.get("/v1/games/runner/questions?limit=25")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["success"])
        self.assertGreaterEqual(len(response.data["data"]), 25)

    def test_submit_score_endpoint_guest(self):
        response = self.client.post("/v1/games/runner/submit-score", {
            "score": 620,
            "distance_meters": 350,
            "duration_seconds": 50,
            "correct_count": 6,
        }, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["success"])
        self.assertEqual(response.data["data"]["score"], 620)
        self.assertGreater(response.data["data"]["xp_earned"], 0)

    def test_leaderboard_endpoint(self):
        response = self.client.get("/v1/games/runner/leaderboard")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["success"])
        self.assertIsInstance(response.data["data"], list)
