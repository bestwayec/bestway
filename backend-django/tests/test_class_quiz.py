"""Pure logic of the classroom quiz engine (the database behaviour is in scripts/verify_class_quiz_postgres.py)."""
from __future__ import annotations

from django.test import SimpleTestCase

from apps.core import class_quiz as cq
from common.api.exceptions import ContractAPIException


def q(qtype, correct, options=(), variants=(), points=1):
    return dict(id='q', type=qtype, prompt='p', options=list(options), correctAnswers=list(correct), acceptedVariants=list(variants),
                explanation='', points=points)


class Grading(SimpleTestCase):
    def test_choice_questions_compare_the_option_index(self):
        mcq = q('mcq', [2], ['a', 'b', 'c', 'd'])
        self.assertTrue(cq.grade_response(mcq, '2')[0])
        self.assertFalse(cq.grade_response(mcq, '1')[0])
        self.assertFalse(cq.grade_response(mcq, None)[0])
        self.assertFalse(cq.grade_response(mcq, '')[0])

    def test_true_false(self):
        tf = q('tf', [0], ['True', 'False'])
        self.assertTrue(cq.grade_response(tf, '0')[0])
        self.assertFalse(cq.grade_response(tf, '1')[0])

    def test_text_accepts_approved_forms_after_sensible_normalisation(self):
        text = q('text', ['broken'], variants=['broke'])
        for accepted in ('broken', 'Broken', '  BROKEN  ', 'broken.', 'Broken!', 'broke'):
            self.assertTrue(cq.grade_response(text, accepted)[0], accepted)

    def test_text_is_not_fuzzy(self):
        text = q('text', ['broken'])
        for wrong in ('brokn', 'broker', 'break', 'broken window', 'b'):
            self.assertFalse(cq.grade_response(text, wrong)[0], wrong)

    def test_hyphen_and_article_variants_follow_the_existing_rules(self):
        text = q('text', ['well-known'])
        self.assertTrue(cq.grade_response(text, 'well known')[0])
        article = q('text', ['apple'])
        self.assertTrue(cq.grade_response(article, 'an apple')[0] or cq.grade_response(article, 'the apple')[0])

    def test_points_are_carried(self):
        self.assertEqual(cq.grade_response(q('mcq', [0], ['a', 'b'], points=3), '0'), (True, 3.0))


class Validation(SimpleTestCase):
    def code(self, data):
        with self.assertRaises(ContractAPIException) as caught:
            cq.validate_question(data)
        return caught.exception.contract_code

    def test_valid_shapes(self):
        self.assertEqual(cq.validate_question(dict(type='mcq', prompt='x', options=['a', 'b'], correctAnswers=['B']))['correct_answers'], [1])
        self.assertEqual(cq.validate_question(dict(type='mcq', prompt='x', options=['a', 'b'], correctAnswers=[0]))['correct_answers'], [0])
        self.assertEqual(cq.validate_question(dict(type='tf', prompt='x', correctAnswers=['false']))['correct_answers'], [1])
        self.assertEqual(cq.validate_question(dict(type='tf', prompt='x', correctAnswers=True))['correct_answers'], [0])
        text = cq.validate_question(dict(type='text', prompt='x', correctAnswers=['a', 'b'], acceptedVariants=['c']))
        self.assertEqual((text['correct_answers'], text['accepted_variants']), (['a', 'b'], ['c']))

    def test_rejections(self):
        bad = [
            dict(type='essay', prompt='x'),
            dict(type='mcq', prompt='', options=['a', 'b'], correctAnswers=[0]),
            dict(type='mcq', prompt='x', options=['a'], correctAnswers=[0]),
            dict(type='mcq', prompt='x', options=['a', 'b', 'c', 'd', 'e', 'f', 'g'], correctAnswers=[0]),
            dict(type='mcq', prompt='x', options=['a', 'A'], correctAnswers=[0]),
            dict(type='mcq', prompt='x', options=['a', 'b'], correctAnswers=[7]),
            dict(type='mcq', prompt='x', options=['a', 'b'], correctAnswers=[True]),
            dict(type='tf', prompt='x', correctAnswers=['maybe']),
            dict(type='text', prompt='x', correctAnswers=[]),
            dict(type='text', prompt='x', correctAnswers=['  ']),
            dict(type='text', prompt='x', correctAnswers=['a'] * 11),
            dict(type='text', prompt='x', correctAnswers=['a'], points=9),
            dict(type='text', prompt='x' * 2001, correctAnswers=['a']),
        ]
        for item in bad:
            self.assertEqual(self.code(item), 'VALIDATION_ERROR', item)

    def test_option_index(self):
        self.assertEqual([cq._option_index(v, 4) for v in (0, 3, 4, -1, 'a', 'D', 'e', '2', True, None)], [0, 3, None, None, 0, 3, None, 2, None, None])


class Parsing(SimpleTestCase):
    def test_answer_key_forms(self):
        self.assertEqual(cq.parse_answer_key('1 B, 2 A, 3 C'), {1: 'B', 2: 'A', 3: 'C'})
        self.assertEqual(cq.parse_answer_key('1. A\n2: true\n3) cold / cool'), {1: 'A', 2: 'true', 3: 'cold / cool'})
        self.assertEqual(cq.parse_answer_key(''), {})

    def test_csv_formula_neutralised(self):
        for hostile in ('=SUM(A1)', '+1', '-1', '@x'):
            self.assertTrue(cq._csv_safe(hostile).startswith("'"))
        self.assertEqual(cq._csv_safe('Aziza'), 'Aziza')

    def test_public_question_has_no_key(self):
        public = cq._public_question(dict(id='1', type='mcq', prompt='p', options=['a'], correctAnswers=[0], explanation='e', points=1))
        self.assertEqual(set(public), {'id', 'type', 'prompt', 'options', 'points'})
