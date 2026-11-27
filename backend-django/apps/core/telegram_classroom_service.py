"""Classroom-to-Telegram group binding service with explicit permission checks and outbox invalidation."""
from __future__ import annotations

import re

from django.core import signing
from django.db import IntegrityError, transaction
from django.utils import timezone

from common.api.exceptions import ContractAPIException

from . import groups
from . import telegram_delivery as api
from . import telegram_links as links
from . import telegram_outbox as outbox
from .classroom_roster import assert_active
from .models import TelegramClassroomBinding


def _serialize_binding(group_id: str, binding: TelegramClassroomBinding | None) -> dict:
    if binding is None or not binding.is_active:
        return {
            "groupId": group_id,
            "bound": False,
            "isActive": False,
            "chatId": None,
            "chatTitle": "",
            "botCanPost": False,
            "verifiedAt": binding.verified_at.isoformat() if binding and binding.verified_at else None,
            "disconnectedAt": binding.disconnected_at.isoformat() if binding and binding.disconnected_at else None,
        }
    return {
        "groupId": group_id,
        "bound": True,
        "isActive": bool(binding.is_active),
        "chatId": binding.chat_id,
        "chatTitle": binding.chat_title or "",
        "botCanPost": bool(binding.bot_can_post),
        "verifiedAt": binding.verified_at.isoformat() if binding.verified_at else None,
        "disconnectedAt": None,
    }


CONFIRMATION_SALT = "telegram-classroom-binding-v1"
CONFIRMATION_AGE = 300


def _chat_id(value):
    value = str(value or "").strip()
    if not re.fullmatch(r"-[1-9][0-9]{0,19}", value):
        raise ContractAPIException("TELEGRAM_GROUP_CHAT_REQUIRED", "Telegram guruh ID si kerak", 400)
    return value


def _telegram_identity(actor):
    from apps.legacy_schema.models import User

    identity = User.objects.filter(
        id=actor.id, is_active=True, role=actor.role,
    ).values_list("telegram_chat_id", flat=True).first()
    if not links._is_private_chat(identity):
        raise ContractAPIException("TELEGRAM_LINK_REQUIRED", "Shaxsiy Telegram akkauntingizni bog‘lang", 403)
    return str(identity)


def verify_group_permissions(chat_id: str, telegram_id: str) -> str:
    """Require authenticated Telegram proof for both the sender and the bot."""
    chat = api.call("getChat", {"chat_id": chat_id})
    bot = api.call("getMe", {})
    if not isinstance(chat, dict) or not isinstance(bot, dict) or not bot.get("id"):
        raise ContractAPIException("TELEGRAM_VERIFICATION_UNAVAILABLE", "Telegram tekshiruvi mavjud emas", 503)
    chat_type = chat.get("type")
    if str(chat.get("id")) != chat_id or chat_type not in ("group", "supergroup", "channel"):
        raise ContractAPIException("TELEGRAM_GROUP_CHAT_REQUIRED", "Telegram guruh ID si kerak", 400)
    manager = api.call("getChatMember", {"chat_id": chat_id, "user_id": int(telegram_id)})
    member = api.call("getChatMember", {"chat_id": chat_id, "user_id": bot["id"]})
    if not isinstance(manager, dict) or not isinstance(member, dict):
        raise ContractAPIException("TELEGRAM_VERIFICATION_UNAVAILABLE", "Telegram tekshiruvi mavjud emas", 503)
    if manager.get("status") not in ("creator", "administrator"):
        raise ContractAPIException("TELEGRAM_MANAGER_REQUIRED", "Telegram guruh administratori bo‘lishingiz kerak", 403)
    status = member.get("status")
    can_post = status in ("creator", "administrator")
    if status == "administrator" and chat_type == "channel":
        can_post = member.get("can_post_messages") is True
    elif status == "member" and chat_type != "channel":
        can_post = (chat.get("permissions") or {}).get("can_send_messages") is True
    elif status == "restricted" and chat_type == "supergroup":
        can_post = member.get("is_member") is True and member.get("can_send_messages") is True
    if not can_post:
        raise ContractAPIException("TELEGRAM_BOT_NO_PERMISSION", "Botda guruhga xabar yuborish huquqi yo‘q", 403)
    return str(chat.get("title") or "")[:255]


def request_binding(actor, group_id: str, chat_id: str, *, sender_id) -> str:
    group = groups.get_group(group_id)
    groups.assert_manages_group(actor, group)
    assert_active(group.id)
    chat_id = _chat_id(chat_id)
    identity = _telegram_identity(actor)
    if str(sender_id) != identity:
        raise ContractAPIException("TELEGRAM_LINK_REQUIRED", "Shaxsiy Telegram akkauntingizni bog‘lang", 403)
    verify_group_permissions(chat_id, identity)
    binding = TelegramClassroomBinding.objects.filter(group_id=group.id).first()
    return signing.dumps(
        [actor.id, group.id, chat_id, identity, binding.updated_at.isoformat() if binding else None],
        salt=CONFIRMATION_SALT,
    )


