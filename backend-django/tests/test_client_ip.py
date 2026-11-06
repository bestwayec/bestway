from django.conf import settings
from django.test import RequestFactory, override_settings

from common.api.client_ip import client_ip


def _req(**meta):
    return RequestFactory().get("/v1/health", REMOTE_ADDR="172.18.0.5", **meta)


def test_default_uses_socket_peer_and_ignores_forged_header():
    assert client_ip(_req(HTTP_X_FORWARDED_FOR="6.6.6.6")) == "172.18.0.5"


def test_one_trusted_proxy_uses_the_hop_it_appended_not_the_forged_left_entry():
    with override_settings(REST_FRAMEWORK={**settings.REST_FRAMEWORK, "NUM_PROXIES": 1}):
        assert client_ip(_req(HTTP_X_FORWARDED_FOR="203.0.113.7")) == "203.0.113.7"
        assert client_ip(_req(HTTP_X_FORWARDED_FOR="6.6.6.6, 203.0.113.7")) == "203.0.113.7"
