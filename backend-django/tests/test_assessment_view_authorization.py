"""Assessment reads must authorize before they can trigger background work."""
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.core import assessment_views
from common.api.exceptions import ContractAPIException


class AssessmentViewAuthorizationTests(SimpleTestCase):
    def request(self):
        request = APIRequestFactory().get('/v1/assessment/attempts/attempt')
        force_authenticate(request, user=SimpleNamespace(id='student-a', role='student', is_authenticated=True))
        return request

    @patch('apps.core.assessment_worker.run_once')
    @patch('apps.legacy_schema.models.AssessmentJob.objects.filter')
    @patch('apps.core.assessment.for_attempt')
    def test_foreign_or_unavailable_attempt_never_starts_a_worker(self, overview, jobs, worker):
        for code, status in (('FORBIDDEN', 403), ('PROGRAM_NOT_ENROLLED', 403), ('MOCK_ATTEMPT_NOT_FOUND', 404)):
            with self.subTest(code=code):
                overview.side_effect = ContractAPIException(code, 'Access denied', status)
                response = assessment_views.attempt(self.request(), 'attempt')
                self.assertEqual(response.status_code, status)
                jobs.assert_not_called()
                worker.assert_not_called()

    @patch('apps.core.assessment_worker.run_once')
    @patch('apps.legacy_schema.models.AssessmentJob.objects.filter')
    @patch('apps.core.assessment.for_attempt')
    def test_authorized_pending_work_refreshes_the_response(self, overview, jobs, worker):
        before = {'status': 'grading'}
        after = {'status': 'completed'}
        overview.side_effect = [before, after]
        jobs.return_value.exists.return_value = True
        jobs.return_value.count.return_value = 1
        worker.return_value = True
        response = assessment_views.attempt(self.request(), 'attempt')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['data'], after)
        self.assertEqual(overview.call_count, 2)
        worker.assert_called_once_with()

    @patch('apps.core.assessment_worker.run_once')
    @patch('apps.legacy_schema.models.AssessmentJob.objects.filter')
    @patch('apps.core.assessment.for_attempt')
    def test_authorized_read_without_work_returns_existing_result(self, overview, jobs, worker):
        overview.return_value = {'status': 'completed'}
        jobs.return_value.exists.return_value = False
        response = assessment_views.attempt(self.request(), 'attempt')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['data'], overview.return_value)
        overview.assert_called_once()
        worker.assert_not_called()
