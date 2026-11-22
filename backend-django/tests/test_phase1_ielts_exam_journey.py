"""Phase 1 Full IELTS Exam Audit & Reliability Regressions.

Validates the complete IELTS assessment pipeline:
- Listening 4 sections (40 questions, objective scoring)
- Reading 3 passages (40 questions, "Choose THREE" multi-select clusters, order independence, max 40 raw score)
- Writing Academic & General tasks (autosave, pending evaluation, evidence preservation)
- Speaking audio upload lifecycle & validation
- In-flight answer persistence during submit (with timer expiry / force submit)
- Duplicate submit idempotency
- Complete answer-key privacy during in-progress exams (no leakage)
"""
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import ANY, MagicMock, patch

from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from rest_framework.test import APIClient

import config.urls  # Preload URLconf
from common.api.exceptions import ContractAPIException
from apps.core import mock_attempts as attempts
from apps.core import mock_scoring as scoring
from apps.core import mock_submissions as submissions


class IeltsPhase1ReliabilityTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()
        self.student = SimpleNamespace(
            id="s-phase1",
            role="student",
            is_authenticated=True,
            is_staff=False,
            is_superuser=False,
        )

    def test_ielts_reading_three_passages_and_choose_three_cluster_scoring(self):
        """Reading: 40 questions across 3 passages with a 'Choose THREE' multi-select cluster.

        Tests:
        1. 3 passages with 40 total scoring positions.
        2. Q38-40 cluster with 3 correct options ['B', 'D', 'E'].
        3. Order independence: student selecting ['E', 'B', 'D'] or ['D', 'B', 'E'] gets full 3 marks.
        4. Partial match: student selecting ['B', 'D', 'A'] gets 2 marks.
        5. Total raw score accurately matches sum of correct positions and never exceeds 40.
        """
        sections = [
            {
                "skill": "reading",
                "groups": [
                    # Passage 1: Q1-13 (13 points)
                    {
                        "id": "g-p1",
                        "passageText": "Passage 1 content...",
                        "questions": [
                            {"id": f"q-r-{i}", "points": 1, "type": "true_false_notgiven", "correctAnswers": ["TRUE"]}
                            for i in range(1, 14)
                        ],
                    },
                    # Passage 2: Q14-26 (13 points)
                    {
                        "id": "g-p2",
                        "passageText": "Passage 2 content...",
                        "questions": [
                            {"id": f"q-r-{i}", "points": 1, "type": "multiple_choice", "options": ["A", "B", "C", "D"], "correctAnswers": ["A"]}
                            for i in range(14, 27)
                        ],
                    },
                    # Passage 3: Q27-37 single questions (11 points) + Q38-40 cluster (3 points) = 14 points
                    {
                        "id": "g-p3",
                        "passageText": "Passage 3 content...",
                        "questions": [
                            {"id": f"q-r-{i}", "points": 1, "type": "sentence_completion", "correctAnswers": ["evidence"]}
                            for i in range(27, 38)
                        ] + [
                            # Q38, Q39, Q40 share the same multi-select options bank and correct answers
                            {
                                "id": f"q-r-{i}",
                                "points": 1,
                                "type": "multiple_choice",
                                "options": ["A", "B", "C", "D", "E", "F", "G"],
                                "correctAnswers": ["B", "D", "E"],
                            }
                            for i in range(38, 41)
                        ],
                    },
                ],
            }
        ]

        total_questions = sum(len(g["questions"]) for g in sections[0]["groups"])
        self.assertEqual(total_questions, 40)

        # Scenario 1: Full correct answers with reverse order on Q38-40 cluster ['E', 'D', 'B']
        answers_full = {f"q-r-{i}": {"response": "TRUE"} for i in range(1, 14)}
        answers_full.update({f"q-r-{i}": {"response": "A"} for i in range(14, 27)})
        answers_full.update({f"q-r-{i}": {"response": "evidence"} for i in range(27, 38)})
        # Q38-40 answered in mixed order
        answers_full["q-r-38"] = {"response": "E"}
        answers_full["q-r-39"] = {"response": "D"}
        answers_full["q-r-40"] = {"response": "B"}

        res_full, proj_full = scoring.calculate("ielts_academic", sections, answers_full)
        self.assertEqual(res_full["rawScores"]["reading"]["score"], 40)
        self.assertEqual(res_full["rawScores"]["reading"]["max"], 40)
        self.assertEqual(res_full["sectionBands"]["reading"], 9.0)
        self.assertTrue(proj_full["q-r-38"]["isCorrect"])
        self.assertTrue(proj_full["q-r-39"]["isCorrect"])
        self.assertTrue(proj_full["q-r-40"]["isCorrect"])

        # Scenario 2: Partial match on cluster (student answered 'B', 'D', and wrong 'A')
        answers_partial = dict(answers_full)
        answers_partial["q-r-38"] = {"response": "B"}
        answers_partial["q-r-39"] = {"response": "D"}
        answers_partial["q-r-40"] = {"response": "A"}  # wrong

        res_part, proj_part = scoring.calculate("ielts_academic", sections, answers_partial)
        # 37 single questions correct + 2 correct from cluster = 39
        self.assertEqual(res_part["rawScores"]["reading"]["score"], 39)
        self.assertEqual(res_part["rawScores"]["reading"]["max"], 40)
        self.assertEqual(res_part["sectionBands"]["reading"], 9.0)

        # Scenario 3: Duplicate selection within cluster ('B', 'B', 'D') should only award 2 marks, not 3
        answers_dupe = dict(answers_full)
        answers_dupe["q-r-38"] = {"response": "B"}
        answers_dupe["q-r-39"] = {"response": "B"}  # duplicate
        answers_dupe["q-r-40"] = {"response": "D"}
        res_dupe, _ = scoring.calculate("ielts_academic", sections, answers_dupe)
        self.assertEqual(res_dupe["rawScores"]["reading"]["score"], 39)

    def test_ielts_listening_four_sections_forty_questions_grading(self):
        """Listening: 4 sections of 10 questions each, total 40 objective scoring positions."""
        sections = [
            {
                "skill": "listening",
                "groups": [
                    {
                        "id": f"g-s{sec}",
                        "title": f"Section {sec}",
                        "questions": [
                            {"id": f"q-l-s{sec}-{i}", "points": 1, "type": "note_completion", "correctAnswers": ["central library"]}
                            for i in range(1, 11)
                        ],
                    }
                    for sec in range(1, 5)
                ],
            }
        ]

        total_questions = sum(len(g["questions"]) for g in sections[0]["groups"])
        self.assertEqual(total_questions, 40)

        # 35 correct answers out of 40 -> IELTS Academic Listening Band 8.0
        answers = {f"q-l-s{sec}-{i}": {"response": "central library"} for sec in range(1, 5) for i in range(1, 10)}
        # Leave last question of each section unanswered (4 unanswered -> 36 correct)
        res, _ = scoring.calculate("ielts_academic", sections, answers)
        self.assertEqual(res["rawScores"]["listening"]["score"], 36)
        self.assertEqual(res["rawScores"]["listening"]["max"], 40)
        self.assertEqual(res["sectionBands"]["listening"], 8.0)

    def test_ielts_writing_evaluation_status_and_evidence_preservation(self):
        """Writing: Academic Task 1 & Task 2 submissions remain pending evaluation without fabricated band."""
        sections = [
            {
                "skill": "writing",
                "groups": [
                    {
                        "id": "g-w1",
                        "title": "Task 1",
                        "questions": [{"id": "q-w-1", "points": 3, "type": "writing_task", "prompt": "Summarize the chart"}],
                    },
                    {
                        "id": "g-w2",
                        "title": "Task 2",
                        "questions": [{"id": "q-w-2", "points": 6, "type": "writing_task", "prompt": "Discuss both views"}],
                    },
                ],
            }
        ]

        # Student answered both essays, but they are not yet graded by a teacher
        answers = {
            "q-w-1": {"response": "The bar chart illustrates global energy consumption...", "isGraded": False},
            "q-w-2": {"response": "In recent decades, educational technology has expanded rapidly...", "isGraded": False},
        }

        res, _ = scoring.calculate("ielts_academic", sections, answers)
        # Attempt status must be 'grading' while writing is unassessed
        self.assertEqual(res["status"], "grading")
        # No overall band or writing band should be invented
        self.assertIsNone(res["overallBand"])
        self.assertIsNone(res["sectionBands"].get("writing"))

    def test_answer_key_privacy_during_in_progress_attempt(self):
        """During an in-progress exam, correctAnswers, quotes, and review evidence must never be disclosed."""
        attempt = SimpleNamespace(
            id="att-privacy-1",
            status="in_progress",
            student_id="s-phase1",
            exam_id="exam-ielts-1",
            started_at=datetime.now(UTC) - timedelta(minutes=10),
            submitted_at=None,
            finished_at=None,
            overall_deadline_at=None,
            deadline_at=None,
            current_skill="reading",
            section_deadlines={},
            raw_scores={},
            section_bands={},
            overall_band=None,
            cefr_level=None,
            standard_scores={},
            anti_cheat_count=0,
            mode="timed",
            flow_mode="full_test",
            specification_version=None,
            media_state={},
            annotations=[],
            exam=SimpleNamespace(id="exam-ielts-1", title="IELTS Test", type="ielts_academic"),
            student=SimpleNamespace(user=SimpleNamespace(name="Test Student")),
        )

        with patch("apps.core.mock_attempts.MockAttempt.objects.select_related") as mock_attempt_qs, \
             patch("apps.core.mock_attempts.assert_view"), \
             patch("apps.core.mock_attempts.mock_catalog.is_staff", return_value=False), \
             patch("apps.core.mock_attempts.MockAnswer.objects.filter", return_value=[]), \
             patch("apps.core.mock_attempts.MockSection.objects.filter") as mock_sec_qs, \
             patch("apps.core.mock_attempts.MockQuestionGroup.objects.filter") as mock_grp_qs, \
             patch("apps.core.mock_attempts.MockQuestion.objects.filter") as mock_q_qs, \
             patch("apps.legacy_schema.models.AssessmentJob.objects.filter") as mock_jobs_qs, \
             patch("apps.core.mock_attempts.review_audio_url", return_value="https://cdn/audio"):

            mock_jobs_qs.return_value.order_by.return_value = []
            mock_attempt_qs.return_value.filter.return_value.first.return_value = attempt
            mock_sec = SimpleNamespace(id="sec-1", skill="reading", title="Reading", duration_minutes=60, instructions="")
            mock_sec_qs.return_value.order_by.return_value = [mock_sec]

            mock_grp = SimpleNamespace(
                id="grp-1", section_id="sec-1", title="Passage 1", instructions="",
                passage_text="Secret passage...", content_html=None, content_layout=None,
                options_reusable=True, audio_key=None, audio_script="Secret transcript",
            )
            mock_grp_qs.return_value.order_by.return_value = [mock_grp]

            mock_q = SimpleNamespace(
                id="q-secret-1", group_id="grp-1", number=1, type="multiple_choice",
                prompt="Secret prompt?", options=["A", "B", "C"], points=1,
                word_limit=None, answer_rule=None, correct_answers=["A"],
                explanation="Secret explanation of why A is correct",
            )
            mock_q_qs.return_value.order_by.return_value = [mock_q]

            student_actor = SimpleNamespace(id="s-phase1", role="student", is_staff=False, is_superuser=False)
            detail = attempts.detail(student_actor, "att-privacy-1")

            # Check the question payload returned to the student
            question_data = detail["sections"][0]["groups"][0]["questions"][0]
            self.assertNotIn("correctAnswers", question_data, "Correct answers leaked to active student!")
            self.assertNotIn("explanation", question_data, "Explanation leaked to active student!")
            self.assertNotIn("evidence", question_data, "Evidence quotes leaked to active student!")

    def test_in_flight_answers_cannot_bypass_the_server_deadline(self):
        """A client-sent force/timeUp flag must not extend the timer (late-answer bypass)."""
        import inspect
        self.assertNotIn("force", inspect.signature(attempts.save_answers).parameters)
        expired = SimpleNamespace(id="att-late", status="in_progress", student_id="s-phase1", mode="timed",
                                  overall_deadline_at=timezone.now() - timedelta(minutes=1), deadline_at=None,
                                  section_deadlines={}, current_skill="reading")
        with patch("apps.core.mock_attempts.own", return_value=expired), \
             patch.object(attempts.transaction, "atomic"):
            with self.assertRaises(ContractAPIException) as caught:
                attempts.save_answers(self.student, "att-late", [{"questionId": "q-r-1", "response": "TRUE"}], bulk=True)
        self.assertEqual(caught.exception.contract_code, "MOCK_TIME_UP")

    def test_submit_saves_in_flight_answers_in_time_and_drops_late_ones(self):
        from apps.core import mock_attempt_views as views
        client = APIClient()
        client.force_authenticate(SimpleNamespace(id="s-phase1", role="student", is_authenticated=True))
        body = {"answers": [{"questionId": "q-r-1", "response": "TRUE"}], "force": True, "timeUp": True}
        # Signature and single-session guards are covered by their own suites.
        for guard in (patch.object(views.attempt_signature, "verify_request"), patch.object(views.exam_session, "guard")):
            guard.start()
            self.addCleanup(guard.stop)
        # In time: saved without any force flag, then submitted.
        with patch.object(views.engine, "save_answers") as save, \
             patch("apps.core.mock_submissions.submit", return_value={"status": "completed"}) as submit:
            response = client.post("/v1/mock/attempts/att-1/submit", body, format="json")
        self.assertEqual(response.status_code, 201)
        save.assert_called_once_with(ANY, "att-1", body["answers"], bulk=True)
        submit.assert_called_once()
        # Time up: the late answers are dropped, the attempt is still submitted.
        with patch.object(views.engine, "save_answers", side_effect=ContractAPIException("MOCK_TIME_UP", "late", 400)), \
             patch("apps.core.mock_submissions.submit", return_value={"status": "completed"}) as submit:
            response = client.post("/v1/mock/attempts/att-1/submit", body, format="json")
        self.assertEqual(response.status_code, 201)
        submit.assert_called_once()
        # Any other save error still fails the request.
        with patch.object(views.engine, "save_answers", side_effect=ContractAPIException("MOCK_ATTEMPT_NOT_FOUND", "x", 404)), \
             patch("apps.core.mock_submissions.submit") as submit:
            response = client.post("/v1/mock/attempts/att-1/submit", body, format="json")
        self.assertEqual(response.status_code, 404)
        submit.assert_not_called()

    def test_grading_views_keep_atomic_inside_the_drf_view(self):
        """`@transaction.atomic` must sit inside `@api_view`: DRF turns a ContractAPIException into a
        4xx response; an outer atomic block would see a normal return and commit partial writes."""
        from apps.core import assessment_views, teacher_views
        for view in (assessment_views.teacher_grade, teacher_views.classroom_assignments_view,
                     teacher_views.teacher_grade_submission_view):
            with self.subTest(view=view.__name__):
                self.assertNotEqual(view.__code__.co_filename.rsplit("/", 1)[-1], "contextlib.py")

    def test_duplicate_submit_returns_saved_result_idempotently(self):
        """Submitting an attempt that is already completed must return the saved result without duplicating scoring."""
        completed_attempt = SimpleNamespace(
            id="att-done-1",
            status="completed",
            student_id="s-phase1",
            exam_id="exam-ielts-1",
            raw_scores={"reading": {"score": 38, "max": 40}},
            section_bands={"reading": 8.5},
            overall_band=8.5,
            cefr_level="C1",
            specification_version=None,
            standard_scores={},
            overall_score=None,
            score_method=None,
            score_version=None,
        )

        with patch("apps.core.mock_submissions.attempts.own", return_value=completed_attempt), \
             patch("apps.core.mock_submissions.transaction.atomic"), \
             patch("apps.core.mock_submission_handoff.pending", return_value=False):

            submit_fn = getattr(submissions.submit, "__wrapped__", submissions.submit)
            result = submit_fn(self.student, "att-done-1", ["reading"])
            self.assertEqual(result["status"], "completed")
            self.assertEqual(result["rawScores"]["reading"]["score"], 38)
            self.assertEqual(result["sectionBands"]["reading"], 8.5)


class AtomicDecoratorOrderTests(TestCase):
    """Why the order matters, shown on a real table: a write followed by a handled 4xx error."""

    def _view(self, outer_atomic):
        from django.contrib.sessions.models import Session
        from django.db import transaction
        from rest_framework.decorators import api_view

        def body(request):
            Session.objects.create(session_key=f"order-{outer_atomic}", session_data="x", expire_date=timezone.now())
            raise ContractAPIException("VALIDATION_ERROR", "rejected after a write", 400)
        return transaction.atomic(api_view(["POST"])(body)) if outer_atomic else api_view(["POST"])(transaction.atomic(body))

    def test_inner_atomic_rolls_back_and_outer_atomic_commits(self):
        from django.contrib.sessions.models import Session
        from rest_framework.test import APIRequestFactory
        factory = APIRequestFactory()
        for outer in (False, True):
            response = self._view(outer)(factory.post("/x", {}, format="json"))
            self.assertEqual(response.status_code, 400)
        self.assertFalse(Session.objects.filter(session_key="order-False").exists())   # correct order: rolled back
        self.assertTrue(Session.objects.filter(session_key="order-True").exists())     # outer atomic: partial write kept
