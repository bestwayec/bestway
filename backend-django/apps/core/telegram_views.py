import hashlib
import hmac
import json
import os
import secrets
import time
import urllib.parse
import uuid

from django.conf import settings
from django.core.cache import cache
from django.db import connection, transaction
from django.utils import timezone
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
)
from rest_framework.permissions import AllowAny

from apps.legacy_schema.models import TelegramLinkToken
from common.api.exceptions import ContractAPIException
from common.auth.passwords import hash_password
from common.auth.permissions import Authenticated

from . import auth_service
from . import telegram_bot as bot
from . import telegram_links as links
from .mock_attempt_views import success


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
        auth_date = int(parsed.get('auth_date', 0) or 0)
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

    auth_date = int(data.get('auth_date', 0) or 0)
    # Check freshness (allow up to 24 hours = 86400s; if auth_date is present)
    if auth_date > 0 and abs(time.time() - auth_date) > 86400:
        raise ContractAPIException('INVALID_CREDENTIALS', 'Telegram avtorizatsiyasi eskirgan', 401)

    telegram_id = data.get('id') or data.get('telegram_id')
    return {
        'id': telegram_id,
        'first_name': data.get('first_name', ''),
        'last_name': data.get('last_name', ''),
        'username': data.get('username', ''),
        'auth_date': auth_date,
    }


