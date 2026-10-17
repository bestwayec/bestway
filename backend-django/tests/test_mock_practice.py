from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase
from rest_framework.test import APIClient

from apps.core import mock_attempts
from apps.core.mock_practice import SCOPE_KEY, scope, scope_sections, task_scope
from apps.core.multilevel import CURRENT_SPEC, V1_SPEC


def question(id, kind='speaking_task', prompt='Describe your hometown.'):
    return dict(id=id, type=kind, prompt=prompt, points=5, options=[], correctAnswers=[], acceptedVariants=[])


def tree():
    return dict(type='multilevel', specificationVersion=CURRENT_SPEC, sections=[
        dict(skill='listening', groups=[dict(questions=[])]),
        dict(skill='writing', groups=[dict(maxScore=5, questions=[question('w1', 'essay_task1', 'Write an email to a friend.')])]),
        dict(skill='speaking', groups=[
            dict(maxScore=5, sortOrder=0, questions=[question('s1'), question('s2'), question('s3')]),
            dict(maxScore=5, sortOrder=1, questions=[question('s4', prompt='Compare the pictures.')]),
        ]),
    ])


class PartialPracticeTests(SimpleTestCase):
    def test_authored_tasks_available_without_fake_full_readiness(self):
        value = task_scope(tree(), lambda key: True)
        self.assertEqual(value, dict(skills=['writing', 'speaking'], questionIds=['w1', 's1', 's2', 's3']))
        # Picture-dependent part is unavailable even though its prompt exists.
        self.assertNotIn('s4', value['questionIds'])

    def test_missing_referenced_media_and_unwritten_tasks_are_omitted(self):
        definition = tree()
        definition['sections'][1]['groups'][0]['imageKey'] = 'missing.png'
        definition['sections'][2]['groups'][0]['questions'][1]['prompt'] = ' '
        definition['sections'][2]['groups'][0]['questions'][2]['correctAnswers'] = ['secret']
        self.assertEqual(task_scope(definition, lambda key: False), dict(skills=['speaking'], questionIds=['s1']))

    def test_placeholder_prompts_are_never_practice_tasks(self):
        definition = tree()
        definition['sections'][1]['groups'][0]['questions'][0]['prompt'] = 'REPLACE — sample prompt'
        self.assertNotIn('writing', task_scope(definition, lambda key: True)['skills'])

    def test_legacy_nine_point_questions_use_the_authored_group_rubric(self):
        definition = tree()
        for section in definition['sections']:
            for group in section['groups']:
                for q in group['questions']:
                    q['points'] = 9
        self.assertEqual(task_scope(definition, lambda key: True)['questionIds'], ['w1', 's1', 's2', 's3'])

    def test_versioned_and_ielts_boundaries(self):
        for version in (CURRENT_SPEC, V1_SPEC):
            definition = tree()
            definition['specificationVersion'] = version
            self.assertTrue(task_scope(definition, lambda key: True)['questionIds'])
        # IELTS is supported for authored tasks
        definition = tree()
        definition['type'] = 'ielts_academic'
        self.assertTrue(task_scope(definition, lambda key: True)['questionIds'])
        # Unsupported specification or type fails closed
        for key, value in [('type', 'unsupported_type'), ('specificationVersion', 'unsupported')]:
            definition = tree()
            definition[key] = value
            self.assertEqual(task_scope(definition, lambda key: True), dict(skills=[], questionIds=[]))

    def test_scope_preserves_part_identity_and_inputs(self):
        sections = tree()['sections']
        before = deepcopy(sections)
        attempt = SimpleNamespace(flow_mode='partial_practice', media_state={SCOPE_KEY: dict(version=1, skills=['speaking'], questionIds=['s4'])})
        selected = scope_sections(attempt, sections)
        self.assertEqual([s['skill'] for s in selected], ['speaking'])
        self.assertEqual(selected[0]['groups'][0]['sourcePartIndex'], 1)
        self.assertEqual(sections, before)

    def test_corrupt_scope_fails_closed_and_legacy_is_unchanged(self):
        sections = tree()['sections']
        self.assertIsNone(scope(SimpleNamespace(flow_mode=None)))
        self.assertIs(scope_sections(SimpleNamespace(flow_mode=None), sections), sections)
        attempt = SimpleNamespace(flow_mode='partial_practice', media_state={})
        self.assertEqual(scope_sections(attempt, sections), [])

    def test_out_of_scope_question_ids_never_reach_the_orm_lookup(self):
        attempt = SimpleNamespace(flow_mode='partial_practice', media_state={SCOPE_KEY: dict(version=1, skills=['writing'], questionIds=['w1'])}, exam_id='e')
        with patch.object(mock_attempts.MockQuestion.objects, 'filter') as rows:
            rows.return_value.select_related.return_value = []
            mock_attempts.questions(attempt, ['s1', 'w1'])
            self.assertEqual(rows.call_args.kwargs['id__in'], ['w1'])

    def test_start_boundary_rejects_timed_duplicate_or_objective_skill_scope(self):
        client = APIClient()
        client.force_authenticate(SimpleNamespace(role='student', id='s', is_authenticated=True))
        for payload in [dict(mode='practice', skills=['writing', 'writing']),
                        dict(mode='practice', skills=[]),
                        dict(mode='practice', skills=['unknown_skill']),
                        dict(mode='practice', flow='full_test', skills=['speaking'])]:
            response = client.post('/v1/mock/exams/e/start', payload, format='json')
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.data['error']['code'], 'VALIDATION_ERROR')
        with patch.object(mock_attempts, 'start', return_value=dict(attemptId='a', flowMode='partial_practice')) as starter:
            for payload in [dict(mode='timed', skills=['writing']), dict(mode='practice', skills=['listening']),
                            dict(mode='timed', skills=['reading', 'listening'])]:
                response = client.post('/v1/mock/exams/e/start', payload, format='json')
                self.assertEqual(response.status_code, 201)
                self.assertTrue(response.data['success'])
