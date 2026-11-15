"""Owner decision 2026-11-14: IELTS sections are numbered from 1, display only."""
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from apps.core import mock_authoring
from apps.core.question_numbering import apply_display_numbers
from common.api.exceptions import ContractAPIException


def sections(numbers_by_section):
    return [dict(skill=skill, groups=[dict(questions=[dict(id=f'{skill}-{n}', number=n) for n in part]) for part in parts])
            for skill, parts in numbers_by_section]


class DisplayNumberTests(SimpleTestCase):
    def test_ielts_sections_restart_at_one_whatever_was_stored(self):
        shaped = sections([('listening', [[1, 2], [3]]), ('reading', [[41, 42], [43, 44]])])
        apply_display_numbers('ielts_academic', shaped)
        self.assertEqual([q['displayNumber'] for g in shaped[0]['groups'] for q in g['questions']], [1, 2, 3])
        self.assertEqual([q['displayNumber'] for g in shaped[1]['groups'] for q in g['questions']], [1, 2, 3, 4])
        # Stored numbers and ids are untouched (gap markers, answer keys and scoring keep using them).
        self.assertEqual([q['number'] for g in shaped[1]['groups'] for q in g['questions']], [41, 42, 43, 44])
        self.assertEqual(shaped[1]['groups'][0]['questions'][0]['id'], 'reading-41')

    def test_multilevel_keeps_its_stored_numbers(self):
        shaped = sections([('listening', [[1, 2]]), ('reading', [[1, 2]])])
        apply_display_numbers('multilevel', shaped)
        self.assertEqual([q['displayNumber'] for s in shaped for g in s['groups'] for q in g['questions']], [1, 2, 1, 2])


class NumberUniquenessTests(SimpleTestCase):
    def check(self, exam_type, used_in_section):
        exam = SimpleNamespace(id='e', type=exam_type)
        with patch.object(mock_authoring.MockQuestion, 'objects') as questions:
            scoped = questions.filter.return_value.filter.return_value
            scoped.values_list.return_value = used_in_section
            mock_authoring._assert_numbers(exam, 'reading', [{'number': 1}, {'number': 2}])
            return questions.filter.return_value.filter.call_args

    def test_ielts_reading_may_reuse_listening_numbers(self):
        call = self.check('ielts_academic', [])
        self.assertEqual(call.kwargs, {'group__section__skill': 'reading'})

    def test_a_number_used_twice_in_one_section_is_still_refused(self):
        with self.assertRaises(ContractAPIException):
            self.check('ielts_academic', [2])