def telegram_login(data: dict):
    # Support one-time SSO token if provided without hash or as fallback
    sso_token = data.get('sso_token') or data.get('token')
    if sso_token and not data.get('hash'):
        row = TelegramLinkToken.objects.filter(token_hash=links.token_hash(sso_token)).select_related('user').first()
        if row and not row.used_at and (row.expires_at is None or row.expires_at > timezone.now()):
            TelegramLinkToken.objects.filter(id=row.id).update(used_at=timezone.now())
            user = auth_service.fetch_user(user_id=row.user_id)
            if user:
                if not user[6]:
                    raise ContractAPIException('USER_DEACTIVATED', 'Akkaunt bloklangan. Administratsiyaga murojaat qiling', 403)
                tokens = auth_service.issue_tokens(user)
                return {
                    'user': auth_service.public(user),
                    'tokens': tokens,
                    'accessToken': tokens['accessToken'],
                    'refreshToken': tokens['refreshToken'],
                }

    verified = verify_telegram_auth(data)
    telegram_id = verified.get('id')
    if not telegram_id:
        raise ContractAPIException('VALIDATION_ERROR', 'Telegram ID aniqlanmadi', 400)
    telegram_chat_id = str(telegram_id)

    with connection.cursor() as cursor:
        cursor.execute(
            'SELECT "id","name","phone","role","createdAt","passwordHash","isActive","telegramChatId" '
            'FROM "User" WHERE "telegramChatId"=%s LIMIT 1',
            [telegram_chat_id],
        )
        user = cursor.fetchone()

    if user:
        if not user[6]:
            raise ContractAPIException('USER_DEACTIVATED', 'Akkaunt bloklangan. Administratsiyaga murojaat qiling', 403)
        tokens = auth_service.issue_tokens(user)
        return {
            'user': auth_service.public(user),
            'tokens': tokens,
            'accessToken': tokens['accessToken'],
            'refreshToken': tokens['refreshToken'],
        }

    # Auto-create student User and StudentProfile
    first_name = (verified.get('first_name') or '').strip()
    last_name = (verified.get('last_name') or '').strip()
    username = (verified.get('username') or '').strip()

    candidate_name = f"{first_name} {last_name}".strip()
    if not candidate_name:
        candidate_name = username or f"Student {telegram_id}"
    if len(candidate_name) < 2:
        candidate_name = f"Student {telegram_id}"
    candidate_name = candidate_name[:100]

    phone_candidate = data.get('phone') or f"tg_{telegram_id}"

    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute('SELECT 1 FROM "User" WHERE "phone"=%s', [phone_candidate])
        if cursor.fetchone():
            phone_candidate = f"tg_{telegram_id}_{secrets.token_hex(3)}"

        user_id = str(uuid.uuid4())
        pwd_hash = hash_password(secrets.token_urlsafe(16))

        cursor.execute(
            'INSERT INTO "User" ("id","name","phone","passwordHash","role","isActive","telegramChatId","createdAt","updatedAt") '
            'VALUES (%s,%s,%s,%s,\'student\',true,%s,NOW(),NOW())',
            [user_id, candidate_name, phone_candidate, pwd_hash, telegram_chat_id],
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

        auth_service.audit(cursor, user_id, 'user.telegram_auto_register', 'user', user_id, new={'telegramId': telegram_chat_id})

        cursor.execute(
            'SELECT "id","name","phone","role","createdAt","passwordHash","isActive","telegramChatId" '
            'FROM "User" WHERE "id"=%s',
            [user_id],
        )
        user = cursor.fetchone()

    tokens = auth_service.issue_tokens(user)
    return {
        'user': auth_service.public(user),
        'tokens': tokens,
        'accessToken': tokens['accessToken'],
        'refreshToken': tokens['refreshToken'],
    }


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def telegram_login_view(request):
    data = request.data if isinstance(request.data, dict) else {}
    try:
        return success(telegram_login(data))
    except ContractAPIException:
        raise
    except Exception as e:
        raise ContractAPIException('TELEGRAM_AUTH_FAILED', f"Telegram orqali kirishda xatolik: {e!s}", 400)


def telegram_otp_verify(code: str):
    code = str(code or "").strip()
    if not code or len(code) != 6 or not code.isdigit():
        raise ContractAPIException('VALIDATION_ERROR', "6 xonali raqamli kod kiriting", 400)

    cache_key = f"telegram_otp:{code}"
    otp_data = cache.get(cache_key)
    if not otp_data:
        raise ContractAPIException('INVALID_CREDENTIALS', "Kod eskirgan yoki noto'g'ri", 401)

    # Delete immediately to ensure single-use
    cache.delete(cache_key)

    telegram_id = otp_data.get('telegram_id')
    if not telegram_id:
        raise ContractAPIException('VALIDATION_ERROR', "Telegram ma'lumotlari topilmadi", 400)
    telegram_chat_id = str(telegram_id)

    with connection.cursor() as cursor:
        cursor.execute(
            'SELECT "id","name","phone","role","createdAt","passwordHash","isActive","telegramChatId" '
            'FROM "User" WHERE "telegramChatId"=%s LIMIT 1',
            [telegram_chat_id],
        )
        user = cursor.fetchone()

    if user:
        if not user[6]:
            raise ContractAPIException('USER_DEACTIVATED', 'Akkaunt bloklangan. Administratsiyaga murojaat qiling', 403)
        tokens = auth_service.issue_tokens(user)
        return {
            'user': auth_service.public(user),
            'tokens': tokens,
            'accessToken': tokens['accessToken'],
            'refreshToken': tokens['refreshToken'],
        }

    # Auto-create student User and StudentProfile if not existing
    first_name = (otp_data.get('first_name') or '').strip()
    last_name = (otp_data.get('last_name') or '').strip()
    username = (otp_data.get('username') or '').strip()

    candidate_name = f"{first_name} {last_name}".strip()
    if not candidate_name:
        candidate_name = username or f"Student {telegram_id}"
    if len(candidate_name) < 2:
        candidate_name = f"Student {telegram_id}"
    candidate_name = candidate_name[:100]

    phone_candidate = f"tg_{telegram_id}"

    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute('SELECT 1 FROM "User" WHERE "phone"=%s', [phone_candidate])
        if cursor.fetchone():
            phone_candidate = f"tg_{telegram_id}_{secrets.token_hex(3)}"

        user_id = str(uuid.uuid4())
        pwd_hash = hash_password(secrets.token_urlsafe(16))

        cursor.execute(
            'INSERT INTO "User" ("id","name","phone","passwordHash","role","isActive","telegramChatId","createdAt","updatedAt") '
            'VALUES (%s,%s,%s,%s,\'student\',true,%s,NOW(),NOW())',
            [user_id, candidate_name, phone_candidate, pwd_hash, telegram_chat_id],
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

        auth_service.audit(cursor, user_id, 'user.telegram_auto_register', 'user', user_id, new={'telegramId': telegram_chat_id, 'method': 'otp'})

        cursor.execute(
            'SELECT "id","name","phone","role","createdAt","passwordHash","isActive","telegramChatId" '
            'FROM "User" WHERE "id"=%s',
            [user_id],
        )
        user = cursor.fetchone()

    tokens = auth_service.issue_tokens(user)
    return {
        'user': auth_service.public(user),
        'tokens': tokens,
        'accessToken': tokens['accessToken'],
        'refreshToken': tokens['refreshToken'],
    }


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def telegram_otp_verify_view(request):
    data = request.data if isinstance(request.data, dict) else {}
    code = data.get('code') or data.get('otp')
    return success(telegram_otp_verify(code))


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
