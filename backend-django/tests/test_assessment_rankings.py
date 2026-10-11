from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import patch
from django.test import SimpleTestCase
from rest_framework.test import APIClient
from apps.core import assessment_rankings as ranking
from apps.core.mock_practice import SCOPE_KEY
from common.api.exceptions import ContractAPIException


def scope_fixture():
    attempt = SimpleNamespace(exam_id='exam', specification_version='V2', flow_mode='partial_practice',
        media_state={SCOPE_KEY: dict(version=1, skills=['writing', 'speaking'], questionIds=['w1', 's1'])})
    job = SimpleNamespace(program='MULTILEVEL', skill='writing', rubric_version='rubric1', prompt_version='prompt2',
        input_snapshot=dict(program='MULTILEVEL', skill='writing', practiceMode='PARTIAL',
            specificationVersion='V2', rubricVersion='rubric1', promptVersion='prompt2',
            gradingPolicy=dict(id='BESTWAY_INTERNAL_PRACTICE_35_50_V1'),
            parts=[dict(id='informal_email', max=5, responses=[dict(questionId='w1', originalResponse='Private work')])]))
    return attempt, job


class CohortTests(SimpleTestCase):
    def test_candidate_work_and_other_selected_skill_do_not_split_writing_cohort(self):
        attempt, job = scope_fixture(); before = ranking.cohort_scope(attempt, job)
        self.assertIsNotNone(before)
        job.input_snapshot['parts'][0]['responses'][0].update(originalResponse='Different work', audioHash='private')
        attempt.media_state[SCOPE_KEY]['questionIds'].append('another-speaking-question')
        after = ranking.cohort_scope(attempt, job)
        self.assertEqual(before, after)
        self.assertNotIn('Private work', str(before)); self.assertNotIn('audioHash', str(after))

    def test_exact_tasks_maxima_rubric_and_grading_policy_split_cohorts(self):
        attempt, original = scope_fixture(); before = ranking.cohort_scope(attempt, original)['id']
        for change in ('question', 'maximum', 'rubric', 'policy', 'authored_prompt'):
            with self.subTest(change=change):
                job = deepcopy(original)
                if change == 'question':
                    job.input_snapshot['parts'][0]['responses'][0]['questionId'] = 's1'
                elif change == 'maximum': job.input_snapshot['parts'][0]['max'] = 6
                elif change == 'rubric':
                    job.rubric_version = 'rubric2'; job.input_snapshot['rubricVersion'] = 'rubric2'
                elif change == 'authored_prompt': job.input_snapshot['parts'][0]['responses'][0]['prompt'] = 'A changed authored question'
                else: job.input_snapshot['gradingPolicy']['id'] = 'old-policy'
                self.assertNotEqual(before, ranking.cohort_scope(attempt, job)['id'])

    def test_corrupt_or_growing_scope_and_mismatched_identity_are_rejected(self):
        for change in ('unfrozen', 'duplicate', 'wrong_skill', 'wrong_spec', 'missing_parts', 'negative_max', 'full_snapshot'):
            with self.subTest(change=change):
                attempt, job = scope_fixture()
                if change == 'unfrozen': job.input_snapshot['parts'][0]['responses'][0]['questionId'] = 'foreign'
                elif change == 'duplicate': job.input_snapshot['parts'][0]['responses'] *= 2
                elif change == 'wrong_skill': job.input_snapshot['skill'] = 'speaking'
                elif change == 'wrong_spec': job.input_snapshot['specificationVersion'] = 'V1'
                elif change == 'missing_parts': job.input_snapshot['parts'] = []
                elif change == 'negative_max': job.input_snapshot['parts'][0]['max'] = -1
                else: job.input_snapshot.pop('practiceMode')
                self.assertIsNone(ranking.cohort_scope(attempt, job))

    def test_competition_ties_exclude_pending_low_confidence_and_null(self):
        def row(id, score, eligible=True):
            return dict(studentId=id, name=id, aiScore=score, eligible=eligible, rank=None)
        rows = ranking.ranked_rows([row('pending', None), row('c', 42), row('b', 48), row('a', 48), row('review', 50, False)])
        self.assertEqual([(r['studentId'], r['rank']) for r in rows], [('a', 1), ('b', 1), ('c', 3), ('pending', None), ('review', None)])


class AccessTests(SimpleTestCase):
    def test_student_parent_rejected_before_group_query(self):
        for role in ('student', 'parent'):
            with patch.object(ranking.Group, 'objects') as groups:
                with self.assertRaises(ContractAPIException):
                    ranking.rankings(SimpleNamespace(role=role, id='user'), 'group')
                groups.filter.assert_not_called()

    def test_unassigned_teacher_rejected_before_roster_query(self):
        with patch.object(ranking.Group, 'objects') as groups, patch.object(ranking.StudentProfile, 'objects') as students:
            groups.filter.return_value.first.return_value = SimpleNamespace(id='group', teacher_id='owner')
            with self.assertRaises(ContractAPIException):
                ranking.rankings(SimpleNamespace(role='teacher', id='other'), 'group')
            students.filter.assert_not_called()

    def test_endpoint_rejects_unknown_query_and_non_writing_speaking_skill(self):
        actor = SimpleNamespace(role='teacher', id='teacher', is_authenticated=True)
        client = APIClient(); client.force_authenticate(user=actor)
        with patch.object(ranking, 'rankings') as service:
            for query in ('?studentId=foreign', '?skill=listening', '?examId='):
                self.assertEqual(client.get('/v1/assessment/groups/group/rankings'+query).status_code, 400)
            service.assert_not_called()

    def test_endpoint_does_not_allow_student_roster_access(self):
        actor = SimpleNamespace(role='student', id='student', is_authenticated=True)
        client = APIClient(); client.force_authenticate(user=actor)
        with patch.object(ranking, 'rankings') as service:
            self.assertEqual(client.get('/v1/assessment/groups/group/rankings').status_code, 403)
            service.assert_not_called()
