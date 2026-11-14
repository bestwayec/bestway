"""Targeted practice drill: answers stay on the server until a question is answered,
one drill gives points once, and a day's points are capped."""
import contextlib
from types import SimpleNamespace
from unittest.mock import patch

from django.core.cache import cache
from django.test import SimpleTestCase
from rest_framework.test import APIClient

from apps.core import study_plan_service as service
from common.api.exceptions import ContractAPIException

STUDENT = SimpleNamespace(id="stu-drill-1", name="Student", role="student", is_authenticated=True, is_active=True)
OTHER = SimpleNamespace(id="stu-drill-2", name="Other", role="student", is_authenticated=True, is_active=True)
TEACHER = SimpleNamespace(id="tea-drill-1", name="Teacher", role="teacher", is_authenticated=True, is_active=True)


class TargetedPracticeTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        self.logs = []
        self.today = 0
        patch.object(service.transaction, "atomic", return_value=contextlib.nullcontext()).start()
        profiles = patch.object(service.StudentProfile.objects, "select_for_update").start()
        profiles.return_value.filter.return_value.first.return_value = SimpleNamespace(pk="profile")
        patch.object(service.StudentProfile.objects, "filter").start().return_value.update.return_value = 1
        patch.object(service.PointsLog.objects, "create", side_effect=lambda **kw: self.logs.append(kw)).start()
        patch.object(service, "targeted_points_today", side_effect=lambda _id: self.today + sum(log["change"] for log in self.logs)).start()
        self.addCleanup(patch.stopall)
        self.addCleanup(cache.clear)

    def key(self, practice):
        """The server-side key, read from the session the way only the server can."""
        return {qid: row["correctAnswer"] for qid, row in cache.get(service._practice_key(practice["practiceId"]))["questions"].items()}

    def finish(self, user=STUDENT, category="tfng", wrong=0):
        practice = service.generate_targeted_practice(user, category)
        answers = [{"questionId": qid, "selectedAnswer": "definitely wrong" if index < wrong else correct}
                   for index, (qid, correct) in enumerate(self.key(practice).items())]
        return practice, service.submit_targeted_practice(user, practice["practiceId"], answers)

    # ── nothing is revealed before an answer ──────────────────────────────────
    def test_issued_questions_carry_no_key_and_no_explanation(self):
        for category in service.PRACTICE_QUESTION_BANKS:
            practice = service.generate_targeted_practice(STUDENT, category)
            self.assertEqual(practice["questionCount"], 10)
            for question in practice["questions"]:
                self.assertNotIn("correctAnswer", question)
                self.assertNotIn("explanation", question)
            self.assertNotIn("correctAnswer", str(practice))

    def test_lettered_options_are_shuffled_so_the_key_is_not_always_a(self):
        first = set()
        for _ in range(8):
            practice = service.generate_targeted_practice(STUDENT, "grammar_cohesion")
            first.update(correct[:2] for correct in self.key(practice).values())
            for question in practice["questions"]:
                self.assertEqual([option[:3] for option in question["options"]], ["A) ", "B) ", "C) ", "D) "])
        self.assertGreater(len(first), 1)

    def test_fixed_option_sets_keep_their_order(self):
        practice = service.generate_targeted_practice(STUDENT, "tfng")
        self.assertEqual(practice["questions"][0]["options"], ["TRUE", "FALSE", "NOT GIVEN"])

    def test_checking_an_answer_reveals_that_question_only_and_the_first_answer_stands(self):
        practice = service.generate_targeted_practice(STUDENT, "headings")
        qid, correct = next(iter(self.key(practice).items()))
        wrong = service.answer_targeted_practice(STUDENT, practice["practiceId"], qid, "nothing like it")
        self.assertEqual((wrong["isCorrect"], wrong["correctAnswer"]), (False, correct))
        self.assertTrue(wrong["explanation"])
        again = service.answer_targeted_practice(STUDENT, practice["practiceId"], qid, correct)
        self.assertIs(again["isCorrect"], False)           # no second try after seeing the key
        result = service.submit_targeted_practice(STUDENT, practice["practiceId"], [{"questionId": qid, "selectedAnswer": correct}])
        self.assertEqual(result["correctCount"], 0)

    def test_a_letter_alone_is_not_accepted_as_the_answer(self):
        practice = service.generate_targeted_practice(STUDENT, "grammar_cohesion")
        qid, correct = next(iter(self.key(practice).items()))
        self.assertIs(service.answer_targeted_practice(STUDENT, practice["practiceId"], qid, correct[:2])["isCorrect"], False)

    def test_another_user_or_an_unknown_question_cannot_use_the_session(self):
        practice = service.generate_targeted_practice(STUDENT, "tfng")
        for call in (lambda: service.answer_targeted_practice(OTHER, practice["practiceId"], "tfng-q1", "TRUE"),
                     lambda: service.submit_targeted_practice(OTHER, practice["practiceId"], []),
                     lambda: service.submit_targeted_practice(STUDENT, "no-such-session", []),
                     lambda: service.submit_targeted_practice(STUDENT, None, [])):
            with self.assertRaises(ContractAPIException) as error:
                call()
            self.assertEqual(error.exception.contract_code, "PRACTICE_SESSION_INVALID")
        with self.assertRaises(ContractAPIException) as error:
            service.answer_targeted_practice(STUDENT, practice["practiceId"], "foreign-question", "TRUE")
        self.assertEqual(error.exception.contract_code, "PRACTICE_QUESTION_INVALID")
        self.assertEqual(self.logs, [])

    # ── one drill, one award ──────────────────────────────────────────────────
    def test_a_finished_drill_gives_its_points_once(self):
        practice, result = self.finish()
        self.assertEqual((result["correctCount"], result["totalQuestions"], result["accuracyPercent"]), (10, 10, 100))
        self.assertEqual((result["pointsAwarded"], result["replayed"]), (50, False))
        self.assertEqual([log["change"] for log in self.logs], [50])
        for _ in range(3):
            repeat = service.submit_targeted_practice(STUDENT, practice["practiceId"], [])
            self.assertEqual((repeat["pointsAwarded"], repeat["replayed"], repeat["correctCount"]), (50, True, 10))
        self.assertEqual(len(self.logs), 1)

    def test_the_score_is_the_servers_own_and_wrong_answers_still_finish_the_drill(self):
        _practice, result = self.finish(wrong=4)
        self.assertEqual((result["correctCount"], result["accuracyPercent"], result["pointsAwarded"]), (6, 60, 50))
        self.assertEqual([row["isCorrect"] for row in result["results"]].count(False), 4)

    def test_an_unfinished_or_empty_drill_gives_nothing(self):
        practice = service.generate_targeted_practice(STUDENT, "tfng")
        qid, correct = next(iter(self.key(practice).items()))
        result = service.submit_targeted_practice(STUDENT, practice["practiceId"], [{"questionId": qid, "selectedAnswer": correct}])
        self.assertEqual((result["answeredCount"], result["pointsAwarded"]), (1, 0))
        empty = service.generate_targeted_practice(STUDENT, "tfng")
        self.assertEqual(service.submit_targeted_practice(STUDENT, empty["practiceId"], [])["pointsAwarded"], 0)
        self.assertEqual(self.logs, [])

    def test_answers_for_questions_outside_the_drill_are_ignored(self):
        practice = service.generate_targeted_practice(STUDENT, "tfng")
        result = service.submit_targeted_practice(STUDENT, practice["practiceId"],
                                                  [{"questionId": f"made-up-{n}", "selectedAnswer": "TRUE"} for n in range(10)])
        self.assertEqual((result["answeredCount"], result["correctCount"], result["pointsAwarded"]), (0, 0, 0))

    def test_staff_get_a_result_but_no_points(self):
        _practice, result = self.finish(user=TEACHER)
        self.assertEqual((result["correctCount"], result["pointsAwarded"]), (10, 0))
        self.assertEqual(self.logs, [])

    # ── daily cap ─────────────────────────────────────────────────────────────
    def test_the_daily_cap_limits_the_days_points(self):
        self.assertEqual((service.TARGETED_PRACTICE_POINTS, service.TARGETED_PRACTICE_DAILY_POINTS_CAP), (50, 300))
        awards = [self.finish()[1] for _ in range(8)]
        self.assertEqual([row["pointsAwarded"] for row in awards], [50] * 6 + [0, 0])
        self.assertEqual([row["dailyCapReached"] for row in awards], [False] * 6 + [True, True])
        self.assertEqual(sum(log["change"] for log in self.logs), 300)

    def test_a_partly_used_day_gives_only_what_is_left(self):
        self.today = 280
        _practice, result = self.finish()
        self.assertEqual((result["pointsAwarded"], result["dailyCapReached"], result["dailyCap"]), (20, True, 300))
        self.assertEqual([log["change"] for log in self.logs], [20])


class TargetedPracticeApiTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.client.force_authenticate(TEACHER)      # staff: no points, so no database is needed
        self.addCleanup(cache.clear)

    def test_the_http_flow_reveals_a_key_only_after_the_answer(self):
        started = self.client.get("/api/v1/study-plan/targeted-practice?category=headings")
        self.assertEqual(started.status_code, 200)
        self.assertNotIn("correctAnswer", started.content.decode())
        self.assertNotIn("explanation", started.content.decode())
        data = started.json()["data"]
        question = data["questions"][0]
        checked = self.client.post("/api/v1/study-plan/targeted-practice/answer",
                                   {"practiceId": data["practiceId"], "questionId": question["id"], "selectedAnswer": question["options"][0]}, format="json")
        self.assertEqual(checked.status_code, 200)
        self.assertIn(checked.json()["data"]["correctAnswer"], question["options"])
        done = self.client.post("/api/v1/study-plan/targeted-practice/submit", {"practiceId": data["practiceId"]}, format="json")
        self.assertEqual((done.status_code, done.json()["data"]["answeredCount"], done.json()["data"]["pointsAwarded"]), (200, 1, 0))
        self.assertIs(self.client.post("/api/v1/study-plan/targeted-practice/submit", {"practiceId": data["practiceId"]}, format="json").json()["data"]["replayed"], True)

    def test_a_submit_without_a_session_is_rejected_and_the_old_post_shape_starts_a_drill(self):
        rejected = self.client.post("/api/v1/study-plan/targeted-practice/submit",
                                    {"categoryId": "tfng", "answers": [{"questionId": "tfng-q1", "selectedAnswer": "TRUE"}]}, format="json")
        self.assertEqual((rejected.status_code, rejected.json()["error"]["code"]), (400, "PRACTICE_SESSION_INVALID"))
        started = self.client.post("/api/v1/study-plan/targeted-practice", {"categoryId": "tfng"}, format="json")
        self.assertEqual(started.status_code, 200)
        self.assertNotIn("correctAnswer", started.content.decode())
