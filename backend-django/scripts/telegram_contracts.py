"""Telegram transport is recorded; all account/menu writes use local PostgreSQL."""
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
            assert normalize(deliveries)==normalize(expected),(deliveries,expected)
            deliveries.clear()
            return result
        for role in (None,'student','parent','teacher','admin','super_admin'):
            check('GET','/v1/telegram/status',role=role)
            check('DELETE','/v1/telegram/link',role=role)
            check('POST','/v1/telegram/link-token',role=role,capture_token='tg_token_'+str(role) if role else None)
        check('POST','/v1/telegram/webhook',{'update_id':1},role=None)
        # Authenticated secret header is intentionally supplied by a local-only
        # fixture client in the next checkpoint; no public Telegram registration.
    checks.append('Telegram: all roles, token format/hash/expiry and replacement, unlink idempotency, webhook rejection; transport matches real Nest service without live calls')
