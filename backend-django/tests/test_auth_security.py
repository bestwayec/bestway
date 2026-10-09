"""Regressions for password compatibility and authentication transaction boundaries."""
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch

import bcrypt
import jwt
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient

from apps.core import auth_service
from common.api.exceptions import ContractAPIException
from common.auth.jwt import decode_access, issue_access
from common.auth.passwords import hash_password, verify_password


class PasswordCompatibilityTests(SimpleTestCase):
    def test_unicode_password_matches_legacy_byte_truncation(self):
        password = "a" * 71 + "😀" * 8
        legacy = bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt(rounds=4))
        self.assertTrue(verify_password(password, legacy))
        self.assertTrue(verify_password(password, hash_password(password)))
        self.assertFalse(verify_password("wrong", legacy))

    def test_invalid_stored_hash_fails_closed(self):
        self.assertFalse(verify_password("password", "broken hash"))

    def test_long_password_for_unknown_login_returns_401_not_500(self):
        with patch.object(auth_service, "fetch_user", return_value=None):
            response = APIClient().post("/v1/auth/login", {"phone": "+998901234567", "password": "😀" * 100}, format="json")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.data["error"]["code"], "INVALID_CREDENTIALS")

    def test_long_password_on_deactivated_login_returns_403(self):
        user = ("id", "Name", "+998901234567", "student", datetime.now(UTC), auth_service.DUMMY_HASH.decode(), False, None)
        with patch.object(auth_service, "fetch_user", return_value=user):
            with self.assertRaises(ContractAPIException) as caught:
                auth_service.login(user[2], "x" * 100)
        self.assertEqual(caught.exception.status_code, 403)


@override_settings(JWT_SECRET="regression-only-secret-longer-than-32-chars")
class AccessTokenTests(SimpleTestCase):
    def test_issued_token_is_accepted(self):
        self.assertEqual(decode_access(issue_access("student-id", "student"))["sub"], "student-id")

    def test_required_claims_and_subject_are_enforced(self):
        payload = {"sub": "id", "iat": datetime.now(UTC), "exp": datetime.now(UTC) + timedelta(minutes=1)}
        for key in ("sub", "exp", "iat"):
            with self.subTest(missing=key):
                token = jwt.encode({k: v for k, v in payload.items() if k != key}, "regression-only-secret-longer-than-32-chars", algorithm="HS256")
                with self.assertRaises(ContractAPIException):
                    decode_access(token)
        for subject in ("", "   ", 123):
            with self.subTest(subject=subject):
                token = jwt.encode({**payload, "sub": subject}, "regression-only-secret-longer-than-32-chars", algorithm="HS256")
                with self.assertRaises(ContractAPIException):
                    decode_access(token)


class AuthenticationTransactionTests(SimpleTestCase):
    @contextmanager
    def atomic_outcome(self, outcomes):
        try:
            yield
        except Exception:
            outcomes.append("rollback")
            raise
        else:
            outcomes.append("commit")

    def test_refresh_reuse_commits_family_revocation_before_error(self):
        outcomes = []
        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.fetchone.return_value = ("old-id", "user-id", "family-id", auth_service.db_now() + timedelta(days=1), auth_service.db_now(), "user-id", "Name", "+998901234567", "student", auth_service.db_now(), "hash", True, None)
        with patch.object(auth_service.transaction, "atomic", side_effect=lambda: self.atomic_outcome(outcomes)), patch.object(auth_service, "connection", MagicMock(cursor=MagicMock(return_value=cursor))), patch.object(auth_service, "issue_tokens") as issue:
            with self.assertRaises(ContractAPIException) as caught:
                auth_service.refresh("reused-token")
        self.assertEqual(outcomes, ["commit"])
        self.assertEqual(caught.exception.contract_code, "SESSION_EXPIRED")
        self.assertIn('"familyId" IS NOT DISTINCT FROM %s', cursor.execute.call_args.args[0])
        self.assertEqual(cursor.execute.call_args.args[1], ["user-id", "family-id"])
        issue.assert_not_called()

    def test_failed_desktop_exchange_commits_code_consumption(self):
        for device, verifier_ok, active, role, expected in (("wrong", True, True, "student", "DEVICE_MISMATCH"), ("device", False, True, "student", "INVALID_VERIFIER"), ("device", True, False, "student", "USER_DEACTIVATED"), ("device", True, True, "teacher", "NOT_A_STUDENT")):
            with self.subTest(expected=expected):
                outcomes = []
                cursor = MagicMock()
                cursor.__enter__.return_value = cursor
                cursor.fetchone.return_value = ("code-id", "user-id", "challenge", "device", auth_service.db_now() + timedelta(minutes=1), None, "user-id", "Name", "+998901234567", role, auth_service.db_now(), "hash", active, None)
                with patch.object(auth_service.transaction, "atomic", side_effect=lambda: self.atomic_outcome(outcomes)), patch.object(auth_service, "connection", MagicMock(cursor=MagicMock(return_value=cursor))), patch.object(auth_service, "verify_challenge", return_value=verifier_ok), patch.object(auth_service, "issue_tokens") as issue:
                    with self.assertRaises(ContractAPIException) as caught:
                        auth_service.exchange_desktop("code", "verifier", device)
                self.assertEqual(outcomes, ["commit"])
                self.assertEqual(caught.exception.contract_code, expected)
                self.assertIn('SET "usedAt"=NOW()', cursor.execute.call_args.args[0])
                issue.assert_not_called()
