"""S3: review material that explains a question (evidence in the text, Listening timestamp)."""
from types import SimpleNamespace

from django.test import SimpleTestCase

from apps.core import review_evidence as ev
from apps.core.type_accuracy import _asked
from common.api.exceptions import ContractAPIException

PASSAGE = "The bridge was built in 1890.\nIt was repaired\n  in 1920 after a flood."


class EvidenceTests(SimpleTestCase):
    def test_evidence_is_stored_as_it_stands_in_the_text_with_its_offset(self):
        self.assertEqual(ev.clean_evidence("built in 1890", PASSAGE), ("built in 1890", PASSAGE.index("built")))
        # Copied with other spacing or line breaks: still found, stored as in the passage.
        text, offset = ev.clean_evidence("repaired in 1920", PASSAGE)
        self.assertEqual(text, "repaired\n  in 1920")
        self.assertEqual(PASSAGE[offset:offset + len(text)], text)

    def test_evidence_that_is_not_in_the_text_is_refused(self):
        with self.assertRaises(ContractAPIException):
            ev.clean_evidence("built in 1891", PASSAGE)
        with self.assertRaises(ContractAPIException):
            ev.clean_evidence("x" * 601, "x" * 700)
        with self.assertRaises(ContractAPIException):
            ev.clean_evidence(42, PASSAGE)

    def test_empty_evidence_clears_it(self):
        self.assertEqual(ev.clean_evidence("  ", PASSAGE), (None, None))
        self.assertEqual(ev.clean_evidence(None, PASSAGE), (None, None))

    def test_audio_start_is_within_the_recording(self):
        self.assertEqual(ev.clean_audio_start(12.345, 300), 12.3)
        self.assertIsNone(ev.clean_audio_start(None, 300))
        for bad in (-1, 301, "12", True, float("nan")):
            with self.assertRaises(ContractAPIException):
                ev.clean_audio_start(bad, 300)

    def test_listening_evidence_comes_from_the_audioscript_as_plain_text(self):
        group = SimpleNamespace(audio_script="<p>Woman: The <b>museum</b> opens at nine.</p><p>Man: Great.</p>", passage_text=None)
        source = ev.source_text(group, "listening")
        self.assertIn("The museum opens at nine.", source)
        self.assertNotIn("<", source)
        payload = {}
        ev.apply(payload, {"evidenceText": "museum opens at nine", "audioStartSec": 42}, SimpleNamespace(**vars(group), audio_duration_sec=120), "listening")
        self.assertEqual(payload["audio_start_sec"], 42.0)
        self.assertEqual(source[payload["evidence_offset"]:].split(" at")[0], "museum opens")

    def test_a_reading_question_has_no_audio_time(self):
        with self.assertRaises(ContractAPIException):
            ev.apply({}, {"audioStartSec": 5}, SimpleNamespace(passage_text=PASSAGE, content_html=None, audio_duration_sec=None), "reading")

    def test_review_relocates_the_evidence_and_drops_it_when_the_text_changed(self):
        question = SimpleNamespace(evidence_text="built in 1890", evidence_offset=999, audio_start_sec=None)
        self.assertEqual(ev.review_fields(question, PASSAGE), {"evidence": {"text": "built in 1890", "offset": PASSAGE.index("built")}})
        self.assertEqual(ev.review_fields(question, "A different passage."), {})
        old = SimpleNamespace(evidence_text=None, evidence_offset=None, audio_start_sec=None)
        self.assertEqual(ev.review_fields(old, PASSAGE), {})   # older exams: no highlight


class TypeAccuracyScopeTests(SimpleTestCase):
    QUESTIONS = [{"id": "l1", "type": "multiple_choice", "skill": "listening"},
                 {"id": "r1", "type": "true_false_notgiven", "skill": "reading"},
                 {"id": "r2", "type": "true_false_notgiven", "skill": "reading"}]

    def test_only_the_skills_the_attempt_took_count(self):
        attempt = SimpleNamespace(raw_scores={"reading": {"score": 1, "max": 2}}, flow_mode="single_skill", media_state=None)
        self.assertEqual([q["id"] for q in _asked(attempt, self.QUESTIONS)], ["r1", "r2"])

    def test_partial_practice_counts_only_its_scope(self):
        attempt = SimpleNamespace(raw_scores={"reading": {}}, flow_mode="partial_practice",
                                  media_state={"__practice_scope": {"version": 1, "skills": ["reading"], "questionIds": ["r2"]}})
        self.assertEqual([q["id"] for q in _asked(attempt, self.QUESTIONS)], ["r2"])
