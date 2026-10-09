"""Explicit Telegram polling/webhook lifecycle; no jobs start at import time."""
import logging
import os
from django.db import close_old_connections
from . import telegram_delivery as api,telegram_links as links,telegram_menu as menu

LINE='➖➖➖➖➖➖➖➖➖'
HELP=f'ℹ️ <b>Buyruqlar</b>\n{LINE}\n\n/start — akkauntni bog\'lash\n/menu — menyuni ko\'rsatish\n/status — bog\'lanish holati\n/unlink — akkauntni uzish\n/help — shu yordam'


def welcome():
    center=os.environ.get('CENTER_NAME',"O'quv markaz")
    return f'🎓 <b>{center}</b>\n{LINE}\n\nAssalomu alaykum! Bu — markazning rasmiy xabarchi boti.\n\nBu yerga quyidagilar keladi:\n   🏆 ball o\'zgarishlari\n   📅 davomat xabarlari\n   💰 to\'lov eslatmalari\n   📝 test natijalari\n\n<b>Akkauntingizni bog\'lang:</b>\n1️⃣ Saytga kiring → profil → <b>"Telegramni ulash"</b>\n2️⃣ Yoki pastdagi tugma bilan telefon raqamingizni yuboring 👇'


def show(chat_id):
    user=links.find(chat_id,True)
    if not user:return False
    menu.show(chat_id,user.role,user.name);return True


def handle(update):
    msg=update.get('message')
    if not msg:return
    chat_id=msg['chat']['id']
    try:
        if msg.get('contact'):
            contact=msg['contact'];own='user_id' in contact and contact['user_id']==msg.get('from',{}).get('id')
            links.contact(contact['phone_number'],chat_id,own);show(chat_id);return
        text=(msg.get('text') or '').strip()
        if not text:return
        if text.startswith('/start'):
            payload=text[len('/start'):].strip()
            if payload:links.consume(payload,chat_id);show(chat_id)
            elif not show(chat_id):api.contact_request(chat_id,welcome())
            return
        if text.startswith('/menu'):
            if not show(chat_id):api.contact_request(chat_id,welcome())
            return
        if text.startswith(('/unlink','/stop')):links.unlink_chat(chat_id);return
        if text.startswith('/status'):
            linked=links.find(chat_id)
            text=f'✅ <b>Bog\'langan</b>\n{LINE}\n\nAkkaunt: <b>{links.escape(linked.name)}</b>\n\nUzish uchun: /unlink' if linked else f'❌ <b>Bog\'lanmagan</b>\n{LINE}\n\nSaytdagi "Telegramni ulash" tugmasidan foydalaning yoki /start bosing.'
            api.send(chat_id,text);return
        if text.startswith('/help'):api.send(chat_id,HELP);return
        if menu.handle(chat_id,text) or show(chat_id):return
        api.contact_request(chat_id,welcome())
    except Exception as error:logging.getLogger(__name__).warning('Telegram update processing failed: %r',error)


def initialize():
    if not os.environ.get('TELEGRAM_BOT_TOKEN'):return 'off'
    mode=os.environ.get('TELEGRAM_MODE','polling').lower()
    if mode=='off':return mode
    api.call('setMyCommands',dict(commands=[dict(command=key,description=value) for key,value in [('start',"Akkauntni bog'lash"),('status',"Bog'lanish holati"),('unlink','Akkauntni uzish'),('help','Yordam')]]))
    if mode=='webhook':
        url=os.environ.get('TELEGRAM_WEBHOOK_URL');secret=os.environ.get('TELEGRAM_WEBHOOK_SECRET')
        if url and secret:api.call('setWebhook',dict(url=url,secret_token=secret,allowed_updates=['message'],drop_pending_updates=True))
        return 'webhook'
    api.call('deleteWebhook',dict(drop_pending_updates=False));return 'polling'


def run(stop,once=False):
    mode=initialize();offset=0
    if mode!='polling':return
    try:
        while not stop.is_set():
            try:
                updates=api.call('getUpdates',dict(offset=offset,timeout=30,allowed_updates=['message'])) or []
                for update in updates:
                    offset=update['update_id']+1;close_old_connections();handle(update)
            except Exception:
                logging.getLogger(__name__).warning('Telegram polling failed');stop.wait(3)
            if once:return
    finally:close_old_connections()
