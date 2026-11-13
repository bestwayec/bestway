"""Score rule #129 in the prediction service: nothing is derived from a short
practice set, from an attempt that is still being graded, or from a legacy test.
Each rule is checked in both directions (real evidence is kept, missing evidence
gives no figure)."""
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from apps.core import prediction_service
from apps.core.prediction_service import extract_attempt_dual_metrics


def attempt(exam_type="ielts_academic", status="completed", flow_mode="full_test", **fields):
    values = dict(id="att", exam_id="exam", exam=SimpleNamespace(title="Mock", type=exam_type), status=status,
                  flow_mode=flow_mode, media_state=None, raw_scores={}, section_bands={}, standard_scores={},
                  overall_band=None, overall_score=None, cefr_level=None,
                  finished_at=None, submitted_at=None, started_at=None)
    values.update(fields)
    return SimpleNamespace(**values)


class SectionEvidenceTests(SimpleTestCase):
    def test_a_short_ielts_practice_gives_no_section_band(self):
        short = attempt(flow_mode="single_skill", raw_scores={"reading": {"score": 1, "max": 1}})
        metrics = extract_attempt_dual_metrics(short)
        self.assertEqual(metrics["skillsIelts"], {})
        self.assertEqual(metrics["skillsMultilevel"], {})
        self.assertEqual((metrics["rawScore"], metrics["rawMax"]), (1.0, 1.0))

    def test_a_band_stored_by_an_older_build_for_a_short_set_is_ignored(self):
        old = attempt(flow_mode="single_skill", raw_scores={"listening": {"score": 6, "max": 6}}, section_bands={"listening": 9.0})
        self.assertEqual(extract_attempt_dual_metrics(old)["skillsIelts"], {})

    def test_a_full_ielts_section_keeps_its_stored_band(self):
        full = attempt(flow_mode="single_skill", raw_scores={"reading": {"score": 30, "max": 40}}, section_bands={"reading": 7.0})
        self.assertEqual(extract_attempt_dual_metrics(full)["skillsIelts"], {"reading": 7.0})

    def test_a_short_multilevel_practice_gives_no_standard_score(self):
        short = attempt("multilevel", flow_mode="single_skill", raw_scores={"reading": {"score": 5, "max": 6}},
                        standard_scores={"reading": {"estimatedStandardScore": None, "scoreMethod": "RAW_ONLY"}})
        metrics = extract_attempt_dual_metrics(short)
        self.assertEqual(metrics["skillsMultilevel"], {})
        self.assertEqual(metrics["skillsIelts"], {})

    def test_a_full_multilevel_section_keeps_its_standard_score(self):
        full = attempt("multilevel", flow_mode="single_skill", raw_scores={"listening": {"score": 18, "max": 35}},
                       standard_scores={"listening": {"estimatedStandardScore": 51}})
        self.assertEqual(extract_attempt_dual_metrics(full)["skillsMultilevel"], {"listening": 51.0})

    def test_writing_and_speaking_are_never_scaled_from_a_raw_score(self):
        raw_only = attempt(raw_scores={"writing": {"score": 6, "max": 9}, "speaking": {"score": 7, "max": 9}})
        self.assertEqual(extract_attempt_dual_metrics(raw_only)["skillsIelts"], {})
        graded = attempt(raw_scores={"writing": {"score": 6, "max": 9}}, section_bands={"writing": 6.5})
        self.assertEqual(extract_attempt_dual_metrics(graded)["skillsIelts"], {"writing": 6.5})


