"""Vocabulary Exam 3.0: grounded question types, no invented keys, server-side grading."""
from __future__ import annotations

import random
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from apps.core import vocabulary_answers, vocabulary_questions as vq
from apps.core.models import QuizMode
from apps.core.vocabulary_homework import expected_for, score_snapshot


def word(i, english, uzbek, sentence=None, synonyms=(), audio="", ipa=""):
    return SimpleNamespace(id=f"w{i}", english=english, uzbek=uzbek, context_sentence=sentence, part_of_speech="noun",
                           synonyms=list(synonyms), audio_url=audio, pronunciation=ipa)


WORDS = [
    word(1, "achievement", "yutuq", "Winning the prize was a great achievement for her.", ["accomplishment", "success"], "https://cdn.example/a.mp3", "/əˈtʃiːvmənt/"),
    word(2, "decline", "pasayish", "Sales saw a sharp decline last year.", ["decrease"]),
    word(3, "rapid", "tez", "No sentence with the word here."),
    word(4, "growth", "o'sish, rivojlanish"),
    word(5, "career", "kasb"),
]


class EligibilityTests(SimpleTestCase):
    def test_types_follow_the_data(self):
        self.assertEqual(vq.eligible_types(WORDS[0]), ["listen_choose", "listen_type", "fill_blank", "context_meaning", "synonym"])
        self.assertEqual(vq.eligible_types(WORDS[2]), ["listen_choose", "listen_type"])  # sentence lacks the word
        self.assertEqual(vq.eligible_types(WORDS[3]), ["listen_choose", "listen_type"])  # no sentence, no synonyms

    def test_blank_matches_whole_words_only(self):
        w = word(9, "art", "san'at", "The article mentions modern art.")
        self.assertEqual(vq.blanked_sentence(w), "The article mentions modern _____.")
        self.assertIsNone(vq.blanked_sentence(word(10, "art", "san'at", "An article about cars.")))

    def test_no_antonym_type_exists(self):
        self.assertNotIn("antonym", vq.NEW_TYPES)
        self.assertNotIn("antonym", QuizMode.values)


class BuildTests(SimpleTestCase):
    def test_listening_question_never_shows_the_word_or_ipa(self):
        q = vq.build_question(WORDS[0], "listen_type", WORDS, random.Random(1))
        self.assertEqual(q["prompt"], "")
        self.assertEqual(q["speak"], "achievement")
        self.assertIsNone(q["pronunciation"])
        self.assertEqual(q["audioUrl"], "https://cdn.example/a.mp3")

    def test_choice_options_have_exactly_one_correct_answer(self):
        rng = random.Random(7)
        for target in WORDS:
            for q_type in ("listen_choose",) + (("context_meaning",) if vq.blanked_sentence(target) else ()):
                q = vq.build_question(target, q_type, WORDS, rng)
                accepted = {vocabulary_answers.canon(a) for a in [expected_for(target, q), *vocabulary_answers.accepted_forms(target, q_type)]}
                self.assertEqual(sum(vocabulary_answers.canon(o) in accepted for o in q["options"]), 1, (target.english, q["options"]))
                self.assertEqual(len({vocabulary_answers.canon(o) for o in q["options"]}), len(q["options"]))

    def test_synonym_distractors_are_not_synonyms(self):
        extra = WORDS + [word(6, "success", "muvaffaqiyat")]  # also a listed synonym of achievement
        for seed in range(20):
            q = vq.build_question(WORDS[0], "synonym", extra, random.Random(seed))
            synonyms = {"accomplishment", "success"}
            self.assertEqual(sum(o in synonyms for o in q["options"]), 1, q["options"])
            self.assertNotIn("achievement", q["options"])

    def test_fill_blank_hides_the_word(self):
        q = vq.build_question(WORDS[1], "fill_blank", WORDS, random.Random(1))
        self.assertNotIn("decline", q["prompt"].lower())
        self.assertIn("_____", q["prompt"])

    def test_plan_falls_back_to_grounded_types(self):
        plan = vq.plan_types(WORDS, "synonym", random.Random(1))
        self.assertEqual(plan["w1"], "synonym")
        self.assertEqual(plan["w3"], "listen_choose")  # no synonyms, no usable sentence
        mixed = vq.plan_types(WORDS, "smart_mix", random.Random(1))
        self.assertTrue(all(mixed[w.id] in vq.eligible_types(w) for w in WORDS))


