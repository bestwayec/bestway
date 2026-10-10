"""Compare safe Phase 2 auth cases against running Nest and Django services.

The harness logs out every successful session before exiting.  It intentionally
does not exercise registration or mutation endpoints against the shared local DB.
"""
from __future__ import annotations

import json
import os
from urllib.error import HTTPError
from urllib.request import Request, urlopen

NEST = os.environ.get("NEST_BASE_URL", "http://127.0.0.1:3001/v1")
DJANGO = os.environ.get("DJANGO_BASE_URL", "http://127.0.0.1:8001/v1")
PHONE = os.environ.get("AUTH_TEST_PHONE", os.environ.get("SEED_SUPER_ADMIN_PHONE", "+998900000001"))
PASSWORD = os.environ.get("AUTH_TEST_PASSWORD", os.environ.get("SEED_SUPER_ADMIN_PASSWORD", "Super123!"))


def call(base, method, path, payload=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token: headers["Authorization"] = f"Bearer {token}"
    request = Request(base + path, data=json.dumps(payload).encode() if payload is not None else None, headers=headers, method=method)
    try:
        with urlopen(request, timeout=10) as response:
            return response.status, json.loads(response.read())
    except HTTPError as error:
        return error.code, json.loads(error.read())


def shape(body):
    if body.get("success"):
        return {"success": True, "dataKeys": sorted(body.get("data", {}).keys()) if isinstance(body.get("data"), dict) else "list"}
    error = body.get("error", {})
    return {"success": False, "errorCode": error.get("code")}


def same(label, nest, django):
    if nest != django:
        raise RuntimeError(f"{label} differs: nest={nest!r}, django={django!r}")


def main():
    invalid_nest = call(NEST, "POST", "/auth/login", {"phone": PHONE, "password": "wrong-password"})
    invalid_django = call(DJANGO, "POST", "/auth/login", {"phone": PHONE, "password": "wrong-password"})
    same("invalid login", (invalid_nest[0], shape(invalid_nest[1])), (invalid_django[0], shape(invalid_django[1])))

    nest_status, nest_login = call(NEST, "POST", "/auth/login", {"phone": PHONE, "password": PASSWORD})
    django_status, django_login = call(DJANGO, "POST", "/auth/login", {"phone": PHONE, "password": PASSWORD})
    same("login", (nest_status, shape(nest_login)), (django_status, shape(django_login)))
    if nest_status != 200: raise RuntimeError("configured existing account could not log in")
    try:
        for label, path in (("me", "/auth/me"), ("users", "/users?limit=1")):
            n, d = call(NEST, "GET", path, token=nest_login["data"]["accessToken"]), call(DJANGO, "GET", path, token=django_login["data"]["accessToken"])
            same(label, (n[0], shape(n[1])), (d[0], shape(d[1])))
        n, d = call(NEST, "POST", "/auth/refresh", {"refreshToken": nest_login["data"]["refreshToken"]}), call(DJANGO, "POST", "/auth/refresh", {"refreshToken": django_login["data"]["refreshToken"]})
        same("refresh", (n[0], shape(n[1])), (d[0], shape(d[1])))
        nest_refresh, django_refresh = n[1]["data"]["refreshToken"], d[1]["data"]["refreshToken"]
        n, d = call(NEST, "POST", "/auth/logout", {"refreshToken": nest_refresh}, nest_login["data"]["accessToken"]), call(DJANGO, "POST", "/auth/logout", {"refreshToken": django_refresh}, django_login["data"]["accessToken"])
        same("logout", (n[0], shape(n[1])), (d[0], shape(d[1])))
    finally:
        # Covers a harness failure before refresh/logout comparison.
        call(NEST, "POST", "/auth/logout", {}, nest_login.get("data", {}).get("accessToken"))
        call(DJANGO, "POST", "/auth/logout", {}, django_login.get("data", {}).get("accessToken"))
    print("PASS: Nest and Django matched status/envelope shapes for invalid login, login, me, users, refresh, and logout")


if __name__ == "__main__":
    main()
