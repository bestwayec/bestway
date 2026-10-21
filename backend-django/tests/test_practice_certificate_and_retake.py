"""Tests for practice certificate generation (ReportLab) and retake / scope conflict resolution."""
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, TestCase
from apps.core import mock_certificate, mock_support
from apps.core import mock_attempts as engine
from apps.core.mock_attempt_views import student as student_guard


class PracticeCertificateReportLabTests(SimpleTestCase):
    def test_multilevel_partial_practice_pdf_generation(self):
        data = {
            'studentName': 'Komiljon Roziyev',
            'examTitle': 'Multi-Level Mock Test 1 (Writing & Speaking)',
            'examType': 'multilevel',
            'level': 'B2-C1',
            'isIelts': False,
            'finishedAt': datetime(2026, 10, 21, 15, 30, tzinfo=UTC),
            'attemptId': '23a26801-4387-4a12-90c8-9a2db8125eb1',
            'sections': [
                {
                    'skill': 'speaking',
                    'score': 37.9,
                    'max': 75.0,
                    'band': 5.5,
                    'standardScore': 37.9,
                }
            ],
            'overallBand': None,
            'overallScore': 37.9,
            'specificationVersion': '2024.1',
            'cefrLevel': 'B1',
            'isPartial': True,
        }
        pdf_bytes = mock_certificate.generate(data)
        self.assertIsInstance(pdf_bytes, bytes)
        self.assertTrue(len(pdf_bytes) > 2000)
        self.assertTrue(pdf_bytes.startswith(b'%PDF'))

    def test_ielts_partial_practice_pdf_generation(self):
        data = {
            'studentName': 'Komiljon Roziyev',
            'examTitle': 'IELTS Academic Practice Exam',
            'examType': 'ielts_academic',
            'level': 'Academic',
            'isIelts': True,
            'finishedAt': datetime(2026, 10, 21, 15, 30, tzinfo=UTC),
            'attemptId': '890e2931-03b4-4c55-9329-4a862eee18ae',
            'sections': [
                {
                    'skill': 'writing',
                    'score': 7.0,
                    'max': 9.0,
                    'band': 7.0,
                    'standardScore': None,
                }
            ],
            'overallBand': 7.0,
            'overallScore': None,
            'specificationVersion': None,
            'cefrLevel': None,
            'isPartial': True,
        }
        pdf_bytes = mock_certificate.generate(data)
        self.assertIsInstance(pdf_bytes, bytes)
        self.assertTrue(len(pdf_bytes) > 2000)
        self.assertTrue(pdf_bytes.startswith(b'%PDF'))


class CertificateDataLogicTests(SimpleTestCase):
    @patch('apps.core.mock_support.assert_view')
    @patch('apps.core.mock_support.MockAttempt')
    def test_certificate_data_allows_partial_practice_and_calculates_scores(self, mock_attempt_cls, mock_assert_view):
        mock_user = SimpleNamespace(name='Komiljon Roziyev')
        mock_student = SimpleNamespace(user=mock_user)
        mock_exam = SimpleNamespace(title='Multi-Level Test 1', type='multilevel', level='B2')
        
        attempt_obj = SimpleNamespace(
            id='attempt-uuid-123',
            student_id='student-uuid-456',
            student=mock_student,
            exam=mock_exam,
            status='completed',
            finished_at=datetime(2026, 10, 21, 12, 0, tzinfo=UTC),
            flow_mode='partial_practice',
            media_state={'__practice_scope': {'version': 1, 'skills': ['speaking'], 'questionIds': ['q1']}},
            raw_scores={'speaking': {'score': 37.9, 'max': 75.0}},
            section_bands={'speaking': 5.5},
            standard_scores={'speaking': {'estimatedStandardScore': 37.9}},
            overall_score=None,
            overall_band=None,
            cefr_level=None,
            specification_version='2024.1',
        )
        mock_attempt_cls.objects.select_related.return_value.filter.return_value.first.return_value = attempt_obj

        actor = SimpleNamespace(id='student-uuid-456', role='student')
        result = mock_support.certificate_data(actor, 'attempt-uuid-123')

        self.assertTrue(result['isPartial'])
        self.assertEqual(result['studentName'], 'Komiljon Roziyev')
        self.assertEqual(result['overallScore'], 37.9)
        self.assertEqual(result['cefrLevel'], 'B1')
        self.assertEqual(len(result['sections']), 1)
        self.assertEqual(result['sections'][0]['skill'], 'speaking')
        self.assertEqual(result['sections'][0]['score'], 37.9)


class MockAttemptPermissionsAndRetakeTests(SimpleTestCase):
    def test_student_guard_allows_student_and_admin(self):
        # Student
        req = SimpleNamespace(user=SimpleNamespace(is_authenticated=True, role='student'))
        student_guard(req) # should not raise

        # Admins can take/test exams
        for role in ('super_admin', 'admin'):
            req = SimpleNamespace(user=SimpleNamespace(is_authenticated=True, role=role))
            student_guard(req) # should not raise

    def test_assert_view_allows_owner_regardless_of_role(self):
        # Teacher viewing their own attempt
        actor = SimpleNamespace(id='user-123', role='teacher')
        engine.assert_view(actor, 'user-123') # should not raise

        # Super admin viewing any attempt
        admin = SimpleNamespace(id='admin-999', role='super_admin')
        engine.assert_view(admin, 'any-student-456') # should not raise
