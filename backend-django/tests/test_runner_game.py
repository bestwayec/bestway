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


class RunnerServerAuthoritativeScoringTests(TestCase):
    """Points come only from the server session: issued questions, choice order, server clock."""

    def setUp(self):
        from django.core.cache import cache
        cache.clear()
        from apps.core import runner_game_service as service
        self.service = service
        self.user = SimpleNamespace(id="stu-1", role="student", name="Ali", is_authenticated=True)
        self.questions = [{"id": f"q{i}", "correct": f"right{i}"} for i in range(1, 11)]
        self.sid = service.start_runner_session(self.user, self.questions)
        self.log = patch.object(service.PointsLog.objects, "create").start()
        profiles = patch.object(service.StudentProfile, "objects").start()
        profiles.select_for_update.return_value.filter.return_value.first.return_value = SimpleNamespace(pk="stu-1")
        profiles.filter.return_value.values_list.return_value.first.return_value = 400
        self.today = patch.object(service, "points_today", return_value=0).start()
        self.addCleanup(patch.stopall)

    def age_session(self, seconds):
        from django.core.cache import cache
        key = self.service._session_key(self.sid)
        session = cache.get(key)
        session["startedAt"] -= seconds
        cache.set(key, session)

    def answers(self, n_correct, wrong=()):
        out = [{"questionId": f"q{i}", "chosen": f"right{i}"} for i in range(1, n_correct + 1)]
        out += [{"questionId": q, "chosen": "nope"} for q in wrong]
        return out

    def test_score_and_correct_count_come_from_the_server_not_the_client(self):
        self.age_session(60)
        res = self.service.submit_runner_score(self.user, {
            "sessionId": self.sid, "answers": self.answers(3),
            "score": 999999, "correct_count": 500, "distance_meters": 10 ** 9})
        self.assertEqual((res["score"], res["correct_count"]), (100 + 200 + 300, 3))
        self.assertLessEqual(res["distance_meters"], 61 * self.service.RUNNER_MAX_SPEED_MPS)
        self.assertEqual(res["xp_earned"], 600 // 15 + 3 * 5)

    def test_unknown_and_repeated_questions_are_ignored_and_game_ends_at_third_mistake(self):
        score, correct, mistakes = self.service.replay_score(
            {"q1": "a", "q2": "b", "q3": "c", "q4": "d", "q5": "e"},
            [{"questionId": "q1", "chosen": "a"}, {"questionId": "q1", "chosen": "a"},
             {"questionId": "zz", "chosen": "x"}, {"questionId": "q2", "chosen": "x"},
             {"questionId": "q3", "chosen": "x"}, {"questionId": "q4", "chosen": "x"},
             {"questionId": "q5", "chosen": "e"}])
        self.assertEqual((score, correct, len(mistakes)), (100, 1, 3))

    def test_retried_post_returns_the_same_result_and_awards_once(self):
        self.age_session(60)
        payload = {"sessionId": self.sid, "answers": self.answers(5)}
        first = self.service.submit_runner_score(self.user, payload)
        second = self.service.submit_runner_score(self.user, payload)
        self.assertEqual(self.log.call_count, 1)
        self.assertEqual(second["xp_earned"], first["xp_earned"])
        self.assertTrue(second["replayed"])

    def test_daily_cap_of_300_limits_the_award(self):
        self.age_session(60)
        self.today.return_value = 290
        res = self.service.submit_runner_score(self.user, {"sessionId": self.sid, "answers": self.answers(5)})
        self.assertEqual(res["xp_earned"], 10)
        self.assertTrue(res["daily_cap_reached"])
        self.assertEqual(self.log.call_args.kwargs["change"], 10)

    def test_answers_faster_than_the_game_allows_are_rejected(self):
        with self.assertRaises(ContractAPIException) as ctx:
            self.service.submit_runner_score(self.user, {"sessionId": self.sid, "answers": self.answers(10)})
        self.assertEqual(ctx.exception.contract_code, "CHEATING_DETECTED")
        self.log.assert_not_called()

    def test_missing_or_foreign_session_awards_nothing(self):
        with self.assertRaises(ContractAPIException) as ctx:
            self.service.submit_runner_score(self.user, {"score": 5000, "correct_count": 40})
        self.assertEqual(ctx.exception.contract_code, "RUNNER_SESSION_REQUIRED")
        other = SimpleNamespace(id="stu-2", role="student", name="B", is_authenticated=True)
        with self.assertRaises(ContractAPIException) as ctx:
            self.service.submit_runner_score(other, {"sessionId": self.sid, "answers": self.answers(1)})
        self.assertEqual(ctx.exception.contract_code, "RUNNER_SESSION_INVALID")
        self.log.assert_not_called()

    def test_staff_get_no_points(self):
        self.age_session(60)
        teacher = SimpleNamespace(id="stu-1", role="teacher", name="T", is_authenticated=True)
        res = self.service.submit_runner_score(teacher, {"sessionId": self.sid, "answers": self.answers(3)})
        self.assertEqual((res["xp_earned"], res["saved"]), (0, False))
        self.log.assert_not_called()

    def test_questions_endpoint_issues_a_session_only_for_signed_in_players(self):
        client = APIClient()
        anon = client.get("/v1/games/runner/questions?limit=5&session=1").data["data"]
        self.assertIsNone(anon["sessionId"])
        client.force_authenticate(self.user)
        data = client.get("/v1/games/runner/questions?limit=5&session=1").data["data"]
        self.assertTrue(data["sessionId"])
        self.assertEqual(len(data["questions"]), 5)
        self.assertEqual(client.get("/v1/games/runner/questions?limit=abc").status_code, 200)
