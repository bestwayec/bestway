"""Authentication views including Google OAuth Sign-Up and Sign-In."""
from __future__ import annotations

import logging
import os
import re
import secrets
import uuid
from typing import Any

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import connection, transaction
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
)
from rest_framework.permissions import AllowAny

from common.api.exceptions import ContractAPIException
from common.auth.passwords import hash_password

from . import auth_service
from .mock_attempt_views import success

logger = logging.getLogger(__name__)


def verify_google_credential(credential: str, client_id: str | None = None) -> dict[str, Any]:
    """Verify Google OAuth2 id_token / credential.
    
    Uses google.oauth2.id_token.verify_oauth2_token with fallback to
    Google's tokeninfo endpoint.
    """
    expected_client_id = client_id or getattr(settings, "GOOGLE_CLIENT_ID", "") or os.environ.get("GOOGLE_CLIENT_ID", "")
    if not expected_client_id:
        expected_client_id = getattr(settings, "GOOGLE_CLIENT_ID", "")
    if not credential or not isinstance(credential, str) or not credential.strip():
        raise ContractAPIException("VALIDATION_ERROR", "Google credential (id_token) taqdim etilmadi", 400)

    token = credential.strip()
    payload = None

    # 1. Official Google verification via google-auth
    try:
        from google.auth.transport import requests as google_requests
        from google.oauth2 import id_token as google_id_token

        req = google_requests.Request()
        payload = google_id_token.verify_oauth2_token(token, req, expected_client_id)
    except Exception as exc:
        logger.warning("google.oauth2 verify_oauth2_token failed (%s), attempting tokeninfo fallback", exc)
        # 2. Direct HTTP fallback to Google tokeninfo
        try:
            import json
            import urllib.parse
            import urllib.request

            url = f"https://oauth2.googleapis.com/tokeninfo?id_token={urllib.parse.quote(token)}"
            http_req = urllib.request.Request(url, headers={"User-Agent": "Bestway-Platform/1.0"})
            with urllib.request.urlopen(http_req, timeout=5) as resp:
                if resp.status == 200:
                    token_info = json.loads(resp.read().decode("utf-8"))
                    aud = token_info.get("aud")
                    if aud != expected_client_id:
                        raise ContractAPIException(
                            "INVALID_CREDENTIALS",
                            "Google token Client ID mos kelmadi",
                            401,
                        )
                    payload = token_info
        except ContractAPIException:
            raise
        except Exception as fallback_exc:
            logger.error("Google tokeninfo fallback failed: %s", fallback_exc)
            raise ContractAPIException(
                "INVALID_CREDENTIALS",
                "Google tokeni yaroqsiz yoki muddati o'tgan",
                401,
            )

    if not payload:
        raise ContractAPIException("INVALID_CREDENTIALS", "Google tokenini tekshirib bo'lmadi", 401)

    email = (payload.get("email") or "").strip().lower()
    if not email:
        raise ContractAPIException("INVALID_CREDENTIALS", "Google akkauntida email topilmadi", 400)

    email_verified = payload.get("email_verified")
    if email_verified is False or str(email_verified).lower() == "false":
        raise ContractAPIException("EMAIL_NOT_VERIFIED", "Google email manzili tasdiqlanmagan", 400)

    return payload


def sync_auth_user_mirror(*, user_id: str, email: str, given_name: str, family_name: str, is_active: bool, is_superuser: bool = False):
    """Keep Django's auth_user mirror table synchronized with Prisma User."""
    user_model = get_user_model()
    dj_user = user_model.objects.filter(username=user_id).first()
    if not dj_user:
        dj_user = user_model.objects.filter(email=email).first()

    base_username = (email.split("@")[0] or user_id)[:30]
    clean_username = re.sub(r"[^\w.@+-]", "_", base_username)

    if not dj_user:
        username = clean_username
        if user_model.objects.filter(username=username).exists():
            username = f"{clean_username}_{secrets.token_hex(2)}"
        dj_user = user_model.objects.create(
            username=username,
            email=email[:254],
            first_name=given_name[:150],
            last_name=family_name[:150],
            is_active=is_active,
            is_staff=is_superuser,
            is_superuser=is_superuser,
        )
        dj_user.set_unusable_password()
        dj_user.save()
    else:
        updated = False
        if dj_user.email != email[:254]:
            dj_user.email = email[:254]
            updated = True
        if given_name and dj_user.first_name != given_name[:150]:
            dj_user.first_name = given_name[:150]
            updated = True
        if family_name and dj_user.last_name != family_name[:150]:
            dj_user.last_name = family_name[:150]
            updated = True
        if dj_user.is_active != is_active:
            dj_user.is_active = is_active
            updated = True
        if updated:
            dj_user.save()
    return dj_user


