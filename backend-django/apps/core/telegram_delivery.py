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


def send_audio(chat_id,audio,caption=None,title=None,performer=None,filename='speaking.mp3',parse_mode='HTML',reply_markup=None):
    if not chat_id or audio is None:return None
    token=os.environ.get('TELEGRAM_BOT_TOKEN','')
    if not token:return None
    if isinstance(audio,str) and audio.startswith(('http://','https://')):
        payload=dict(chat_id=chat_id,audio=audio)
        if caption is not None:payload['caption']=caption;payload['parse_mode']=parse_mode
        if title:payload['title']=title
        if performer:payload['performer']=performer
        if reply_markup is not None:payload['reply_markup']=reply_markup
        return call('sendAudio',payload)
    try:
        if isinstance(audio,(str,Path)):
            path=Path(audio)
            raw=path.read_bytes()
            if not filename:filename=path.name
        elif hasattr(audio,'read'):
            raw=audio.read()
            if isinstance(raw,str):raw=raw.encode('utf-8')
        elif isinstance(audio,(bytes,bytearray)):
            raw=bytes(audio)
        else:
            return None
        boundary='tg-aud-'+uuid4().hex
        fields=dict(chat_id=str(chat_id))
        if caption is not None:fields['caption']=caption;fields['parse_mode']=parse_mode
        if title:fields['title']=title
        if performer:fields['performer']=performer
        if reply_markup is not None:fields['reply_markup']=json.dumps(reply_markup)
        parts=[]
        for key,value in fields.items():
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode('utf-8'))
        safe_name=(filename or 'speaking.mp3').replace('"','')
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="audio"; filename="{safe_name}"\r\n'
            f'Content-Type: audio/mpeg\r\n\r\n'.encode('utf-8')
            + raw + f'\r\n--{boundary}--\r\n'.encode('utf-8')
        )
        request=Request(
            f'https://api.telegram.org/bot{token}/sendAudio',
            data=b''.join(parts),
            headers={'Content-Type':f'multipart/form-data; boundary={boundary}'},
            method='POST',
        )
        with urlopen(request,timeout=120) as response: data=json.loads(response.read())
        if data.get('ok'):return data.get('result')
    except Exception:
        logging.getLogger(__name__).warning('Telegram delivery failed for sendAudio')
    return None


def send_voice(chat_id,voice,caption=None,parse_mode='HTML',reply_markup=None):
    if not chat_id or voice is None:return None
    token=os.environ.get('TELEGRAM_BOT_TOKEN','')
    if not token:return None
    if isinstance(voice,str) and voice.startswith(('http://','https://')):
        payload=dict(chat_id=chat_id,voice=voice)
        if caption is not None:payload['caption']=caption;payload['parse_mode']=parse_mode
        if reply_markup is not None:payload['reply_markup']=reply_markup
        return call('sendVoice',payload)
    try:
        if isinstance(voice,(str,Path)):
            path=Path(voice)
            raw=path.read_bytes()
            filename=path.name
        elif hasattr(voice,'read'):
            raw=voice.read()
            if isinstance(raw,str):raw=raw.encode('utf-8')
            filename='voice.ogg'
        elif isinstance(voice,(bytes,bytearray)):
            raw=bytes(voice)
            filename='voice.ogg'
        else:
            return None
        boundary='tg-voi-'+uuid4().hex
        fields=dict(chat_id=str(chat_id))
        if caption is not None:fields['caption']=caption;fields['parse_mode']=parse_mode
        if reply_markup is not None:fields['reply_markup']=json.dumps(reply_markup)
        parts=[]
        for key,value in fields.items():
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode('utf-8'))
        safe_name=(filename or 'voice.ogg').replace('"','')
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="voice"; filename="{safe_name}"\r\n'
            f'Content-Type: audio/ogg\r\n\r\n'.encode('utf-8')
            + raw + f'\r\n--{boundary}--\r\n'.encode('utf-8')
        )
        request=Request(
            f'https://api.telegram.org/bot{token}/sendVoice',
            data=b''.join(parts),
            headers={'Content-Type':f'multipart/form-data; boundary={boundary}'},
            method='POST',
        )
        with urlopen(request,timeout=120) as response: data=json.loads(response.read())
        if data.get('ok'):return data.get('result')
    except Exception:
        logging.getLogger(__name__).warning('Telegram delivery failed for sendVoice')
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
