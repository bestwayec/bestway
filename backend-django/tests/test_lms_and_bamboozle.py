"""Tests for Unified LMS Video Engine & Bamboozle Game Arena."""

import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from django.test import RequestFactory, SimpleTestCase
from django.utils import timezone

from apps.core.models import (
    CardType,
    Course,
    Lesson,
    QuizCard,
    QuizDeck,
    UserLessonProgress,
)
from apps.core.lms_services import (
    apply_bamboozle_card_effect,
    complete_lesson,
    create_or_update_quiz_deck,
    get_or_create_progress,
    get_quiz_deck_detail,
    list_quiz_decks,
    stream_video_file,
    update_watch_time,
    get_lesson_solo_quiz,
    submit_lesson_solo_quiz,
)


class HTTPRangeStreamingTestCase(SimpleTestCase):
    """Test HTTP Range streaming and partial content responses."""

    def setUp(self):
        self.factory = RequestFactory()

    def test_stream_video_without_range_returns_200(self):
        request = self.factory.get("/v1/lessons/test/stream")
        response = stream_video_file("non_existent_file.mp4", request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Accept-Ranges"], "bytes")
        self.assertTrue(int(response["Content-Length"]) > 0)
        self.assertEqual(response["Content-Type"], "video/mp4")

    def test_stream_video_with_valid_range_returns_206(self):
        request = self.factory.get("/v1/lessons/test/stream", HTTP_RANGE="bytes=0-99")
        response = stream_video_file("non_existent_file.mp4", request)
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response["Accept-Ranges"], "bytes")
        self.assertEqual(response["Content-Length"], "100")
        self.assertTrue(response["Content-Range"].startswith("bytes 0-99/"))
        self.assertEqual(len(response.content), 100)

    def test_stream_video_with_invalid_range_returns_416(self):
        request = self.factory.get("/v1/lessons/test/stream", HTTP_RANGE="bytes=99999-999999")
        response = stream_video_file("non_existent_file.mp4", request)
        self.assertEqual(response.status_code, 416)
        self.assertTrue("Content-Range" in response)


class BamboozleCardEffectsTestCase(SimpleTestCase):
    """Test Bamboozle team battle card outcomes."""

    def test_question_card_correct_adds_points(self):
        t1, t2, msg = apply_bamboozle_card_effect(
            active_team=1,
            card_type=CardType.QUESTION,
            points=15,
            team1_score=10,
            team2_score=20,
            is_correct=True,
        )
        self.assertEqual(t1, 25)
        self.assertEqual(t2, 20)
        self.assertIn("+15 ball", msg)

    def test_question_card_incorrect_no_points(self):
        t1, t2, msg = apply_bamboozle_card_effect(
            active_team=2,
            card_type=CardType.QUESTION,
            points=20,
            team1_score=30,
            team2_score=15,
            is_correct=False,
        )
        self.assertEqual(t1, 30)
        self.assertEqual(t2, 15)
        self.assertIn("Noto'g'ri", msg)

    def test_swap_card_exchanges_scores(self):
        t1, t2, msg = apply_bamboozle_card_effect(
            active_team=1,
            card_type=CardType.SWAP,
            points=0,
            team1_score=10,
            team2_score=45,
        )
        self.assertEqual(t1, 45)
        self.assertEqual(t2, 10)
        self.assertIn("Ballar almashdi", msg)

    def test_steal_card_transfers_points(self):
        t1, t2, msg = apply_bamboozle_card_effect(
            active_team=1,
            card_type=CardType.STEAL,
            points=15,
            team1_score=10,
            team2_score=30,
        )
        self.assertEqual(t1, 25)
        self.assertEqual(t2, 15)
        self.assertIn("o'g'irladi", msg)

    def test_bomb_card_deducts_points(self):
        t1, t2, msg = apply_bamboozle_card_effect(
            active_team=2,
            card_type=CardType.BOMB,
            points=0,
            team1_score=40,
            team2_score=25,
        )
        self.assertEqual(t1, 40)
        self.assertEqual(t2, 10)  # 25 - 15 = 10
        self.assertIn("BOMBA", msg)

    def test_double_multiplier_applies_correctly(self):
        t1, t2, msg = apply_bamboozle_card_effect(
            active_team=1,
            card_type=CardType.QUESTION,
            points=20,
            team1_score=10,
            team2_score=10,
            is_correct=True,
            has_double=True,
        )
        self.assertEqual(t1, 50)  # 10 + (20 * 2) = 50
        self.assertIn("+40 ball", msg)


