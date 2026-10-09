"""Bcrypt password handling compatible with the existing bcryptjs hashes."""
import bcrypt


def password_bytes(password: str) -> bytes:
    # bcryptjs uses the first 72 UTF-8 bytes, including a partial final codepoint.
    # bcrypt 5 rejects longer inputs rather than performing that truncation.
    return password.encode("utf-8")[:72]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password_bytes(password), bcrypt.gensalt(rounds=12)).decode("ascii")


def verify_password(password: str, encoded: str | bytes) -> bool:
    try:
        hashed = encoded.encode("ascii") if isinstance(encoded, str) else encoded
        return bcrypt.checkpw(password_bytes(password), hashed)
    except (ValueError, UnicodeError, TypeError):
        return False
