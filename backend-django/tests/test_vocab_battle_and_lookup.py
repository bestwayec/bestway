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

    def _session(self, **question):
        mock_session = MagicMock()
        mock_session.status = BattleStatus.QUESTION
        mock_session.current_question_index = 0
        mock_session.questions = [dict({
            "questionId": "q_1", "english": "Desert", "correctIndex": 2, "timeLimit": 15,
            "options": ["a", "b", "c", "d"],
        }, **question)]
        mock_session.participants = {
            "student-1": {"id": "student-1", "name": "Ali", "score": 0, "streak": 0, "answers": {}}
        }
        return mock_session

    def _submit(self, session, **kwargs):
        from contextlib import nullcontext
        with patch("apps.core.vocab_battle.transaction.atomic", return_value=nullcontext()), \
             patch("apps.core.vocab_battle.VocabBattleSession.objects.select_for_update") as sfu:
            sfu.return_value.filter.return_value.first.return_value = session
            return vocab_battle.submit_battle_answer("123456", MagicMock(id="student-1", name="Ali"), **kwargs)

    def test_submit_battle_answer_correct_with_speed_bonus(self):
        from datetime import timedelta
        from django.utils import timezone
        started = (timezone.now() - timedelta(seconds=5)).isoformat()
        # The server clock says ~5 s (10 s left -> speed bonus ~100); the client's 0 s is ignored.
        ans = self._submit(self._session(startedAt=started), question_index=0, selected_index=2, elapsed_sec=0.0)
        self.assertTrue(ans["isCorrect"])
        self.assertEqual(ans["correctIndex"], 2)
        # 100 base + ~100 speed bonus + 20 streak bonus
        self.assertTrue(205 <= ans["pointsGained"] <= 220, ans["pointsGained"])
        self.assertEqual(ans["totalScore"], ans["pointsGained"])
        self.assertEqual(ans["streak"], 1)

    def test_client_elapsed_cannot_inflate_points(self):
        # An older question without a server start time: the client figure is clamped.
        ans = self._submit(self._session(), question_index=0, selected_index=2, elapsed_sec=-1e6)
        self.assertEqual(ans["pointsGained"], 100 + 150 + 20)  # never more than the full time bonus
        ans = self._submit(self._session(), question_index=0, selected_index=2, elapsed_sec=float("nan"))
        self.assertEqual(ans["pointsGained"], 100 + 0 + 20)

    def test_late_answer_scores_nothing(self):
        from datetime import timedelta
        from django.utils import timezone
        started = (timezone.now() - timedelta(seconds=40)).isoformat()
        ans = self._submit(self._session(startedAt=started), question_index=0, selected_index=2)
        self.assertFalse(ans["isCorrect"])
        self.assertTrue(ans["late"])
        self.assertEqual(ans["pointsGained"], 0)

    def test_option_out_of_range_is_rejected(self):
        from common.api.exceptions import ContractAPIException
        with self.assertRaises(ContractAPIException):
            self._submit(self._session(), question_index=0, selected_index=9)


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
        mock_set.words.filter.side_effect = lambda **filters: MagicMock(count=lambda: 25) if filters == {'is_archived': False} else [w1]
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
