import bcrypt

from common.auth import passwords as p


def test_new_hash_is_argon2_and_verifies():
    password = "s3cret-\u043f\u0430\u0440\u043e\u043b\u044c"
    h = p.hash_password(password)
    assert h.startswith("argon2$argon2id$")
    assert p.verify_password(password, h)
    assert not p.verify_password("wrong", h)
    assert not p.needs_rehash(h)


def test_legacy_bcrypt_still_verifies_and_is_flagged():
    legacy = bcrypt.hashpw(b"old-pass", bcrypt.gensalt(rounds=4)).decode()
    assert p.verify_password("old-pass", legacy)
    assert not p.verify_password("nope", legacy)
    assert p.needs_rehash(legacy)


def test_garbage_hash_rejected():
    assert not p.verify_password("x", "plaintext")
    assert not p.verify_password("x", "")
