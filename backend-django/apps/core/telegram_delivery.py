"""TelegramService HTTP delivery; bot polling/link/menu lifecycle is separate."""
import json
import logging
import os
from urllib.request import Request, urlopen


def call(method, payload=None):
    token=os.environ.get('TELEGRAM_BOT_TOKEN','')
    if not token:return None
    try:
        request=Request(f'https://api.telegram.org/bot{token}/{method}',data=json.dumps(payload or {}).encode(),headers={'Content-Type':'application/json'},method='POST')
        with urlopen(request,timeout=40) as response: data=json.loads(response.read())
        if data.get('ok'):return data.get('result')
    except Exception:
        # Never log token-bearing URLs or private notification content.
        logging.getLogger(__name__).warning('Telegram delivery failed for %s',method)
    return None


def send(chat_id,text):
    if chat_id:call('sendMessage',dict(chat_id=chat_id,text=text,parse_mode='HTML'))


_username=None

def username():
    global _username
    configured=os.environ.get('TELEGRAM_BOT_USERNAME')
    if configured:return configured.replace('@','',1)
    if _username:return _username
    _username=(call('getMe') or {}).get('username')
    return _username


def plain(chat_id,text):
    call('sendMessage',dict(chat_id=chat_id,text=text,parse_mode='HTML',reply_markup=dict(remove_keyboard=True)))


def menu(chat_id,text,keyboard):
    call('sendMessage',dict(chat_id=chat_id,text=text,parse_mode='HTML',reply_markup=keyboard))


def contact_request(chat_id,text):
    call('sendMessage',dict(chat_id=chat_id,text=text,reply_markup=dict(keyboard=[[dict(text='📱 Telefon raqamimni yuborish',request_contact=True)]],resize_keyboard=True,one_time_keyboard=True)))
