"""Partial practice must never become an overall score, level or trend, and
practice content must keep every authored Listening part."""
from types import SimpleNamespace

from django.test import SimpleTestCase

from apps.core import prediction_service
from apps.core.mock_practice import SCOPE_KEY, task_scope
from apps.core.mock_rules import objective_question_issues


class FullExamEligibilityTests(SimpleTestCase):
    def test_partial_and_single_skill_attempts_are_not_full_exams(self):
        partial = SimpleNamespace(flow_mode='partial_practice', media_state={SCOPE_KEY: {'version': 1, 'skills': ['listening'], 'questionIds': []}})
        single = SimpleNamespace(flow_mode='single_skill', media_state=None)
        full = SimpleNamespace(flow_mode='full_test', media_state=None)
        self.assertFalse(prediction_service.is_full_exam_attempt(partial))
        self.assertFalse(prediction_service.is_full_exam_attempt(single))
        self.assertTrue(prediction_service.is_full_exam_attempt(full))


class SpokenStemTests(SimpleTestCase):
    def q(self, **extra):
        return dict(type='multiple_choice', prompt='', options=['A  Me too.', 'B  Can you?', 'C  Sure.'],
                    correctAnswers=['C'], acceptedVariants=[], points=1, **extra)

    def test_listening_choice_item_may_have_a_spoken_only_stem(self):
        self.assertEqual(objective_question_issues(self.q(), True, audio_stem=True), [])

    def test_reading_or_text_item_still_requires_a_written_prompt(self):
        self.assertIn('question prompt is missing', objective_question_issues(self.q(), True))
        text = dict(type='note_completion', prompt='', correctAnswers=['lake'], points=1)
        self.assertIn('question prompt is missing', objective_question_issues(text, True, audio_stem=True))


class ListeningPartOneKeptTests(SimpleTestCase):
    def test_practice_scope_keeps_listening_part_one(self):
        from apps.core.multilevel import CURRENT_SPEC, SPECS
        parts = SPECS[CURRENT_SPEC]['listening']['parts']
        groups = []
        number = 1
        for index, (_part, count, types, maximum) in enumerate(parts):
            questions = []
            for _ in range(count):
                if types[0] == 'multiple_choice':
                    q = dict(type='multiple_choice', prompt='' if index == 0 else f'Q{number}', options=['A x', 'B y', 'C z'], correctAnswers=['A'])
                elif types[0] == 'matching':
                    q = dict(type='matching', prompt=f'Q{number}', options=[f'{c} opt{c}' for c in 'ABCDEFGH'], correctAnswers=['A'])
                else:
                    q = dict(type=types[-1], prompt=f'Gap {number}', correctAnswers=['word'])
                q.update(id=f'q{number}', number=number, points=1)
                questions.append(q)
                number += 1
            groups.append(dict(id=f'g{index}', audioKey=f'a{index}.wav', imageKey='map.png' if index == 3 else None,
                               maxScore=maximum, title=f'Part {index + 1}', questions=questions))
        tree = dict(type='multilevel', specificationVersion=CURRENT_SPEC, sections=[dict(skill='listening', groups=groups)])
        plan = task_scope(tree, lambda _key: True)
        self.assertIn('listening', plan['skills'])
        self.assertEqual(len(plan['questionIds']), 35)
        self.assertEqual(plan['questionIds'][:8], [f'q{n}' for n in range(1, 9)])
