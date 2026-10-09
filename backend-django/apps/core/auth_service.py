"""Authentication operations over the Prisma-owned PostgreSQL schema."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import uuid
from datetime import timedelta

from django.conf import settings
from django.db import connection, transaction
from django.utils import timezone

from common.api.exceptions import ContractAPIException
from common.auth.jwt import base64url_random, issue_access, new_family, new_refresh, token_hash
from common.auth.passwords import verify_password

DUMMY_HASH = b"$2a$10$S0DkiNylcFUhAIuwhOeOz.jS/i48bFSlu6E0mrcE/jVrZ9Ph9i6Zy"
LINK_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def db_now():
    """Prisma stores timestamp-without-time-zone values in this legacy schema."""
    return timezone.now().replace(tzinfo=None)


def public(row):
    return {"id": row[0], "name": row[1], "phone": row[2], "role": row[3], "createdAt": row[4]}


def fetch_user(*, phone: str | None = None, user_id: str | None = None):
    clause, value = (('\"phone\"=%s', phone) if phone is not None else ('\"id\"=%s', user_id))
    with connection.cursor() as cursor:
        cursor.execute(f'SELECT "id","name","phone","role","createdAt","passwordHash","isActive","telegramChatId" FROM "User" WHERE {clause}', [value])
        return cursor.fetchone()


def verify(password: str, encoded: str) -> bool:
    return verify_password(password, encoded)


def initial_points(cursor) -> int:
    cursor.execute('SELECT "value" FROM "Setting" WHERE "key"=%s', ["initialPoints"])
    row = cursor.fetchone()
    if not row:
        return 0
    value = row[0]
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            pass
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def unique_link_code(cursor) -> str:
    for _ in range(5):
        code = "".join(secrets.choice(LINK_CHARS) for _ in range(8))
        cursor.execute('SELECT 1 FROM "StudentProfile" WHERE "linkCode"=%s', [code])
        if not cursor.fetchone():
            return code
    raise ContractAPIException("LINK_CODE_GENERATION_FAILED", "Kod yaratib bo'lmadi, qayta urinib ko'ring", 500)


def audit(cursor, actor_id: str | None, action: str, entity: str, entity_id: str | None, old=None, new=None) -> None:
    cursor.execute(
        'INSERT INTO "AuditLog" ("id","userId","action","entity","entityId","oldValue","newValue","createdAt") VALUES (%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,NOW())',
        [str(uuid.uuid4()), actor_id, action, entity, entity_id, json.dumps(old) if old is not None else None, json.dumps(new) if new is not None else None],
    )


def issue_tokens(user, *, family_id: str | None = None):
    refresh = new_refresh()
    expires = timezone.now() + timedelta(days=max(settings.JWT_REFRESH_TTL_DAYS, 1))
    with connection.cursor() as cursor:
        cursor.execute('INSERT INTO "RefreshToken" ("id","userId","tokenHash","familyId","expiresAt","createdAt") VALUES (%s,%s,%s,%s,%s,NOW())', [str(uuid.uuid4()), user[0], token_hash(refresh), family_id or new_family(), expires])
        cursor.execute('DELETE FROM "RefreshToken" WHERE "userId"=%s AND "expiresAt"<NOW()', [user[0]])
    return {"accessToken": issue_access(user[0], user[3]), "refreshToken": refresh}


def login(phone: str, password: str):
    user = fetch_user(phone=phone.strip())
    if not user:
        verify_password(password, DUMMY_HASH)
        raise ContractAPIException("INVALID_CREDENTIALS", "Telefon raqam yoki parol noto'g'ri", 401)
    if not user[6]:
        verify_password(password, user[5])
        raise ContractAPIException("USER_DEACTIVATED", "Akkaunt bloklangan. Administratsiyaga murojaat qiling", 403)
    if not verify(password, user[5]):
        raise ContractAPIException("INVALID_CREDENTIALS", "Telefon raqam yoki parol noto'g'ri", 401)
    return {"user": public(user), **issue_tokens(user)}


def refresh(raw: str):
    reused = False
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute('SELECT r."id",r."userId",r."familyId",r."expiresAt",r."revokedAt",u."id",u."name",u."phone",u."role",u."createdAt",u."passwordHash",u."isActive",u."telegramChatId" FROM "RefreshToken" r JOIN "User" u ON u."id"=r."userId" WHERE r."tokenHash"=%s FOR UPDATE', [token_hash(raw)])
        row = cursor.fetchone()
        if not row or row[3] < db_now() or not row[11]:
            raise ContractAPIException("INVALID_REFRESH_TOKEN", "Sessiya muddati tugagan — qaytadan kiring", 401)
        if row[4]:
            cursor.execute('UPDATE "RefreshToken" SET "revokedAt"=NOW() WHERE "userId"=%s AND "familyId" IS NOT DISTINCT FROM %s', [row[1], row[2]])
            reused = True
        else:
            user = (row[5], row[6], row[7], row[8], row[9], row[10], row[11], row[12])
            cursor.execute('UPDATE "RefreshToken" SET "revokedAt"=NOW() WHERE "id"=%s', [row[0]])
            tokens = issue_tokens(user, family_id=row[2] or new_family())
    # Raise after committing the family revocation; raising inside atomic rolls it back.
    if reused:
        raise ContractAPIException("SESSION_EXPIRED", "Sessiya xavfsizlik sababli bekor qilindi — qaytadan kiring", 401)
    return tokens


def verify_challenge(verifier: str, challenge: str) -> bool:
    digest = hashlib.sha256(verifier.encode("utf-8")).digest()
    try:
        expected = base64.urlsafe_b64decode(challenge + "=" * (-len(challenge) % 4))
    except Exception:
        return False
    return hmac.compare_digest(digest, expected)


def authorize_desktop(user_id: str, *, device_id: str, state: str, challenge: str, redirect: str):
    if redirect not in settings.DESKTOP_REDIRECT_URIS:
        raise ContractAPIException("INVALID_REDIRECT", "Ruxsat etilmagan qaytish manzili", 400)
    user = fetch_user(user_id=user_id)
    if not user or not user[6]:
        raise ContractAPIException("USER_DEACTIVATED", "Akkaunt bloklangan. Administratsiyaga murojaat qiling", 403)
    if user[3] != "student":
        raise ContractAPIException("NOT_A_STUDENT", "Desktop ilova faqat o‘quvchilar uchun", 403)
    code = base64url_random(32)
    expiry = timezone.now() + timedelta(minutes=5)
    with connection.cursor() as cursor:
        cursor.execute('INSERT INTO "DesktopAuthCode" ("id","userId","codeHash","codeChallenge","deviceId","state","expiresAt","createdAt") VALUES (%s,%s,%s,%s,%s,%s,%s,NOW())', [str(uuid.uuid4()), user_id, token_hash(code), challenge, device_id, state, expiry])
        cursor.execute('DELETE FROM "DesktopAuthCode" WHERE "userId"=%s AND "expiresAt"<NOW()', [user_id])
    return {"code": code, "state": state, "expiresAt": expiry.isoformat().replace("+00:00", "Z")}


def exchange_desktop(code: str, verifier: str, device_id: str):
    failure = None
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute('SELECT d."id",d."userId",d."codeChallenge",d."deviceId",d."expiresAt",d."usedAt",u."id",u."name",u."phone",u."role",u."createdAt",u."passwordHash",u."isActive",u."telegramChatId" FROM "DesktopAuthCode" d JOIN "User" u ON u."id"=d."userId" WHERE d."codeHash"=%s FOR UPDATE', [token_hash(code)])
        row = cursor.fetchone()
        if not row:
            raise ContractAPIException("INVALID_DESKTOP_CODE", "Desktop kodi noto‘g‘ri", 401)
        if row[5]:
            raise ContractAPIException("DESKTOP_CODE_USED", "Desktop kodi allaqachon ishlatilgan", 401)
        if row[4] < db_now():
            raise ContractAPIException("DESKTOP_CODE_EXPIRED", "Desktop kodi muddati o‘tgan — qaytadan urinib ko‘ring", 401)
        cursor.execute('UPDATE "DesktopAuthCode" SET "usedAt"=NOW() WHERE "id"=%s', [row[0]])
        user = (row[6], row[7], row[8], row[9], row[10], row[11], row[12], row[13])
        if row[3] != device_id:
            failure = ContractAPIException("DEVICE_MISMATCH", "Kod boshqa qurilma uchun yaratilgan", 400)
        elif not verify_challenge(verifier, row[2]):
            failure = ContractAPIException("INVALID_VERIFIER", "Xavfsizlik tekshiruvi o‘tmadi", 401)
        elif not user[6]:
            failure = ContractAPIException("USER_DEACTIVATED", "Akkaunt bloklangan. Administratsiyaga murojaat qiling", 403)
        elif user[3] != "student":
            failure = ContractAPIException("NOT_A_STUDENT", "Desktop ilova faqat o‘quvchilar uchun", 403)
        else:
            result = {"user": public(user), **issue_tokens(user)}
    # Failed exchanges consume the code too, matching the one-time Nest contract.
    if failure is not None:
        raise failure
    return result
