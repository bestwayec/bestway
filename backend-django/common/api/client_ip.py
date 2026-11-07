"""Client address resolution for per-IP rate limits.

Same rule as DRF throttling with REST_FRAMEWORK["NUM_PROXIES"] = N (env TRUSTED_PROXY_COUNT):
the N-th address from the right of X-Forwarded-For, or the socket peer when N is 0. Unlike DRF,
an unset NUM_PROXIES means 0 here (DRF would trust the whole, client-forgeable header).
Never uses the left-most X-Forwarded-For entry.
"""
from rest_framework.settings import api_settings


def client_ip(request) -> str:
    remote = request.META.get("REMOTE_ADDR", "") or "unknown"
    proxies = api_settings.NUM_PROXIES or 0
    xff = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if proxies <= 0 or not xff:
        return remote
    hops = [h.strip() for h in xff.split(",") if h.strip()]
    return hops[-min(proxies, len(hops))] if hops else remote
