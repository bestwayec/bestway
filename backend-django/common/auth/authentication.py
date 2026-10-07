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
        payload = decode_access(header[7:]); user_id = payload.get("sub")
        with connection.cursor() as c:
            c.execute('SELECT "id","name","phone","role","isActive" FROM "User" WHERE "id"=%s', [user_id]); row=c.fetchone()
        if not row or not row[4]: raise ContractAPIException("UNAUTHORIZED", "Token yaroqsiz yoki muddati tugagan", 401)
        return LegacyUser(*row), header[7:]
