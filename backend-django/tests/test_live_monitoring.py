"""Tests for live monitoring endpoint and partial practice scoring."""
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from apps.core import mock_scoring


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
        now = datetime(2026, 10, 13, 12, 0, 0, tzinfo=UTC)
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
        self.assertEqual(result['standardScores']['writing']['level'], 'B2')
        self.assertEqual(result['standardScores']['writing']['cefrLevel'], 'B2')
        # Overall score and band must remain None for partial practice
        self.assertIsNone(result['overallScore'])
        self.assertIsNone(result['overallBand'])
        self.assertIsNone(result['cefrLevel'])
        self.assertEqual(result['scoreMethod'], 'PRACTICE_PARTIAL')


class LiveProctoringTelemetryTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_telemetry_anonymous_denied(self):
        response = self.client.post('/v1/live-room/telemetry', {})
        self.assertEqual(response.status_code, 401)

    def test_telemetry_normal_heartbeat_returns_continue(self):
        self.client.force_authenticate(SimpleNamespace(id='s1', role='student', is_authenticated=True))
        with patch('django.db.connection.cursor') as mock_cursor:
            cursor = Mock()
            mock_cursor.return_value.__enter__.return_value = cursor
            # Session select returns room row
            cursor.fetchone.side_effect = [
                ('room-1', 'active'),  # session lookup by pin
                ('part-1', 'room-1', 'in_progress', 0, 0, 'att-1'),  # participant lookup
            ]
            response = self.client.post('/v1/live-room/telemetry', {
                'room_pin': '123456',
                'current_question': 12,
                'current_section': 'reading',
                'time_remaining': 2400,
                'strikes_count': 0,
                'is_focused': True,
            })
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.data['success'])
            self.assertEqual(response.data['data']['action'], 'continue')
            self.assertEqual(response.data['data']['strikesCount'], 0)

    def test_telemetry_three_strikes_triggers_disqualification(self):
        self.client.force_authenticate(SimpleNamespace(id='s1', role='student', is_authenticated=True))
        with patch('django.db.connection.cursor') as mock_cursor,              patch('apps.legacy_schema.models.MockAttempt.objects.filter') as mock_att_filter:
            cursor = Mock()
            mock_cursor.return_value.__enter__.return_value = cursor
            cursor.fetchone.side_effect = [
                ('room-1', 'active'),  # session lookup
                ('part-1', 'room-1', 'in_progress', 2, 2, 'att-1'),  # participant has 2 strikes
            ]
            mock_att_filter.return_value.update.return_value = 1
            response = self.client.post('/v1/live-room/telemetry', {
                'room_pin': '123456',
                'current_question': 14,
                'strikes_count': 3,
                'is_focused': False,
            })
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.data['success'])
            self.assertEqual(response.data['data']['action'], 'disqualified')
            self.assertEqual(response.data['data']['status'], 'disqualified')
            self.assertEqual(response.data['data']['strikesCount'], 3)

    def test_proctor_action_student_denied(self):
        self.client.force_authenticate(SimpleNamespace(id='s1', role='student', is_authenticated=True))
        response = self.client.post('/v1/live-room/123456/action', {'action': 'start_exam'})
        self.assertEqual(response.status_code, 403)

    def test_proctor_action_teacher_disqualify_student(self):
        self.client.force_authenticate(SimpleNamespace(id='t1', role='teacher', is_authenticated=True))
        with patch('apps.core.live_exam_service.get_session_detail') as mock_session,              patch('django.db.connection.cursor') as mock_cursor,              patch('apps.legacy_schema.models.MockAttempt.objects.filter') as mock_att_filter:
            mock_session.return_value = {
                'id': 'room-1',
                'pin': '123456',
                'teacherId': 't1',
                'status': 'active',
                'examTitle': 'IELTS Mock 1',
                'examType': 'ielts_academic',
                'simulatorMode': 'cdi',
                'durationMinutes': 60,
            }
            cursor = Mock()
            mock_cursor.return_value.__enter__.return_value = cursor
            cursor.fetchone.return_value = ('att-1',)  # RETURNING attempt_id
            mock_att_filter.return_value.update.return_value = 1

            response = self.client.post('/v1/live-room/123456/action', {
                'action': 'disqualify_student',
                'student_id': 's1',
            })
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.data['success'])
            self.assertEqual(response.data['data']['action'], 'disqualify_student')
            self.assertEqual(response.data['data']['studentId'], 's1')
    def test_proctor_action_teacher_extend_time(self):
        self.client.force_authenticate(SimpleNamespace(id='t1', role='teacher', is_authenticated=True))
        with patch('apps.core.live_exam_service.get_session_detail') as mock_session,              patch('django.db.connection.cursor') as mock_cursor:
            mock_session.return_value = {
                'id': 'room-1',
                'pin': '123456',
                'teacherId': 't1',
                'status': 'active',
                'examTitle': 'IELTS Mock 1',
                'examType': 'ielts_academic',
                'simulatorMode': 'cdi',
                'durationMinutes': 60,
            }
            cursor = Mock()
            mock_cursor.return_value.__enter__.return_value = cursor

            response = self.client.post('/v1/live-room/123456/action', {
                'action': 'extend_time',
                'minutes': 10,
            })
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.data['success'])
            self.assertEqual(response.data['data']['action'], 'extend_time')
            self.assertEqual(response.data['data']['minutes'], 10)