class OverallEvidenceTests(SimpleTestCase):
    SECTIONS = dict(raw_scores={"listening": {"score": 30, "max": 40}, "reading": {"score": 30, "max": 40}},
                    section_bands={"listening": 7.0, "reading": 7.0})

    def test_an_attempt_that_is_still_being_graded_has_no_overall(self):
        metrics = extract_attempt_dual_metrics(attempt(status="grading", **self.SECTIONS))
        self.assertIs(metrics["hasOverall"], False)
        self.assertEqual((metrics["ieltsBand"], metrics["multilevelScore"], metrics["cefrLevel"]), (0.0, 0.0, None))
        # Its finished sections are still real evidence.
        self.assertEqual(metrics["skillsIelts"], {"listening": 7.0, "reading": 7.0})

    def test_a_stale_overall_on_a_grading_attempt_is_not_reported(self):
        metrics = extract_attempt_dual_metrics(attempt(status="grading", overall_band=7.0, **self.SECTIONS))
        self.assertIs(metrics["hasOverall"], False)
        self.assertEqual(metrics["ieltsBand"], 0.0)

    def test_a_completed_full_exam_reports_its_stored_overall(self):
        metrics = extract_attempt_dual_metrics(attempt(overall_band=6.5, cefr_level="B2", **self.SECTIONS))
        self.assertIs(metrics["hasOverall"], True)
        self.assertEqual((metrics["ieltsBand"], metrics["cefrLevel"]), (6.5, "B2"))

    def test_a_completed_exam_without_a_stored_overall_gets_none_from_its_sections(self):
        metrics = extract_attempt_dual_metrics(attempt(**self.SECTIONS))
        self.assertIs(metrics["hasOverall"], False)
        self.assertEqual(metrics["ieltsBand"], 0.0)

    def test_a_single_section_practice_has_no_overall_even_with_a_stored_one(self):
        metrics = extract_attempt_dual_metrics(attempt(flow_mode="single_skill", overall_band=7.0, **self.SECTIONS))
        self.assertIs(metrics["hasOverall"], False)

    def test_a_completed_multilevel_exam_reports_its_stored_score(self):
        metrics = extract_attempt_dual_metrics(attempt("multilevel", overall_score=62.0))
        self.assertIs(metrics["hasOverall"], True)
        self.assertEqual(metrics["multilevelScore"], 62.0)


class PredictionTests(SimpleTestCase):
    def predict(self, attempts):
        with patch("apps.core.prediction_service.MockAttempt") as attempts_cls, \
             patch("apps.core.prediction_service.User") as users, \
             patch("apps.core.prediction_service.StudentProfile") as profiles, \
             patch("apps.core.prediction_service.get_student_target", return_value={"targetBand": 7.0, "targetScore": 60.0, "targetCefr": "C1"}), \
             patch("apps.core.prediction_service._analyze_weak_modules", return_value=[]):
            users.objects.filter.return_value.first.return_value = SimpleNamespace(id="s-1", name="Student")
            profiles.objects.filter.return_value.first.return_value = SimpleNamespace(active_program="IELTS")
            attempts_cls.objects.filter.return_value.select_related.return_value.order_by.return_value.__getitem__.return_value = attempts
            attempts_cls.objects.filter.return_value.exclude.return_value.select_related.return_value.order_by.return_value.__getitem__.return_value = attempts
            return prediction_service.get_student_prediction("s-1")

    def test_only_short_practice_gives_no_band_at_all(self):
        result = self.predict([attempt(flow_mode="single_skill", raw_scores={"reading": {"score": 1, "max": 1}})])
        self.assertIsNone(result["ielts"]["currentBand"])
        self.assertIsNone(result["ielts"]["predictedBand"])
        self.assertEqual(result["ielts"]["skillBreakdown"], {"listening": None, "reading": None, "writing": None, "speaking": None})
        self.assertEqual(result["history"], [])
        self.assertEqual(result["trend"], "insufficient_data")

    def test_a_grading_mock_gives_section_evidence_but_no_overall(self):
        grading = attempt(status="grading", raw_scores={"listening": {"score": 30, "max": 40}}, section_bands={"listening": 7.0})
        result = self.predict([grading])
        self.assertIsNone(result["ielts"]["currentBand"])
        self.assertIsNone(result["multilevel"]["currentScore"])
        self.assertEqual(result["history"], [])
        self.assertEqual(result["pendingAttempts"], 1)
        self.assertEqual(result["ielts"]["skillBreakdown"]["listening"], 7.0)

    def test_a_completed_full_mock_gives_an_overall(self):
        done = attempt(overall_band=6.5, cefr_level="B2", raw_scores={"listening": {"score": 30, "max": 40}}, section_bands={"listening": 7.0})
        result = self.predict([done])
        self.assertEqual(result["ielts"]["currentBand"], 6.5)
        self.assertEqual(len(result["history"]), 1)
        self.assertEqual(result["pendingAttempts"], 0)

    def test_legacy_tests_are_not_read_and_give_no_result(self):
        # The service no longer touches the legacy table at all.
        self.assertFalse(hasattr(prediction_service, "TestAttempt"))
        result = self.predict([])
        self.assertEqual(result["history"], [])
        self.assertIsNone(result["ielts"]["currentBand"])
        self.assertIsNone(result["multilevel"]["cefrLevel"])


