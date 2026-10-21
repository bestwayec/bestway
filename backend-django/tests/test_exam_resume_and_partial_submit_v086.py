from unittest.mock import MagicMock, patch
from types import SimpleNamespace
from django.test import SimpleTestCase
from apps.core import mock_attempts as engine
from apps.core.mock_submissions import assert_complete
from apps.core.assessment_worker import build_zero_result
from apps.core import assessment_results as results


class ExamResumeAndPartialSubmitV086Tests(SimpleTestCase):
    def test_assert_complete_does_not_block_partial_submission(self):
        attempt = SimpleNamespace(
            overall_deadline_at=None,
            deadline_at=None,
            section_deadlines={},
            flow_mode="full_test",
            current_skill="writing",
        )
        sections = [{"skill": "writing", "groups": [{"questions": [{"id": "q1", "type": "essay_task1"}]}]}]
        # Empty answers: assert_complete returns gracefully without raising MOCK_ATTEMPT_INCOMPLETE
        res = assert_complete(attempt, sections, {}, None)
        self.assertIsNone(res)

    @patch("django.db.transaction.atomic")
    @patch("apps.core.mock_attempts.own")
    @patch("apps.core.mock_attempts.assert_in_progress")
    @patch("apps.legacy_schema.models.MockSection.objects.filter")
    def test_switch_section_updates_current_skill(self, mock_sec_filter, mock_in_prog, mock_own, mock_atomic):
        mock_atomic.return_value.__enter__.return_value = None
        mock_atomic.return_value.__exit__.return_value = None
        user = SimpleNamespace(id="student-1", role="student")
        attempt = SimpleNamespace(id="att-1", exam_id="exam-1", current_skill="speaking", save=MagicMock())
        mock_own.return_value = attempt
        mock_sec_filter.return_value.first.return_value = SimpleNamespace(id="sec-writing", skill="writing")

        res = engine.switch_section(user, "att-1", "writing")
        self.assertTrue(res["saved"])
        self.assertEqual(res["currentSkill"], "writing")
        self.assertEqual(attempt.current_skill, "writing")
        attempt.save.assert_called_once_with(update_fields=["current_skill"])

    def test_build_zero_result_matches_schema(self):
        input_data = {
            "program": "MULTILEVEL",
            "skill": "writing",
            "pronunciationEvidence": "UNAVAILABLE",
            "parts": [
                {"id": "part1", "max": 5, "responses": []},
                {"id": "part2", "max": 5, "responses": []},
            ],
        }
        zero_res = build_zero_result(input_data)
        self.assertEqual(zero_res["confidence"], 1.0)
        self.assertEqual(len(zero_res["parts"]), 2)
        for p in zero_res["parts"]:
            self.assertEqual(p["rawScore"], 0.0)
            self.assertEqual(p["criteria"]["taskCoverage"], 0.0)
            self.assertEqual(p["evidence"]["taskCoverage"], "Javob taqdim etilmadi (0 ball)")

        validated = results.validate(zero_res, input_data)
        self.assertIsNotNone(validated)
