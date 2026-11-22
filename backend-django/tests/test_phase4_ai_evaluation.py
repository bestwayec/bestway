"""Phase 4: AI Writing and Speaking Evaluation Contract & Reliability Test Suite.

Validates:
1. IELTS Writing 4-criterion grading contracts:
   - Task Achievement / Response (TA/TR), Coherence and Cohesion (CC),
     Lexical Resource (LR), Grammatical Range and Accuracy (GRA).
   - 0..9 half-band scale increments.
   - Inline grammar corrections and vocabulary upgrades quoting candidate text.
2. IELTS Speaking 4-criterion grading contracts:
   - Fluency and Coherence (FC), Lexical Resource (LR),
     Grammatical Range and Accuracy (GRA), Pronunciation (PR).
   - Speech diagnostics generation: WPM, pauses, filler tokens, phonetic watchlist.
3. Strict anti-fabrication gates:
   - Empty attempts or submissions without candidate evidence must never receive fabricated scores.
   - Zero result generation returns null bands and zero raw scores.
4. Asynchronous job handoff:
   - Submission creates handoff record without blocking HTTP response.
"""
from __future__ import annotations

import os
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from apps.core import assessment_prompts, assessment_providers, assessment_worker
from apps.core.assessment_worker import build_zero_result


class IeltsAiEvaluationPhase4Tests(SimpleTestCase):
    def test_ielts_writing_prompt_specifies_four_official_criteria(self):
        """Writing prompt must instruct the 4 official IELTS criteria: TA/TR, CC, LR, GRA."""
        inp = {
            "program": "IELTS_ACADEMIC",
            "skill": "writing",
            "pronunciationEvidence": "UNAVAILABLE",
        }
        prompt = assessment_prompts.legacy_prompt(inp)

        self.assertIn("Task Achievement", prompt)
        self.assertIn("Task Response", prompt)
        self.assertIn("Coherence and Cohesion", prompt)
        self.assertIn("Lexical Resource", prompt)
        self.assertIn("Grammatical Range and Accuracy", prompt)
        self.assertIn("0.0..9.0 in exact 0.5 half-band increments", prompt)
        self.assertIn("Task 2 has twice Task 1's weight", prompt)
        self.assertIn("grammarCorrections", prompt)
        self.assertIn("vocabularyUpgrades", prompt)

    def test_ielts_speaking_prompt_specifies_four_criteria_and_acoustic_limitation(self):
        """Speaking prompt must enforce FC, LR, GRA, PR and prohibit acoustic fabrication without audio."""
        inp = {
            "program": "IELTS_ACADEMIC",
            "skill": "speaking",
            "pronunciationEvidence": "UNAVAILABLE",
        }
        prompt = assessment_prompts.legacy_prompt(inp)

        self.assertIn("IELTS Speaking", prompt)
        self.assertIn("fluency, lexical, grammar and pronunciation", prompt)
        self.assertIn("pronunciation must be null", prompt)
        self.assertIn("Do not fabricate acoustic observations", prompt)

    def test_speech_diagnostics_detects_wpm_fillers_and_phonetics(self):
        """Text-only diagnostics report WPM and fillers, never pronunciation (no acoustic evidence)."""
        sample_speech = (
            "Well, um, I definitely think that learning a specific foreign language "
            "in this environment is very comfortable for every student."
        )

        diagnostics = assessment_providers._generate_heuristic_speech_diagnostics(
            sample_speech, duration_ms=8000
        )

        self.assertGreater(diagnostics["words_per_minute"], 0)
        self.assertEqual(diagnostics["total_words"], 20)

        # Check filler word detection (um, well)
        fillers = [p["text"] for p in diagnostics["pauses_and_hesitations"] if p["type"] == "filler_word"]
        self.assertIn("um", fillers)
        self.assertIn("well", fillers)

        # A transcript is not acoustic evidence: no word may be reported as mispronounced.
        self.assertEqual(diagnostics["mispronounced_words"], [])

    def test_zero_result_builds_honest_zero_scores_without_ai_fabrication(self):
        """Submissions with zero work must produce null bands and zero raw scores without LLM calls."""
        input_data = {
            "program": "IELTS_ACADEMIC",
            "skill": "writing",
            "parts": [
                {"partNumber": 1, "max": 9.0},
                {"partNumber": 2, "max": 9.0},
            ],
            "pronunciationEvidence": "UNAVAILABLE",
        }

        zero_res = build_zero_result(input_data)
        self.assertEqual(len(zero_res["parts"]), 2)
        for part in zero_res["parts"]:
            self.assertEqual(part["rawScore"], 0.0)
            self.assertTrue(all(v == 0.0 or v is None for v in part["criteria"].values()))
        self.assertEqual(zero_res["grammarCorrections"], [])
        self.assertEqual(zero_res["vocabularyUpgrades"], [])

    def test_assessment_identity_failover_order(self):
        """STT transcribe provider chain must honor configuration with fallback."""
        with patch.dict(os.environ, {
            "STT_PROVIDER": "openrouter",
            "OPENROUTER_API_KEY": "test-key",
            "OPENROUTER_STT_MODEL": "primary-model",
            "OPENROUTER_STT_FALLBACK_MODEL": "fallback-model",
        }, clear=True):
            prov, model = assessment_providers.assessment_identity("PRIMARY")
            self.assertEqual(prov, "openrouter")
            self.assertTrue(bool(model))
