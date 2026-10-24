"""Parent Telegram Monitoring and Weekly Digest Service."""
import logging
import random
from datetime import timedelta
from typing import Any
from django.utils import timezone
from apps.core.models import ParentTelegramLink, VocabularyAttempt
from apps.legacy_schema.models import User, Attendance, PointsLog
from apps.core import telegram_delivery as api

logger = logging.getLogger(__name__)


def get_or_create_parent_invite_code(student_id: str, student_name: str = "") -> dict[str, Any]:
    """Retrieve or generate a 6-digit parent invite code (e.g. BW-849201)."""
    link = ParentTelegramLink.objects.filter(student_id=student_id, is_active=True).first()
    if not link:
        # Generate clean human invite code
        num = random.randint(100000, 999999)
        code = f"BW-{num}"
        # Ensure unique
        while ParentTelegramLink.objects.filter(invite_code=code).exists():
            num = random.randint(100000, 999999)
            code = f"BW-{num}"

        user = User.objects.filter(id=student_id).first()
        st_name = getattr(user, "name", "") or student_name or "O'quvchi"

        link = ParentTelegramLink.objects.create(
            student_id=student_id,
            invite_code=code,
            is_active=True,
        )

    bot_username = "bestway_education_bot"
    deep_link = f"https://t.me/{bot_username}?start=parent_{link.invite_code}"

    return {
        "inviteCode": link.invite_code,
        "isLinked": bool(link.parent_chat_id),
        "parentName": link.parent_name or "",
        "deepLink": deep_link,
        "linkedAt": link.linked_at.isoformat() if link.linked_at else None,
    }


def link_parent_by_code(chat_id: str, invite_code: str, parent_name: str = "") -> dict[str, Any]:
    """Link a parent's Telegram chat_id using an invite code."""
    cleaned = invite_code.strip()
    if cleaned.lower().startswith("parent_"):
        cleaned = cleaned[7:].strip()

    link = (
        ParentTelegramLink.objects.filter(invite_code__iexact=cleaned, is_active=True)
        .select_related("student")
        .first()
    )
    if not link:
        return {
            "success": False,
            "message": "Kiritilgan taklif kodi topilmadi yoki muddati o'tgan. Iltimos, farzandingiz profilidagi kodni tekshiring.",
        }

    link.parent_chat_id = str(chat_id)
    if parent_name:
        link.parent_name = parent_name
    link.linked_at = timezone.now()
    link.save(update_fields=["parent_chat_id", "parent_name", "linked_at", "updated_at"])

    student_name = getattr(link.student, "name", "Farzandingiz") if link.student else "Farzandingiz"

    return {
        "success": True,
        "studentName": student_name,
        "studentId": link.student_id,
        "inviteCode": link.invite_code,
    }


def notify_parent_attendance(student_id: str, state: str, date_str: str, group_name: str = "") -> bool:
    """Notify linked parent when student is absent or late."""
    if state not in ("absent", "late"):
        return False

    links = ParentTelegramLink.objects.filter(
        student_id=student_id,
        is_active=True,
        parent_chat_id__isnull=False,
    ).exclude(parent_chat_id="")

    if not links.exists():
        return False

    user = User.objects.filter(id=student_id).first()
    student_name = getattr(user, "name", "Farzandingiz") or "Farzandingiz"

    if state == "absent":
        state_label = "Darsga qatnashmadi (Kelmadi ❌)"
    else:
        state_label = "Darsga kechikib keldi ⚠️"

    msg = (
        "🔔 <b>Davomat Xabarnomasi</b>\n"
        "━━━━━━━━━━━━━━━━━━\n"
        f"Hurmatli ota-ona! Farzandingiz <b>{student_name}</b> {date_str} kuni "
        f"{group_name or 'dars'} mashg'ulotiga <b>{state_label}</b> deb qayd etildi.\n\n"
        "Batafsil ma'lumot olish yoki sababini bildirish uchun markaz ma'muriyati bilan bog'lanishingiz mumkin."
    )

    sent = False
    for lk in links:
        try:
            api.send(lk.parent_chat_id, msg)
            sent = True
        except Exception as err:
            logger.warning("Failed to send attendance alert to parent %s: %s", lk.parent_chat_id, err)

    return sent


