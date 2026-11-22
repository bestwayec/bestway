"""Live cross-account authorization probe (synthetic accounts only).

Usage (disposable database):
  DJANGO_SETTINGS_MODULE=config.settings.local DATABASE_URL=postgresql://.../bestway_e2e_local \
    python manage.py seed_local_dev && PYTHONPATH=. python scripts/verify_cross_account_local.py

Everything runs inside one transaction that is rolled back.
"""
import django, json, sys
django.setup()
from django.conf import settings
from django.db import connection

_db = connection.settings_dict
if not settings.DEBUG or _db["HOST"] not in ("127.0.0.1", "localhost", "::1") or not str(_db["NAME"]).endswith("_local"):
    sys.exit("Refusing: run only against a loopback *_local database seeded by manage.py seed_local_dev.")
from django.db import transaction
from rest_framework.test import APIClient
from django.core.files.uploadedfile import SimpleUploadedFile

PW = "LocalDev-2026!"
def login(phone):
    c = APIClient()
    r = c.post("/v1/auth/login", {"phone": phone, "password": PW}, format="json")
    assert r.status_code == 200, (phone, r.status_code, r.content[:200])
    data = r.json()["data"]
    c.credentials(HTTP_AUTHORIZATION="Bearer " + data["accessToken"])
    return c, data

out = {}
with transaction.atomic():
    a, ad = login("+998900000010")
    b, bd = login("+998900000011")
    parent, _ = login("+998900000020")
    teacher, _ = login("+998900000003")
    exams = a.get("/v1/mock/exams").json()["data"]
    exam = exams[0]["id"]
    started = a.post(f"/v1/mock/exams/{exam}/start", {"mode": "timed"}, format="json")
    out["start"] = started.status_code
    attempt = (started.json().get("data") or {}).get("attemptId") or (started.json().get("data") or {}).get("id")
    out["attempt_found"] = bool(attempt)
    me_a = ad["user"]["id"]
    from apps.legacy_schema.models import MockAnswer, MockQuestion
    QID = MockQuestion.objects.filter(group__section__exam_id=exam).values_list("id", flat=True).first()
    out["qid_found"] = bool(QID)
    probes = {
        "B reads A attempt": b.get(f"/v1/mock/attempts/{attempt}"),
        "B claims A session": b.post(f"/v1/mock/attempts/{attempt}/session", {"sessionId": "6f1f0b4e-6a51-4a39-9d0a-6a2f1c1d2e3f", "takeover": True}, format="json"),
        "B releases A session": b.post(f"/v1/mock/attempts/{attempt}/session/release", {"sessionId": "6f1f0b4e-6a51-4a39-9d0a-6a2f1c1d2e3f"}, format="json"),
        "B reveals A answer": b.post(f"/v1/mock/attempts/{attempt}/reveal", {"questionId": QID}, format="json"),
        "B writes A annotations": b.put(f"/v1/mock/attempts/{attempt}/annotations", {"annotations": []}, format="json"),
        "B streams A speaking audio": b.get(f"/v1/mock/attempts/{attempt}/answers/{QID}/audio"),
        "B writing page of A": b.get(f"/v1/mock/attempts/{attempt}/writing-pages/q1/1"),
        "B speaking upload to A": b.post(f"/v1/mock/attempts/{attempt}/speaking/{QID}", {"audio": SimpleUploadedFile("a.webm", b"\x1a\x45\xdf\xa3" + b"0" * 2048, content_type="audio/webm")}, format="multipart"),
        "B certificate of A": b.get(f"/v1/mock/attempts/{attempt}/certificate"),
        "B teacher-grade A": b.post(f"/v1/mock/attempts/{attempt}/teacher-grade", {}, format="json"),
        "B reads user A": b.get(f"/v1/users/{me_a}"),
        "unlinked parent reads user A": parent.get(f"/v1/users/{me_a}"),
        "A force-submit own (staff only)": a.post(f"/v1/mock/attempts/{attempt}/force-submit", {}, format="json"),
        "A extends own time (staff only)": a.post(f"/v1/mock/attempts/{attempt}/extend", {"minutes": 30}, format="json"),
        "A reads own attempt": a.get(f"/v1/mock/attempts/{attempt}"),
    }
    for k, r in probes.items():
        code = r.status_code
        if code not in (200, 201, 403):
            try:
                code = f"{code} {r.json()['error']['code']}"
            except Exception:
                pass
        out[k] = code
    # Session revocation: logout A, then reuse the old access token and refresh token
    rt = ad["refreshToken"]
    out["A logout"] = a.post("/v1/auth/logout-refresh", {"refreshToken": rt}, format="json").status_code
    reuse = APIClient().post("/v1/auth/refresh", {"refreshToken": rt}, format="json")
    out["reuse revoked refresh"] = reuse.status_code
    transaction.set_rollback(True)
print(json.dumps(out, indent=1))
