"""Administrator-assisted safe account discovery, conflict detection, and transactional merging."""
from __future__ import annotations

import hashlib
import hmac
import re
from collections import defaultdict
from django.conf import settings
from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone

from apps.legacy_schema.models import (
    AssessmentJob,
    Attendance,
    Group,
    MockAttempt,
    MockPurchase,
    Notification,
    ParentStudent,
    Payment,
    PointsLog,
    RefreshToken,
    StudentProfile,
    TestAttempt,
    User,
    VideoPurchase,
)
from common.api.exceptions import ContractAPIException

from .models import (
    AccountReconciliationLog,
    ClassQuizAttempt,
    ClassroomEnrollment,
    Cohort,
    CohortMembership,
    HomeworkSubmission,
    UserLessonProgress,
    UserWeakWord,
    VocabularyAttempt,
    VocabularySet,
)
from .system_settings import audit


def fail(code: str, message: str, status: int = 400):
    raise ContractAPIException(code, message, status)


def normalize_phone(phone: str | None) -> str:
    digits = re.sub(r"\D", "", str(phone or ""))
    if len(digits) == 9:
        digits = "998" + digits
    return digits if len(digits) >= 9 else ""


def normalize_email(email: str | None) -> str:
    val = str(email or "").strip().lower()
    return val if "@" in val else ""


def _account_summary(user: User, profile: StudentProfile | None) -> dict:
    active_groups = list(
        ClassroomEnrollment.objects.filter(student_id=user.id, ended_at__isnull=True)
        .select_related("group__teacher")
        .order_by("group__name")
    )
    return {
        "id": user.id,
        "name": user.name,
        "phone": user.phone,
        "email": user.email,
        "role": user.role,
        "isActive": user.is_active,
        "telegramLinked": bool(user.telegram_chat_id),
        "telegramChatId": user.telegram_chat_id,
        "createdAt": user.created_at.isoformat() if user.created_at else None,
        "student": {
            "isApproved": profile.is_approved,
            "currentPoints": profile.current_points,
            "activeProgram": profile.active_program,
            "availablePrograms": list(profile.available_programs or []),
            "groupId": profile.group_id,
        } if profile else None,
        "memberships": [
            {
                "groupId": row.group_id,
                "groupName": row.group.name,
                "teacherName": row.group.teacher.name if row.group.teacher else None,
                "startedAt": row.started_at.isoformat() if row.started_at else None,
                "source": row.source,
            }
            for row in active_groups
        ],
        "counts": {
            "mockAttempts": MockAttempt.objects.filter(student_id=user.id).count(),
            "testAttempts": TestAttempt.objects.filter(student_id=user.id).count(),
            "payments": Payment.objects.filter(student_id=user.id).count(),
            "attendance": Attendance.objects.filter(student_id=user.id).count(),
            "homework": HomeworkSubmission.objects.filter(student_id=user.id).count(),
            "vocabulary": VocabularyAttempt.objects.filter(student_id=user.id).count(),
            "parents": ParentStudent.objects.filter(student_id=user.id).count(),
        },
    }


def _preview_token(source_id: str, canonical_id: str, basis: str, stamp: str) -> str:
    payload = f"{source_id}:{canonical_id}:{basis}:{stamp}".encode()
    return hmac.new(settings.SECRET_KEY.encode(), payload, hashlib.sha256).hexdigest()[:24]


