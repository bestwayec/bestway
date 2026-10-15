from types import SimpleNamespace
from unittest.mock import patch
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient
from apps.core.views import desktop_version
from apps.core.assessment_results import format_diagnostic_feedback
from apps.core import mock_attempts


class SingleSkillAndDesktopVersionTests(SimpleTestCase):
    def test_desktop_version_returns_0_5_6(self):
        client = APIClient()
        response = client.get('/v1/desktop-version')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['data']['version'], '0.5.6')
        self.assertIn('0.5.6', response.data['data']['downloadUrl'])

    def test_format_diagnostic_feedback_structures_all_fields(self):
        raw_result = {
            'parts': [
                {
                    'id': 'task1',
                    'rawScore': 7.0,
                    'criteria': {'ta': 7.0, 'cc': 6.5, 'lr': 6.5, 'gra': 6.0},
                    'evidence': {
                        'ta': 'Well covered the prompt.',
                        'cc': 'Logical progression.',
                        'lr': 'Sufficient range.',
                        'gra': 'Frequent error-free sentences.'
                    },
                    'feedback': {'taskCoverage': 'Good coverage', 'register': 'Formal tone'}
                }
            ],
            'grammarCorrections': [
                {
                    'original': 'People is going.',
                    'corrected': 'People are progressing.',
                    'explanation': 'Subject-verb agreement.'
                }
            ],
            'vocabularyUpgrades': [
                {
                    'original': 'big change',
                    'alternative': 'substantial transformation',
                    'explanation': 'C1 academic synonym.'
                }
            ],
            'priorityImprovements': ['Diversify complex transitions.'],
            'recommendedPractice': ['Read academic journal abstracts.'],
            'improvedExamples': [
                {'partId': 'task1', 'text': 'It is often argued that modern advancements have significantly influenced society.'}
            ],
            'confidence': 0.95,
            'pronunciationEvidence': 'UNAVAILABLE'
        }
        feedback = format_diagnostic_feedback(raw_result)
        self.assertIsNotNone(feedback)
        self.assertEqual(len(feedback['criteria_scores']), 4)
        self.assertEqual(feedback['criteria_scores'][0]['criterion'], 'Task Achievement / Response')
        self.assertEqual(feedback['criteria_scores'][0]['score'], 7.0)
        self.assertEqual(len(feedback['mistakes_and_fixes']), 1)
        self.assertEqual(feedback['mistakes_and_fixes'][0]['original'], 'People is going.')
        self.assertEqual(feedback['mistakes_and_fixes'][0]['corrected'], 'People are progressing.')
        self.assertEqual(len(feedback['vocabulary_upgrades']), 1)
        self.assertEqual(feedback['vocabulary_upgrades'][0]['alternative'], 'substantial transformation')
        self.assertIn('Diversify complex transitions.', feedback['action_plan'])
        self.assertIn('It is often argued', feedback['band_8_rewrite'])

    def test_start_view_accepts_skill_and_section_filter_query_and_body(self):
        client = APIClient()
        client.force_authenticate(SimpleNamespace(role='student', id='s', is_authenticated=True))
        with patch.object(mock_attempts, 'start', return_value={'attemptId': 'att-1', 'flowMode': 'single_skill'}) as mock_start:
            # Query param
            resp = client.post('/v1/mock/exams/exam-123/start?skill=writing', {}, format='json')
            self.assertEqual(resp.status_code, 201)
            self.assertEqual(mock_start.call_args.args[2]['skills'], ['writing'])
            self.assertEqual(mock_start.call_args.args[2]['flow'], 'single_skill')

            # Body section_filter
            resp2 = client.post('/v1/mock/exams/exam-123/start', {'section_filter': 'reading'}, format='json')
            self.assertEqual(resp2.status_code, 201)
            self.assertEqual(mock_start.call_args.args[2]['skills'], ['reading'])
            self.assertEqual(mock_start.call_args.args[2]['flow'], 'single_skill')
