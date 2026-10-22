"""Comprehensive test suite for the Vocabulary Engine, SRS, Quizzes, Gamification, and Excel Export."""
from __future__ import annotations

from datetime import datetime, timezone as dt_timezone
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import openpyxl
from django.test import SimpleTestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.core import vocabulary_service as service
from apps.core.models import (
    QuizMode,
    UserWeakWord,
    VocabularyAttempt,
    VocabularyLevel,
    VocabularySet,
    VocabularyWord,
)
from apps.core.vocabulary_views import (
    parse_text_preview_view,
    srs_quiz_view,
    srs_stats_view,
    srs_submit_view,
    vocabulary_export_excel_view,
    vocabulary_group_report_view,
    vocabulary_quiz_view,
    vocabulary_set_detail_view,
    vocabulary_sets_view,
    vocabulary_submit_view,
)
from common.api.exceptions import ContractAPIException


class VocabularyParserTests(SimpleTestCase):
    def test_parse_various_separators_and_prefixes(self):
        raw = """
        1. apple - olma
        2) banana — banan
        • cat – mushuk
        dog : it
        car = mashina
        table\tstol
        resilient [adj] (e.g. He is very resilient) - chidamli
        # Comment line to ignore
        invalid line without separator
        """
        parsed = service.parse_raw_vocabulary_text(raw)
        self.assertEqual(len(parsed), 7)

        self.assertEqual(parsed[0]["english"], "apple")
        self.assertEqual(parsed[0]["uzbek"], "olma")

        self.assertEqual(parsed[1]["english"], "banana")
        self.assertEqual(parsed[1]["uzbek"], "banan")

        self.assertEqual(parsed[2]["english"], "cat")
        self.assertEqual(parsed[2]["uzbek"], "mushuk")

        self.assertEqual(parsed[3]["english"], "dog")
        self.assertEqual(parsed[3]["uzbek"], "it")

        self.assertEqual(parsed[4]["english"], "car")
        self.assertEqual(parsed[4]["uzbek"], "mashina")

        self.assertEqual(parsed[5]["english"], "table")
        self.assertEqual(parsed[5]["uzbek"], "stol")

        self.assertEqual(parsed[6]["english"], "resilient")
        self.assertEqual(parsed[6]["uzbek"], "chidamli")
        self.assertEqual(parsed[6]["part_of_speech"], "adj")
        self.assertIn("resilient", parsed[6]["context_sentence"])

    def test_empty_input(self):
        self.assertEqual(service.parse_raw_vocabulary_text(""), [])
        self.assertEqual(service.parse_raw_vocabulary_text(None), [])


class VocabularyPointsGamificationTests(SimpleTestCase):
    def test_point_allocations(self):
        # 100% -> 5 points
        self.assertEqual(service.calculate_points_for_percentage(100.0), 5)
        # 80% to 99% -> 3 points
        self.assertEqual(service.calculate_points_for_percentage(95.0), 3)
        self.assertEqual(service.calculate_points_for_percentage(80.0), 3)
        # <80% -> 0 points
        self.assertEqual(service.calculate_points_for_percentage(79.9), 0)
        self.assertEqual(service.calculate_points_for_percentage(50.0), 0)
        self.assertEqual(service.calculate_points_for_percentage(0.0), 0)


