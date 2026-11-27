"""Classroom-to-Telegram group binding service with explicit permission checks and outbox invalidation."""
from __future__ import annotations

import os

from django.db import transaction
from django.utils import timezone

from common.api.exceptions import ContractAPIException

from . import groups
from . import telegram_delivery as api
from . import telegram_links as links
from . import telegram_outbox as outbox
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


def verify_bot_group_permissions(chat_id: str, *, fallback_title: str = "") -> tuple[bool, str]:
    """Verify bot membership and posting capability when Telegram token is configured."""
    token = (os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip()
    if not token:
        return True, fallback_title
    chat_info = api.call("getChat", {"chat_id": str(chat_id)})
    if not isinstance(chat_info, dict) or chat_info.get("type") not in ("group", "supergroup", "channel"):
        raise ContractAPIException(
            "TELEGRAM_CHAT_UNREACHABLE",
            "Bot ushbu Telegram guruhga qo'shilmagan yoki chat topilmadi",
            400,
        )
    me = api.call("getMe", {}) or {}
    bot_id = me.get("id")
    if bot_id:
        member = api.call("getChatMember", {"chat_id": str(chat_id), "user_id": bot_id})
        status = (member or {}).get("status")
        if status in ("left", "kicked") or member is None:
            raise ContractAPIException(
                "TELEGRAM_BOT_NOT_MEMBER",
                "Bot Telegram guruh a'zosi emas",
                400,
            )
        if member.get("can_send_messages") is False or member.get("can_post_messages") is False:
            raise ContractAPIException(
                "TELEGRAM_BOT_NO_PERMISSION",
                "Botda guruhga xabar yuborish huquqi yo'q",
                400,
            )
    return True, str(chat_info.get("title") or fallback_title or "")


def get_binding(actor, group_id: str) -> dict:
    group = groups.get_group(group_id)
    groups.assert_manages_group(actor, group)
    binding = TelegramClassroomBinding.objects.filter(group_id=group.id).first()
    return _serialize_binding(group.id, binding)


def bind_group_chat(actor, group_id: str, chat_id: str, *, chat_title: str = "") -> dict:
    group = groups.get_group(group_id)
    groups.assert_manages_group(actor, group)
    raw_chat = str(chat_id or "").strip()
    if not raw_chat or links._is_private_chat(raw_chat):
        raise ContractAPIException(
            "TELEGRAM_GROUP_CHAT_REQUIRED",
            "Shaxsiy chat emas, Telegram guruh yoki kanal ID sini kiriting",
            400,
        )
    can_post, verified_title = verify_bot_group_permissions(raw_chat, fallback_title=chat_title)
    now = timezone.now()
    with transaction.atomic():
        groups.get_group(group.id, lock=True)
        outbox.invalidate_group_queue(group.id, "group_rebound")
        binding, _ = TelegramClassroomBinding.objects.update_or_create(
            group_id=group.id,
            defaults={
                "chat_id": raw_chat,
                "chat_title": (verified_title or chat_title or "")[:255],
                "bound_by_id": actor.id,
                "is_active": True,
                "bot_can_post": can_post,
                "verified_at": now,
                "disconnected_at": None,
            },
        )
    return _serialize_binding(group.id, binding)


def disconnect_group_chat(actor, group_id: str) -> dict:
    group = groups.get_group(group_id)
    groups.assert_manages_group(actor, group)
    now = timezone.now()
    with transaction.atomic():
        groups.get_group(group.id, lock=True)
        binding = TelegramClassroomBinding.objects.filter(group_id=group.id).first()
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
