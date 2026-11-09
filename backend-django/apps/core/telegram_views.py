import hashlib
import hmac
import json
import logging
import os
import secrets
import time
import urllib.parse
import uuid

from django.conf import settings
from django.db import OperationalError, connection, transaction
from django.http import HttpResponseRedirect
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
    throttle_classes,
)
from rest_framework.permissions import AllowAny

from common.api.exceptions import ContractAPIException
from common.auth.passwords import hash_password
from common.auth.permissions import Authenticated
from common.auth.throttling import SensitiveAuthThrottle

from . import auth_service, telegram_sso
from . import telegram_bot as bot
from . import telegram_links as links
from .mock_attempt_views import success


def telegram_auth_date(value):
    try:
        if isinstance(value, bool):
            raise ValueError
        timestamp = int(value)
    except (TypeError, ValueError, OverflowError):
        raise ContractAPIException('INVALID_CREDENTIALS', 'Telegram auth_date yaroqsiz', 401) from None
    age = time.time() - timestamp
    if timestamp <= 0 or age > 86400 or age < -30:
        raise ContractAPIException('INVALID_CREDENTIALS', 'Telegram avtorizatsiyasi eskirgan', 401)
    return timestamp


def verify_telegram_auth(data: dict) -> dict:
    """
    Validates Telegram Login Widget or WebApp initData HMAC-SHA256 hash.
    Returns dict: {'id': int/str, 'first_name': str, 'last_name': str, 'username': str, 'auth_date': int}
    """
    bot_token = os.environ.get('TELEGRAM_BOT_TOKEN') or getattr(settings, 'TELEGRAM_BOT_TOKEN', '')
    if not bot_token:
        raise ContractAPIException('TELEGRAM_DISABLED', 'Telegram SSO sozlanmagan', 400)

    # 1. WebApp initData string
    init_data = data.get('initData') or data.get('init_data')
    if isinstance(init_data, str) and init_data.strip():
        parsed = dict(urllib.parse.parse_qsl(init_data, keep_blank_values=True))
        auth_hash = parsed.pop('hash', None)
        if not auth_hash:
            raise ContractAPIException('INVALID_CREDENTIALS', 'Telegram imzosi topilmadi', 401)
        secret_key = hmac.new(b"WebAppData", bot_token.encode('utf-8'), hashlib.sha256).digest()
        data_check = sorted([f"{k}={v}" for k, v in parsed.items()])
        data_check_string = "\n".join(data_check)
        calculated_hash = hmac.new(secret_key, data_check_string.encode('utf-8'), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(calculated_hash, auth_hash):
            raise ContractAPIException('INVALID_CREDENTIALS', "Telegram imzosi noto'g'ri", 401)
        user_info = {}
        if parsed.get('user'):
            try:
                user_info = json.loads(parsed['user'])
            except Exception:
                pass
        auth_date = telegram_auth_date(parsed.get('auth_date'))
        return {
            'id': user_info.get('id') or parsed.get('id'),
            'first_name': user_info.get('first_name', ''),
            'last_name': user_info.get('last_name', ''),
            'username': user_info.get('username', ''),
            'auth_date': auth_date,
        }

    # 2. Telegram Login Widget / dict data
    auth_hash = data.get('hash')
    if not auth_hash:
        raise ContractAPIException('INVALID_CREDENTIALS', 'Telegram imzosi topilmadi', 401)

    check_pairs = []
    for k, v in data.items():
        if k in ('hash', 'tokens', 'accessToken', 'refreshToken', 'sso_token') or v is None:
            continue
        if isinstance(v, (str, int, float, bool)):
            check_pairs.append((k, str(v)))

    check_pairs.sort(key=lambda x: x[0])
    data_check_string = "\n".join(f"{k}={v}" for k, v in check_pairs)

    secret_key_widget = hashlib.sha256(bot_token.encode('utf-8')).digest()
    calc_widget = hmac.new(secret_key_widget, data_check_string.encode('utf-8'), hashlib.sha256).hexdigest()

    secret_key_webapp = hmac.new(b"WebAppData", bot_token.encode('utf-8'), hashlib.sha256).digest()
    calc_webapp = hmac.new(secret_key_webapp, data_check_string.encode('utf-8'), hashlib.sha256).hexdigest()

    if not (hmac.compare_digest(calc_widget, auth_hash) or hmac.compare_digest(calc_webapp, auth_hash)):
        raise ContractAPIException('INVALID_CREDENTIALS', "Telegram imzosi noto'g'ri", 401)

    auth_date = telegram_auth_date(data.get('auth_date'))

    telegram_id = data.get('id') or data.get('telegram_id')
    return {
        'id': telegram_id,
        'first_name': data.get('first_name', ''),
        'last_name': data.get('last_name', ''),
        'username': data.get('username', ''),
        'auth_date': auth_date,
    }


logger = logging.getLogger(__name__)

USER_COLUMNS = '"id","name","phone","role","createdAt","passwordHash","isActive","telegramChatId","email"'


def _session(user):
    tokens = auth_service.issue_tokens(user)
    return {
        'user': auth_service.public(user),
        'tokens': tokens,
        'accessToken': tokens['accessToken'],
        'refreshToken': tokens['refreshToken'],
    }


def _register_student(cursor, telegram_chat_id, first_name, last_name, username, method):
    candidate_name = f"{(first_name or '').strip()} {(last_name or '').strip()}".strip()
    if not candidate_name:
        candidate_name = (username or '').strip() or f"Student {telegram_chat_id}"
    if len(candidate_name) < 2:
        candidate_name = f"Student {telegram_chat_id}"
    candidate_name = candidate_name[:100]

    phone_candidate = f"tg_{telegram_chat_id}"
    cursor.execute('SELECT 1 FROM "User" WHERE "phone"=%s', [phone_candidate])
    if cursor.fetchone():
        phone_candidate = f"tg_{telegram_chat_id}_{secrets.token_hex(3)}"

    user_id = str(uuid.uuid4())
    cursor.execute(
        'INSERT INTO "User" ("id","name","phone","passwordHash","role","isActive","telegramChatId","createdAt","updatedAt") '
        'VALUES (%s,%s,%s,%s,\'student\',true,%s,NOW(),NOW())',
        [user_id, candidate_name, phone_candidate, hash_password(secrets.token_urlsafe(16)), telegram_chat_id],
    )
    points = auth_service.initial_points(cursor)
    link_code = auth_service.unique_link_code(cursor)
    cursor.execute(
        'INSERT INTO "StudentProfile" ("userId","availablePrograms","activeProgram","isApproved","currentPoints","linkCode","createdAt","gameQualified") '
        'VALUES (%s,ARRAY[\'IELTS\',\'MULTILEVEL\']::"ExamProgram"[],\'IELTS\'::"ExamProgram",true,%s,%s,NOW(),false)',
        [user_id, points, link_code],
    )
    cursor.execute(
        'INSERT INTO "PointsLog" ("id","studentId","change","reason","createdAt") VALUES (%s,%s,%s,%s,NOW())',
        [str(uuid.uuid4()), user_id, points, "Boshlang'ich ball"],
    )
    cursor.execute(
        'INSERT INTO "Notification" ("id","userId","type","text","read","createdAt") VALUES (%s,%s,\'points\'::"NotificationType",%s,false,NOW())',
        [str(uuid.uuid4()), user_id, f"Xush kelibsiz! Sizga boshlang'ich {points} ball berildi."],
    )
    auth_service.audit(cursor, user_id, 'user.telegram_auto_register', 'user', user_id, new={'telegramId': telegram_chat_id, 'method': method})
    cursor.execute(f'SELECT {USER_COLUMNS} FROM "User" WHERE "id"=%s', [user_id])
    return cursor.fetchone()


def login_or_register(telegram_id, first_name='', last_name='', username='', method='telegram'):
    """Sign in the account linked to a verified Telegram identity.

    The Telegram user id is the only identity key: accounts are never matched
    or merged by display name, phone or e-mail. An unknown, verified Telegram
    identity gets a new student account (existing auto-registration policy).
    """
    if not telegram_id:
        raise ContractAPIException('VALIDATION_ERROR', 'Telegram ID aniqlanmadi', 400)
    telegram_chat_id = str(telegram_id)
    with transaction.atomic(), connection.cursor() as cursor:
        # Serialise concurrent first logins of the same Telegram identity so a
        # double tap cannot create two student accounts.
        if connection.vendor == 'postgresql':
            cursor.execute('SELECT pg_advisory_xact_lock(hashtext(%s))', [f'telegram-login:{telegram_chat_id}'])
        cursor.execute(f'SELECT {USER_COLUMNS} FROM "User" WHERE "telegramChatId"=%s LIMIT 1', [telegram_chat_id])
        user = cursor.fetchone()
        if user and not user[6]:
            raise ContractAPIException('USER_DEACTIVATED', 'Akkaunt bloklangan. Administratsiyaga murojaat qiling', 403)
        if not user:
            user = _register_student(cursor, telegram_chat_id, first_name, last_name, username, method)
    return _session(user)


def telegram_login(data: dict):
    sso_token = data.get('sso_token')
    if sso_token and not data.get('hash'):
        payload = telegram_sso.consume_sso_token(sso_token)
        if not payload:
            raise ContractAPIException('INVALID_TOKEN', "Kirish havolasi eskirgan yoki allaqachon ishlatilgan. Botda /login ni qayta bosing", 401)
        return login_or_register(payload['telegram_id'], payload.get('first_name'), payload.get('last_name'), payload.get('username'), 'sso_link')

    verified = verify_telegram_auth(data)
    return login_or_register(verified.get('id'), verified.get('first_name'), verified.get('last_name'), verified.get('username'), 'widget')


def database_unavailable():
    return ContractAPIException('SERVICE_UNAVAILABLE', "Server hozir band. Bir necha soniyadan so'ng qayta urinib ko'ring", 503)


@api_view(['GET', 'POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([SensitiveAuthThrottle])
def telegram_login_view(request):
    if request.method == 'GET':
        data = request.GET.dict()
    else:
        data = request.data if isinstance(request.data, dict) else {}
        if not data and request.GET:
            data = request.GET.dict()

    client = str(data.get('client') or request.GET.get('client') or '').lower()
    ua = request.META.get('HTTP_USER_AGENT', '').lower()
    is_mobile = client == 'mobile' or 'bestwayapp' in ua or 'bestway' in client
    wants_redirect = request.method == 'GET' or data.get('redirect') == '1' or request.GET.get('redirect') == '1'

    if wants_redirect and not is_mobile:
        # Browsers finish sign-in on the web login page, which keeps the session
        # in httpOnly cookies. Access tokens never travel in a URL.
        frontend_url = (os.environ.get('FRONTEND_URL') or 'https://bestwayec.uz').rstrip('/')
        allowed = ('sso_token', 'id', 'first_name', 'last_name', 'username', 'photo_url', 'auth_date', 'hash')
        query = urllib.parse.urlencode({k: v for k, v in data.items() if k in allowed and isinstance(v, str)})
        return HttpResponseRedirect(f"{frontend_url}/login?{query}")

    try:
        res = telegram_login(data)
    except ContractAPIException:
        raise
    except OperationalError:
        logger.exception('Telegram login failed: database unavailable')
        raise database_unavailable() from None
    except Exception:
        logger.exception('Telegram login failed unexpectedly')
        raise ContractAPIException('TELEGRAM_AUTH_FAILED', "Telegram orqali kirib bo'lmadi. Qayta urinib ko'ring", 500) from None

    res['deepLink'] = (
        f"bestwayapp://auth?token={urllib.parse.quote(str(res['accessToken']))}"
        f"&refresh={urllib.parse.quote(str(res['refreshToken']))}"
    )
    if wants_redirect:
        return HttpResponseRedirect(res['deepLink'])
    return success(res)


def telegram_otp_verify(code: str):
    code = str(code or "").strip()
    if not code or len(code) != 6 or not code.isdigit():
        raise ContractAPIException('VALIDATION_ERROR', "6 xonali raqamli kod kiriting", 400)
    otp_data = telegram_sso.consume_otp(code)
    if not otp_data:
        raise ContractAPIException('INVALID_CREDENTIALS', "Kod eskirgan yoki noto'g'ri", 401)
    return login_or_register(otp_data.get('telegram_id'), otp_data.get('first_name'), otp_data.get('last_name'), otp_data.get('username'), 'otp')


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([SensitiveAuthThrottle])
def telegram_otp_verify_view(request):
    data = request.data if isinstance(request.data, dict) else {}
    code = data.get('code') or data.get('otp')
    try:
        return success(telegram_otp_verify(code))
    except ContractAPIException:
        raise
    except OperationalError:
        logger.exception('Telegram OTP login failed: database unavailable')
        raise database_unavailable() from None


@api_view(['GET'])
@permission_classes([Authenticated])
def status(request):
    return success(links.status(request.user.id))


@api_view(['POST'])
@permission_classes([Authenticated])
def token(request):
    return success(links.create_token(request.user))


@api_view(['DELETE'])
@permission_classes([Authenticated])
def unlink(request):
    return success(links.unlink(request.user))


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def webhook(request):
    expected = os.environ.get('TELEGRAM_WEBHOOK_SECRET', '')
    supplied = request.headers.get('x-telegram-bot-api-secret-token', '')
    if not expected or not supplied or not hmac.compare_digest(expected.encode(), supplied.encode()):
        raise ContractAPIException('FORBIDDEN', 'Webhook secret mos kelmadi', 403)
    bot.handle(request.data)
    return success(dict(ok=True))
