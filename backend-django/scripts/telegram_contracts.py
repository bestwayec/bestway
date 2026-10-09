"""Telegram transport is recorded; all account/menu writes use local PostgreSQL."""
import hashlib
import json
import os
from unittest.mock import patch
def verify_telegram(call,control,normalize,checks):
    deliveries=[]
    def transport(method,payload=None):
        deliveries.append(dict(method=method,payload=payload))
        return dict(username='fixture_bot') if method=='getMe' else True
    control('telegramDeliveries')
    with (patch.dict(os.environ,dict(TELEGRAM_BOT_TOKEN='local-fixture-not-a-real-token',TELEGRAM_BOT_USERNAME='fixture_bot',TELEGRAM_MODE='off',TELEGRAM_WEBHOOK_SECRET='local-fixture-secret')),
        patch('apps.core.telegram_delivery.call',side_effect=transport)):
        def check(*args,**kwargs):
            result=call(*args,**kwargs)
            expected=control('telegramDeliveries')['result']
            actual_normalized=normalize(deliveries)
            expected_normalized=normalize(expected)
            if actual_normalized!=expected_normalized:
                def summary(rows):
                    output=[]
                    for row in rows:
                        payload=row.get('payload') or {}
                        text=payload.get('text')
                        output.append({
                            'method':row.get('method'),
                            'keys':sorted(payload),
                            'chat_id':payload.get('chat_id'),
                            'text_utf16_units':len(text.encode('utf-16-le'))//2 if isinstance(text,str) else None,
                            'text_sha256':hashlib.sha256(text.encode('utf-8')).hexdigest() if isinstance(text,str) else None,
                            'text_repr':repr(text) if isinstance(text,str) else None,
                            'reply_markup':payload.get('reply_markup'),
                        })
                    return output
                raise AssertionError('Telegram delivery mismatch '+json.dumps(
                    {'django':summary(deliveries),'nest':summary(expected)},ensure_ascii=True,sort_keys=True))
            deliveries.clear()
            return result
        for role in (None,'student','parent','teacher','admin','super_admin'):
            check('GET','/v1/telegram/status',role=role)
            check('DELETE','/v1/telegram/link',role=role)
            check('POST','/v1/telegram/link-token',role=role,capture_token='tg_token_'+str(role) if role else None)
        check('POST','/v1/telegram/webhook',{'update_id':1},role=None)
        def update(text=None,chat=100,contact=None,from_id=100):
            message=dict(message_id=1,chat=dict(id=chat,type='private'),**{'from':dict(id=from_id)})
            if text is not None:message['text']=text
            if contact is not None:message['contact']=contact
            return check('POST','/v1/telegram/webhook',dict(update_id=1,message=message),role=None,extra_headers={'x-telegram-bot-api-secret-token':'local-fixture-secret'})
        for text in ('/start','/help','/status','unknown','/menu','/unlink'):update(text)
        update('/start {tg_token_student}')
        check('GET','/v1/telegram/status',role='student')
        update('/start {tg_token_student}') # One-use rejection, existing menu.
        from apps.core.telegram_menu import BTN
        for text in ('/status','/menu','unknown',*BTN.values()):update(text)
        check('DELETE','/v1/telegram/link',role='student')
        update('/status')
        for role,chat in [('parent',200),('teacher',300),('admin',400),('super_admin',500)]:
            update('/start {tg_token_'+role+'}',chat)
            for text in ('/menu',*BTN.values()):update(text,chat)
            update('/unlink',chat)
        update(contact=dict(phone_number='+998901234567',user_id=999))
        update(contact=dict(phone_number='123',user_id=100))
        update(contact=dict(phone_number='+998901234567',user_id=100))
        check('POST','/v1/telegram/link-token',role='student',capture_token='tg_token_student')
        update('/start {tg_token_student}',700)
        check('POST','/v1/telegram/link-token',role='parent',capture_token='tg_token_parent')
        update('/start {tg_token_parent}',700) # Exactly one owner per chat.
        check('GET','/v1/telegram/status',role='student');check('GET','/v1/telegram/status',role='parent')
        update('/stop',700)
    checks.append('Telegram: all roles, token hash/expiry/replacement and one-use consume, menus, contact ownership/validation, secret webhook, chat-owner transfer and both unlink paths match recorded Nest transport and local database')
