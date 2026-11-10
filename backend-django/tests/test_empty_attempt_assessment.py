"""An attempt with no Writing/Speaking work must not queue AI/teacher assessment or wait for a grade."""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from apps.core import mock_submission_snapshots as snapshots
from apps.core.mock_submissions import has_evidence

SECTIONS = [
    {'skill': 'writing', 'groups': [{'id': 'gw', 'questions': [{'id': 'w1'}, {'id': 'w2'}]}]},
    {'skill': 'speaking', 'groups': [{'id': 'gs', 'questions': [{'id': 's1'}]}]},
    {'skill': 'listening', 'groups': [{'id': 'gl', 'questions': [{'id': 'l1'}]}]},
]


def answer(**fields):
    base = dict(response='', audio_key=None, rubric_scores=None)
    return SimpleNamespace(**{**base, **fields})


def run_enqueue(rows):
    """Run enqueue() over fake answers and return the skills it created jobs for."""
    created = []
    attempt = SimpleNamespace(id='a1', exam=SimpleNamespace(id='e1', assessment_policy=None, profile='full_mock'),
                              flow_mode='full_test', student_id='s1', media_state={})
    by_question = {question_id: row for question_id, row in rows.items()}
    fake_answers = [SimpleNamespace(question_id=qid, **vars(row)) for qid, row in by_question.items()]
    with patch.object(snapshots.MockAnswer.objects, 'filter', return_value=fake_answers), \
            patch.object(snapshots.MockQuestionGroup.objects, 'filter') as groups, \
            patch.object(snapshots, 'shape_exam', return_value={'sections': [dict(s, groups=[dict(g, questions=[dict(q) for q in g['questions']]) for g in s['groups']]) for s in SECTIONS]}), \
            patch.object(snapshots, 'scope_sections', side_effect=lambda _attempt, sections: sections), \
            patch.object(snapshots, 'is_partial', return_value=False), \
            patch.object(snapshots, 'build_input', side_effect=lambda exam, attempt, skill, *a, **k: dict(program='MULTILEVEL', skill=skill, parts=[], rubricVersion='r')), \
            patch.object(snapshots, 'canonical_checksum', return_value='hash'), \
            patch.object(snapshots, 'new_id', return_value='job'), \
            patch.object(snapshots.AssessmentJob.objects, 'get_or_create', side_effect=lambda **kw: created.append(kw['skill'])):
        groups.return_value.values_list.return_value = [('gw', None), ('gs', None), ('gl', None)]
        snapshots.enqueue(attempt)
    return created


class HasEvidenceTests(SimpleTestCase):
    def test_text_audio_and_handwriting_count_as_work(self):
        self.assertFalse(has_evidence('', None, None))
        self.assertFalse(has_evidence('   \n', None, {}))
        self.assertFalse(has_evidence(None, None, {'imageKeys': []}))
        self.assertTrue(has_evidence('My essay', None, None))
        self.assertTrue(has_evidence('', 'speaking/a.webm', None))
        self.assertTrue(has_evidence('', None, {'imageKeys': ['page1.jpg']}))
        self.assertTrue(has_evidence(None, None, {'imageUrls': ['u']}))


class EmptyAttemptEnqueueTests(SimpleTestCase):
    def test_no_work_queues_nothing(self):
        self.assertEqual(run_enqueue({'w1': answer(), 'w2': answer(response='  '), 's1': answer(), 'l1': answer(response='A')}), [])

    def test_only_the_skills_with_work_are_queued(self):
        self.assertEqual(run_enqueue({'w1': answer(response='Dear Sam, ...'), 's1': answer()}), ['writing'])
        self.assertEqual(run_enqueue({'w1': answer(), 's1': answer(audio_key='speaking/s1.webm')}), ['speaking'])
        self.assertEqual(run_enqueue({'w2': answer(rubric_scores={'imageKeys': ['p.jpg']})}), ['writing'])


class WithoutLevelTests(SimpleTestCase):
    def test_empty_attempt_keeps_raw_zeros_but_no_level(self):
        from apps.core.mock_submissions import without_level
        result = dict(status='completed', rawScores={'listening': {'score': 0, 'max': 35}}, sectionBands={'x': 1},
                      overallBand=3.0, cefrLevel='BELOW_B1', standardScores={'listening': {}}, overallScore=0.0)
        out = without_level(result)
        self.assertEqual(out['rawScores'], result['rawScores'])
        self.assertEqual(out['status'], 'completed')
        for key in ('sectionBands', 'overallBand', 'cefrLevel', 'standardScores', 'overallScore'):
            self.assertIsNone(out[key])

    def test_ielts_style_result_without_standard_scores_is_left_alone(self):
        from apps.core.mock_submissions import without_level
        self.assertNotIn('standardScores', without_level(dict(status='completed', rawScores={}, sectionBands=None, overallBand=None, cefrLevel=None)))
