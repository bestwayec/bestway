"""Comprehensive unit tests for Google OAuth Sign-Up and Sign-In flows."""
from unittest.mock import MagicMock, patch
import uuid

from django.test import TestCase
from rest_framework.test import APIClient

from apps.core import auth_views
from common.api.exceptions import ContractAPIException


class GoogleAuthTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client_id = "502060795540-ve4stfeb6un42b0dfh1snr0978294aat.apps.googleusercontent.com"

    def test_verify_google_credential_missing(self):
        with self.assertRaises(ContractAPIException) as ctx:
            auth_views.verify_google_credential("")
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(ctx.exception.contract_code, "VALIDATION_ERROR")

    def test_verify_google_credential_unverified_email(self):
        fake_payload = {
            "email": "test@example.com",
            "email_verified": False,
            "aud": self.client_id,
        }
        with patch("google.oauth2.id_token.verify_oauth2_token", return_value=fake_payload):
            with self.assertRaises(ContractAPIException) as ctx:
                auth_views.verify_google_credential("fake-token", self.client_id)
            self.assertEqual(ctx.exception.status_code, 400)
            self.assertEqual(ctx.exception.contract_code, "EMAIL_NOT_VERIFIED")

    def test_verify_google_credential_fallback_tokeninfo(self):
        # When google-auth raises an exception, tokeninfo fallback succeeds
        token_info = {
            "email": "fallback@example.com",
            "email_verified": "true",
            "aud": self.client_id,
            "given_name": "Fallback",
            "family_name": "User",
        }
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.read.return_value = b'{"email":"fallback@example.com","email_verified":"true","aud":"' + self.client_id.encode() + b'","given_name":"Fallback","family_name":"User"}'
        mock_resp.__enter__.return_value = mock_resp

        with patch("google.oauth2.id_token.verify_oauth2_token", side_effect=Exception("verification error")), \
             patch("urllib.request.urlopen", return_value=mock_resp):
            payload = auth_views.verify_google_credential("valid-fallback-token", self.client_id)
            self.assertEqual(payload["email"], "fallback@example.com")
            self.assertEqual(payload["given_name"], "Fallback")

    def test_google_auth_signup_new_student(self):
        email = f"student_{uuid.uuid4().hex[:8]}@example.com"
        fake_payload = {
            "email": email,
            "email_verified": True,
            "given_name": "Komiljon",
            "family_name": "Roziyev",
            "name": "Komiljon Roziyev",
            "aud": self.client_id,
        }

        mock_user_tuple = (
            "new-user-uuid", "Komiljon Roziyev", "g_student", "student",
            "2026-01-01T00:00:00", "hash", True, None
        )

        with patch("apps.core.auth_views.verify_google_credential", return_value=fake_payload), \
             patch("apps.core.auth_views.connection.cursor") as mock_cursor, \
             patch("apps.core.auth_views.transaction.atomic"), \
             patch("apps.core.auth_service.initial_points", return_value=50), \
             patch("apps.core.auth_service.unique_link_code", return_value="LINK1234"), \
             patch("apps.core.auth_views.sync_auth_user_mirror") as mock_sync, \
             patch("apps.core.auth_service.issue_tokens", return_value={"accessToken": "at123", "refreshToken": "rt123"}):
            cursor_inst = mock_cursor.return_value.__enter__.return_value
            # 1st fetchone: SELECT FROM User WHERE email -> None (not found)
            # 2nd fetchone: SELECT 1 FROM User WHERE phone -> None (available)
            # 3rd fetchone: SELECT FROM User WHERE id -> created user tuple
            cursor_inst.fetchone.side_effect = [None, None, mock_user_tuple]

            response = self.client.post(
                "/v1/auth/google",
                {"credential": "valid-google-jwt-token"},
                format="json",
            )
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.data["success"])
            data = response.data["data"]
            self.assertTrue(data["isNewUser"])
            self.assertEqual(data["accessToken"], "at123")
            self.assertEqual(data["refreshToken"], "rt123")
            self.assertEqual(data["user"]["name"], "Komiljon Roziyev")
            self.assertEqual(data["user"]["role"], "student")
            self.assertTrue(mock_sync.called)

    def test_google_auth_signin_existing_student(self):
        email = f"existing_{uuid.uuid4().hex[:8]}@example.com"
        fake_payload = {
            "email": email,
            "email_verified": True,
            "given_name": "Aziz",
            "family_name": "Valiyev",
            "name": "Aziz Valiyev",
            "aud": self.client_id,
        }

        existing_user_row = (
            "user-uuid-existing", "Aziz Valiyev", "+998901234567", "student",
            "2026-01-01T00:00:00", "hash", True, None, email
        )

        with patch("apps.core.auth_views.verify_google_credential", return_value=fake_payload), \
             patch("apps.core.auth_views.connection.cursor") as mock_cursor, \
             patch("apps.core.auth_views.sync_auth_user_mirror") as mock_sync, \
             patch("apps.core.auth_service.issue_tokens", return_value={"accessToken": "at456", "refreshToken": "rt456"}):
            cursor_inst = mock_cursor.return_value.__enter__.return_value
            cursor_inst.fetchone.return_value = existing_user_row

            response = self.client.post("/v1/auth/google/", {"credential": "token_existing"}, format="json")
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.data["success"])
            data = response.data["data"]
            self.assertFalse(data["isNewUser"])
            self.assertEqual(data["user"]["id"], "user-uuid-existing")
            self.assertEqual(data["accessToken"], "at456")
            self.assertTrue(mock_sync.called)

    def test_google_auth_signin_deactivated_user(self):
        email = f"blocked_{uuid.uuid4().hex[:8]}@example.com"
        fake_payload = {
            "email": email,
            "email_verified": True,
            "given_name": "Blocked",
            "family_name": "User",
            "aud": self.client_id,
        }

        blocked_user_row = (
            "user-uuid-blocked", "Blocked User", "+998901234568", "student",
            "2026-01-01T00:00:00", "hash", False, None, email
        )

        with patch("apps.core.auth_views.verify_google_credential", return_value=fake_payload), \
             patch("apps.core.auth_views.connection.cursor") as mock_cursor:
            cursor_inst = mock_cursor.return_value.__enter__.return_value
            cursor_inst.fetchone.return_value = blocked_user_row

            response = self.client.post("/v1/auth/google", {"credential": "token_blocked"}, format="json")
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.data["error"]["code"], "USER_DEACTIVATED")

    def test_google_auth_api_v1_alias(self):
        email = f"alias_{uuid.uuid4().hex[:8]}@example.com"
        fake_payload = {
            "email": email,
            "email_verified": True,
            "given_name": "Alias",
            "family_name": "Test",
            "aud": self.client_id,
        }
        existing_user_row = (
            "user-alias-id", "Alias Test", "+998901234599", "student",
            "2026-01-01T00:00:00", "hash", True, None, email
        )
        with patch("apps.core.auth_views.verify_google_credential", return_value=fake_payload), \
             patch("apps.core.auth_views.connection.cursor") as mock_cursor, \
             patch("apps.core.auth_views.sync_auth_user_mirror"), \
             patch("apps.core.auth_service.issue_tokens", return_value={"accessToken": "at_alias", "refreshToken": "rt_alias"}):
            cursor_inst = mock_cursor.return_value.__enter__.return_value
            cursor_inst.fetchone.return_value = existing_user_row

            res = self.client.post("/api/v1/auth/google/", {"credential": "token_alias"}, format="json")
            self.assertEqual(res.status_code, 200)
            self.assertTrue(res.data["success"])
            self.assertEqual(res.data["data"]["accessToken"], "at_alias")

    def test_sync_auth_user_mirror_logic(self):
        with patch("apps.core.auth_views.get_user_model") as mock_get_user_model:
            mock_manager = MagicMock()
            mock_get_user_model.return_value = mock_manager
            mock_manager.objects.filter.return_value.first.return_value = None
            mock_manager.objects.filter.return_value.exists.return_value = False
            mock_user = MagicMock()
            mock_manager.objects.create.return_value = mock_user

            auth_views.sync_auth_user_mirror(
                user_id="user-123",
                email="test@bestwayec.uz",
                given_name="Ali",
                family_name="Valiyev",
                is_active=True,
                is_superuser=False,
            )
            self.assertTrue(mock_manager.objects.create.called)
            self.assertTrue(mock_user.set_unusable_password.called)
            self.assertTrue(mock_user.save.called)
