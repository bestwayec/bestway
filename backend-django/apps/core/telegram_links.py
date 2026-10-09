import hashlib
import os
import re
import secrets
from datetime import timedelta
from types import SimpleNamespace
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from apps.legacy_schema.models import User,TelegramLinkToken
from common.api.exceptions import ContractAPIException
from .system_settings import audit
from . import telegram_delivery as api


def escape(text):return text.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')
def token_hash(token):return hashlib.sha256(token.encode()).hexdigest()


def status(user_id):
    user=User.objects.filter(id=user_id).first()
    return dict(linked=bool(user and user.telegram_chat_id),botUsername=api.username() if os.environ.get('TELEGRAM_BOT_TOKEN') else None)


def create_token(actor):
    if not os.environ.get('TELEGRAM_BOT_TOKEN'):raise ContractAPIException('TELEGRAM_DISABLED','Telegram bot sozlanmagan',400)
    username=api.username()
    if not username:raise ContractAPIException('TELEGRAM_DISABLED','Bot username aniqlanmadi',400)
    TelegramLinkToken.objects.filter(Q(user_id=actor.id)|Q(expires_at__lt=timezone.now())).delete()
    token=secrets.token_urlsafe(24);expires=timezone.now()+timedelta(minutes=int(os.environ.get('TELEGRAM_LINK_TTL_MINUTES','10')))
    from uuid import uuid4
    TelegramLinkToken.objects.create(id=str(uuid4()),user_id=actor.id,token_hash=token_hash(token),expires_at=expires,created_at=timezone.now())
    return dict(url=f'https://t.me/{username}?start={token}',token=token,expiresAt=expires)


def unlink(actor):
    user=User.objects.filter(id=actor.id).first()
    if not user or not user.telegram_chat_id:return dict(unlinked=False)
    User.objects.filter(id=actor.id).update(telegram_chat_id=None,updated_at=timezone.now())
    api.plain(user.telegram_chat_id,'🔌 Telegram akkauntingiz saytdan uzildi. Xabarlar endi bu yerga kelmaydi.')
    audit(actor,'user.telegram_unlink','user',actor.id)
    return dict(unlinked=True)


@transaction.atomic
def attach(user_id,chat_id):
    User.objects.filter(telegram_chat_id=str(chat_id)).exclude(id=user_id).update(telegram_chat_id=None,updated_at=timezone.now())
    User.objects.filter(id=user_id).update(telegram_chat_id=str(chat_id),updated_at=timezone.now())


def consume(token,chat_id):
    row=TelegramLinkToken.objects.filter(token_hash=token_hash(token)).select_related('user').first()
    if not row or row.used_at or row.expires_at<timezone.now():
        api.plain(chat_id,'❌ Bog\'lash havolasi eskirgan yoki ishlatilgan.\nSaytga kiring va "Telegramni ulash" tugmasini qaytadan bosing.');return
    if not row.user.is_active:api.plain(chat_id,'❌ Akkaunt bloklangan. Administratsiyaga murojaat qiling.');return
    attach(row.user_id,chat_id)
    TelegramLinkToken.objects.filter(id=row.id).update(used_at=timezone.now())
    api.plain(chat_id,f'✅ <b>Bog\'landi!</b>\n\nAkkaunt: <b>{escape(row.user.name)}</b>\n\nEndi ball, davomat, to\'lov va test natijalari haqidagi xabarlar shu yerga keladi.')
    audit(SimpleNamespace(id=row.user_id),'user.telegram_link','user',row.user_id,new=dict(method='deep_link'))


def contact(phone,chat_id,own):
    if not own:api.plain(chat_id,"❌ Iltimos, faqat o'zingizning raqamingizni yuboring.");return
    key=re.sub('[^0-9]','',phone)[-9:]
    if len(key)<9:api.plain(chat_id,"❌ Raqam formati noto'g'ri.");return
    users=list(User.objects.filter(phone__endswith=key,is_active=True))
    if not users:api.plain(chat_id,'❌ Bu raqam tizimda topilmadi.\nAdministratsiyaga murojaat qiling yoki saytga kirib "Telegramni ulash" tugmasidan foydalaning.');return
    if len(users)>1:api.plain(chat_id,'⚠️ Bu raqam bir nechta akkauntga tegishli. Saytga kirib "Telegramni ulash" tugmasidan foydalaning.');return
    user=users[0];attach(user.id,chat_id)
    api.plain(chat_id,f'✅ <b>Bog\'landi!</b>\n\nAkkaunt: <b>{escape(user.name)}</b>\n\nEndi xabarlar shu yerga keladi.')
    audit(user,'user.telegram_link','user',user.id,new=dict(method='contact'))


def find(chat_id,active=False):
    rows=User.objects.filter(telegram_chat_id=str(chat_id))
    if active:rows=rows.filter(is_active=True)
    return rows.first()


def unlink_chat(chat_id):
    user=find(chat_id)
    if not user:api.plain(chat_id,"ℹ️ Bu chat hech qanday akkauntga bog'lanmagan.");return
    User.objects.filter(id=user.id).update(telegram_chat_id=None,updated_at=timezone.now())
    api.plain(chat_id,'🔌 Uzildi. Qayta ulash uchun saytdagi tugmadan foydalaning.')
    audit(user,'user.telegram_unlink','user',user.id)
