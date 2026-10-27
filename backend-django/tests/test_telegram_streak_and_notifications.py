"""Tests for Telegram streak notifications and weekly leaderboard."""
from datetime import date, datetime, timedelta
from unittest.mock import MagicMock, patch
from zoneinfo import ZoneInfo

from django.test import SimpleTestCase

from apps.notifications.telegram_tasks import (
    TASHKENT_TZ,
    calculate_student_streak,
    check_daily_streaks,
    get_tashkent_now,
    has_activity_today,
    send_weekly_leaderboard,
)


class TelegramStreakAndNotificationTests(SimpleTestCase):
    def test_streak_calculation_inactive_user(self):
        """User with no activity dates should have 0 streak and no activity today."""
        with patch("apps.notifications.telegram_tasks.get_student_learning_activity_dates", return_value=set()):
            today = date(2026, 10, 27)
            self.assertFalse(has_activity_today("user-1", today_date=today))
            self.assertEqual(calculate_student_streak("user-1", as_of_date=today), 0)

    def test_streak_calculation_active_today_and_yesterday(self):
        """User active today and yesterday should have a streak of 2 days."""
        today = date(2026, 10, 27)
        yesterday = date(2026, 10, 26)
        activity_dates = {today, yesterday}

        with patch("apps.notifications.telegram_tasks.get_student_learning_activity_dates", return_value=activity_dates):
            self.assertTrue(has_activity_today("user-1", today_date=today))
            self.assertEqual(calculate_student_streak("user-1", as_of_date=today), 2)

    def test_streak_calculation_active_yesterday_not_today(self):
        """User active yesterday and day before, but not today yet, has streak = 2 (streak at risk)."""
        today = date(2026, 10, 27)
        yesterday = date(2026, 10, 26)
        day_before = date(2026, 10, 25)
        activity_dates = {yesterday, day_before}

        with patch("apps.notifications.telegram_tasks.get_student_learning_activity_dates", return_value=activity_dates):
            self.assertFalse(has_activity_today("user-1", today_date=today))
            self.assertEqual(calculate_student_streak("user-1", as_of_date=today), 2)

    def test_streak_calculation_broken_streak(self):
        """User active 3 days ago but missed yesterday and today has streak = 0."""
        today = date(2026, 10, 27)
        three_days_ago = date(2026, 10, 24)
        activity_dates = {three_days_ago}

        with patch("apps.notifications.telegram_tasks.get_student_learning_activity_dates", return_value=activity_dates):
            self.assertFalse(has_activity_today("user-1", today_date=today))
            self.assertEqual(calculate_student_streak("user-1", as_of_date=today), 0)

    @patch("apps.core.telegram_delivery.send")
    @patch("apps.legacy_schema.models.User.objects.filter")
    def test_check_daily_streaks_sends_notification_for_inactive_student(self, mock_user_filter, mock_tg_send):
        """Student inactive today receives a personalized streak reminder."""
        mock_student = MagicMock()
        mock_student.id = "student-123"
        mock_student.name = "Jasur Aliyev"
        mock_student.telegram_chat_id = "123456789"

        # Mock User query chain: filter().exclude().exclude()
        mock_qs = MagicMock()
        mock_qs.exclude.return_value.exclude.return_value = [mock_student]
        mock_user_filter.return_value = mock_qs

        mock_tg_send.return_value = {"message_id": 999}

        now_tashkent = datetime(2026, 10, 27, 20, 0, 0, tzinfo=TASHKENT_TZ)

        with patch("apps.notifications.telegram_tasks.has_activity_today", return_value=False), \
             patch("apps.notifications.telegram_tasks.calculate_student_streak", return_value=3):
            result = check_daily_streaks(now_dt=now_tashkent)

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["total_checked"], 1)
        self.assertEqual(result["reminders_sent"], 1)
        self.assertEqual(result["skipped_active_today"], 0)

        # Check call arguments
        mock_tg_send.assert_called_once()
        call_args = mock_tg_send.call_args[0]
        chat_id, text = call_args[0], call_args[1]
        self.assertEqual(chat_id, "123456789")
        self.assertIn("Jasur", text)
        self.assertIn("bugungi 1 ta darsingiz qoldi", text)
        self.assertIn("3 kunlik", text)
        self.assertIn("Platformaga kirish", text)

    @patch("apps.core.telegram_delivery.send")
    @patch("apps.legacy_schema.models.User.objects.filter")
    def test_check_daily_streaks_skips_student_active_today(self, mock_user_filter, mock_tg_send):
        """Student already active today does NOT receive an annoying reminder."""
        mock_student = MagicMock()
        mock_student.id = "student-active"
        mock_student.name = "Madina Karimova"
        mock_student.telegram_chat_id = "987654321"

        mock_qs = MagicMock()
        mock_qs.exclude.return_value.exclude.return_value = [mock_student]
        mock_user_filter.return_value = mock_qs

        now_tashkent = datetime(2026, 10, 27, 20, 0, 0, tzinfo=TASHKENT_TZ)

        with patch("apps.notifications.telegram_tasks.has_activity_today", return_value=True):
            result = check_daily_streaks(now_dt=now_tashkent)

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["total_checked"], 1)
        self.assertEqual(result["skipped_active_today"], 1)
        self.assertEqual(result["reminders_sent"], 0)
        mock_tg_send.assert_not_called()

    @patch("apps.core.telegram_delivery.send")
    @patch("apps.core.lms_services.get_lms_leaderboard")
    @patch.dict("os.environ", {"TELEGRAM_LEADERBOARD_CHANNEL_ID": "-1001234567890"})
    def test_send_weekly_leaderboard_formats_and_sends_report(self, mock_leaderboard, mock_tg_send):
        """Weekly leaderboard formats Top-10 report and sends to channel."""
        mock_leaderboard.return_value = [
            {"rank": 1, "name": "Jasur Aliyev", "points": 450, "group_name": "B2 Guruh"},
            {"rank": 2, "name": "Madina Karimova", "points": 410, "group_name": "IELTS Intensive"},
            {"rank": 3, "name": "Bobur Usmonov", "points": 380, "group_name": "B1 Guruh"},
        ]
        mock_tg_send.return_value = {"message_id": 1001}

        res = send_weekly_leaderboard()
        self.assertEqual(res["status"], "success")
        self.assertTrue(res["sent"])
        self.assertEqual(res["top_count"], 3)

        mock_tg_send.assert_called_once()
        call_args = mock_tg_send.call_args[0]
        self.assertEqual(call_args[0], "-1001234567890")
        message_text = call_args[1]
        self.assertIn("Haftalik O'quvchilar Reytingi", message_text)
        self.assertIn("Jasur Aliyev", message_text)
        self.assertIn("450 XP", message_text)
        self.assertIn("🥇", message_text)
