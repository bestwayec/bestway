"""Explicit production configuration; never selected by local development."""
from django.core.exceptions import ImproperlyConfigured

from .base import *  # noqa: F403

DEBUG = False
for name, value in (("DJANGO_SECRET_KEY", SECRET_KEY), ("JWT_SECRET", JWT_SECRET)):
    minimum = 50 if name == "DJANGO_SECRET_KEY" else 32
    if len(value) < minimum or len(set(value)) < 5 or value.lower().startswith(("change-me", "phase-1")):
        raise ImproperlyConfigured(f"{name} must contain a strong, unique production secret")
if not ALLOWED_HOSTS or "*" in ALLOWED_HOSTS or not env("ALLOWED_HOSTS"):
    raise ImproperlyConfigured("Explicit ALLOWED_HOSTS without wildcards is required")
if not REDIS_URL or not REDIS_URL.startswith(("redis://", "rediss://")):
    raise ImproperlyConfigured("REDIS_URL is required for shared production throttling")
if not env("CORS_ALLOWED_ORIGINS"):
    raise ImproperlyConfigured("Explicit CORS_ALLOWED_ORIGINS is required")

CACHES = {"default": {
    "BACKEND": "django.core.cache.backends.redis.RedisCache",
    "LOCATION": REDIS_URL,
    "KEY_PREFIX": "bestway",
    "TIMEOUT": 300,
}}
REST_FRAMEWORK = {**REST_FRAMEWORK,
    "DEFAULT_THROTTLE_CLASSES": ["common.api.throttling.GlobalAPIThrottle"],
    "DEFAULT_THROTTLE_RATES": {**REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"], "api": "300/min"},
    # Default to the socket peer. Configure an exact trusted proxy count only
    # after the edge strips/replaces client-provided forwarding headers.
    "NUM_PROXIES": int(env("TRUSTED_PROXY_COUNT", "0")),
}
DATABASES["default"]["CONN_MAX_AGE"] = 60
DATABASES["default"]["CONN_HEALTH_CHECKS"] = True
MIDDLEWARE = [*MIDDLEWARE, "django.middleware.csrf.CsrfViewMiddleware",
              "django.middleware.clickjacking.XFrameOptionsMiddleware"]
# Enable only behind a trusted proxy which strips/replaces incoming X-Forwarded-Proto.
if env_bool("TRUST_PROXY_SSL_HEADER", False):
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", True)
SECURE_REDIRECT_EXEMPT = [r"^v1/health$"]
SECURE_HSTS_SECONDS = int(env("SECURE_HSTS_SECONDS", "31536000"))
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = False
# Preload registration is a separate, long-lived domain decision, not a
# prerequisite to API deployment. Keep every other deployment check enabled.
SILENCED_SYSTEM_CHECKS = ["security.W021"]
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
STATIC_ROOT = BASE_DIR / "staticfiles"