def google_auth_process(payload_data: dict):
    """Core logic for Google OAuth: verify token, auto-register new student or login existing."""
    credential = (
        payload_data.get("credential")
        or payload_data.get("id_token")
        or payload_data.get("token")
    )
    desired_role = payload_data.get("role", "student")
    if desired_role not in ("student", "parent"):
        desired_role = "student"

    verified = verify_google_credential(credential)
    email = verified["email"].strip().lower()
    given_name = (verified.get("given_name") or "").strip()
    family_name = (verified.get("family_name") or "").strip()
    full_name = (verified.get("name") or f"{given_name} {family_name}").strip()

    if not full_name:
        full_name = email.split("@")[0]
    if len(full_name) < 2:
        full_name = "Student"
    full_name = full_name[:100]

    # Check if user already exists with this email
    with connection.cursor() as cursor:
        cursor.execute(
            'SELECT "id","name","phone","role","createdAt","passwordHash","isActive","telegramChatId","email" '
            'FROM "User" WHERE lower("email")=%s LIMIT 1',
            [email],
        )
        user_row = cursor.fetchone()

    is_new = False
    if user_row:
        # Existing user - Sign In
        user_id = user_row[0]
        is_active = user_row[6]
        role = user_row[3]
        if not is_active:
            raise ContractAPIException(
                "USER_DEACTIVATED",
                "Akkaunt bloklangan. Administratsiyaga murojaat qiling",
                403,
            )
        sync_auth_user_mirror(
            user_id=user_id,
            email=email,
            given_name=given_name,
            family_name=family_name,
            is_active=is_active,
            is_superuser=(role in ("admin", "super_admin")),
        )
        user_tuple = user_row[:8]
    else:
        # New user - Sign Up
        is_new = True
        user_id = str(uuid.uuid4())
        pwd_hash = hash_password(secrets.token_urlsafe(24))

        email_prefix = re.sub(r"[^\w]", "", email.split("@")[0])[:12]
        phone_candidate = f"g_{email_prefix}"
        with transaction.atomic(), connection.cursor() as cursor:
            cursor.execute('SELECT 1 FROM "User" WHERE "phone"=%s', [phone_candidate])
            if cursor.fetchone():
                phone_candidate = f"g_{email_prefix}_{secrets.token_hex(2)}"

            cursor.execute(
                'INSERT INTO "User" ("id","name","phone","email","passwordHash","role","isActive","createdAt","updatedAt") '
                'VALUES (%s,%s,%s,%s,%s,%s,true,NOW(),NOW())',
                [user_id, full_name, phone_candidate, email, pwd_hash, desired_role],
            )

            if desired_role == "student":
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

            auth_service.audit(cursor, user_id, "user.google_register", "user", user_id, new={"email": email, "role": desired_role})

            cursor.execute(
                'SELECT "id","name","phone","role","createdAt","passwordHash","isActive","telegramChatId" '
                'FROM "User" WHERE "id"=%s',
                [user_id],
            )
            user_tuple = cursor.fetchone()

        sync_auth_user_mirror(
            user_id=user_id,
            email=email,
            given_name=given_name,
            family_name=family_name,
            is_active=True,
            is_superuser=False,
        )

    tokens = auth_service.issue_tokens(user_tuple)
    return {
        "user": auth_service.public(user_tuple),
        "tokens": tokens,
        "accessToken": tokens["accessToken"],
        "refreshToken": tokens["refreshToken"],
        "isNewUser": is_new,
    }


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def google_auth_view(request):
    """Google OAuth2 sign-up and sign-in endpoint."""
    data = request.data if isinstance(request.data, dict) else {}
    return success(google_auth_process(data))
