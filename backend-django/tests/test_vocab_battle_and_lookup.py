"""Tests for Vocab Battle (Live Kahoot mode), Click-to-Vocab Lookup, and Group Report KPIs."""
from __future__ import annotations

from unittest.mock import MagicMock, patch
from django.test import SimpleTestCase
from rest_framework.test import APIRequestFactory

from apps.core import vocabulary_service as vocab_service
from apps.core import vocab_battle
from apps.core.models import BattleStatus, VocabBattleSession, VocabularySet, VocabularyWord
from apps.core.vocabulary_views import vocabulary_group_report_view, vocabulary_lookup_view, add_user_word_view
from apps.core.vocab_battle_views import (
    battle_create_view,
    battle_join_view,
    battle_state_view,
    battle_next_view,
    battle_answer_view,
    battle_finish_view,
)


class VocabLookupTests(SimpleTestCase):
    @patch("apps.core.vocabulary_service.VocabularyWord.objects.filter")
    def test_lookup_word_common_dictionary(self, mock_filter):
        mock_filter.return_value.first.return_value = None
        res = vocab_service.lookup_word("challenge")
        self.assertEqual(res["cleanWord"], "challenge")
        self.assertEqual(res["uzbek"], "qiyinchilik, chaqiriq")
        self.assertEqual(res["partOfSpeech"], "noun")

    @patch("apps.core.vocabulary_service.VocabularyWord.objects.filter")
    def test_lookup_word_punctuation_stripping(self, mock_filter):
        mock_filter.return_value.first.return_value = None
        res = vocab_service.lookup_word("  \"environment!\"  ")
        self.assertEqual(res["cleanWord"], "environment")
        self.assertEqual(res["uzbek"], "atrof-muhit")

    @patch("apps.core.vocabulary_service.VocabularyWord.objects.filter")
    def test_lookup_word_database_priority(self, mock_filter):
        mock_word = MagicMock()
        mock_word.english = "pamper"
        mock_word.uzbek = "erkalamoq"
        mock_word.part_of_speech = "verb"
        mock_word.context_sentence = "She likes to pamper her pet."
        mock_filter.return_value.first.return_value = mock_word

        res = vocab_service.lookup_word("pamper")
        self.assertEqual(res["uzbek"], "erkalamoq")
        self.assertEqual(res["source"], "database")


