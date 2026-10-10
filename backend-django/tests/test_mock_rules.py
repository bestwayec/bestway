from django.test import SimpleTestCase

from apps.core.mock_rules import objective_group_issues, objective_question_issues, respects_answer_rule
from apps.core.multilevel import CURRENT_SPEC
from apps.core.mock_authoring import multilevel_readiness, readiness as authoring_readiness


class QuestionRuleParityTests(SimpleTestCase):
    def test_choice_keys_accept_letters_and_reject_multi_choice_answers(self):
        question = {"type": "multiple_choice", "prompt": "Choose", "options": ["One", "Two"], "correctAnswers": ["b"]}
        self.assertEqual(objective_question_issues(question, True), [])
        question["correctAnswers"] = ["a", "b"]
        self.assertIn("single-choice question maps to several options", objective_question_issues(question, True))

    def test_manual_content_cannot_smuggle_objective_answer_key(self):
        question = {"type": "essay_task1", "prompt": "Write", "correctAnswers": ["A"]}
        self.assertIn("manual tasks cannot contain objective keys or options", objective_question_issues(question, False))

    def test_answer_rule_accepts_word_or_number_only_contract(self):
        self.assertTrue(respects_answer_rule("17", "ONE_WORD_AND_OR_NUMBER"))
        self.assertTrue(respects_answer_rule("green 17", "ONE_WORD_AND_OR_NUMBER"))
        self.assertFalse(respects_answer_rule("green blue", "ONE_WORD_AND_OR_NUMBER"))

    def test_one_use_matching_detects_duplicate_mapping(self):
        group = {"optionsReusable": False, "questions": [
            {"type": "matching", "prompt": "1", "options": ["A", "B"], "correctAnswers": ["A"]},
            {"type": "matching", "prompt": "2", "options": ["A", "B"], "correctAnswers": ["A"]},
        ]}
        self.assertIn("one-use option bank has repeated answer mappings", objective_group_issues(group, True))


class MultilevelReadinessTests(SimpleTestCase):
    def test_unsupported_specification_is_never_ready(self):
        self.assertEqual(multilevel_readiness({"specification_version": "old", "sections": []}), {"supported": False, "issues": ["Unsupported Multilevel specification"]})

    def test_v2_listening_requires_media_and_authored_part_number(self):
        result = multilevel_readiness({"specification_version": CURRENT_SPEC, "profile": "practice", "sections": [{"skill": "listening", "groups": [{"sort_order": 0, "part_number": 4, "audio_key": None, "audio_duration_sec": 0, "questions": []}]}]})
        self.assertIn("listening: requires 6 parts", result["issues"])
        self.assertIn("listening 1: audio and matching part number required", result["issues"])

    def test_writing_requires_shared_durable_stimulus_relation(self):
        result = multilevel_readiness({"specification_version": CURRENT_SPEC, "sections": [{"skill": "writing", "groups": [{"sort_order": 0, "stimulus_ref": "a", "max_score": 5, "questions": []}, {"sort_order": 1, "stimulus_ref": "b", "max_score": 5, "questions": []}, {"sort_order": 2, "max_score": 6, "questions": []}]}]})
        self.assertIn("writing: informal and formal emails must share the same source stimulus", result["issues"])

    def test_canonical_readiness_sorts_by_sort_order_not_physical_order(self):
        result = multilevel_readiness({
            "specification_version": CURRENT_SPEC, "profile": "practice",
            "sections": [
                {"skill": "listening", "sort_order": 2, "groups": [
                    {"sort_order": 0, "part_number": 1, "audio_key": "key1", "audio_duration_sec": 30, "questions": [{"type": "multiple_choice", "points": 1, "options": ["A", "B", "C", "D"]}]},
                ]},
                {"skill": "listening", "sort_order": 1, "groups": [
                    {"sort_order": 2, "part_number": 2, "audio_key": "key2", "audio_duration_sec": 40, "questions": [{"type": "short_answer", "points": 1, "options": [], "word_limit": 1}]},
                ]},
            ],
        })
        self.assertIn("listening: requires 6 parts", result["issues"])
        joined = "; ".join(result["issues"])
        self.assertNotIn("listening 2: audio and matching part number required", joined)

    def test_canonical_readiness_used_by_authoring_not_catalog_only(self):
        self.assertIs(authoring_readiness, authoring_readiness)
