"""TelegramService HTTP delivery; bot polling/link/menu lifecycle is separate."""
import json
import logging
import os
from pathlib import Path
from uuid import uuid4
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


def send(chat_id,text,reply_markup=None):
    if not chat_id:return None
    payload=dict(chat_id=chat_id,text=text,parse_mode='HTML')
    if reply_markup is not None:payload['reply_markup']=reply_markup
    return call('sendMessage',payload)


def answer_callback(callback_query_id,text=None):
    if not callback_query_id:return None
    payload=dict(callback_query_id=callback_query_id)
    if text:payload['text']=text
    return call('answerCallbackQuery',payload)


def send_document(chat_id,document,caption=None,filename='bestway-app.apk',parse_mode='HTML',reply_markup=None):
    if not chat_id or document is None:return None
    token=os.environ.get('TELEGRAM_BOT_TOKEN','')
    if not token:return None
    if isinstance(document,str) and document.startswith(('http://','https://')):
        payload=dict(chat_id=chat_id,document=document)
        if caption is not None:
            payload['caption']=caption
            if parse_mode:payload['parse_mode']=parse_mode
        if reply_markup is not None:payload['reply_markup']=reply_markup
        return call('sendDocument',payload)
    try:
        if isinstance(document,(str,Path)):
            path=Path(document)
            raw=path.read_bytes()
            if not filename:filename=path.name
        elif hasattr(document,'read'):
            raw=document.read()
            if isinstance(raw,str):raw=raw.encode('utf-8')
        elif isinstance(document,(bytes,bytearray)):
            raw=bytes(document)
        else:
            return None
        boundary='tg-doc-'+uuid4().hex
        fields=dict(chat_id=str(chat_id))
        if caption is not None:
            fields['caption']=caption
            if parse_mode:fields['parse_mode']=parse_mode
        if reply_markup is not None:
            fields['reply_markup']=json.dumps(reply_markup)
        parts=[]
        for key,value in fields.items():
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode('utf-8'))
        safe_name=(filename or 'bestway-app.apk').replace('"','')
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="document"; filename="{safe_name}"\r\n'
            f'Content-Type: application/vnd.android.package-archive\r\n\r\n'.encode('utf-8')
            + raw + f'\r\n--{boundary}--\r\n'.encode('utf-8')
        )
        request=Request(
            f'https://api.telegram.org/bot{token}/sendDocument',
            data=b''.join(parts),
            headers={'Content-Type':f'multipart/form-data; boundary={boundary}'},
            method='POST',
        )
        with urlopen(request,timeout=120) as response: data=json.loads(response.read())
        if data.get('ok'):return data.get('result')
    except Exception:
        # Never log token-bearing URLs or private notification content.
        logging.getLogger(__name__).warning('Telegram delivery failed for sendDocument')
    return None


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
    call('sendMessage',dict(chat_id=chat_id,text=text,parse_mode='HTML',reply_markup=dict(keyboard=[[dict(text='📱 Telefon raqamimni yuborish',request_contact=True)]],resize_keyboard=True,one_time_keyboard=True)))
