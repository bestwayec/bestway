"""Password handling: Argon2id for new hashes, bcrypt kept for existing bcryptjs hashes.

Hashes created before the Argon2 rollout are bcrypt (``$2a$/$2b$/$2y$``) and keep
verifying. ``needs_rehash`` lets login upgrade them to Argon2 transparently.
"""
import bcrypt
from django.contrib.auth.hashers import Argon2PasswordHasher

_ARGON2 = Argon2PasswordHasher()
_ARGON2_PREFIX = "argon2$"
_BCRYPT_PREFIXES = ("$2a$", "$2b$", "$2x$", "$2y$")


def password_bytes(password: str) -> bytes:
    # bcryptjs uses the first 72 UTF-8 bytes, including a partial final codepoint.
    # bcrypt 5 rejects longer inputs rather than performing that truncation.
    return password.encode("utf-8")[:72]


def hash_password(password: str) -> str:
    return _ARGON2.encode(password, _ARGON2.salt())


def is_argon2(encoded: str | bytes) -> bool:
    text = encoded.decode("ascii", "ignore") if isinstance(encoded, bytes) else (encoded or "")
    return text.startswith(_ARGON2_PREFIX)


def needs_rehash(encoded: str | bytes) -> bool:
    """True for legacy bcrypt hashes and Argon2 hashes with outdated parameters."""
    if not is_argon2(encoded):
        return True
    text = encoded.decode("ascii") if isinstance(encoded, bytes) else encoded
    try:
        return _ARGON2.must_update(text)
    except Exception:
        return True


def verify_password(password: str, encoded: str | bytes) -> bool:
    try:
        if is_argon2(encoded):
            text = encoded.decode("ascii") if isinstance(encoded, bytes) else encoded
            return _ARGON2.verify(password, text)
        hashed = encoded.encode("ascii") if isinstance(encoded, str) else encoded
        if not hashed.startswith(tuple(p.encode() for p in _BCRYPT_PREFIXES)):
            return False
        return bcrypt.checkpw(password_bytes(password), hashed)
    except (ValueError, UnicodeError, TypeError):
        return False
