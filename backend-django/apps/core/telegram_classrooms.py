"""Private Telegram entry point for the same classroom enrollment flow as web."""
from html import escape

from common.api.exceptions import ContractAPIException

from . import classroom_invitations as invitations
from . import telegram_classroom_service as binding_service
from . import telegram_delivery as api
from . import telegram_links as links


def command(chat_id, text, *, chat_type, sender_id=None, chat_title=""):
    if not text:
        return False
    command_name, *args = text.split(maxsplit=3)
    cmd = command_name.split("@", 1)[0]
    if cmd in ("/bind", "/unbind"):
        if chat_type == "private" or links._is_private_chat(chat_id):
            api.plain(chat_id, "Guruhni bog'lash uchun buyruqni Telegram guruh ichida yuboring.")
            return True
        actor = links.find(sender_id or "", active=True) if sender_id else None
        if actor is None or getattr(actor, "role", None) not in ("teacher", "admin", "super_admin"):
            api.plain(chat_id, "Faqat bog'langan o'qituvchi yoki administrator guruhni ulay oladi.")
            return True
        if cmd == "/unbind":
            if not args:
                api.plain(chat_id, "Guruh ID sini ko'rsating: <code>/unbind GROUP_ID</code>")
                return True
            try:
                res = binding_service.disconnect_group_chat(actor, args[0])
                api.plain(chat_id, f"🔌 Guruh Telegramdan uzildi (bekor qilingan xabarlar: {res['invalidatedCount']}).")
            except ContractAPIException as error:
                api.plain(chat_id, escape(str(error.detail)))
            return True
        if not args:
            api.plain(chat_id, "Guruhni bog'lash uchun yuboring: <code>/bind GROUP_ID</code>")
            return True
        try:
            binding_service.bind_group_chat(actor, args[0], str(chat_id), chat_title=chat_title)
            api.plain(chat_id, "✅ Telegram guruh BestWay sinfiga muvaffaqiyatli bog'landi.")
        except ContractAPIException as error:
            api.plain(chat_id, escape(str(error.detail)))
        return True
    if cmd not in ("/join", "/guruh"):
        return False
    if chat_type != "private" or not links._is_private_chat(chat_id):
        api.plain(chat_id, "Taklif kodini botning shaxsiy chatiga yuboring.")
        return True
    user = links.find(chat_id, active=True)
    if user is None:
        api.plain(chat_id, "Avval saytdagi akkauntingizni bog‘lang.")
        return True
    if not args or len(args) > 2 or (len(args) == 2 and args[1].lower() != "confirm"):
        api.plain(chat_id, "Taklifni ko‘rish uchun yuboring <code>/join KOD</code>")
        return True
    code = args[0]
    try:
        if len(args) == 1:
            invite = invitations.preview(user, code)
            name = escape(invite["groupName"])
            api.plain(chat_id, f"Guruh <b>{name}</b>\nTasdiqlash uchun <code>/join {escape(code)} confirm</code>")
        else:
            joined = invitations.redeem(user, code, source="telegram")
            message = {
                "active": "Guruhga qo‘shildingiz.",
                "pending": "So‘rovingiz o‘qituvchiga yuborildi.",
                "rejected": "Bu taklif bo‘yicha so‘rov rad etilgan.",
            }
            api.plain(chat_id, message[joined["status"]])
    except ContractAPIException as error:
        api.plain(chat_id, escape(str(error.detail)))
    return True