def discover_duplicates(actor) -> list[dict]:
    """Find potential duplicate accounts ONLY by verified identity signals (normalized phone, email, telegram)."""
    if actor.role not in ("admin", "super_admin"):
        fail("FORBIDDEN", "Faqat administrator dublikat akkauntlarni tekshira oladi", 403)

    users = list(User.objects.filter(is_active=True).exclude(role="super_admin").order_by("created_at"))
    profiles = {p.user_id: p for p in StudentProfile.objects.filter(user_id__in=[u.id for u in users])}
    by_phone = defaultdict(list)
    by_email = defaultdict(list)
    by_telegram = defaultdict(list)

    for u in users:
        np = normalize_phone(u.phone)
        if np:
            by_phone[np].append(u)
        ne = normalize_email(u.email)
        if ne:
            by_email[ne].append(u)
        if u.telegram_chat_id:
            by_telegram[str(u.telegram_chat_id).strip()].append(u)

    candidates = []
    seen_pairs = set()

    def add_group(signal: str, items: list[User]):
        if len(items) < 2:
            return
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                a, b = items[i], items[j]
                pair = tuple(sorted((a.id, b.id)))
                if pair in seen_pairs:
                    continue
                seen_pairs.add(pair)
                candidates.append({
                    "signal": signal,
                    "verifiedIdentityMatch": True,
                    "accounts": [
                        _account_summary(a, profiles.get(a.id)),
                        _account_summary(b, profiles.get(b.id)),
                    ],
                })

    for items in by_phone.values():
        add_group("phone_match", items)
    for items in by_email.values():
        add_group("email_match", items)
    for items in by_telegram.values():
        add_group("telegram_match", items)

    return candidates[:100]


def _evaluate_pair(source: User, canonical: User, *, verified_ownership: bool, transfer_telegram: bool):
    blockers = []
    warnings = []

    if source.id == canonical.id:
        blockers.append({"code": "SAME_ACCOUNT", "message": "Manba va asosiy akkaunt bir xil bo'lishi mumkin emas"})
    if source.role == "super_admin" or canonical.role == "super_admin":
        blockers.append({"code": "SUPER_ADMIN_FORBIDDEN", "message": "Super admin akkauntini birlashtirish taqiqlangan"})
    if source.role != canonical.role:
        blockers.append({"code": "ROLE_MISMATCH", "message": f"Rollar mos emas: {source.role} != {canonical.role}"})
    if not source.is_active:
        blockers.append({"code": "SOURCE_INACTIVE", "message": "Manba akkaunt allaqachon faolsizlantirilgan"})
    if not canonical.is_active:
        blockers.append({"code": "CANONICAL_INACTIVE", "message": "Asosiy akkaunt faol emas"})

    same_phone = bool(normalize_phone(source.phone) and normalize_phone(source.phone) == normalize_phone(canonical.phone))
    same_email = bool(normalize_email(source.email) and normalize_email(source.email) == normalize_email(canonical.email))
    same_telegram = bool(source.telegram_chat_id and source.telegram_chat_id == canonical.telegram_chat_id)

    if same_phone:
        identity_basis = "phone_match"
    elif same_email:
        identity_basis = "email_match"
    elif same_telegram:
        identity_basis = "telegram_match"
    elif verified_ownership:
        identity_basis = "admin_verified"
        warnings.append({
            "code": "MANUAL_IDENTITY_ATTESTATION",
            "message": "Telefon, email yoki Telegram bir xil emas — egasi tasdiqlanganligi administrator tomonidan tasdiqlandi",
        })
    else:
        identity_basis = "unverified"
        blockers.append({
            "code": "IDENTITY_UNVERIFIED",
            "message": "Shaxsiy identifikator (telefon/email/Telegram) tasdiqlanmagan. Faqat ism o'xshashligi bo'yicha birlashtirish taqiqlanadi.",
        })

    if source.telegram_chat_id and canonical.telegram_chat_id and source.telegram_chat_id != canonical.telegram_chat_id:
        blockers.append({
            "code": "TELEGRAM_IDENTITY_CONFLICT",
            "message": "Ikkala akkauntda har xil Telegram bog'lanishi mavjud. Telegram identifikatorini jimgina almashtirish taqiqlanadi.",
        })
    elif source.telegram_chat_id and not canonical.telegram_chat_id and not transfer_telegram:
        blockers.append({
            "code": "TELEGRAM_TRANSFER_CONFIRMATION_REQUIRED",
            "message": "Manba akkauntda Telegram bog'langan. Uni o'tkazish uchun transferTelegram tasdig'i talab qilinadi.",
        })

    # Payment conflict detection (same year & month with different state or non-zero different amount)
    src_payments = {(p.year, p.month): p for p in Payment.objects.filter(student_id=source.id)}
    can_payments = {(p.year, p.month): p for p in Payment.objects.filter(student_id=canonical.id)}
    for ym in sorted(set(src_payments) & set(can_payments)):
        sp, cp = src_payments[ym], can_payments[ym]
        if sp.state != cp.state or (sp.amount and cp.amount and sp.amount != cp.amount):
            blockers.append({
                "code": "PAYMENT_CONFLICT",
                "message": f"{ym[0]}-{ym[1]:02d} oyi uchun to'lov yozuvlari ziddiyatli ({sp.state}/{sp.amount} vs {cp.state}/{cp.amount})",
            })

    # Attendance conflict detection (same group & date with different state)
    src_att = {(a.group_id, a.date): a for a in Attendance.objects.filter(student_id=source.id)}
    can_att = {(a.group_id, a.date): a for a in Attendance.objects.filter(student_id=canonical.id)}
    for gd in sorted(set(src_att) & set(can_att)):
        if src_att[gd].state != can_att[gd].state:
            blockers.append({
                "code": "ATTENDANCE_CONFLICT",
                "message": f"{gd[1].isoformat()} sanasidagi davomat yozuvi ziddiyatli ({src_att[gd].state} vs {can_att[gd].state})",
            })

    return identity_basis, blockers, warnings


