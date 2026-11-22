"""OCR / AI grading must fail closed: never invent text or a score (Telegram bot 2.0, milestone 1)."""
from __future__ import annotations

import os
from unittest.mock import patch

from django.test import SimpleTestCase

from apps.core import writing_ocr

BLANK_IMAGE = (b"\x89PNG\r\n\x1a\n" + bytes(range(256)) * 8, "image/png")  # no readable text


class OcrFailClosed(SimpleTestCase):
    def _offline(self):
        return patch.dict(os.environ, {"OPENROUTER_API_KEY": "", "XKIRO_API_KEY": "", "GEMINI_API_KEY": ""}, clear=False)

    def test_no_provider_means_no_text_not_an_invented_essay(self):
        with self._offline(), patch.object(writing_ocr, "_post_json", side_effect=RuntimeError("offline")):
            result = writing_ocr.extract_text_from_images([BLANK_IMAGE])
        self.assertEqual(result["ocrText"], "")
        self.assertEqual(result["wordCount"], 0)
        self.assertEqual(result["provider"], "none")
        self.assertFalse(result["available"])
        self.assertNotIn("contemporary society", str(result).lower())

    def test_offline_evaluation_returns_no_band(self):
        text = "Some essay text. " * 40
        with self._offline(), patch.object(writing_ocr, "_post_json", side_effect=RuntimeError("offline")):
            result = writing_ocr.evaluate_writing_text(text, task_type="task2")
        self.assertFalse(result["available"])
        self.assertIsNone(result["overall_band"])
        self.assertEqual(result["criteriaScores"], {})
        self.assertEqual(result["provider"], "unavailable")

    def test_empty_text_is_not_band_zero(self):
        result = writing_ocr.evaluate_writing_text("   ")
        self.assertIsNone(result["overall_band"])
        self.assertFalse(result["available"])

    def test_ai_answer_missing_a_criterion_is_rejected_not_defaulted(self):
        calls = []

        def partial(url, payload, headers, timeout=8.0):
            calls.append(url)
            return {"choices": [{"message": {"content": '{"task_achievement": 7, "overall_band": 9}'}}]}

        with patch.dict(os.environ, {"OPENROUTER_API_KEY": "k", "XKIRO_API_KEY": "", "GEMINI_API_KEY": ""}, clear=False), \
                patch.object(writing_ocr, "_post_json", side_effect=partial):
            result = writing_ocr.evaluate_writing_text("An essay. " * 50)
        self.assertTrue(calls)
        self.assertIsNone(result["overall_band"])  # not 6.0-filled, and the claimed overall 9 is not trusted

    def test_overall_is_computed_from_the_four_criteria(self):
        full = '{"task_achievement": 6, "coherence_cohesion": 7, "lexical_resource": 6, "grammatical_range": 7, "overall_band": 9}'
        with patch.dict(os.environ, {"OPENROUTER_API_KEY": "k", "XKIRO_API_KEY": "", "GEMINI_API_KEY": ""}, clear=False), \
                patch.object(writing_ocr, "_post_json", return_value={"choices": [{"message": {"content": full}}]}):
            result = writing_ocr.evaluate_writing_text("An essay. " * 50)
        self.assertTrue(result["available"])
        self.assertEqual(result["overall_band"], 6.5)

    def test_gemini_tier_is_skipped_without_a_key_and_logs_no_url(self):
        posted = []
        with self._offline(), patch.object(writing_ocr, "_post_json", side_effect=lambda *a, **k: posted.append(a[0])):
            writing_ocr.evaluate_writing_text("An essay. " * 50)
        self.assertEqual(posted, [])
