import json
import pytest
from django.test import Client
from apps.core.views import _compare_semver


def test_compare_semver():
    assert _compare_semver("1.0.6", "1.0.6") == 0
    assert _compare_semver("0.8.5", "1.0.6") == -1
    assert _compare_semver("1.0.7", "1.0.6") == 1
    assert _compare_semver("1.0", "1.0.0") == 0
    assert _compare_semver("0.8.5", "0.8.5") == 0


@pytest.mark.django_db
def test_desktop_update_check_current_version_returns_204():
    c = Client()
    # When client version is equal or newer than 1.0.7
    resp = c.get("/v1/desktop/update/windows-x86_64/1.0.7")
    assert resp.status_code == 204

    resp_newer = c.get("/v1/desktop/update/windows-x86_64/1.0.8")
    assert resp_newer.status_code == 204


@pytest.mark.django_db
def test_desktop_update_check_old_version_returns_manifest():
    c = Client()
    # When client version is older than 1.0.7
    resp = c.get("/v1/desktop/update/windows-x86_64/0.8.5")
    assert resp.status_code == 200
    data = resp.json()
    assert data["version"] == "1.0.7"
    assert "notes" in data
    assert "pub_date" in data
    assert "url" in data
    assert "platforms" in data
    assert "windows-x86_64" in data["platforms"]


@pytest.mark.django_db
def test_telegram_login_mobile_deeplink_json():
    c = Client()
    # Test that telegram_login_view handles client=mobile
    resp = c.post("/v1/auth/telegram-login", data=json.dumps({"client": "mobile"}), content_type="application/json")
    # Will fail with 401/400 because no telegram hash or token provided
    assert resp.status_code in (400, 401)
