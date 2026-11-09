"""One-time Telegram login credentials (bot SSO link and 6-digit OTP).

Both credentials live only in the shared cache (Redis in production), are
stored under a hash of the secret, expire quickly and are consumed with an
atomic delete so a link or code can sign in exactly once, even when two
requests race with the same value.
"""
import hashlib
import os
import secrets

from django.core.cache import cache

SSO_PREFIX = 'telegram_sso:'
OTP_PREFIX = 'telegram_otp:'


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def sso_ttl_seconds() -> int:
    try:
        return max(60, min(int(os.environ.get('TELEGRAM_SSO_TTL_SECONDS', '600')), 3600))
    except ValueError:
        return 600


def otp_ttl_seconds() -> int:
    return 300


def identity(telegram_id, first_name='', last_name='', username=''):
    return {
        'telegram_id': str(telegram_id),
        'first_name': (first_name or '')[:100],
        'last_name': (last_name or '')[:100],
        'username': (username or '')[:100],
    }


def issue_sso_token(telegram_id, first_name='', last_name='', username='') -> str:
    token = secrets.token_urlsafe(32)
    cache.set(SSO_PREFIX + _digest(token), identity(telegram_id, first_name, last_name, username), timeout=sso_ttl_seconds())
    return token


def _consume(key: str):
    payload = cache.get(key)
    if not payload:
        return None
    # delete() reports whether this call removed the key; only one of several
    # concurrent requests can win, which makes the credential single-use.
    if not cache.delete(key):
        return None
    return payload if isinstance(payload, dict) and payload.get('telegram_id') else None


def consume_sso_token(token: str):
    token = str(token or '').strip()
    if not token or len(token) > 256:
        return None
    return _consume(SSO_PREFIX + _digest(token))


def issue_otp(telegram_id, first_name='', last_name='', username='') -> str:
    data = identity(telegram_id, first_name, last_name, username)
    for _ in range(20):
        code = f'{secrets.randbelow(900000) + 100000}'
        # add() never overwrites, so two users can never share a live code.
        if cache.add(OTP_PREFIX + code, data, timeout=otp_ttl_seconds()):
            return code
    raise RuntimeError('Could not allocate a unique Telegram OTP')


def consume_otp(code: str):
    code = str(code or '').strip()
    if len(code) != 6 or not code.isdigit():
        return None
    return _consume(OTP_PREFIX + code)