class VocabularyServiceLogicTests(SimpleTestCase):
    @patch("apps.core.vocabulary_service.transaction.atomic")
    @patch("apps.core.vocabulary_service.VocabularySet.objects.create")
    @patch("apps.core.vocabulary_service.VocabularyWord.objects.bulk_create")
    def test_vocabulary_set_creation(self, mock_bulk_create, mock_set_create, mock_atomic):
        actor = SimpleNamespace(id="teacher-1", name="Teacher Roziyev", role="teacher")
        mock_set = VocabularySet(
            id="vset-123",
            title="Unit 1: Advanced Adjectives",
            description="High-frequency CEFR C1 adjectives",
            level="C1",
        )
        mock_set_create.return_value = mock_set

        words_data = [
            {"english": "diligent", "uzbek": "tirishqoq"},
            {"english": "meticulous", "uzbek": "sinchkov"},
        ]

        result = service.create_vocabulary_set(
            actor=actor,
            title="Unit 1: Advanced Adjectives",
            words=words_data,
            level="C1",
            description="High-frequency CEFR C1 adjectives",
        )

        self.assertEqual(result.id, "vset-123")
        self.assertEqual(result.title, "Unit 1: Advanced Adjectives")
        mock_set_create.assert_called_once()
        mock_bulk_create.assert_called_once()

    @patch("apps.core.vocabulary_service.VocabularyWord.objects.filter")
    @patch("apps.core.vocabulary_service.VocabularySet.objects.filter")
    def test_generate_quiz_options(self, mock_set_filter, mock_word_filter):
        mock_set = VocabularySet(
            id="vset-1",
            title="Adjectives",
            level="B2",
        )
        mock_set_filter.return_value.first.return_value = mock_set

        w1 = VocabularyWord(id="w1", set=mock_set, english="diligent", uzbek="tirishqoq", context_sentence=None, part_of_speech="adj")
        w2 = VocabularyWord(id="w2", set=mock_set, english="meticulous", uzbek="sinchkov", context_sentence=None, part_of_speech="adj")
        w3 = VocabularyWord(id="w3", set=mock_set, english="profound", uzbek="chuqur", context_sentence=None, part_of_speech="adj")
        mock_word_filter.return_value = [w1, w2, w3]

        quiz = service.generate_quiz_for_set("vset-1", mode="mixed")
        self.assertEqual(quiz["totalQuestions"], 3)
        self.assertEqual(len(quiz["questions"]), 3)
        for q in quiz["questions"]:
            self.assertIn(q["type"], ["eng_uzb", "uzb_eng", "spelling"])

    @patch("apps.core.vocabulary_service.UserWeakWord.objects.filter")
    @patch("apps.core.vocabulary_service.transaction.atomic")
    @patch("apps.core.vocabulary_service.PointsLog.objects.create")
    @patch("apps.core.vocabulary_service.StudentProfile.objects")
    @patch("apps.core.vocabulary_service.VocabularyAttempt.objects.create")
    @patch("apps.core.vocabulary_service.VocabularyWord.objects.filter")
    @patch("apps.core.vocabulary_service.VocabularySet.objects.filter")
    def test_submit_quiz_100_percent_awards_5_points(
        self, mock_set_filter, mock_word_filter, mock_attempt_create, mock_profile_objects, mock_points_log_create, mock_atomic, mock_weak_filter
    ):
        student = SimpleNamespace(id="student-1", name="Ali Valiyev", role="student")
        vocab_set = VocabularySet(id="vset-1", title="Unit 1", level="B1")
        mock_set_filter.return_value.first.return_value = vocab_set

        w1 = VocabularyWord(id="w1", set=vocab_set, english="apple", uzbek="olma")
        w2 = VocabularyWord(id="w2", set=vocab_set, english="banana", uzbek="banan")
        mock_word_filter.return_value = [w1, w2]
        mock_weak_filter.return_value.first.return_value = None

        mock_profile = SimpleNamespace(current_points=10)
        mock_profile_objects.filter.return_value.first.return_value = mock_profile

        answers = [
            {"wordId": "w1", "answer": "olma", "type": "eng_uzb"},
            {"wordId": "w2", "answer": "banan", "type": "eng_uzb"},
        ]

        result = service.submit_quiz_attempt(
            student=student,
            set_id="vset-1",
            mode="eng_uzb",
            answers=answers,
        )

        self.assertEqual(result["score"], 2)
        self.assertEqual(result["totalWords"], 2)
        self.assertEqual(result["percentage"], 100.0)
        self.assertEqual(result["pointsAwarded"], 5)
        self.assertEqual(len(result["wrongAnswers"]), 0)
        mock_points_log_create.assert_called_once()
        mock_attempt_create.assert_called_once()

    @patch("apps.core.vocabulary_service.PointsLog.objects.create")
    @patch("apps.core.vocabulary_service.UserWeakWord.objects.filter")
    @patch("apps.core.vocabulary_service.transaction.atomic")
    @patch("apps.core.vocabulary_service.UserWeakWord.objects.get_or_create")
    @patch("apps.core.vocabulary_service.StudentProfile.objects")
    @patch("apps.core.vocabulary_service.VocabularyAttempt.objects.create")
    @patch("apps.core.vocabulary_service.VocabularyWord.objects.filter")
    @patch("apps.core.vocabulary_service.VocabularySet.objects.filter")
    def test_submit_quiz_partial_awards_3_points_and_creates_weak_word(
        self, mock_set_filter, mock_word_filter, mock_attempt_create, mock_profile_objects, mock_weak_word_get_or_create, mock_atomic, mock_weak_filter, mock_points_log_create
    ):
        student = SimpleNamespace(id="student-1", name="Ali Valiyev", role="student")
        vocab_set = VocabularySet(id="vset-1", title="Unit 1", level="B1")
        mock_set_filter.return_value.first.return_value = vocab_set

        words = [
            VocabularyWord(id=f"w{i}", set=vocab_set, english=f"eng{i}", uzbek=f"uzb{i}")
            for i in range(1, 6)
        ]
        mock_word_filter.return_value = words
        mock_weak_filter.return_value.first.return_value = None

        mock_profile = SimpleNamespace(current_points=10)
        mock_profile_objects.filter.return_value.first.return_value = mock_profile
        mock_weak_word_get_or_create.return_value = (MagicMock(), True)

        # 4 correct, 1 wrong = 80% -> 3 points
        answers = [
            {"wordId": "w1", "answer": "uzb1", "type": "eng_uzb"},
            {"wordId": "w2", "answer": "uzb2", "type": "eng_uzb"},
            {"wordId": "w3", "answer": "uzb3", "type": "eng_uzb"},
            {"wordId": "w4", "answer": "uzb4", "type": "eng_uzb"},
            {"wordId": "w5", "answer": "wrong", "type": "eng_uzb"},
        ]

        result = service.submit_quiz_attempt(
            student=student,
            set_id="vset-1",
            mode="eng_uzb",
            answers=answers,
        )

        self.assertEqual(result["score"], 4)
        self.assertEqual(result["totalWords"], 5)
        self.assertEqual(result["percentage"], 80.0)
        self.assertEqual(result["pointsAwarded"], 3)
        self.assertEqual(len(result["wrongAnswers"]), 1)
        self.assertEqual(result["wrongAnswers"][0]["wordId"], "w5")
        mock_weak_word_get_or_create.assert_called_once()

    @patch("apps.core.vocabulary_service.VocabularyAttempt.objects")
    @patch("apps.core.vocabulary_service.VocabularySet.objects")
    def test_excel_export_structure(self, mock_set_objects, mock_attempt_objects):
        vset = SimpleNamespace(
            id="vset-1",
            title="Unit 5: Environment",
            level="B2",
            created_at=datetime.now(dt_timezone.utc),
            group=SimpleNamespace(name="Group Alpha"),
            created_by=SimpleNamespace(name="Teacher Roziyev"),
        )
        mock_set_objects.select_related.return_value.filter.return_value.first.return_value = vset

        w1 = SimpleNamespace(id="w1", english="pollution", uzbek="ifloslanish", part_of_speech="noun", context_sentence="Air pollution is bad")
        vset.words = MagicMock()
        vset.words.all.return_value = [w1]

        student = SimpleNamespace(id="s1", name="Jasur Omonov", phone="+998901112233")
        att1 = SimpleNamespace(
            student=student,
            score=9,
            total_words=10,
            percentage=90.0,
            points_awarded=3,
            mode="mixed",
            wrong_answers=[{"english": "pollution", "uzbek": "ifloslanish"}],
            completed_at=datetime.now(dt_timezone.utc),
        )
        mock_attempt_objects.filter.return_value.select_related.return_value.order_by.return_value = [att1]

        excel_bytes = service.export_vocabulary_set_excel("vset-1")
        self.assertIsInstance(excel_bytes, bytes)
        self.assertTrue(len(excel_bytes) > 2000)
        self.assertTrue(excel_bytes.startswith(b"PK"))

        # Verify workbook readable
        wb = openpyxl.load_workbook(BytesIO(excel_bytes))
        self.assertIn("Lug'at Natijalari", wb.sheetnames)


