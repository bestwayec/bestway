import os
from unittest.mock import MagicMock, patch
from types import SimpleNamespace
from django.test import SimpleTestCase

from apps.core import assessment_providers as providers
from apps.core import mock_attempts as attempts
from apps.core import mock_submissions as submissions


class FishAudioSTTAndDeepSeekEvaluatorTests(SimpleTestCase):
    def test_assessment_identity_defaults_to_deepseek_v41_flash(self):
        with patch.dict(os.environ, {"OPENROUTER_API_KEY": "dummy-key"}, clear=True):
            provider, model = providers.assessment_identity("PRIMARY")
            self.assertEqual(provider, "openrouter")
            self.assertEqual(model, "deepseek/deepseek-v4.1-flash")

    def test_assessment_identity_honors_openrouter_eval_model(self):
        with patch.dict(os.environ, {
            "OPENROUTER_API_KEY": "dummy-key",
            "OPENROUTER_EVAL_MODEL": "deepseek/deepseek-v4.1-flash"
        }, clear=True):
            provider, model = providers.assessment_identity("PRIMARY")
            self.assertEqual(provider, "openrouter")
            self.assertEqual(model, "deepseek/deepseek-v4.1-flash")

    @patch("urllib.request.urlopen")
    def test_transcribe_openrouter_failover(self, mock_urlopen):
        # First call fails (fish-audio TTS model error 400), second call succeeds (google/gemini-2.5-flash)
        mock_resp_fail = MagicMock()
        mock_resp_fail.read.side_effect = Exception("HTTP Error 400: Bad Request")

        mock_resp_ok = MagicMock()
        mock_resp_ok.read.return_value = b'{"choices": [{"message": {"content": "Hello this is a test spoken answer."}}]}'
        mock_resp_ok.__enter__.return_value = mock_resp_ok
        mock_resp_ok.__exit__.return_value = None

        mock_urlopen.side_effect = [Exception("HTTP Error 400: Bad Request"), mock_resp_ok]

        mock_path = MagicMock()
        mock_path.is_file.return_value = True
        mock_path.stat.return_value.st_size = 1024
        mock_path.read_bytes.return_value = b"RIFF....WAVEfmt "
        mock_path.suffix = ".wav"

        with patch.dict(os.environ, {
            "OPENROUTER_API_KEY": "dummy-key",
            "OPENROUTER_STT_MODEL": "fish-audio/s2.1-pro-free:free",
            "OPENROUTER_STT_FALLBACK_MODEL": "google/gemini-2.5-flash",
        }):
            res = providers._transcribe_openrouter(mock_path, "audio/wav", "en", duration_ms=4000)
            self.assertEqual(res["text"], "Hello this is a test spoken answer.")
            self.assertEqual(res["model"], "google/gemini-2.5-flash")
            self.assertEqual(res["provider"], "openrouter")
            self.assertEqual(res["confidence"], 0.95)
            self.assertTrue(len(res["segments"]) > 0)
            self.assertEqual(res["segments"][0]["text"], "Hello")

    @patch("apps.core.assessment_providers._transcribe_openrouter")
    def test_transcribe_dispatches_to_openrouter(self, mock_or_transcribe):
        mock_or_transcribe.return_value = {
            "text": "Transcribed text",
            "confidence": 0.95,
            "segments": [],
            "provider": "openrouter",
            "model": "deepseek/deepseek-v4.1-flash",
            "durationMs": 3000,
            "pronunciationEvidence": "UNAVAILABLE",
        }
        mock_path = MagicMock()
        with patch.dict(os.environ, {"STT_PROVIDER": "openrouter", "OPENROUTER_API_KEY": "dummy"}):
            res = providers.transcribe(mock_path, "audio/webm", "en", duration_ms=3000)
            self.assertEqual(res["text"], "Transcribed text")
            mock_or_transcribe.assert_called_once()

    def test_assert_question_updates_section_without_lock(self):
        attempt = SimpleNamespace(
            flow_mode="full_test",
            current_skill="writing",
            save=MagicMock()
        )
        mock_q = SimpleNamespace(id="q-speak-1", group=SimpleNamespace(section=SimpleNamespace(skill="speaking")))
        with patch("apps.core.mock_attempts.questions", return_value=[mock_q]):
            q = attempts.assert_question(attempt, "q-speak-1")
            self.assertEqual(q.id, "q-speak-1")
            self.assertEqual(attempt.current_skill, "speaking")
            attempt.save.assert_called_once_with(update_fields=["current_skill"])

    @patch("django.db.transaction.atomic")
    @patch("apps.core.mock_attempts.own")
    @patch("apps.core.mock_attempts.assert_in_progress")
    @patch("apps.core.mock_attempts.assert_time")
    @patch("apps.core.mock_attempts.questions")
    @patch("apps.core.mock_attempts.upsert_answer")
    def test_save_answers_bulk_does_not_fail_with_section_locked(
        self, mock_upsert, mock_qs, mock_time, mock_in_prog, mock_own, mock_atomic
    ):
        mock_atomic.return_value.__enter__.return_value = None
        mock_atomic.return_value.__exit__.return_value = None

        attempt = SimpleNamespace(
            id="att-1",
            flow_mode="full_test",
            current_skill="speaking",
            save=MagicMock()
        )
        mock_own.return_value = attempt

        q1 = SimpleNamespace(id="q1", group=SimpleNamespace(section=SimpleNamespace(skill="speaking")))
        q2 = SimpleNamespace(id="q2", group=SimpleNamespace(section=SimpleNamespace(skill="speaking")))
        mock_qs.return_value = [q1, q2]

        user = SimpleNamespace(id="student-1", role="student")
        items = [{"questionId": "q1", "response": "Answer 1"}, {"questionId": "q2", "response": "Answer 2"}]

        with patch("apps.core.mock_attempts.assert_program"):
            res = attempts.save_answers(user, "att-1", items, bulk=True)
            self.assertEqual(res["saved"], 2)
            self.assertEqual(mock_upsert.call_count, 2)

    @patch("urllib.request.urlopen")
    def test_transcribe_gemini_flash_multimodal_with_diagnostics(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.read.return_value = (
            b'{"choices": [{"message": {"content": "{\\"transcript\\": \\"I feel comfortable in this specific environment, um, absolutely.\\", \\"speech_diagnostics\\": {\\"mispronounced_words\\": [{\\"word\\": \\"comfortable\\", \\"issue\\": \\"unclear vowel\\", \\"suggestion\\": \\"/\\u02c8k\\u028cmf.t\\u0259.b\\u0259l/\\"}], \\"pauses_and_hesitations\\": [{\\"type\\": \\"filler_word\\", \\"text\\": \\"um\\"}], \\"fluency_score\\": 7.0}}"}}]}'
        )
        mock_resp.__enter__.return_value = mock_resp
        mock_resp.__exit__.return_value = None
        mock_urlopen.return_value = mock_resp

        mock_path = MagicMock()
        mock_path.is_file.return_value = True
        mock_path.stat.return_value.st_size = 2048
        mock_path.read_bytes.return_value = b"RIFF....WAVEfmt "
        mock_path.suffix = ".wav"

        with patch.dict(os.environ, {
            "OPENROUTER_API_KEY": "dummy-key",
            "OPENROUTER_STT_MODEL": "google/gemini-2.5-flash",
        }):
            res = providers._transcribe_openrouter(mock_path, "audio/wav", "en", duration_ms=5000)
            self.assertEqual(res["text"], "I feel comfortable in this specific environment, um, absolutely.")
            self.assertEqual(res["model"], "google/gemini-2.5-flash")
            self.assertIn("speech_diagnostics", res)
            diag = res["speech_diagnostics"]
            self.assertEqual(len(diag["mispronounced_words"]), 1)
            self.assertEqual(diag["mispronounced_words"][0]["word"], "comfortable")
            self.assertEqual(diag["fluency_score"], 7.0)
            self.assertEqual(res["pronunciationEvidence"], "AVAILABLE")

    def test_heuristic_speech_diagnostics_detection(self):
        text = "Well, um, I think this specific situation is comfortable, you know."
        diag = providers._generate_heuristic_speech_diagnostics(text, duration_ms=6000)
        self.assertIn("mispronounced_words", diag)
        self.assertIn("pauses_and_hesitations", diag)
        self.assertTrue(any(p["text"].lower() == "um" for p in diag["pauses_and_hesitations"]))
        self.assertTrue(any(m["word"].lower() == "specific" for m in diag["mispronounced_words"]))
        self.assertTrue(0.0 <= diag["fluency_score"] <= 9.0)

    @patch("apps.core.writing_ocr._post_json")
    def test_writing_ocr_gemini_flash_and_deepseek_eval(self, mock_post_json):
        from apps.core import writing_ocr

        # Mock OCR response from OpenRouter Gemini Flash Vision
        ocr_resp = {"choices": [{"message": {"content": "This is an essay written by a student about environmental issues."}}]}
        # Mock evaluation response from DeepSeek v4.1 Flash
        eval_resp = {
            "choices": [{
                "message": {
                    "content": '{"task_achievement": 7.0, "coherence_cohesion": 6.5, "lexical_resource": 7.0, "grammatical_range": 6.5, "overall_band": 7.0, "strengths": ["Clear thesis"], "weaknesses": ["More examples needed"], "feedback": "Good job."}'
                }
            }]
        }
        mock_post_json.side_effect = [ocr_resp, eval_resp]

        with patch.dict(os.environ, {
            "OPENROUTER_API_KEY": "dummy-key",
            "OPENROUTER_VISION_MODEL": "google/gemini-2.5-flash",
            "OPENROUTER_EVAL_MODEL": "deepseek/deepseek-v4.1-flash",
        }):
            res = writing_ocr.extract_and_evaluate_images(
                [(b"fake-image-bytes", "image/jpeg")],
                task_prompt="Discuss environmental challenges",
                task_type="task2"
            )
            self.assertEqual(res["overall_band"], 7.0)
            self.assertEqual(res["task_achievement"], 7.0)
            self.assertEqual(res["ocrText"], "This is an essay written by a student about environmental issues.")
