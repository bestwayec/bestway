"""Telegram Streak & Automated Notification Tasks."""
import logging
import os
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Set
from zoneinfo import ZoneInfo

from django.db import transaction
from django.utils import timezone

from apps.core import telegram_delivery
from apps.core.models import UserLessonProgress, VocabularyAttempt
from apps.legacy_schema.models import MockAttempt, PointsLog, StudentProfile, TestAttempt, User

logger = logging.getLogger(__name__)
TASHKENT_TZ = ZoneInfo("Asia/Tashkent")


def get_tashkent_now(now_dt: Optional[datetime] = None) -> datetime:
    """Return timezone-aware datetime in Asia/Tashkent."""
    if now_dt is None:
        now_dt = timezone.now()
    if timezone.is_naive(now_dt):
        now_dt = timezone.make_aware(now_dt, timezone.utc)
    return now_dt.astimezone(TASHKENT_TZ)


def get_student_learning_activity_dates(user_id: str, days_limit: int = 60) -> Set[date]:
    """Collect all dates where student performed learning activities in Asia/Tashkent."""
    activity_dates: Set[date] = set()
    now_tashkent = get_tashkent_now()
    cutoff_dt = now_tashkent - timedelta(days=days_limit)

    # 1. Lesson progress (watched or completed)
    try:
        progress_qs = UserLessonProgress.objects.filter(
            user_id=user_id,
            updated_at__gte=cutoff_dt,
        ).values_list("updated_at", flat=True)
        for dt in progress_qs:
            if dt:
                activity_dates.add(dt.astimezone(TASHKENT_TZ).date())
    except Exception as e:
        logger.debug("Error checking lesson progress dates for %s: %s", user_id, e)

    # 2. Mock attempts
    try:
        mock_qs = MockAttempt.objects.filter(
            user_id=user_id,
            created_at__gte=cutoff_dt,
        ).values_list("created_at", flat=True)
        for dt in mock_qs:
            if dt:
                activity_dates.add(dt.astimezone(TASHKENT_TZ).date())
    except Exception as e:
        logger.debug("Error checking mock attempts dates for %s: %s", user_id, e)

    # 3. Test attempts (regular tests)
    try:
        test_qs = TestAttempt.objects.filter(
            student__user_id=user_id,
            created_at__gte=cutoff_dt,
        ).values_list("created_at", flat=True)
        for dt in test_qs:
            if dt:
                activity_dates.add(dt.astimezone(TASHKENT_TZ).date())
    except Exception as e:
        logger.debug("Error checking test attempt dates for %s: %s", user_id, e)

    # 4. Vocabulary attempts
    try:
        vocab_qs = VocabularyAttempt.objects.filter(
            user_id=user_id,
            created_at__gte=cutoff_dt,
        ).values_list("created_at", flat=True)
        for dt in vocab_qs:
            if dt:
                activity_dates.add(dt.astimezone(TASHKENT_TZ).date())
    except Exception as e:
        logger.debug("Error checking vocab attempt dates for %s: %s", user_id, e)

    # 5. Points earned (attendance or tests)
    try:
        points_qs = PointsLog.objects.filter(
            student__user_id=user_id,
            created_at__gte=cutoff_dt,
        ).values_list("created_at", flat=True)
        for dt in points_qs:
            if dt:
                activity_dates.add(dt.astimezone(TASHKENT_TZ).date())
    except Exception as e:
        logger.debug("Error checking points log dates for %s: %s", user_id, e)

    return activity_dates


def calculate_student_streak(user_id: str, as_of_date: Optional[date] = None) -> int:
    """Calculate the consecutive day learning streak for a student.

    If the student was active today: streak ends today.
    If the student was active yesterday but not today: streak was active up to yesterday.
    If inactive both today and yesterday: streak is 0.
    """
    if as_of_date is None:
        as_of_date = get_tashkent_now().date()

    activity_dates = get_student_learning_activity_dates(user_id)
    if not activity_dates:
        return 0

    streak = 0
    current_check = as_of_date

    # If active today, count today and go backwards
    if current_check in activity_dates:
        while current_check in activity_dates:
            streak += 1
            current_check -= timedelta(days=1)
        return streak

    # If not active today, check if active yesterday
    yesterday = current_check - timedelta(days=1)
    if yesterday in activity_dates:
        current_check = yesterday
        while current_check in activity_dates:
            streak += 1
            current_check -= timedelta(days=1)
        return streak

    return 0


def has_activity_today(user_id: str, today_date: Optional[date] = None) -> bool:
    """Check if the student has completed any learning activity today."""
    if today_date is None:
        today_date = get_tashkent_now().date()
    activity_dates = get_student_learning_activity_dates(user_id, days_limit=2)
    return today_date in activity_dates