def preview_merge(actor, source_id: str, canonical_id: str, *, verified_ownership: bool = False, transfer_telegram: bool = False) -> dict:
    if actor.role not in ("admin", "super_admin"):
        fail("FORBIDDEN", "Ruxsat berilmagan", 403)
    source = User.objects.filter(id=source_id).first()
    canonical = User.objects.filter(id=canonical_id).first()
    if source is None or canonical is None:
        fail("USER_NOT_FOUND", "Foydalanuvchi topilmadi", 404)

    src_profile = StudentProfile.objects.filter(user_id=source.id).first()
    can_profile = StudentProfile.objects.filter(user_id=canonical.id).first()
    identity_basis, blockers, warnings = _evaluate_pair(
        source, canonical, verified_ownership=verified_ownership, transfer_telegram=transfer_telegram,
    )
    stamp = f"{source.updated_at.isoformat() if source.updated_at else ''}|{canonical.updated_at.isoformat() if canonical.updated_at else ''}"
    return {
        "canMerge": len(blockers) == 0,
        "identityBasis": identity_basis,
        "blockers": blockers,
        "warnings": warnings,
        "previewToken": _preview_token(source.id, canonical.id, identity_basis, stamp),
        "source": _account_summary(source, src_profile),
        "canonical": _account_summary(canonical, can_profile),
    }


