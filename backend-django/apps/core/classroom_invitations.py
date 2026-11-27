"""Invitation management shared by the web application and the Telegram bot."""
from datetime import timedelta
from hashlib import sha256
import re
from secrets import token_hex

from django.core.cache import cache
from django.db import transaction
from django.utils import timezone

from . import groups
from .classroom_roster import active_enrollments, assert_active
from .models import ClassroomInvitation, ClassroomJoinRequest


def invitation_digest(code):
    if not isinstance(code, str) or not re.fullmatch(r"BW5-[0-9A-F]{24}", code.strip().upper()):
        groups.fail("INVITE_NOT_FOUND", "Taklif kodi topilmadi", 404)
    return sha256(code.strip().upper().encode()).hexdigest()


def limit_attempt(student_id):
    key = f"classroom-invitation:{student_id}"
    if not cache.add(key, 1, timeout=60):
        # The key may have expired between add and incr.
        try:
            count = cache.incr(key)
        except ValueError:
            cache.add(key, 1, timeout=60)
            return
        if count > 30:
            groups.fail("INVITE_RATE_LIMITED", "Biroz kutib, qayta urinib ko‘ring", 429)


def managed_group(actor, group_id, *, lock=False):
    group = groups.get_group(group_id, lock=lock)
    groups.assert_manages_group(actor, group)
    assert_active(group_id)
    return group


def invitation_status(actor, group_id):
    managed_group(actor, group_id)
    invite = ClassroomInvitation.objects.filter(group_id=group_id).first()
    if invite is None:
        return {"invitation": None, "requests": []}
    requests = ClassroomJoinRequest.objects.filter(
        invitation=invite, invitation_version=invite.version, status="pending",
    ).order_by("requested_at", "id").values("id", "student_id", "student__name")[:100]
    return {
        "invitation": {
            "expiresAt": invite.expires_at, "maxUses": invite.max_uses, "uses": invite.uses,
            "requiresApproval": invite.requires_approval, "revokedAt": invite.revoked_at,
            "active": not invite.revoked_at and invite.expires_at > timezone.now(),
        },
        "requests": [
            {"id": row["id"], "studentId": row["student_id"], "studentName": row["student__name"]}
            for row in requests
        ],
    }


@transaction.atomic
def issue(actor, group_id, *, requires_approval, expires_in_hours, max_uses):
    managed_group(actor, group_id, lock=True)
    code = f"BW5-{token_hex(12).upper()}"
    current = ClassroomInvitation.objects.filter(group_id=group_id).first()
    version = current.version + 1 if current else 1
    invite, _ = ClassroomInvitation.objects.update_or_create(group_id=group_id, defaults={
        "code_hash": invitation_digest(code), "version": version,
        "requires_approval": requires_approval, "max_uses": max_uses, "uses": 0,
        "expires_at": timezone.now() + timedelta(hours=expires_in_hours), "revoked_at": None,
    })
    ClassroomJoinRequest.objects.filter(invitation=invite, status="pending").update(
        status="cancelled", decided_at=timezone.now(),
    )
    groups.audit(actor, "classroom.invite.issue", "group", group_id, new={"version": version})
    return {"code": code, "expiresAt": invite.expires_at}


@transaction.atomic
def revoke(actor, group_id):
    managed_group(actor, group_id, lock=True)
    now = timezone.now()
    if ClassroomInvitation.objects.filter(group_id=group_id, revoked_at=None).update(revoked_at=now):
        ClassroomJoinRequest.objects.filter(invitation__group_id=group_id, status="pending").update(
            status="cancelled", decided_at=now,
        )
        groups.audit(actor, "classroom.invite.revoke", "group", group_id)
    return {"revoked": True}


