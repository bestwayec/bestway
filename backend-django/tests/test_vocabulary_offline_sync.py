"""Tests for Offline Vocabulary Synchronization Backend: Snapshots, Idempotency, Batch Limits, and RBAC."""
from unittest.mock import MagicMock, patch
from django.test import SimpleTestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.core.models import HomeworkAssignment, VocabularyFlashcardProgress, VocabularySet, VocabularyWord
from apps.core.vocabulary_homework import flashcards_sync_view, flashcards_view, snapshot_view
from common.api.exceptions import ContractAPIException


class VocabularyOfflineSyncTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._conn_patcher = patch("django.db.transaction.get_connection")
        cls._mock_conn = cls._conn_patcher.start()
        conn = MagicMock()
        conn.savepoint_ids = []
        cls._mock_conn.return_value = conn

    @classmethod
    def tearDownClass(cls):
        cls._conn_patcher.stop()
        super().tearDownClass()

    def setUp(self):
        self.factory = APIRequestFactory()

        self.student = MagicMock(
            id="student-1",
            role="student",
            phone="+998901234567",
            email="student@bestwayec.uz",
            is_authenticated=True,
        )
        self.student.name = "Ali Student"

        self.stranger_student = MagicMock(
            id="student-stranger",
            role="student",
            phone="+998909999999",
            email="stranger@bestwayec.uz",
            is_authenticated=True,
        )
        self.stranger_student.name = "Stranger Student"

        self.sample_words = [
            {"id": "w1", "english": "apple", "uzbek": "olma", "contextSentence": None, "partOfSpeech": "noun"},
            {"id": "w2", "english": "banana", "uzbek": "banan", "contextSentence": None, "partOfSpeech": "noun"},
            {"id": "w3", "english": "cherry", "uzbek": "olcha", "contextSentence": None, "partOfSpeech": "noun"},
        ]

        self.mock_assignment = MagicMock(spec=HomeworkAssignment, id="a-1", vocabulary_set_id="set-1")
        self.mock_assignment._state = MagicMock()
        self.mock_assignment._state.db = "default"
        self.mock_assignment.cohort = MagicMock(classroom_id="group-1")

    @patch("apps.core.vocabulary_homework.assignment_for_student")
    @patch("apps.core.vocabulary_collections.assignment_revision")
    def test_snapshot_view_authorized_student(self, mock_revision, mock_for_student):
        mock_for_student.return_value = self.mock_assignment
        mock_revision.return_value = {
            "revision": 3,
            "title": "IELTS Core Words",
            "level": "B2",
            "words": self.sample_words,
        }

        request = self.factory.get("/v1/student/assignments/a-1/vocabulary/snapshot")
        force_authenticate(request, user=self.student)
        response = snapshot_view(request, "a-1")

        self.assertEqual(response.status_code, 200)
        data = response.data["data"]
        self.assertEqual(data["revision"], 3)
        self.assertEqual(data["title"], "IELTS Core Words")
        self.assertEqual(len(data["words"]), 3)
        self.assertEqual(data["words"][0]["id"], "w1")

    @patch("apps.core.vocabulary_homework.assignment_for_student")
    def test_snapshot_view_forbidden_stranger(self, mock_for_student):
        mock_for_student.side_effect = ContractAPIException("FORBIDDEN", "Not enrolled", 403)

        request = self.factory.get("/v1/student/assignments/a-1/vocabulary/snapshot")
        force_authenticate(request, user=self.stranger_student)
        response = snapshot_view(request, "a-1")
        self.assertEqual(response.status_code, 403)

    @patch("apps.core.vocabulary_homework.assignment_for_student")
    @patch("apps.core.vocabulary_collections.assignment_revision")
    @patch("apps.core.models.VocabularyFlashcardProgress.objects.filter")
    def test_flashcards_sync_idempotent_batch(self, mock_filter, mock_revision, mock_for_student):
        mock_for_student.return_value = self.mock_assignment
        mock_revision.return_value = {
            "revision": 2,
            "words": self.sample_words,
        }

        progress = VocabularyFlashcardProgress(
            assignment=self.mock_assignment,
            student_id=self.student.id,
            familiarity={"w1": "practice"},
            word_order=["w1", "w2", "w3"],
            last_word_id="w1",
        )
        progress.save = MagicMock()
        mock_filter.return_value.first.return_value = progress

        payload = {
            "lastWordId": "w2",
            "order": ["w3", "w2", "w1"],
            "mutations": [
                {"opId": "op-1", "wordId": "w1", "status": "known"},
                {"opId": "op-2", "wordId": "w2", "status": "practice"},
                {"opId": "op-3", "wordId": "unknown-word", "status": "known"},  # Should be filtered
            ],
        }

        request = self.factory.post("/v1/student/assignments/a-1/vocabulary/flashcards/sync", payload, format="json")
        force_authenticate(request, user=self.student)
        response = flashcards_sync_view(request, "a-1")

        self.assertEqual(response.status_code, 200)
        data = response.data["data"]
        self.assertEqual(data["serverRevision"], 2)
        self.assertEqual(data["acknowledgedOpIds"], ["op-1", "op-2", "op-3"])
        self.assertEqual(data["familiarity"]["w1"], "known")
        self.assertEqual(data["familiarity"]["w2"], "practice")
        self.assertNotIn("unknown-word", data["familiarity"])
        self.assertEqual(data["lastWordId"], "w2")
        self.assertEqual(data["order"], ["w3", "w2", "w1"])
        progress.save.assert_called_once()

    @patch("apps.core.vocabulary_homework.assignment_for_student")
    @patch("apps.core.vocabulary_collections.assignment_revision")
    @patch("apps.core.models.VocabularyFlashcardProgress.objects.filter")
    def test_repeated_sync_is_idempotent(self, mock_filter, mock_revision, mock_for_student):
        mock_for_student.return_value = self.mock_assignment
        mock_revision.return_value = {
            "revision": 1,
            "words": self.sample_words,
        }

        progress = VocabularyFlashcardProgress(
            assignment=self.mock_assignment,
            student_id=self.student.id,
            familiarity={},
            word_order=["w1", "w2", "w3"],
            last_word_id="",
        )
        progress.save = MagicMock()
        mock_filter.return_value.first.return_value = progress

        payload = {
            "lastWordId": "w1",
            "mutations": [{"opId": "op-same", "wordId": "w1", "status": "known"}],
        }

        # First call
        req1 = self.factory.post("/v1/student/assignments/a-1/vocabulary/flashcards/sync", payload, format="json")
        force_authenticate(req1, user=self.student)
        res1 = flashcards_sync_view(req1, "a-1")

        # Second identical call (retry/reconnect)
        req2 = self.factory.post("/v1/student/assignments/a-1/vocabulary/flashcards/sync", payload, format="json")
        force_authenticate(req2, user=self.student)
        res2 = flashcards_sync_view(req2, "a-1")

        self.assertEqual(res1.status_code, 200)
        self.assertEqual(res2.status_code, 200)
        self.assertEqual(res1.data["data"]["familiarity"], res2.data["data"]["familiarity"])
        self.assertEqual(res1.data["data"]["acknowledgedOpIds"], ["op-same"])
        self.assertEqual(res2.data["data"]["acknowledgedOpIds"], ["op-same"])

    @patch("apps.core.vocabulary_homework.assignment_for_student")
    @patch("apps.core.vocabulary_collections.assignment_revision")
    def test_sync_batch_limit_exceeded(self, mock_revision, mock_for_student):
        mock_for_student.return_value = self.mock_assignment
        mock_revision.return_value = {"revision": 1, "words": self.sample_words}

        payload = {
            "mutations": [{"opId": f"op-{i}", "wordId": "w1", "status": "known"} for i in range(101)],
        }

        request = self.factory.post("/v1/student/assignments/a-1/vocabulary/flashcards/sync", payload, format="json")
        force_authenticate(request, user=self.student)
        response = flashcards_sync_view(request, "a-1")
        self.assertEqual(response.status_code, 400)

    @patch("apps.core.vocabulary_homework.assignment_for_student")
    @patch("apps.core.vocabulary_collections.assignment_revision")
    @patch("apps.core.models.VocabularyFlashcardProgress.objects.filter")
    def test_flashcards_view_backward_compatible_patch(self, mock_filter, mock_revision, mock_for_student):
        mock_for_student.return_value = self.mock_assignment
        mock_revision.return_value = {"revision": 1, "words": self.sample_words}

        progress = VocabularyFlashcardProgress(
            assignment=self.mock_assignment,
            student_id=self.student.id,
            familiarity={},
            word_order=["w1", "w2", "w3"],
            last_word_id="w1",
        )
        progress.save = MagicMock()
        mock_filter.return_value.first.return_value = progress

        # Standard legacy single-change PATCH
        legacy_payload = {"wordId": "w1", "status": "known", "lastWordId": "w1"}
        req_legacy = self.factory.patch("/v1/student/assignments/a-1/vocabulary/flashcards", legacy_payload, format="json")
        force_authenticate(req_legacy, user=self.student)
        res_legacy = flashcards_view(req_legacy, "a-1")
        self.assertEqual(res_legacy.status_code, 200)
        self.assertEqual(res_legacy.data["data"]["familiarity"]["w1"], "known")

        # Batch mutations on PATCH
        batch_payload = {"mutations": [{"opId": "op-p1", "wordId": "w2", "status": "practice"}]}
        req_batch = self.factory.patch("/v1/student/assignments/a-1/vocabulary/flashcards", batch_payload, format="json")
        force_authenticate(req_batch, user=self.student)
        res_batch = flashcards_view(req_batch, "a-1")
        self.assertEqual(res_batch.status_code, 200)
        self.assertEqual(res_batch.data["data"]["familiarity"]["w2"], "practice")
        self.assertEqual(res_batch.data["data"]["acknowledgedOpIds"], ["op-p1"])