@transaction.atomic
def execute_merge(
    actor,
    source_id: str,
    canonical_id: str,
    *,
    reason: str,
    confirm_text: str,
    preview_token: str,
    verified_ownership: bool = False,
    transfer_telegram: bool = False,
) -> dict:
    if actor.role not in ("admin", "super_admin"):
        fail("FORBIDDEN", "Ruxsat berilmagan", 403)
    if confirm_text.strip().upper() != "MERGE":
        fail("CONFIRMATION_REQUIRED", "Tasdiqlash uchun 'MERGE' so'zini kiriting", 400)
    if len(reason.strip()) < 5:
        fail("REASON_REQUIRED", "Birlashtirish sababini (kamida 5 belgi) kiriting", 400)

    pair_ids = sorted([source_id, canonical_id])
    locked_users = {u.id: u for u in User.objects.select_for_update().filter(id__in=pair_ids).order_by("id")}
    source = locked_users.get(source_id)
    canonical = locked_users.get(canonical_id)
    if source is None or canonical is None:
        fail("USER_NOT_FOUND", "Foydalanuvchi topilmadi", 404)

    identity_basis, blockers, _ = _evaluate_pair(
        source, canonical, verified_ownership=verified_ownership, transfer_telegram=transfer_telegram,
    )
    if blockers:
        raise ContractAPIException("MERGE_BLOCKED", blockers[0]["message"], 409, details={"blockers": blockers})

    stamp = f"{source.updated_at.isoformat() if source.updated_at else ''}|{canonical.updated_at.isoformat() if canonical.updated_at else ''}"
    expected_token = _preview_token(source.id, canonical.id, identity_basis, stamp)
    if not hmac.compare_digest(preview_token or "", expected_token):
        fail("PREVIEW_STALE", "Akkaunt holati o'zgargan, avval qayta ko'rib chiqing", 409)

    src_profile = StudentProfile.objects.select_for_update().filter(user_id=source.id).first()
    can_profile = StudentProfile.objects.select_for_update().filter(user_id=canonical.id).first()
    snapshot_before = {
        "source": _account_summary(source, src_profile),
        "canonical": _account_summary(canonical, can_profile),
    }

    now = timezone.now()
    transferred = {}

    # 1. Classroom memberships (preserve open periods without violating unique open constraint)
    can_open_groups = set(
        ClassroomEnrollment.objects.filter(student_id=canonical.id, ended_at__isnull=True).values_list("group_id", flat=True)
    )
    moved_enrollments = 0
    for row in ClassroomEnrollment.objects.filter(student_id=source.id):
        if row.ended_at is None and row.group_id in can_open_groups:
            row.ended_at = now
            row.save(update_fields=["ended_at"])
        else:
            row.student_id = canonical.id
            row.save(update_fields=["student_id"])
            moved_enrollments += 1
    transferred["enrollments"] = moved_enrollments

    # 2. Cohort memberships
    can_cohorts = set(CohortMembership.objects.filter(student_id=canonical.id).values_list("cohort_id", flat=True))
    moved_cohorts = 0
    for cm in CohortMembership.objects.filter(student_id=source.id):
        if cm.cohort_id in can_cohorts:
            cm.delete()
        else:
            cm.student_id = canonical.id
            cm.save(update_fields=["student_id"])
            moved_cohorts += 1
    transferred["cohortMemberships"] = moved_cohorts

    # 3. Homework submissions
    can_hw = set(HomeworkSubmission.objects.filter(student_id=canonical.id).values_list("assignment_id", flat=True))
    transferred["homeworkSubmissions"] = HomeworkSubmission.objects.filter(student_id=source.id).exclude(
        assignment_id__in=can_hw,
    ).update(student_id=canonical.id)

    # 4. Exams, AssessmentJobs, Purchases, Vocabulary, Lesson Progress, ClassQuizzes
    transferred["mockAttempts"] = MockAttempt.objects.filter(student_id=source.id).update(student_id=canonical.id)
    transferred["assessmentJobs"] = AssessmentJob.objects.filter(student_id=source.id).update(student_id=canonical.id)
    transferred["testAttempts"] = TestAttempt.objects.filter(student_id=source.id).update(student_id=canonical.id)
    transferred["classQuizAttempts"] = ClassQuizAttempt.objects.filter(student_id=source.id).update(student_id=canonical.id)

    can_mock_p = set(MockPurchase.objects.filter(user_id=canonical.id).values_list("exam_id", flat=True))
    transferred["mockPurchases"] = MockPurchase.objects.filter(user_id=source.id).exclude(exam_id__in=can_mock_p).update(user_id=canonical.id)

    can_vid_p = set(VideoPurchase.objects.filter(user_id=canonical.id).values_list("video_id", flat=True))
    transferred["videoPurchases"] = VideoPurchase.objects.filter(user_id=source.id).exclude(video_id__in=can_vid_p).update(user_id=canonical.id)

    transferred["vocabularyAttempts"] = VocabularyAttempt.objects.filter(student_id=source.id).update(student_id=canonical.id)
    can_weak = set(UserWeakWord.objects.filter(student_id=canonical.id).values_list("word_id", flat=True))
    UserWeakWord.objects.filter(student_id=source.id).exclude(word_id__in=can_weak).update(student_id=canonical.id)

    can_lessons = set(UserLessonProgress.objects.filter(user_id=canonical.id).values_list("lesson_id", flat=True))
    UserLessonProgress.objects.filter(user_id=source.id).exclude(lesson_id__in=can_lessons).update(user_id=canonical.id)

    # 5. Payments & Attendance (already verified conflict-free above)
    can_pay_keys = set(Payment.objects.filter(student_id=canonical.id).values_list("year", "month"))
    moved_payments = 0
    for p in Payment.objects.filter(student_id=source.id):
        if (p.year, p.month) not in can_pay_keys:
            p.student_id = canonical.id
            p.save(update_fields=["student_id"])
            moved_payments += 1
    transferred["payments"] = moved_payments

    can_att_keys = set(Attendance.objects.filter(student_id=canonical.id).values_list("group_id", "date"))
    moved_att = 0
    for a in Attendance.objects.filter(student_id=source.id):
        if (a.group_id, a.date) not in can_att_keys:
            a.student_id = canonical.id
            a.save(update_fields=["student_id"])
            moved_att += 1
    transferred["attendance"] = moved_att

    # 6. Points & Parents
    transferred["pointsLogs"] = PointsLog.objects.filter(student_id=source.id).update(student_id=canonical.id)
    if src_profile and can_profile and src_profile.current_points:
        StudentProfile.objects.filter(user_id=canonical.id).update(
            current_points=F("current_points") + src_profile.current_points,
        )
        StudentProfile.objects.filter(user_id=source.id).update(current_points=0)
    if src_profile and can_profile and can_profile.group_id is None and src_profile.group_id is not None:
        StudentProfile.objects.filter(user_id=canonical.id).update(group_id=src_profile.group_id)

    existing_parents = set(ParentStudent.objects.filter(student_id=canonical.id).values_list("parent_user_id", flat=True))
    moved_parents = 0
    for ps in ParentStudent.objects.filter(student_id=source.id):
        if ps.parent_user_id not in existing_parents:
            ParentStudent.objects.filter(parent_user_id=ps.parent_user_id, student_id=source.id).update(student_id=canonical.id)
            moved_parents += 1
    transferred["parentLinks"] = moved_parents

    # 7. Teacher ownership if applicable
    if canonical.role == "teacher":
        transferred["groups"] = Group.objects.filter(teacher_id=source.id).update(teacher_id=canonical.id)
        transferred["cohorts"] = Cohort.objects.filter(teacher_id=source.id).update(teacher_id=canonical.id)
        transferred["vocabularySets"] = VocabularySet.objects.filter(created_by_id=source.id).update(created_by_id=canonical.id)

    Notification.objects.filter(user_id=source.id).update(user_id=canonical.id)

    # 8. Optional explicit Telegram transfer and deactivate source
    if transfer_telegram and source.telegram_chat_id and not canonical.telegram_chat_id:
        tg_id = source.telegram_chat_id
        User.objects.filter(id=source.id).update(telegram_chat_id=None, updated_at=now)
        User.objects.filter(id=canonical.id).update(telegram_chat_id=tg_id, updated_at=now)
        transferred["telegramTransferred"] = True
    else:
        transferred["telegramTransferred"] = False

    User.objects.filter(id=source.id).update(is_active=False, updated_at=now)
    RefreshToken.objects.filter(user_id=source.id).delete()

    log = AccountReconciliationLog.objects.create(
        canonical_user_id=canonical.id,
        source_user_id=source.id,
        actor_id=actor.id,
        reason=reason.strip(),
        identity_basis=identity_basis,
        snapshot_before=snapshot_before,
        transferred_summary=transferred,
    )
    audit(
        actor,
        "account.reconcile_merge",
        "user",
        canonical.id,
        old={"sourceId": source.id, "identityBasis": identity_basis},
        new={"canonicalId": canonical.id, "logId": log.id, "transferred": transferred},
    )
    return {
        "merged": True,
        "logId": log.id,
        "canonicalUserId": canonical.id,
        "sourceUserId": source.id,
        "transferred": transferred,
    }


def history(actor) -> list[dict]:
    if actor.role not in ("admin", "super_admin"):
        fail("FORBIDDEN", "Ruxsat berilmagan", 403)
    rows = list(AccountReconciliationLog.objects.order_by("-created_at")[:50])
    actor_ids = {r.actor_id for r in rows}
    names = dict(User.objects.filter(id__in=actor_ids).values_list("id", "name"))
    return [
        {
            "id": r.id,
            "canonicalUserId": r.canonical_user_id,
            "sourceUserId": r.source_user_id,
            "actorId": r.actor_id,
            "actorName": names.get(r.actor_id, r.actor_id),
            "reason": r.reason,
            "identityBasis": r.identity_basis,
            "transferredSummary": r.transferred_summary,
            "createdAt": r.created_at,
        }
        for r in rows
    ]