class GradingTests(SimpleTestCase):
    def snapshot(self, target, q_type):
        q = vq.build_question(target, q_type, WORDS, random.Random(3))
        with patch.object(vocabulary_answers, "approved_variants", return_value=[]):
            return [{"question": q, "english": target.english, "uzbek": target.uzbek, "expected": expected_for(target, q),
                     "accepted": vocabulary_answers.accepted_forms(target, q_type, [])}], q

    def test_server_grades_each_type_from_the_snapshot(self):
        cases = [
            ("listen_choose", WORDS[3], "rivojlanish", True),   # any listed translation
            ("listen_type", WORDS[0], "Achievement", True),
            ("listen_type", WORDS[0], "achievment", False),     # misspelling is wrong
            ("fill_blank", WORDS[1], "decline", True),
            ("context_meaning", WORDS[1], "pasayish", True),
            ("synonym", WORDS[0], "success", True),
            ("synonym", WORDS[0], "achievement", False),        # the word itself is not its synonym
        ]
        for q_type, target, answer, correct in cases:
            with self.subTest(q_type=q_type, answer=answer):
                snap, q = self.snapshot(target, q_type)
                _, wrong, score, total, _ = score_snapshot(snap, [{"wordId": target.id, "answer": answer, "type": q_type}])
                self.assertEqual(score == 1, correct)

    def test_variant_directions_map_to_existing_teacher_variants(self):
        self.assertEqual(vq.VARIANT_DIRECTION["listen_type"], "spelling")
        self.assertEqual(vq.VARIANT_DIRECTION["context_meaning"], "eng_uzb")
        self.assertEqual(vocabulary_answers.approved_variants("w1", "synonym"), [])


class AnswerLeakTests(SimpleTestCase):
    def test_context_sentence_and_audio_only_where_the_word_is_the_prompt(self):
        from apps.core.vocabulary_service import quiz_from_words
        vocab_set = SimpleNamespace(id="s1", title="Set", level="B1")
        for mode in ("uzb_eng", "spelling", "eng_uzb"):
            quiz = quiz_from_words(vocab_set, [WORDS[0], WORDS[1], WORDS[3]], mode)
            for q in quiz["questions"]:
                if q["type"] == "eng_uzb":
                    continue
                self.assertIsNone(q["contextSentence"], q)  # the sentence contains the English answer
                self.assertIsNone(q["audioUrl"])
                self.assertIsNone(q["pronunciation"])
        quiz = quiz_from_words(vocab_set, [WORDS[0]], "eng_uzb")
        self.assertEqual(quiz["questions"][0]["contextSentence"], WORDS[0].context_sentence)
        self.assertEqual(quiz["questions"][0]["audioUrl"], WORDS[0].audio_url)


class PinnedRevisionTests(SimpleTestCase):
    def test_words_pinned_before_learning_3_still_build_every_mode(self):
        """Homework pins a word snapshot; older pins have no audio/IPA/synonym fields."""
        from apps.core.vocabulary_service import quiz_from_words
        old = [SimpleNamespace(id=f"p{i}", english=e, uzbek=u, context_sentence=None, part_of_speech=None)
               for i, (e, u) in enumerate([("one", "bir"), ("two", "ikki"), ("three", "uch"), ("four", "to'rt")])]
        vocab_set = SimpleNamespace(id="s", title="T", level="B1")
        for mode in ("mixed", "eng_uzb", "uzb_eng", "spelling", "smart_mix", "listen_choose", "listen_type", "synonym"):
            with self.subTest(mode=mode):
                quiz = quiz_from_words(vocab_set, list(old), mode)
                self.assertEqual(len(quiz["questions"]), 4)
