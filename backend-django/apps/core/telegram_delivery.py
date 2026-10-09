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
