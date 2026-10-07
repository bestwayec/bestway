from __future__ import annotations
from datetime import UTC, datetime, timedelta
import base64, hashlib, os, uuid
import jwt
from django.conf import settings
from common.api.exceptions import ContractAPIException

def jwt_secret() -> str:
    secret = settings.JWT_SECRET
    if len(secret) < 32: raise RuntimeError("JWT_SECRET must contain at least 32 characters")
    return secret
def issue_access(user_id: str, role: str) -> str:
    return jwt.encode({"sub":user_id,"role":role,"iat":datetime.now(UTC),"exp":datetime.now(UTC)+timedelta(minutes=settings.JWT_ACCESS_TTL_MINUTES)}, jwt_secret(), algorithm="HS256")
def decode_access(token: str) -> dict[str, object]:
    try: return jwt.decode(token, jwt_secret(), algorithms=["HS256"])
    except jwt.PyJWTError as exc: raise ContractAPIException("UNAUTHORIZED", "Token yaroqsiz yoki muddati tugagan", 401) from exc
def base64url_random(byte_count: int) -> str:
    """Match Node's randomBytes(n).toString('base64url') exactly in shape."""
    return base64.urlsafe_b64encode(os.urandom(byte_count)).rstrip(b"=").decode("ascii")
def new_refresh() -> str: return base64url_random(48)
def token_hash(token: str) -> str: return hashlib.sha256(token.encode()).hexdigest()
def new_family() -> str: return str(uuid.uuid4())