def notify_parent_exam_result(student_id: str, exam_title: str, score_text: str, skill: str = "") -> bool:
    """Notify linked parent when an exam or practice attempt is completed."""
    links = ParentTelegramLink.objects.filter(
        student_id=student_id,
        is_active=True,
        parent_chat_id__isnull=False,
    ).exclude(parent_chat_id="")

    if not links.exists():
        return False

    user = User.objects.filter(id=student_id).first()
    student_name = getattr(user, "name", "Farzandingiz") or "Farzandingiz"

    skill_str = f"({skill})" if skill else ""
    msg = (
        "🏆 <b>Yangi Natija Xabarnomasi</b>\n"
        "━━━━━━━━━━━━━━━━━━\n"
        f"Hurmatli ota-ona! Farzandingiz <b>{student_name}</b> bugun <b>'{exam_title}'</b> {skill_str} bo'yicha amaliyot topshirdi!\n\n"
        f"📊 Qayd etilgan natija: <b>{score_text}</b>\n"
        "⭐ To'plangan ballar o'quvchining shaxsiy reytingiga muvaffaqiyatli qo'shildi!"
    )

    sent = False
    for lk in links:
        try:
            api.send(lk.parent_chat_id, msg)
            sent = True
        except Exception as err:
            logger.warning("Failed to send exam result alert to parent %s: %s", lk.parent_chat_id, err)

    return sent


def send_weekly_parent_digest(student_id: str | None = None) -> dict[str, int]:
    """Generate and dispatch weekly performance digest to active parent telegram chats."""
    now = timezone.now()
    since_date = (now - timedelta(days=7)).date()

    qs = ParentTelegramLink.objects.filter(
        is_active=True,
        parent_chat_id__isnull=False,
    ).exclude(parent_chat_id="")

    if student_id:
        qs = qs.filter(student_id=student_id)

    links = list(qs.select_related("student"))
    sent_count = 0
    failed_count = 0

    for link in links:
        try:
            st_id = link.student_id
            st_user = link.student
            st_name = getattr(st_user, "name", "Farzandingiz") or "Farzandingiz"

            # Attendance in last 7 days
            attendances = list(Attendance.objects.filter(student_id=st_id, date__gte=since_date))
            total_lessons = len(attendances)
            present_count = sum(1 for a in attendances if a.state == "present")
            absent_count = sum(1 for a in attendances if a.state == "absent")
            late_count = sum(1 for a in attendances if a.state == "late")
            attendance_pct = round((present_count / total_lessons * 100), 1) if total_lessons > 0 else 100.0

            # Vocabulary in last 7 days
            vocab_attempts = list(
                VocabularyAttempt.objects.filter(student_id=st_id, completed_at__gte=now - timedelta(days=7))
            )
            vocab_count = len(vocab_attempts)
            vocab_avg = (
                round(sum(v.percentage for v in vocab_attempts) / vocab_count, 1)
                if vocab_count > 0
                else 0.0
            )

            # Points change
            points_entries = list(
                PointsLog.objects.filter(student_id=st_id, created_at__gte=now - timedelta(days=7))
            )
            points_sum = sum(p.change for p in points_entries)

            digest_msg = (
                "📋 <b>BestWay Haftalik O'zlashtirish Hisoboti (Digest)</b>\n"
                "━━━━━━━━━━━━━━━━━━━━\n"
                f"👤 O'quvchi: <b>{st_name}</b>\n"
                f"📅 Davr: So'nggi 7 kun ({since_date.strftime('%d.%m')} - {now.strftime('%d.%m.%Y')})\n\n"
                f"✅ <b>Davomat ko'rsatkichi:</b> {attendance_pct}%\n"
                f"   • Qatnashdi: {present_count} ta dars\n"
                f"   • Kechikdi: {late_count} ta | Kelmadi: {absent_count} ta\n\n"
                f"📚 <b>Lug'at amaliyoti:</b> {vocab_count} ta test\n"
                f"   • O'rtacha o'zlashtirish: {vocab_avg}%\n\n"
                f"⭐ <b>Haftalik to'plangan ballar:</b> +{points_sum} ball\n"
                "━━━━━━━━━━━━━━━━━━━━\n"
                "Farzandingizning kelajagi va ta'limiga befarq bo'lmaganingiz uchun tashakkur!"
            )

            api.send(link.parent_chat_id, digest_msg)
            sent_count += 1
        except Exception as e:
            logger.error("Failed to compile weekly digest for student %s: %s", link.student_id, e)
            failed_count += 1

    return {"sentCount": sent_count, "failedCount": failed_count}