class OverviewLegacyTests(SimpleTestCase):
    """GET assessment/overview: a legacy test keeps its stored total, nothing more."""

    def overview(self, mock_attempts, legacy_attempts):
        from unittest.mock import MagicMock

        from apps.core import assessment_overview_service, auth_service
        user = SimpleNamespace(id="s-1", name="Student", phone="+998900000000", role="student")
        with patch("apps.core.prediction_service.get_student_prediction", return_value={"ielts": {}, "multilevel": {}}), \
             patch("apps.legacy_schema.models.MockAttempt.objects.filter") as mocks, \
             patch("apps.legacy_schema.models.TestAttempt.objects.filter") as legacy, \
             patch("apps.legacy_schema.models.AssessmentJob.objects.filter") as jobs, \
             patch("apps.legacy_schema.models.MockAnswer.objects.filter") as answers, \
             patch.object(auth_service, "fetch_user", return_value=None):
            mocks.return_value.select_related.return_value.order_by.return_value = mock_attempts
            mocks.return_value.__iter__.return_value = mock_attempts
            mocks.return_value.count.return_value = len(mock_attempts)
            legacy.return_value.select_related.return_value.order_by.return_value = legacy_attempts
            legacy.return_value.__iter__.return_value = legacy_attempts
            legacy.return_value.count.return_value = len(legacy_attempts)
            jobs.return_value = MagicMock()
            jobs.return_value.select_related.return_value.order_by.return_value = []
            answers.return_value = MagicMock()
            answers.return_value.select_related.return_value.order_by.return_value = []
            return assessment_overview_service.get_assessment_overview(user)

    def test_a_legacy_test_is_listed_without_a_band_or_level(self):
        legacy = SimpleNamespace(id="la-1", test_id="t-1", test=SimpleNamespace(title="Old test", type="ielts"), status="completed",
                                 total_score=32.0, auto_score=32.0, started_at=None, finished_at=None)
        result = self.overview([], [legacy])
        row = result["recentAttempts"][0]
        self.assertEqual(row["overallScore"], 32.0)
        self.assertEqual((row["overallBand"], row["multilevelScore"], row["cefrLevel"], row["skills"]), (0.0, 0.0, None, {}))
        stats = result["statistics"]
        self.assertEqual((stats["averageBand"], stats["highestBand"], stats["averageMultilevelScore"]), (0.0, 0.0, 0.0))
        # No timestamps, so no practice time is claimed.
        self.assertEqual(stats["practiceHours"], 0.0)

    def test_a_completed_mock_without_timestamps_claims_no_practice_time(self):
        done = attempt(overall_band=6.5, cefr_level="B2")
        result = self.overview([done], [])
        self.assertEqual(result["statistics"]["practiceHours"], 0.0)
        self.assertEqual(result["statistics"]["highestBand"], 6.5)
