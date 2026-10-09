import inspect

from django.conf import settings
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient

from apps.legacy_schema import models
from common.api.exceptions import ContractAPIException, exception_handler


class EndpointContractTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()

    @override_settings(BUILD_COMMIT="abc123")
    def test_health_matches_reference_envelope(self):
        response = self.client.get("/v1/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["success"], True)
        self.assertEqual(response.data["data"]["status"], "ok")
        self.assertEqual(response.data["data"]["buildCommit"], "abc123")
        self.assertTrue(response.data["data"]["time"].endswith("Z"))

    def test_desktop_version_matches_reference_fields(self):
        response = self.client.get("/v1/desktop-version")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["data"], {"version": settings.DESKTOP_LATEST_VERSION, "downloadUrl": settings.DESKTOP_DOWNLOAD_URL, "prerelease": settings.DESKTOP_PRERELEASE, "updateChannel": "manual_installer"})

    def test_cors_is_explicit_not_allow_all(self):
        response = self.client.options("/v1/health", HTTP_ORIGIN="http://localhost:3000", HTTP_ACCESS_CONTROL_REQUEST_METHOD="GET")
        self.assertEqual(response["access-control-allow-origin"], "http://localhost:3000")
        self.assertNotIn("CORS_ALLOW_ALL_ORIGINS", settings.__dict__)


class ExceptionEnvelopeTests(SimpleTestCase):
    def test_throttle_preserves_retry_after_header(self):
        from rest_framework.exceptions import Throttled
        response = exception_handler(Throttled(wait=12), {})
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response['Retry-After'], '12')
        self.assertEqual(response.data['error']['code'], 'TOO_MANY_REQUESTS')

    def test_contract_error_preserves_code_message_and_details(self):
        response = exception_handler(ContractAPIException("MOCK_NOT_READY", "not ready", 409, {"reason": "draft"}), {})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data, {"success": False, "error": {"code": "MOCK_NOT_READY", "message": "not ready", "details": {"reason": "draft"}}})


class LegacyMappingTests(SimpleTestCase):
    def test_all_prisma_models_are_present_and_unmanaged(self):
        mapped = [value for _, value in inspect.getmembers(models, inspect.isclass) if issubclass(value, models.LegacyModel) and value is not models.LegacyModel]
        self.assertEqual(len(mapped), 39)
        self.assertTrue(all(not model._meta.managed for model in mapped))

    def test_key_table_and_column_names_are_explicit(self):
        self.assertEqual(models.User._meta.db_table, "User")
        self.assertEqual(models.User._meta.get_field("password_hash").db_column, "passwordHash")
        self.assertEqual(models.MockAttempt._meta.db_table, "MockAttempt")
        self.assertEqual(models.MockAttempt._meta.get_field("overall_deadline_at").db_column, "overallDeadlineAt")
        self.assertEqual(models.AssessmentJob._meta.get_field("input_snapshot").db_column, "inputSnapshot")

    def test_read_only_model_types_cover_text_json_array_timestamps_and_relations(self):
        self.assertEqual(models.User._meta.pk.get_internal_type(), "CharField")
        self.assertEqual(models.MockAttempt._meta.get_field("raw_scores").get_internal_type(), "JSONField")
        self.assertEqual(models.StudentProfile._meta.get_field("available_programs").get_internal_type(), "ArrayField")
        self.assertEqual(models.Answer._meta.get_field("updated_at").get_internal_type(), "DateTimeField")
        self.assertEqual(models.MockAnswer._meta.get_field("attempt").db_column, "attemptId")

    def test_enum_values_are_exact_prisma_values(self):
        self.assertEqual(RoleValues(models.Role), {"super_admin", "admin", "teacher", "student", "parent"})
        self.assertEqual(RoleValues(models.ExamProgram), {"IELTS", "MULTILEVEL"})
        self.assertIn("PRACTICE_AUTO_AI", RoleValues(models.AssessmentPolicyMode))
        self.assertIn("speaking_task", RoleValues(models.MockQuestionType))


def RoleValues(choice):
    return {item.value for item in choice}