def check_invitation(invite, *, check_capacity=True):
    if invite is None or invite.revoked_at:
        groups.fail("INVITE_NOT_FOUND", "Taklif kodi topilmadi", 404)
    if invite.expires_at <= timezone.now():
        groups.fail("INVITE_EXPIRED", "Taklif kodi muddati tugagan", 409)
    assert_active(invite.group_id)
    if check_capacity and invite.max_uses is not None and invite.uses >= invite.max_uses:
        groups.fail("INVITE_FULL", "Taklif limiti tugagan", 409)


def learner_is_active(user):
    if user.role != "student" or not user.is_active:
        groups.fail("FORBIDDEN", "Faqat faol o‘quvchi guruhga qo‘shila oladi", 403)


def public_invitation(invite, group):
    return {"groupId": group.id, "groupName": group.name, "requiresApproval": invite.requires_approval}


def preview(user, code):
    learner_is_active(user)
    limit_attempt(user.id)
    invite = ClassroomInvitation.objects.select_related("group").filter(code_hash=invitation_digest(code)).first()
    check_invitation(invite, check_capacity=False)
    if not active_enrollments(student_id=user.id, group_id=invite.group_id).exists():
        check_invitation(invite)
    return public_invitation(invite, invite.group)


@transaction.atomic
def redeem(user, code, *, source):
    learner_is_active(user)
    limit_attempt(user.id)
    digest = invitation_digest(code)
    group_id = ClassroomInvitation.objects.filter(code_hash=digest).values_list("group_id", flat=True).first()
    if group_id is None:
        check_invitation(None)
    group = groups.get_group(group_id, lock=True)
    invite = ClassroomInvitation.objects.filter(group_id=group_id, code_hash=digest).first()
    check_invitation(invite, check_capacity=False)
    user = groups.lock_student(user.id)
    learner_is_active(user)
    public = public_invitation(invite, group)
    if active_enrollments(group_id=group_id, student_id=user.id).exists():
        return {**public, "status": "active"}
    existing = ClassroomJoinRequest.objects.filter(
        invitation=invite, invitation_version=invite.version, student_id=user.id,
    ).first()
    if existing and existing.status in ("pending", "rejected"):
        return {**public, "status": existing.status}
    check_invitation(invite)
    if invite.requires_approval:
        if existing:
            # A staff removal does not allow re-enrollment with the same approval.
            groups.fail("INVITE_ALREADY_USED", "Bu taklif avval ishlatilgan", 409)
        ClassroomJoinRequest.objects.create(
            invitation=invite, invitation_version=invite.version, student_id=user.id, source=source,
        )
        return {**public, "status": "pending"}
    if groups.add_member(group.id, user, source=source):
        invite.uses += 1
        invite.save(update_fields=["uses"])
        groups.audit(user, "classroom.invite.redeem", "group", group.id)
    return {**public, "status": "active"}


@transaction.atomic
def decide(actor, group_id, request_id, *, approve):
    managed_group(actor, group_id, lock=True)
    row = ClassroomJoinRequest.objects.select_related("invitation").filter(
        id=request_id, invitation__group_id=group_id,
    ).first()
    if row is None:
        groups.fail("JOIN_REQUEST_NOT_FOUND", "So‘rov topilmadi", 404)
    decision = "approved" if approve else "rejected"
    if row.status == decision:
        return {"status": decision}
    if row.status != "pending" or row.invitation_version != row.invitation.version:
        groups.fail("JOIN_REQUEST_CLOSED", "So‘rov allaqachon yopilgan", 409)
    if approve:
        invite = row.invitation
        user = groups.lock_student(row.student_id)
        learner_is_active(user)
        already_member = active_enrollments(group_id=group_id, student_id=user.id).exists()
        check_invitation(invite, check_capacity=not already_member)
        if groups.add_member(group_id, user, source=row.source):
            invite.uses += 1
            invite.save(update_fields=["uses"])
    row.status, row.decided_at = decision, timezone.now()
    row.save(update_fields=["status", "decided_at"])
    groups.audit(actor, "classroom.invite.decide", "group", group_id, new={"requestId": row.id, "status": decision})
    return {"status": decision}
