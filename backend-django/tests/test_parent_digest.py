"""Tests for Parent Telegram Monitoring, Real-time Alerts, and Weekly Digest."""
from __future__ import annotations

from unittest.mock import MagicMock, patch
from django.test import SimpleTestCase
from apps.core import parent_bot_service


class ParentMonitoringTests(SimpleTestCase):
    @patch("apps.core.parent_bot_service.ParentTelegramLink.objects.create")
    @patch("apps.core.parent_bot_service.ParentTelegramLink.objects.filter")
    @patch("apps.core.parent_bot_service.User.objects.filter")
    def test_get_or_create_parent_invite_code(self, mock_user_filter, mock_link_filter, mock_link_create):
        mock_link_filter.return_value.first.return_value = None
        mock_link_filter.return_value.exists.return_value = False

        mock_user = MagicMock(id="st-123", name="Komiljon")
        mock_user_filter.return_value.first.return_value = mock_user

        created_mock = MagicMock(
            student_id="st-123",
            invite_code="BW-123456",
            parent_chat_id="",
            parent_name="",
            linked_at=None,
        )
        mock_link_create.return_value = created_mock

        res = parent_bot_service.get_or_create_parent_invite_code("st-123", "Komiljon")
        self.assertEqual(res["inviteCode"], "BW-123456")
        self.assertFalse(res["isLinked"])
        self.assertIn("BW-123456", res["deepLink"])

    @patch("apps.core.parent_bot_service.ParentTelegramLink.objects.filter")
    def test_link_parent_by_code_success(self, mock_filter):
        mock_link = MagicMock()
        mock_link.student_id = "st-123"
        mock_link.invite_code = "BW-987654"
        student_mock = MagicMock()
        student_mock.name = "Shohruh"
        mock_link.student = student_mock
        mock_filter.return_value.select_related.return_value.first.return_value = mock_link

        res = parent_bot_service.link_parent_by_code("chat-999", "BW-987654", parent_name="Ota")
        self.assertTrue(res["success"])
        self.assertEqual(res["studentName"], "Shohruh")
        self.assertEqual(mock_link.parent_chat_id, "chat-999")
        mock_link.save.assert_called_once()

    @patch("apps.core.parent_bot_service.ParentTelegramLink.objects.filter")
    def test_link_parent_by_code_invalid(self, mock_filter):
        mock_filter.return_value.select_related.return_value.first.return_value = None

        res = parent_bot_service.link_parent_by_code("chat-999", "BW-000000")
        self.assertFalse(res["success"])
        self.assertIn("topilmadi", res["message"])

    @patch("apps.core.telegram_delivery.send")
    @patch("apps.core.parent_bot_service.User.objects.filter")
    @patch("apps.core.parent_bot_service.ParentTelegramLink.objects.filter")
    def test_notify_parent_attendance_absent(self, mock_link_filter, mock_user_filter, mock_tele_send):
        mock_link = MagicMock(parent_chat_id="chat-111")
        mock_link_filter.return_value.exclude.return_value.exists.return_value = True
        mock_link_filter.return_value.exclude.return_value.__iter__.return_value = [mock_link]

        mock_user = MagicMock(name="Azizbek")
        mock_user_filter.return_value.first.return_value = mock_user

        sent = parent_bot_service.notify_parent_attendance(
            student_id="st-1",
            state="absent",
            date_str="24.10.2026",
            group_name="IELTS 1",
        )
        self.assertTrue(sent)
        mock_tele_send.assert_called_once()
        args, _ = mock_tele_send.call_args
        self.assertEqual(args[0], "chat-111")
        self.assertIn("Darsga qatnashmadi (Kelmadi ❌)", args[1])
        self.assertIn("Azizbek", args[1])

    @patch("apps.core.telegram_delivery.send")
    @patch("apps.core.parent_bot_service.User.objects.filter")
    @patch("apps.core.parent_bot_service.ParentTelegramLink.objects.filter")
    def test_notify_parent_exam_result(self, mock_link_filter, mock_user_filter, mock_tele_send):
        mock_link = MagicMock(parent_chat_id="chat-222")
        mock_link_filter.return_value.exclude.return_value.exists.return_value = True
        mock_link_filter.return_value.exclude.return_value.__iter__.return_value = [mock_link]

        mock_user = MagicMock(name="Madina")
        mock_user_filter.return_value.first.return_value = mock_user

        sent = parent_bot_service.notify_parent_exam_result(
            student_id="st-2",
            exam_title="Unit 3 Review",
            score_text="20/20 (100%)",
            skill="Lug'at",
        )
        self.assertTrue(sent)
        mock_tele_send.assert_called_once()
        args, _ = mock_tele_send.call_args
        self.assertEqual(args[0], "chat-222")
        self.assertIn("Unit 3 Review", args[1])
        self.assertIn("20/20 (100%)", args[1])

    @patch("apps.core.telegram_delivery.send")
    @patch("apps.core.parent_bot_service.PointsLog.objects.filter")
    @patch("apps.core.parent_bot_service.VocabularyAttempt.objects.filter")
    @patch("apps.core.parent_bot_service.Attendance.objects.filter")
    @patch("apps.core.parent_bot_service.ParentTelegramLink.objects.filter")
    def test_send_weekly_parent_digest(
        self,
        mock_link_filter,
        mock_att_filter,
        mock_vocab_filter,
        mock_points_filter,
        mock_tele_send,
    ):
        mock_link = MagicMock(
            student_id="st-5",
            parent_chat_id="chat-555",
            student=MagicMock(name="Temur"),
        )
        mock_link_filter.return_value.exclude.return_value.select_related.return_value = [mock_link]

        # Attendance mock (2 present, 1 late)
        a1 = MagicMock(state="present")
        a2 = MagicMock(state="present")
        a3 = MagicMock(state="late")
        mock_att_filter.return_value = [a1, a2, a3]

        # Vocab attempts mock
        v1 = MagicMock(percentage=90.0)
        v2 = MagicMock(percentage=100.0)
        mock_vocab_filter.return_value = [v1, v2]

        # Points log mock
        p1 = MagicMock(change=5)
        p2 = MagicMock(change=3)
        mock_points_filter.return_value = [p1, p2]

        res = parent_bot_service.send_weekly_parent_digest()
        self.assertEqual(res["sentCount"], 1)
        self.assertEqual(res["failedCount"], 0)
        mock_tele_send.assert_called_once()
        args, _ = mock_tele_send.call_args
        self.assertEqual(args[0], "chat-555")
        self.assertIn("Temur", args[1])
        self.assertIn("Haftalik O'zlashtirish Hisoboti (Digest)", args[1])
        self.assertIn("66.7%", args[1])  # 2/3 present
        self.assertIn("+8 ball", args[1])  # 5 + 3
