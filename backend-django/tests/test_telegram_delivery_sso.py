"""Comprehensive tests for Telegram SSO, Bot parity, audio playback and Channel integration."""
import hashlib
import hmac
import os
import time
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import TestCase
from rest_framework.test import APIClient

from apps.core import telegram_bot, telegram_delivery, telegram_menu, telegram_views
from apps.core.mock_submission_snapshots import announce_channel_mock_result
from common.api.exceptions import ContractAPIException


class TelegramSSOTests(TestCase):
    databases = '__all__'

    def setUp(self):
        self.client = APIClient()
        self.bot_token = "123456789:ABCdefGHIjklMNOpqrSTUvwxYZ"

    def _sign_widget(self, params: dict, token: str) -> str:
        check = []
        for k, v in params.items():
            if k != "hash":
                check.append(f"{k}={v}")
        check.sort()
        data_string = "\n".join(check)
        secret_key = hashlib.sha256(token.encode("utf-8")).digest()
        return hmac.new(secret_key, data_string.encode("utf-8"), hashlib.sha256).hexdigest()

    def test_verify_telegram_auth_login_widget_valid(self):
        auth_date = int(time.time())
        data = {
            "id": 987654321,
            "first_name": "Sardor",
            "last_name": "Karimov",
            "username": "sardor_k",
            "auth_date": auth_date,
        }
        data["hash"] = self._sign_widget(data, self.bot_token)

        with patch.dict(os.environ, {"TELEGRAM_BOT_TOKEN": self.bot_token}):
            verified = telegram_views.verify_telegram_auth(data)
            self.assertEqual(verified["id"], 987654321)
            self.assertEqual(verified["first_name"], "Sardor")
            self.assertEqual(verified["username"], "sardor_k")

    def test_verify_telegram_auth_webapp_initdata_valid(self):
        auth_date = int(time.time())
        user_json = '{"id":555666,"first_name":"Aziza","username":"aziza_b"}'
        init_pairs = [
            ("auth_date", str(auth_date)),
            ("query_id", "AAG_test"),
            ("user", user_json),
        ]
        init_pairs.sort(key=lambda x: x[0])
        data_string = "\n".join(f"{k}={v}" for k, v in init_pairs)
        secret_key = hmac.new(b"WebAppData", self.bot_token.encode("utf-8"), hashlib.sha256).digest()
        auth_hash = hmac.new(secret_key, data_string.encode("utf-8"), hashlib.sha256).hexdigest()
        raw_init_data = f"query_id=AAG_test&user={user_json}&auth_date={auth_date}&hash={auth_hash}"

        with patch.dict(os.environ, {"TELEGRAM_BOT_TOKEN": self.bot_token}):
            verified = telegram_views.verify_telegram_auth({"initData": raw_init_data})
            self.assertEqual(verified["id"], 555666)
            self.assertEqual(verified["first_name"], "Aziza")
            self.assertEqual(verified["username"], "aziza_b")

    def test_verify_telegram_auth_invalid_hash_rejected(self):
        data = {
            "id": 111,
            "first_name": "Hacker",
            "auth_date": int(time.time()),
            "hash": "invalidhash123",
        }
        with patch.dict(os.environ, {"TELEGRAM_BOT_TOKEN": self.bot_token}):
            with self.assertRaises(ContractAPIException) as ctx:
                telegram_views.verify_telegram_auth(data)
            self.assertEqual(ctx.exception.status_code, 401)
            self.assertEqual(ctx.exception.contract_code, "INVALID_CREDENTIALS")

    def test_verify_telegram_auth_expired_rejected(self):
        old_date = int(time.time()) - 200000  # > 2 days ago
        data = {
            "id": 111,
            "first_name": "Old",
            "auth_date": old_date,
        }
        data["hash"] = self._sign_widget(data, self.bot_token)
        with patch.dict(os.environ, {"TELEGRAM_BOT_TOKEN": self.bot_token}):
            with self.assertRaises(ContractAPIException) as ctx:
                telegram_views.verify_telegram_auth(data)
            self.assertEqual(ctx.exception.status_code, 401)
            self.assertIn("eskirgan", ctx.exception.contract_message)

    def test_telegram_login_endpoint_existing_user(self):
        auth_date = int(time.time())
        data = {
            "id": 999111,
            "first_name": "Existing",
            "auth_date": auth_date,
        }
        data["hash"] = self._sign_widget(data, self.bot_token)

        existing_user_row = (
            "user-uuid-1", "Existing User", "+998901234567", "student",
            "2026-01-01T00:00:00", "hash", True, "999111"
        )
        with patch.dict(os.environ, {"TELEGRAM_BOT_TOKEN": self.bot_token}), \
             patch("apps.core.telegram_views.connection.cursor") as mock_cursor, \
             patch("apps.core.auth_service.issue_tokens", return_value={"accessToken": "at123", "refreshToken": "rt123"}):
            mock_cursor.return_value.__enter__.return_value.fetchone.return_value = existing_user_row
            response = self.client.post("/v1/auth/telegram-login", data, format="json")
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.data["success"])
            self.assertEqual(response.data["data"]["user"]["id"], "user-uuid-1")
            self.assertEqual(response.data["data"]["tokens"]["accessToken"], "at123")
            self.assertEqual(response.data["data"]["accessToken"], "at123")

    def test_telegram_login_endpoint_deactivated_user(self):
        auth_date = int(time.time())
        data = {
            "id": 999222,
            "first_name": "Blocked",
            "auth_date": auth_date,
        }
        data["hash"] = self._sign_widget(data, self.bot_token)

        deactivated_user_row = (
            "user-uuid-2", "Blocked User", "+998901234568", "student",
            "2026-01-01T00:00:00", "hash", False, "999222"
        )
        with patch.dict(os.environ, {"TELEGRAM_BOT_TOKEN": self.bot_token}), \
             patch("apps.core.telegram_views.connection.cursor") as mock_cursor:
            mock_cursor.return_value.__enter__.return_value.fetchone.return_value = deactivated_user_row
            response = self.client.post("/v1/auth/telegram-login", data, format="json")
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.data["error"]["code"], "USER_DEACTIVATED")