class LMSLessonAndDeckServiceTestCase(SimpleTestCase):
    """Test Lesson progress, anti-cheat, XP rewards, and QuizDeck unlocking."""

    def setUp(self):
        self.user = SimpleNamespace(
            id="user-123",
            name="Ali Valiyev",
            role="student",
            is_authenticated=True,
        )
        self.lesson = SimpleNamespace(
            id="lesson-456",
            title="Fluency & Coherence Secrets",
            duration=60,
            xp_reward=50,
            order_index=1,
        )

    @patch("apps.core.lms_services.UserLessonProgress.objects.get_or_create")
    def test_anti_cheat_blocks_premature_completion(self, mock_get_or_create):
        mock_progress = MagicMock()
        mock_progress.is_completed = False
        mock_progress.max_watched_seconds = 10
        mock_progress.watched_seconds = 10
        mock_progress.earned_xp = 0
        mock_get_or_create.return_value = (mock_progress, False)

        # User watched only 10s out of 60s
        result = complete_lesson(self.user, self.lesson, session_duration=10, watched_seconds=10)
        self.assertFalse(result["success"])
        self.assertEqual(result["error"], "ANTI_CHEAT_DETECTED")
        self.assertEqual(result["earned_xp"], 0)
        self.assertFalse(mock_progress.is_completed)

    @patch("django.db.transaction.atomic")
    @patch("apps.core.lms_services.QuizDeck.objects.filter")
    @patch("apps.core.lms_services.PointsLog.objects.create")
    @patch("apps.core.lms_services.StudentProfile.objects.filter")
    @patch("apps.core.lms_services.UserLessonProgress.objects.get_or_create")
    def test_genuine_watch_completes_lesson_and_awards_xp(
        self,
        mock_get_or_create,
        mock_profile_filter,
        mock_points_create,
        mock_deck_filter,
        mock_atomic,
    ):
        mock_atomic.return_value.__enter__.return_value = None
        mock_atomic.return_value.__exit__.return_value = None
        mock_progress = MagicMock()
        mock_progress.is_completed = False
        mock_progress.max_watched_seconds = 55
        mock_progress.watched_seconds = 55
        mock_progress.earned_xp = 0
        mock_get_or_create.return_value = (mock_progress, False)

        mock_profile_filter.return_value.exists.return_value = True

        mock_tied_deck = MagicMock()
        mock_tied_deck.id = "deck-789"
        mock_tied_deck.title = "Fluency Quiz"
        mock_tied_deck.category = "Vocabulary"
        mock_tied_deck.cards.count.return_value = 16
        mock_deck_filter.return_value.first.return_value = mock_tied_deck

        # User watched 55s out of 60s (> 80%)
        result = complete_lesson(self.user, self.lesson, session_duration=55, watched_seconds=55)
        self.assertTrue(result["success"])
        self.assertTrue(result["is_completed"])
        self.assertEqual(result["earned_xp"], 50)
        self.assertIsNotNone(result["unlocked_deck"])
        self.assertEqual(result["unlocked_deck"]["id"], "deck-789")

        # Verify PointsLog was created and progress marked complete
        self.assertTrue(mock_progress.is_completed)
        self.assertTrue(mock_points_create.called)

    @patch("apps.core.lms_services.UserLessonProgress.objects.filter")
    @patch("apps.core.lms_services.QuizDeck.objects.select_related")
    def test_quiz_deck_detail_reflects_unlock_status(
        self,
        mock_select_related,
        mock_progress_filter,
    ):
        mock_deck = MagicMock()
        mock_deck.id = "deck-1"
        mock_deck.title = "Speaking Vocab"
        mock_deck.category = "Vocabulary"
        mock_deck.is_lesson_tied = True
        mock_deck.lesson_id = "lesson-456"
        mock_deck.lesson.title = "Fluency Lesson"

        mock_card = MagicMock()
        mock_card.id = "card-1"
        mock_card.question_text = "What is fluency?"
        mock_card.points = 15
        mock_card.options = ["Flow", "Stop", "Sleep", "Jump"]
        mock_card.correct_answer = "Flow"
        mock_card.card_type = "question"
        mock_card.order_index = 1
        mock_deck.cards.all.return_value = [mock_card]

        mock_select_related.return_value.prefetch_related.return_value.get.return_value = mock_deck

        # If not completed -> is_unlocked False
        mock_progress_filter.return_value.first.return_value = None
        detail_locked = get_quiz_deck_detail("deck-1", user=self.user)
        self.assertFalse(detail_locked["is_unlocked"])

        # If completed -> is_unlocked True
        mock_completed_progress = MagicMock(is_completed=True)
        mock_progress_filter.return_value.first.return_value = mock_completed_progress
        detail_unlocked = get_quiz_deck_detail("deck-1", user=self.user)
        self.assertTrue(detail_unlocked["is_unlocked"])
        self.assertEqual(len(detail_unlocked["cards"]), 1)
        self.assertEqual(detail_unlocked["cards"][0]["points"], 15)

    @patch("django.db.transaction.atomic")
    @patch("apps.core.lms_services.QuizCard.objects.create")
    @patch("apps.core.lms_services.QuizDeck.objects.create")
    def test_create_custom_quiz_deck_by_teacher(
        self,
        mock_deck_create,
        mock_card_create,
        mock_atomic,
    ):
        mock_atomic.return_value.__enter__.return_value = None
        mock_atomic.return_value.__exit__.return_value = None
        teacher = SimpleNamespace(
            id="teacher-1",
            role="teacher",
            is_authenticated=True,
        )
        mock_deck = MagicMock()
        mock_deck.id = "new-deck-1"
        mock_deck.title = "Arena Grammar Battle"
        mock_deck_create.return_value = mock_deck

        data = {
            "title": "Arena Grammar Battle",
            "category": "Grammar",
            "is_lesson_tied": False,
            "cards": [
                {
                    "question_text": "Choose correct tense",
                    "points": 10,
                    "options": ["Have been", "Had been", "Was"],
                    "correct_answer": "Have been",
                    "card_type": "question",
                },
                {
                    "question_text": "SWAP CARD!",
                    "points": 0,
                    "card_type": "swap",
                },
            ],
        }
        deck = create_or_update_quiz_deck(teacher, data)
        self.assertEqual(deck.title, "Arena Grammar Battle")
        self.assertEqual(mock_card_create.call_count, 2)