class VocabBattleTests(SimpleTestCase):
    @patch("apps.core.vocab_battle.VocabBattleSession.objects.create")
    @patch("apps.core.vocab_battle.VocabBattleSession.objects.filter")
    @patch("apps.core.vocab_battle.VocabularySet.objects.prefetch_related")
    def test_create_battle_session(self, mock_prefetch, mock_session_filter, mock_session_create):
        mock_set = MagicMock()
        mock_set.id = "set-123"
        mock_set.title = "Unit 1: Nature"
        mock_set.level = "B1"

        w1 = MagicMock(english="Forest", uzbek="O'rmon")
        w2 = MagicMock(english="River", uzbek="Daryo")
        w3 = MagicMock(english="Mountain", uzbek="Tog'")
        w4 = MagicMock(english="Desert", uzbek="Cho'l")
        mock_set.words.all.return_value = [w1, w2, w3, w4]
        mock_prefetch.return_value.filter.return_value.first.return_value = mock_set

        mock_session_filter.return_value.exists.return_value = False
        mock_created = MagicMock(
            id="session-456",
            pin="123456",
            status=BattleStatus.WAITING,
        )
        mock_session_create.return_value = mock_created

        teacher = MagicMock(id="teacher-1", name="Mr. Smith")
        res = vocab_battle.create_battle_session(teacher, "set-123", question_count=4)

        self.assertEqual(res["status"], BattleStatus.WAITING)
        self.assertEqual(res["setTitle"], "Unit 1: Nature")
        self.assertEqual(res["totalQuestions"], 4)
        mock_session_create.assert_called_once()

    @patch("apps.core.vocab_battle.VocabBattleSession.objects.filter")
    def test_submit_battle_answer_correct_with_speed_bonus(self, mock_filter):
        mock_session = MagicMock()
        mock_session.status = BattleStatus.QUESTION
        mock_session.current_question_index = 0
        mock_session.questions = [{
            "questionId": "q_1",
            "english": "Desert",
            "correctIndex": 2,
            "timeLimit": 15,
        }]
        mock_session.participants = {
            "student-1": {
                "id": "student-1",
                "name": "Ali",
                "score": 0,
                "streak": 0,
                "answers": {},
            }
        }
        mock_filter.return_value.first.return_value = mock_session

        user = MagicMock(id="student-1", name="Ali")
        # Answered in 5 seconds (10 seconds remaining -> speed bonus = 100)
        ans = vocab_battle.submit_battle_answer("123456", user, question_index=0, selected_index=2, elapsed_sec=5.0)

        self.assertTrue(ans["isCorrect"])
        self.assertEqual(ans["correctIndex"], 2)
        # 100 base + 100 speed bonus + 20 streak bonus = 220
        self.assertEqual(ans["pointsGained"], 220)
        self.assertEqual(ans["totalScore"], 220)
        self.assertEqual(ans["streak"], 1)

    @patch("apps.core.vocab_battle.PointsLog.objects.create")
    @patch("apps.core.vocab_battle.StudentProfile.objects.filter")
    def test_finish_battle_and_award_points(self, mock_profile_filter, mock_log_create):
        session = MagicMock()
        session.set.title = "Unit 1"
        session.host_id = "teacher-1"
        session.participants = {
            "p1": {"id": "st-1", "name": "Ali", "score": 500, "streak": 3},
            "p2": {"id": "st-2", "name": "Vali", "score": 300, "streak": 1},
            "p3": {"id": "st-3", "name": "Sami", "score": 200, "streak": 0},
            "p4": {"id": "st-4", "name": "Gani", "score": 100, "streak": 0},
        }

        winners = vocab_battle.finish_battle_and_award_points(session)
        self.assertEqual(len(winners), 3)
        self.assertEqual(winners[0]["rank"], 1)
        self.assertEqual(winners[0]["studentId"], "st-1")
        self.assertEqual(winners[0]["pointsAwarded"], 10)

        self.assertEqual(winners[1]["rank"], 2)
        self.assertEqual(winners[1]["studentId"], "st-2")
        self.assertEqual(winners[1]["pointsAwarded"], 7)

        self.assertEqual(winners[2]["rank"], 3)
        self.assertEqual(winners[2]["studentId"], "st-3")
        self.assertEqual(winners[2]["pointsAwarded"], 5)


class GroupReportKpiTests(SimpleTestCase):
    @patch("apps.core.vocabulary_service.VocabularyAttempt.objects.filter")
    @patch("apps.core.vocabulary_service.VocabularySet.objects.select_related")
    def test_get_vocabulary_set_report_kpis_and_hardest_words(self, mock_set_rel, mock_att_filter):
        mock_set = MagicMock()
        mock_set.id = "set-abc"
        mock_set.title = "Advanced Lexis"
        mock_set.level = "C1"
        mock_set.group.name = "Morning IELTS"

        w1 = MagicMock(id="w1", english="pamper", uzbek="erkalamoq")
        mock_set.words.count.return_value = 25
        mock_set.words.filter.return_value = [w1]
        mock_set_rel.return_value.filter.return_value.first.return_value = mock_set

        att1 = MagicMock(
            id="att-1",
            student_id="st-1",
            student=MagicMock(name="Ali", phone="+998901234567"),
            score=18,
            total_words=25,
            percentage=72.0,
            points_awarded=0,
            mode="mixed",
            wrong_answers=[{"english": "pamper", "userAnswer": "urmoq"}],
        )
        att1.completed_at.isoformat.return_value = "2026-10-24T12:00:00"

        mock_att_filter.return_value.select_related.return_value.order_by.return_value = [att1]

        report = vocab_service.get_vocabulary_set_report("set-abc")
        self.assertEqual(report["totalWords"], 25)
        self.assertEqual(report["totalAttempts"], 1)
        self.assertEqual(report["averagePercentage"], 72.0)
        self.assertEqual(len(report["hardestWords"]), 1)
        self.assertEqual(report["hardestWords"][0]["english"], "pamper")
        self.assertEqual(report["hardestWords"][0]["uzbek"], "erkalamoq")
        self.assertEqual(report["hardestWords"][0]["mistakeCount"], 1)