def verify_current_binding(binding):
    from apps.legacy_schema.models import User

    if not binding.verified_telegram_id:
        raise ContractAPIException("TELEGRAM_CONFIRMATION_REQUIRED", "Telegram bog‘lanishini tasdiqlang", 403)
    actor = User.objects.filter(id=binding.bound_by_id, is_active=True).first()
    if not actor or actor.telegram_chat_id != binding.verified_telegram_id:
        raise ContractAPIException("TELEGRAM_LINK_REQUIRED", "Telegram akkaunti bog‘lanmagan", 403)
    groups.assert_manages_group(actor, groups.get_group(binding.group_id))
    assert_active(binding.group_id)
    verify_group_permissions(binding.chat_id, binding.verified_telegram_id)


def get_binding(actor, group_id: str) -> dict:
    group = groups.get_group(group_id)
    groups.assert_manages_group(actor, group)
    binding = TelegramClassroomBinding.objects.filter(group_id=group.id).first()
    return _serialize_binding(group.id, binding)


def bind_group_chat(actor, group_id: str, chat_id: str, *, confirmation=None) -> dict:
    group = groups.get_group(group_id)
    groups.assert_manages_group(actor, group)
    assert_active(group.id)
    raw_chat = _chat_id(chat_id)
    identity = _telegram_identity(actor)
    try:
        if not isinstance(confirmation, str) or not confirmation or len(confirmation) > 2048:
            raise signing.BadSignature()
        actor_id, classroom, target, sender, revision = signing.loads(
            confirmation, salt=CONFIRMATION_SALT, max_age=CONFIRMATION_AGE,
        )
        if [actor_id, classroom, target, sender] != [actor.id, group.id, raw_chat, identity]:
            raise signing.BadSignature()
    except (signing.BadSignature, TypeError, ValueError):
        raise ContractAPIException(
            "TELEGRAM_CONFIRMATION_REQUIRED", "Telegram guruhida /bind orqali bog‘lanishni tasdiqlang", 403,
        )

    title = verify_group_permissions(raw_chat, identity)
    try:
        with transaction.atomic():
            groups.assert_manages_group(actor, groups.get_group(group.id, lock=True))
            assert_active(group.id)
            if _telegram_identity(actor) != identity:
                raise ContractAPIException("TELEGRAM_LINK_REQUIRED", "Telegram bog‘lanishi o‘zgargan", 403)
            binding = TelegramClassroomBinding.objects.filter(group_id=group.id).first()
            if binding and binding.is_active and binding.chat_id != raw_chat:
                raise ContractAPIException("TELEGRAM_ALREADY_BOUND", "Avval joriy Telegram guruhini uzing", 409)
            if revision != (binding.updated_at.isoformat() if binding else None):
                raise ContractAPIException("TELEGRAM_CONFIRMATION_STALE", "Bog‘lanishni qayta tasdiqlang", 409)
            outbox.invalidate_group_queue(group.id, "group_rebound")
            binding, _ = TelegramClassroomBinding.objects.update_or_create(
                group_id=group.id,
                defaults={
                    "chat_id": raw_chat,
                    "chat_title": title,
                    "bound_by_id": actor.id,
                    "verified_telegram_id": identity,
                    "is_active": True,
                    "bot_can_post": True,
                    "verified_at": timezone.now(),
                    "disconnected_at": None,
                },
            )
    except IntegrityError as error:
        if getattr(error.__cause__, "diag", None) and error.__cause__.diag.constraint_name == "telegram_unique_verified_chat":
            raise ContractAPIException("TELEGRAM_CHAT_ALREADY_BOUND", "Telegram guruhi avval bog‘langan", 409) from error
        raise
    return _serialize_binding(group.id, binding)


def disconnect_group_chat(actor, group_id: str, *, expected_chat_id=None) -> dict:
    group = groups.get_group(group_id)
    groups.assert_manages_group(actor, group)
    now = timezone.now()
    with transaction.atomic():
        groups.assert_manages_group(actor, groups.get_group(group.id, lock=True))
        binding = TelegramClassroomBinding.objects.filter(group_id=group.id).first()
        if expected_chat_id is not None and (
            not binding or not binding.is_active or binding.chat_id != expected_chat_id
        ):
            raise ContractAPIException("TELEGRAM_BINDING_MISMATCH", "Ushbu chat guruhga bog‘lanmagan", 403)
        if binding is not None and binding.is_active:
            binding.is_active = False
            binding.disconnected_at = now
            binding.save(update_fields=["is_active", "disconnected_at", "updated_at"])
        invalidated = outbox.invalidate_group_queue(group.id, "group_disconnected")
    return {
        "groupId": group.id,
        "disconnected": True,
        "invalidatedCount": invalidated,
        **_serialize_binding(group.id, binding),
    }
