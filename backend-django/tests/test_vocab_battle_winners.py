"""Vocab Battle podium: recorded once, reported in the FINISHED state, never given twice,
and never to a player with no game score."""
from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from apps.core import vocab_battle
from apps.core.models import BattleStatus, VocabBattleSession, VocabularySet

HOST = SimpleNamespace(id="teacher-1", role="teacher", name="Ustoz", is_authenticated=True)


def player(pid, score, streak=0, name=None):
    return {"id": pid, "name": name or pid, "score": score, "streak": streak, "answers": {}}


class BattleWinnersTests(TestCase):
    def setUp(self):
        self.set = VocabularySet.objects.create(title="Unit 1", level="B1", created_by_id=HOST.id)
        self.students = {"st-1", "st-2", "st-3", "st-4", "st-0"}
        self.logs = []
        self.updated = []
        users = patch.object(vocab_battle.User.objects, "filter").start()
        users.side_effect = lambda **kw: SimpleNamespace(exists=lambda: kw.get("id") in self.students and kw.get("role") == "student")
        profiles = patch.object(vocab_battle.StudentProfile.objects, "filter").start()
        profiles.side_effect = lambda **kw: SimpleNamespace(update=lambda **change: self.updated.append(kw["user_id"]) or 1)
        patch.object(vocab_battle.PointsLog.objects, "create", side_effect=lambda **kw: self.logs.append(kw)).start()
        self.addCleanup(patch.stopall)

    def battle(self, participants, status=BattleStatus.LEADERBOARD, pin="123456", questions=1):
        return VocabBattleSession.objects.create(
            pin=pin, set=self.set, host_id=HOST.id, status=status, current_question_index=questions - 1,
            questions=[{"questionId": f"q_{n + 1}", "english": "w", "prompt": "p", "options": ["a", "b"], "correctIndex": 0, "timeLimit": 15}
                       for n in range(questions)],
            participants={p["id"]: p for p in participants})

    def state(self, pin="123456", user=HOST):
        # The host is a legacy-schema user; the state only needs the session and its set.
        session = VocabBattleSession.objects.select_related("set").get(pin=pin)
        session.host = vocab_battle.User(id=HOST.id, name="Ustoz")
        with patch.object(vocab_battle.VocabBattleSession.objects, "select_related") as related:
            related.return_value.filter.return_value.first.return_value = session
            return vocab_battle.get_battle_state(pin, current_user=user)

    def test_top_three_scorers_are_recorded_and_awarded_once(self):
        session = self.battle([player("st-1", 500, 3, "Ali"), player("st-2", 300, 1, "Vali"), player("st-3", 200), player("st-4", 100)])
        winners = vocab_battle.finish_battle_and_award_points(session)
        self.assertEqual([(w["rank"], w["studentId"], w["score"], w["pointsAwarded"]) for w in winners],
                         [(1, "st-1", 500, 10), (2, "st-2", 300, 7), (3, "st-3", 200, 5)])
        self.assertEqual([log["change"] for log in self.logs], [10, 7, 5])
        self.assertEqual([log["student_id"] for log in self.logs], ["st-1", "st-2", "st-3"])
        session.refresh_from_db()
        self.assertEqual((session.status, session.winners), (BattleStatus.FINISHED, winners))

    def test_a_repeated_finish_returns_the_same_podium_and_gives_nothing_again(self):
        session = self.battle([player("st-1", 500), player("st-2", 300)])
        first = vocab_battle.finish_battle_and_award_points(session)
        second = vocab_battle.finish_battle_and_award_points(session)
        third = vocab_battle.finish_battle_and_award_points(VocabBattleSession.objects.get(pk=session.pk))
        self.assertEqual(first, second)
        self.assertEqual(first, third)
        self.assertEqual(len(self.logs), 2)
        self.assertEqual(self.updated, ["st-1", "st-2"])

    def test_a_player_with_no_game_score_takes_no_place(self):
        session = self.battle([player("st-1", 220), player("st-0", 0), player("st-2", 0)])
        winners = vocab_battle.finish_battle_and_award_points(session)
        self.assertEqual([w["studentId"] for w in winners], ["st-1"])
        self.assertEqual(len(self.logs), 1)

    def test_a_battle_where_nobody_scored_has_an_empty_podium(self):
        session = self.battle([player("st-1", 0), player("st-2", 0)])
        self.assertEqual(vocab_battle.finish_battle_and_award_points(session), [])
        self.assertEqual((self.logs, self.updated), ([], []))
        session.refresh_from_db()
        self.assertEqual((session.status, session.winners), (BattleStatus.FINISHED, []))

    def test_a_staff_player_keeps_the_place_but_gets_no_platform_points(self):
        session = self.battle([player("teacher-9", 900), player("st-1", 500)])
        winners = vocab_battle.finish_battle_and_award_points(session)
        self.assertEqual([(w["studentId"], w["pointsAwarded"]) for w in winners], [("teacher-9", 0), ("st-1", 7)])
        self.assertEqual([log["student_id"] for log in self.logs], ["st-1"])

    def test_the_last_next_step_finishes_and_a_later_finish_does_not_award_again(self):
        self.battle([player("st-1", 500), player("st-2", 300)])
        with patch.object(vocab_battle, "get_battle_state", return_value={}):
            vocab_battle.next_battle_step("123456", HOST)
            vocab_battle.next_battle_step("123456", HOST)          # already finished: no-op
        session = VocabBattleSession.objects.get(pin="123456")
        self.assertEqual(session.status, BattleStatus.FINISHED)
        self.assertEqual(len(self.logs), 2)
        again = vocab_battle.finish_battle_and_award_points(session)
        self.assertEqual([w["pointsAwarded"] for w in again], [10, 7])
        self.assertEqual(len(self.logs), 2)

    def test_a_battle_finished_by_an_older_build_is_not_awarded_again(self):
        session = self.battle([player("st-1", 500)], status=BattleStatus.FINISHED)
        self.assertIsNone(session.winners)
        self.assertEqual(vocab_battle.finish_battle_and_award_points(session), [])
        self.assertEqual(self.logs, [])

    def test_the_state_reports_winners_only_after_the_battle_is_finished(self):
        session = self.battle([player("st-1", 500), player("st-0", 0)])
        self.assertEqual(self.state()["winners"], [])
        vocab_battle.finish_battle_and_award_points(session)
        state = self.state()
        self.assertEqual(state["status"], BattleStatus.FINISHED)
        self.assertEqual(state["winners"], [{"rank": 1, "studentId": "st-1", "name": "st-1", "score": 500, "pointsAwarded": 10}])

    def test_only_the_host_may_finish(self):
        self.battle([player("st-1", 500)])
        client = APIClient()
        client.force_authenticate(SimpleNamespace(id="teacher-2", role="teacher", is_authenticated=True))
        self.assertEqual(client.post("/v1/vocabulary/battle/123456/finish").status_code, 403)
        self.assertEqual(self.logs, [])
        client.force_authenticate(HOST)
        response = client.post("/v1/vocabulary/battle/123456/finish")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["data"]["winners"][0]["pointsAwarded"], 10)
        repeat = client.post("/v1/vocabulary/battle/123456/finish")
        self.assertEqual(repeat.data["data"]["winners"], response.data["data"]["winners"])
        self.assertEqual(len(self.logs), 1)