class VocabularyAPITests(SimpleTestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.teacher = SimpleNamespace(
            id="teacher-api-1",
            name="Mr. Teacher",
            phone="+998901112233",
            role="teacher",
            is_authenticated=True,
        )
        self.student = SimpleNamespace(
            id="student-api-1",
            name="Jasur Omonov",
            phone="+998904445566",
            role="student",
            is_authenticated=True,
        )

    def test_student_cannot_create_set(self):
        req = self.factory.post("/v1/vocabulary/sets", {"title": "Test"}, format="json")
        force_authenticate(req, user=self.student)
        res = vocabulary_sets_view(req)
        self.assertEqual(res.status_code, 403)

    @patch("apps.core.vocabulary_views.service.create_vocabulary_set")
    def test_teacher_creates_set_via_smart_paste(self, mock_create):
        mock_set = SimpleNamespace(
            id="vset-new",
            title="B2 Daily Routines",
            description="",
            level="B2",
            group_id=None,
            created_at=datetime.now(dt_timezone.utc),
            words=MagicMock(),
        )
        mock_set.words.count.return_value = 3
        mock_set.words.all.return_value = [
            SimpleNamespace(id="w1", english="wake up", uzbek="uyg'onmoq", part_of_speech="", context_sentence="")
        ]
        mock_create.return_value = mock_set

        payload = {
            "title": "B2 Daily Routines",
            "level": "B2",
            "rawText": "wake up - uyg'onmoq\nhave breakfast - nonushta qilmoq\ncommute - yo'l bosib bormoq",
        }
        req = self.factory.post("/v1/vocabulary/sets", payload, format="json")
        force_authenticate(req, user=self.teacher)
        res = vocabulary_sets_view(req)
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["data"]["title"], "B2 Daily Routines")
        self.assertEqual(res.data["data"]["wordCount"], 3)

    @patch("apps.core.vocabulary_views.service.generate_quiz_for_set")
    def test_student_fetches_quiz(self, mock_gen):
        mock_gen.return_value = {
            "setId": "vset-1",
            "setTitle": "Animals",
            "level": "A2",
            "mode": "eng_uzb",
            "totalQuestions": 2,
            "questions": [
                {"id": "w1", "wordId": "w1", "prompt": "lion", "type": "eng_uzb", "options": ["sher", "fil"]},
            ],
        }
        req = self.factory.get("/v1/vocabulary/sets/vset-1/quiz?mode=eng_uzb")
        force_authenticate(req, user=self.student)
        res = vocabulary_quiz_view(req, set_id="vset-1")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["data"]["totalQuestions"], 2)

    @patch("apps.core.vocabulary_views.service.submit_quiz_attempt")
    def test_student_submits_quiz(self, mock_submit):
        mock_submit.return_value = {
            "attemptId": "att-1",
            "score": 5,
            "totalWords": 5,
            "percentage": 100.0,
            "pointsAwarded": 5,
            "mode": "eng_uzb",
            "wrongAnswers": [],
        }
        payload = {
            "mode": "eng_uzb",
            "answers": [{"wordId": "w1", "answer": "sher", "type": "eng_uzb"}],
        }
        req = self.factory.post("/v1/vocabulary/sets/vset-1/submit", payload, format="json")
        force_authenticate(req, user=self.student)
        res = vocabulary_submit_view(req, set_id="vset-1")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["data"]["percentage"], 100.0)
        self.assertEqual(res.data["data"]["pointsAwarded"], 5)

    @patch("apps.core.vocabulary_views.UserWeakWord.objects.filter")
    def test_student_srs_stats(self, mock_weak_filter):
        mock_qs = MagicMock()
        w1 = SimpleNamespace(
            word=SimpleNamespace(id="w1", english="diligent", uzbek="tirishqoq"),
            mistake_count=3,
            correct_streak=0,
            is_mastered=False,
            last_reviewed=datetime.now(dt_timezone.utc),
        )
        w2 = SimpleNamespace(
            word=SimpleNamespace(id="w2", english="meticulous", uzbek="sinchkov"),
            mistake_count=1,
            correct_streak=2,
            is_mastered=True,
            last_reviewed=datetime.now(dt_timezone.utc),
        )
        mock_qs.select_related.return_value.order_by.return_value = [w1, w2]
        mock_weak_filter.return_value = mock_qs

        req = self.factory.get("/v1/vocabulary/srs/stats")
        force_authenticate(req, user=self.student)
        res = srs_stats_view(req)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["data"]["totalWeakWords"], 1)
        self.assertEqual(res.data["data"]["totalMasteredWords"], 1)
        self.assertEqual(len(res.data["data"]["weakWords"]), 2)