def check_daily_streaks(now_dt: Optional[datetime] = None) -> Dict[str, Any]:
    """Scan all active students at 20:00 (Asia/Tashkent).

    If student hasn't watched a lesson or completed a test today, send a telegram reminder:
    '🔥 {Ism}, bugungi 1 ta darsingiz qoldi! {X} kunlik zanjiringiz uzilib ketmasin. Hoziroq bitta mashq ishlang: [Platformaga kirish]'
    """
    tashkent_now = get_tashkent_now(now_dt)
    today = tashkent_now.date()

    students = (
        User.objects.filter(
            is_active=True,
            role="student",
        )
        .exclude(telegram_chat_id__isnull=True)
        .exclude(telegram_chat_id="")
    )

    checked_count = 0
    sent_count = 0
    skipped_active_today = 0
    failed_deliveries = 0

    for student in students:
        checked_count += 1
        user_id = str(student.id)

        # Check if already active today
        if has_activity_today(user_id, today_date=today):
            skipped_active_today += 1
            continue

        # Calculate streak
        current_streak = calculate_student_streak(user_id, as_of_date=today)
        streak_display = current_streak if current_streak > 0 else 1

        first_name = student.name.split()[0] if student.name else "Qadrli o'quvchi"

        message = (
            f"🔥 <b>{first_name}</b>, bugungi 1 ta darsingiz qoldi!\n\n"
            f"Sizning <b>{streak_display} kunlik</b> zanjiringiz uzilib ketmasin. "
            f"Hoziroq bitta dars ko'ring yoki test mashqini bajaring!\n\n"
            f"👉 <a href=\"https://bestwayec.uz/en/videos\">Platformaga kirish</a>"
        )

        reply_markup = {
            "inline_keyboard": [
                [
                    {
                        "text": "▶️ Darslarni ochish",
                        "url": "https://bestwayec.uz/en/videos",
                    },
                    {
                        "text": "🎮 Bamboozle Arena",
                        "url": "https://bestwayec.uz/en/bamboozle",
                    },
                ]
            ]
        }

        try:
            res = telegram_delivery.send(student.telegram_chat_id, message, reply_markup=reply_markup)
            if res:
                sent_count += 1
            else:
                failed_deliveries += 1
        except Exception as err:
            logger.warning("Failed to send streak reminder to user %s (%s): %s", user_id, student.telegram_chat_id, err)
            failed_deliveries += 1

    return {
        "status": "success",
        "date": today.isoformat(),
        "time": tashkent_now.strftime("%H:%M:%S"),
        "total_checked": checked_count,
        "reminders_sent": sent_count,
        "skipped_active_today": skipped_active_today,
        "failed_deliveries": failed_deliveries,
    }


def send_weekly_leaderboard(now_dt: Optional[datetime] = None) -> Dict[str, Any]:
    """Send Sunday weekly leaderboard Top-10 report to the configured Telegram channel/group."""
    from apps.core.lms_services import get_lms_leaderboard

    tashkent_now = get_tashkent_now(now_dt)
    target_chat = (
        os.environ.get("TELEGRAM_LEADERBOARD_CHANNEL_ID")
        or os.environ.get("TELEGRAM_CHANNEL_ID")
        or os.environ.get("TELEGRAM_GROUP_ID")
    )

    top_students = get_lms_leaderboard(period="weekly", limit=10)

    medals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"]

    lines = [
        "🏆 <b>Haftalik O'quvchilar Reytingi (Top-10) — BestWay</b>\n",
        f"📅 <i>{tashkent_now.strftime('%d.%m.%Y')} holatiga ko'ra eng faol o'quvchilar:</i>\n",
    ]

    if not top_students:
        lines.append("<i>Hozircha reyting jadvali shakllanmoqda...</i>")
    else:
        for idx, student in enumerate(top_students):
            badge = medals[idx] if idx < len(medals) else f"#{idx+1}"
            name = student.get("name", "O'quvchi")
            points = student.get("points", 0)
            group = student.get("group_name", "Individual")
            lines.append(f"{badge} <b>{name}</b> — <b>{points} XP</b> ({group})")

    lines.append("\n🔥 <i>Barcha o'quvchilarga yangi haftada zafarlar tilaymiz!</i>")
    lines.append("🌐 <a href=\"https://bestwayec.uz\">bestwayec.uz</a>")

    full_text = "\n".join(lines)

    reply_markup = {
        "inline_keyboard": [
            [
                {
                    "text": "📊 To'liq reytingni ko'rish",
                    "url": "https://bestwayec.uz/en/leaderboard",
                }
            ]
        ]
    }

    sent = False
    if target_chat:
        try:
            res = telegram_delivery.send(target_chat, full_text, reply_markup=reply_markup)
            sent = bool(res)
        except Exception as e:
            logger.warning("Failed to send weekly leaderboard to channel %s: %s", target_chat, e)

    return {
        "status": "success",
        "sent": sent,
        "target_chat_configured": bool(target_chat),
        "top_count": len(top_students),
        "message_preview": full_text[:120],
    }


# Optional Celery task wrappers
try:
    from celery import shared_task

    @shared_task(name="apps.notifications.telegram_tasks.check_daily_streaks_task")
    def check_daily_streaks_task():
        return check_daily_streaks()

    @shared_task(name="apps.notifications.telegram_tasks.send_weekly_leaderboard_task")
    def send_weekly_leaderboard_task():
        return send_weekly_leaderboard()

except Exception:
    def check_daily_streaks_task():
        return check_daily_streaks()

    def send_weekly_leaderboard_task():
        return send_weekly_leaderboard()