class TelegramBotParityTests(TestCase):
    databases = '__all__'

    def setUp(self):
        self.bot_token = "test-token"

    def test_sso_url_generation(self):
        with patch.dict(os.environ, {"TELEGRAM_BOT_TOKEN": self.bot_token, "FRONTEND_URL": "https://bestwayec.uz"}):
            url = telegram_menu.generate_sso_url(777888, SimpleNamespace(name="Ali"))
            self.assertIn("https://bestwayec.uz/login?", url)
            self.assertIn("id=777888", url)
            self.assertIn("first_name=Ali", url)
            self.assertIn("hash=", url)

    def test_bot_login_command_sends_sso_inline_button(self):
        sent = []
        with patch.dict(os.environ, {"TELEGRAM_BOT_TOKEN": self.bot_token}), \
             patch("apps.core.telegram_links.find", return_value=SimpleNamespace(name="Aziz", role="student")), \
             patch.object(telegram_delivery, "send", side_effect=lambda cid, txt, reply_markup=None: sent.append((cid, txt, reply_markup))):
            telegram_bot.handle({"message": {"chat": {"id": 12345}, "text": "/login"}})
            self.assertEqual(len(sent), 1)
            cid, text, markup = sent[0]
            self.assertEqual(cid, 12345)
            self.assertIn("One-Click SSO", text)
            self.assertTrue(markup["inline_keyboard"][0][0]["url"].startswith("https://bestwayec.uz/login?"))

    def test_bot_mock_exams_listing_detailed(self):
        from apps.legacy_schema import models as m
        exam_ielts = SimpleNamespace(id="ielts-1", title="IELTS Mock #1", type="ielts_academic", level="C1", price=75000, is_free_for_approved=False)
        exam_multi = SimpleNamespace(id="cefr-1", title="Multi-Level CEFR Practice", type="multilevel", level="B2", price=0, is_free_for_approved=True)

        user = SimpleNamespace(id="u1", role="student", name="Sardor")
        with patch.object(m.MockExam.objects, "filter") as mock_filter:
            mock_filter.return_value.order_by.return_value = [exam_ielts, exam_multi]
            text = telegram_menu.text_for(user, "mock_exams")
            self.assertIn("IELTS Mock #1", text)
            self.assertIn("IELTS Academic", text)
            self.assertIn("Multi-Level CEFR", text)
            self.assertIn(telegram_menu.money(75000), text)
            self.assertIn("Bepul", text)
            self.assertIn("https://bestwayec.uz/mock/ielts-1", text)
            self.assertIn("https://bestwayec.uz/mock/cefr-1", text)

    def test_bot_audio_request_playback(self):
        import tempfile
        from pathlib import Path

        from apps.legacy_schema import models as m

        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
            tmp.write(b"fake-audio-bytes")
            tmp_path = Path(tmp.name)

        mock_ans = SimpleNamespace(
            audio_key="speaking/test.mp3",
            question_id="q1",
            attempt=SimpleNamespace(
                exam=SimpleNamespace(title="IELTS Mock Test"),
                student=SimpleNamespace(user=SimpleNamespace(name="Ali Valiyev"))
            )
        )

        sent_audios = []
        with patch.object(m.MockAnswer.objects, "filter") as ans_filter, \
             patch("apps.core.mock_media.resolve_key", return_value=tmp_path), \
             patch.object(telegram_delivery, "send_audio", side_effect=lambda cid, f, **kw: sent_audios.append((cid, f, kw)) or True):
            target_mock = MagicMock()
            target_mock.__getitem__.return_value = [mock_ans]
            ans_filter.return_value.exclude.return_value.filter.return_value.select_related.return_value = target_mock
            ans_filter.return_value.exclude.return_value.select_related.return_value = target_mock
            res = telegram_menu.handle_audio_request(12345, "att1_q1")
            self.assertTrue(res)
            self.assertEqual(len(sent_audios), 1)
            cid, path, kw = sent_audios[0]
            self.assertEqual(cid, 12345)
            self.assertIn("Ali Valiyev", kw["caption"])

        try:
            tmp_path.unlink()
        except OSError:
            pass

    def test_channel_mock_result_announcement(self):
        sent_channel = []
        attempt = SimpleNamespace(
            id="att-completed",
            cefr_level="C1",
            overall_band=7.5,
            overall_score=None,
            standard_scores={"listening": 8.0, "reading": 7.5, "writing": 7.0, "speaking": 7.5},
            section_bands=None,
            raw_scores=None,
            exam=SimpleNamespace(title="Official BestWay Mock", type="ielts_academic"),
            student=SimpleNamespace(user=SimpleNamespace(name="Javohir Toshmatov"))
        )

        with patch.dict(os.environ, {"TELEGRAM_CHANNEL_ID": "@bestway_results"}), \
             patch("apps.legacy_schema.models.MockAttempt.objects.select_related") as mock_rel, \
             patch.object(telegram_delivery, "send", side_effect=lambda cid, txt: sent_channel.append((cid, txt))):
            mock_rel.return_value.filter.return_value.first.return_value = attempt
            announce_channel_mock_result(attempt)
            self.assertEqual(len(sent_channel), 1)
            cid, text = sent_channel[0]
            self.assertEqual(cid, "@bestway_results")
            self.assertIn("Javohir Toshmatov", text)
            self.assertIn("Official BestWay Mock", text)
            self.assertIn("Band: <b>7.5</b>", text)
            self.assertIn("CEFR: <b>C1</b>", text)
            self.assertIn("Listening: <b>8.0</b>", text)
            self.assertIn("Reading: <b>7.5</b>", text)
            self.assertIn("Writing: <b>7.0</b>", text)
            self.assertIn("Speaking: <b>7.5</b>", text)
