"""Tests for live monitoring endpoint and partial practice scoring."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock, patch
from django.test import SimpleTestCase
from rest_framework.test import APIClient
from apps.core import mock_scoring
from apps.core.multilevel import CURRENT_SPEC


class LiveMonitoringTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()

    def test_anonymous_access_denied(self):
        response = self.client.get('/v1/assessment/groups/g1/live-monitoring')
        self.assertEqual(response.status_code, 401)

    def test_student_role_denied(self):
        self.client.force_authenticate(SimpleNamespace(id='s1', role='student', is_authenticated=True))
        response = self.client.get('/v1/assessment/groups/g1/live-monitoring')
        self.assertEqual(response.status_code, 403)

    def test_group_not_found_returns_404(self):
        self.client.force_authenticate(SimpleNamespace(id='t1', role='teacher', is_authenticated=True))
        with patch('apps.legacy_schema.models.Group.objects') as groups:
            groups.filter.return_value.first.return_value = None
            response = self.client.get('/v1/assessment/groups/g1/live-monitoring')
            self.assertEqual(response.status_code, 404)
            self.assertEqual(response.data['error']['code'], 'GROUP_NOT_FOUND')

    def test_teacher_forbidden_if_not_group_owner(self):
        self.client.force_authenticate(SimpleNamespace(id='t1', role='teacher', is_authenticated=True))
        with patch('apps.legacy_schema.models.Group.objects') as groups:
            groups.filter.return_value.first.return_value = SimpleNamespace(id='g1', teacher_id='other_teacher')
            response = self.client.get('/v1/assessment/groups/g1/live-monitoring')
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.data['error']['code'], 'FORBIDDEN')

    def test_teacher_owner_success_with_active_and_inactive_students(self):
        self.client.force_authenticate(SimpleNamespace(id='t1', role='teacher', is_authenticated=True))
        now = datetime(2026, 10, 13, 12, 0, 0, tzinfo=timezone.utc)
        group = SimpleNamespace(id='g1', teacher_id='t1')

        student1 = SimpleNamespace(
            user_id='u1',
            user=SimpleNamespace(name='Alisher Navoiy', phone='+998901234567')
        )
        student2 = SimpleNamespace(
            user_id='u2',
            user=SimpleNamespace(name='Bobur Mirzo', phone='+998907654321')
        )

        active_attempt = SimpleNamespace(
            id='att1',
            exam_id='ex1',
            exam=SimpleNamespace(title='Multilevel Mock Exam 1'),
            status='in_progress',
            mode='timed',
            current_skill='writing',
            started_at=now - timedelta(minutes=30),
            anti_cheat_count=2,
        )

        cheat_events = [
            SimpleNamespace(id='ce1', event='TAB_SWITCH', created_at=now - timedelta(minutes=10)),
            SimpleNamespace(id='ce2', event='FULLSCREEN_EXIT', created_at=now - timedelta(minutes=5)),
        ]

        with patch('apps.legacy_schema.models.Group.objects') as groups, \
             patch('apps.legacy_schema.models.StudentProfile.objects') as student_profiles, \
             patch('apps.legacy_schema.models.MockAttempt.objects') as attempts, \
             patch('apps.legacy_schema.models.MockCheatEvent.objects') as cheat_model:

            groups.filter.return_value.first.return_value = group
            student_profiles.filter.return_value.select_related.return_value.order_by.return_value = [student1, student2]

            def attempt_filter(**kwargs):
                query = Mock()
                student_id = kwargs.get('student_id')
                status_in = kwargs.get('status__in')
                if student_id == 'u1' and status_in:
                    query.select_related.return_value.order_by.return_value.first.return_value = active_attempt
                else:
                    query.select_related.return_value.order_by.return_value.first.return_value = None
                return query

            attempts.filter.side_effect = attempt_filter
            cheat_model.filter.return_value.order_by.return_value = cheat_events

            response = self.client.get('/v1/assessment/groups/g1/live-monitoring')
            self.assertEqual(response.status_code, 200)
            data = response.data['data']
            self.assertEqual(data['groupId'], 'g1')
            self.assertEqual(len(data['students']), 2)

            s1_data = data['students'][0]
            self.assertEqual(s1_data['studentId'], 'u1')
            self.assertEqual(s1_data['name'], 'Alisher Navoiy')
            self.assertIsNotNone(s1_data['activeAttempt'])
            self.assertEqual(s1_data['activeAttempt']['attemptId'], 'att1')
            self.assertEqual(s1_data['activeAttempt']['antiCheatCount'], 2)
            self.assertTrue(s1_data['activeAttempt']['isFlagged'])
            self.assertEqual(len(s1_data['activeAttempt']['recentAnomalies']), 2)

            s2_data = data['students'][1]
            self.assertEqual(s2_data['studentId'], 'u2')
            self.assertIsNone(s2_data['activeAttempt'])

    def test_admin_can_monitor_any_group(self):
        self.client.force_authenticate(SimpleNamespace(id='adm', role='admin', is_authenticated=True))
        group = SimpleNamespace(id='g2', teacher_id='any_teacher')
        with patch('apps.legacy_schema.models.Group.objects') as groups, \
             patch('apps.legacy_schema.models.StudentProfile.objects') as student_profiles:
            groups.filter.return_value.first.return_value = group
            student_profiles.filter.return_value.select_related.return_value.order_by.return_value = []
            response = self.client.get('/v1/assessment/groups/g2/live-monitoring')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.data['data']['students'], [])


class SingleSkillScoringTests(SimpleTestCase):
    def test_multilevel_partial_practice_scoring_preserves_standard_scores_with_level(self):
        sections = [
            dict(
                skill='writing',
                groups=[
                    dict(
                        id='g1',
                        maxScore=16,
                        questions=[
                            dict(id='q1', type='essay_task1', points=16, options=[], correctAnswers=[]),
                        ]
                    )
                ]
            )
        ]
        answers = {
            'q1': dict(response='My written essay', isGraded=True, score=8.0)
        }

        raw_result, _ = mock_scoring.calculate('multilevel', sections, answers, versioned=True)
        result = mock_scoring.partial_result(raw_result)

        # Writing raw score 8.0 -> convert_expert('writing', 8.0) = WRITING[16] = 47 -> level B1
        self.assertIn('writing', result['standardScores'])
        self.assertEqual(result['standardScores']['writing']['rawScore'], 8.0)
        self.assertEqual(result['standardScores']['writing']['estimatedStandardScore'], 47)
        self.assertEqual(result['standardScores']['writing']['level'], 'B1')
        self.assertEqual(result['standardScores']['writing']['cefrLevel'], 'B1')
        # Overall score and band must remain None for partial practice
        self.assertIsNone(result['overallScore'])
        self.assertIsNone(result['overallBand'])
        self.assertIsNone(result['cefrLevel'])
        self.assertEqual(result['scoreMethod'], 'PRACTICE_PARTIAL')
