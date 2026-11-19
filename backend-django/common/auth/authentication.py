from dataclasses import dataclass

from django.db import connection
from rest_framework.authentication import BaseAuthentication

from common.api.exceptions import ContractAPIException

from .jwt import decode_access


@dataclass
class LegacyUser:
    id: str; name: str; phone: str; role: str; is_active: bool
    @property
    def is_authenticated(self): return True
class BestwayJWTAuthentication(BaseAuthentication):
    def authenticate(self, request):
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "): return None
        payload = decode_access(header[7:])
        user_id, family_id = payload["sub"], payload.get("sid")
        with connection.cursor() as c:
            if family_id is None:
                # Already-issued access tokens remain valid under their original expiry.
                c.execute('SELECT "id","name","phone","role","isActive" FROM "User" WHERE "id"=%s', [user_id])
            else:
                c.execute('''SELECT u."id",u."name",u."phone",u."role",u."isActive"
                    FROM "User" u WHERE u."id"=%s AND EXISTS (
                      SELECT 1 FROM "RefreshToken" r WHERE r."userId"=u."id" AND r."familyId"=%s
                      AND r."revokedAt" IS NULL AND r."expiresAt" > NOW()
                    )''', [user_id, family_id])
            row = c.fetchone()
        if not row or not row[4]: raise ContractAPIException("UNAUTHORIZED", "Token yaroqsiz yoki muddati tugagan", 401)
        return LegacyUser(*row), header[7:]


class OptionalMockJWTAuthentication(BestwayJWTAuthentication):
    """Nest OptionalAuth falls back to anonymous for invalid GET bearer tokens.

    Mixed catalogue/detail views keep strict authentication for mutations.
    """
    def authenticate(self, request):
        try:
            return super().authenticate(request)
        except ContractAPIException as error:
            if request.method == 'GET' and error.status_code == 401:
                return None
            raise