class SoloGrammarQuizTestCase(SimpleTestCase):
    """Test individual solo grammar quiz extraction and scoring."""

    def setUp(self):
        self.user = SimpleNamespace(id="student-1", role="student", is_authenticated=True)
        self.lesson = SimpleNamespace(id="lesson-101", title="1. Nouns Mastery", duration=600, xp_reward=50)

    @patch("apps.core.lms_services.QuizDeck.objects.filter")
    @patch("apps.core.lms_services.Lesson.objects.get")
    def test_get_lesson_solo_quiz_filters_surprise_cards(self, mock_lesson_get, mock_deck_filter):
        mock_lesson_get.return_value = self.lesson

        mock_deck = MagicMock()
        mock_deck.id = "deck-101"
        mock_deck.title = "Nouns Deck"
        mock_deck.category = "Grammar"

        q_card = MagicMock(id="c-1", question_text="What is a noun?", points=10, options=["Person/place/thing", "Action"], card_type="question", order_index=1)
        mock_deck.cards.filter.return_value.order_index = 1
        mock_deck.cards.filter.return_value.order_by.return_value = [q_card]

        mock_deck_filter.return_value.first.return_value = mock_deck

        quiz = get_lesson_solo_quiz("lesson-101")
        self.assertEqual(quiz["lesson_id"], "lesson-101")
        self.assertEqual(quiz["total_questions"], 1)
        self.assertEqual(quiz["questions"][0]["question"], "What is a noun?")
        self.assertEqual(quiz["passing_percentage"], 80)
        self.assertEqual(quiz["xp_reward"], 30)

    @patch("django.db.transaction.atomic")
    @patch("apps.core.lms_services.PointsLog.objects.create")
    @patch("apps.core.lms_services.StudentProfile.objects.filter")
    @patch("apps.core.lms_services.UserLessonProgress.objects.get_or_create")
    @patch("apps.core.lms_services.QuizDeck.objects.filter")
    @patch("apps.core.lms_services.Lesson.objects.get")
    def test_submit_lesson_solo_quiz_passing_awards_xp(
        self,
        mock_lesson_get,
        mock_deck_filter,
        mock_get_or_create,
        mock_profile_filter,
        mock_points_create,
        mock_atomic,
    ):
        mock_atomic.return_value.__enter__.return_value = None
        mock_atomic.return_value.__exit__.return_value = None
        mock_lesson_get.return_value = self.lesson

        mock_deck = MagicMock()
        c1 = MagicMock(id="c-1", question_text="Plural of child?", correct_answer="children", points=10, options=["children", "childs"], card_type="question", order_index=1)
        c2 = MagicMock(id="c-2", question_text="Uncountable noun?", correct_answer="furniture", points=10, options=["furniture", "chair"], card_type="question", order_index=2)
        mock_deck.cards.filter.return_value.order_by.return_value = [c1, c2]
        mock_deck_filter.return_value.first.return_value = mock_deck

        mock_progress = MagicMock(is_completed=False, earned_xp=0, completed_at=None)
        mock_get_or_create.return_value = (mock_progress, False)
        mock_profile_filter.return_value.exists.return_value = True

        # Submit 100% correct answers
        answers = {"c-1": "children", "c-2": "furniture"}
        res = submit_lesson_solo_quiz(self.user, "lesson-101", answers)

        self.assertTrue(res["success"])
        self.assertTrue(res["passed"])
        self.assertEqual(res["score"], 2)
        self.assertEqual(res["percentage"], 100.0)
        self.assertEqual(res["xp_awarded"], 30)
        self.assertTrue(mock_progress.is_completed)
        self.assertTrue(mock_points_create.called)

    @patch("apps.core.lms_services.UserLessonProgress.objects.get_or_create")
    @patch("apps.core.lms_services.QuizDeck.objects.filter")
    @patch("apps.core.lms_services.Lesson.objects.get")
    def test_submit_lesson_solo_quiz_failing_does_not_award_xp(
        self,
        mock_lesson_get,
        mock_deck_filter,
        mock_get_or_create,
    ):
        mock_lesson_get.return_value = self.lesson

        mock_deck = MagicMock()
        c1 = MagicMock(id="c-1", question_text="Plural of child?", correct_answer="children", points=10, options=["children", "childs"], card_type="question", order_index=1)
        c2 = MagicMock(id="c-2", question_text="Uncountable noun?", correct_answer="furniture", points=10, options=["furniture", "chair"], card_type="question", order_index=2)
        mock_deck.cards.filter.return_value.order_by.return_value = [c1, c2]
        mock_deck_filter.return_value.first.return_value = mock_deck

        mock_progress = MagicMock(is_completed=False, earned_xp=0, completed_at=None)
        mock_get_or_create.return_value = (mock_progress, False)

        # 0% score
        answers = {"c-1": "childs", "c-2": "chair"}
        res = submit_lesson_solo_quiz(self.user, "lesson-101", answers)

        self.assertTrue(res["success"])
        self.assertFalse(res["passed"])
        self.assertEqual(res["score"], 0)
        self.assertEqual(res["percentage"], 0.0)
        self.assertEqual(res["xp_awarded"], 0)
        self.assertFalse(mock_progress.is_completed)
