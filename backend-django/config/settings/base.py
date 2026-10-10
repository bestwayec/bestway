from __future__ import annotations
import os
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse
BASE_DIR = Path(__file__).resolve().parents[2]
def env(name: str, default: str = "") -> str: return os.getenv(name, default).strip()
def env_bool(name: str, default: bool = False) -> bool: return env(name, str(default)).lower() in {"1", "true", "yes", "on"}
def env_list(name: str, default: str = "") -> list[str]: return [v.strip() for v in env(name, default).split(",") if v.strip()]
def database_from_url(raw: str) -> dict[str, object]:
    parsed = urlparse(raw)
    if parsed.scheme not in {"postgres", "postgresql"}: raise RuntimeError("DATABASE_URL must be a PostgreSQL URL")
    query = parse_qs(parsed.query)
    return {"ENGINE":"django.db.backends.postgresql", "NAME":unquote(parsed.path.lstrip("/")), "USER":unquote(parsed.username or ""), "PASSWORD":unquote(parsed.password or ""), "HOST":parsed.hostname or "", "PORT":str(parsed.port or 5432), "OPTIONS":{"options":f"-c search_path={query.get('schema', ['public'])[0]}"}, "CONN_MAX_AGE":0}
SECRET_KEY = env("DJANGO_SECRET_KEY", "phase-1-local-only-not-for-production")
DEBUG = env_bool("DEBUG", False)
ALLOWED_HOSTS = env_list("ALLOWED_HOSTS", "localhost,127.0.0.1")
DATABASE_URL = env("DATABASE_URL")
if not DATABASE_URL: raise RuntimeError("DATABASE_URL is required; Phase 1 never falls back to SQLite")
DATABASES = {"default": database_from_url(DATABASE_URL)}
INSTALLED_APPS = ["django.contrib.auth", "django.contrib.contenttypes", "django.contrib.staticfiles", "corsheaders", "rest_framework", "apps.core", "apps.legacy_schema"]
MIDDLEWARE = ["corsheaders.middleware.CorsMiddleware", "django.middleware.security.SecurityMiddleware", "django.middleware.common.CommonMiddleware"]
ROOT_URLCONF = "config.urls"; TEMPLATES: list[dict[str, object]] = []; WSGI_APPLICATION = "config.wsgi.application"; ASGI_APPLICATION = "config.asgi.application"; DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"; USE_TZ = True; TIME_ZONE = "Asia/Tashkent"; LANGUAGE_CODE = "en-us"; STATIC_URL = "/static/"; MEDIA_URL = env("MEDIA_URL", "/media/")
# Share the reference storage root by default so existing mock keys still resolve.
MEDIA_ROOT = env("STORAGE_DIR", str(BASE_DIR.parent / "backend" / "storage"))
if not Path(MEDIA_ROOT).is_absolute():
    MEDIA_ROOT = str((BASE_DIR.parent / "backend" / MEDIA_ROOT).resolve())
DATA_UPLOAD_MAX_MEMORY_SIZE = 3 * 1024 * 1024
CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", env("FRONTEND_ORIGIN", "http://localhost:3000")); CORS_ALLOW_CREDENTIALS = True
REST_FRAMEWORK = {"EXCEPTION_HANDLER": "common.api.exceptions.exception_handler", "DEFAULT_AUTHENTICATION_CLASSES": ["common.auth.authentication.BestwayJWTAuthentication"], "DEFAULT_THROTTLE_RATES": {"auth_public": "30/min", "auth_sensitive": "10/min"}}
BUILD_COMMIT = env("BUILD_COMMIT") or None; DESKTOP_LATEST_VERSION = env("DESKTOP_LATEST_VERSION", "0.5.1-rc.1"); DESKTOP_DOWNLOAD_URL = env("DESKTOP_DOWNLOAD_URL", "https://github.com/bestwayec/bw-tauri/releases/download/v0.5.1-rc.1/Bestway.App_0.5.1-rc.1_x64-setup.exe"); DESKTOP_PRERELEASE = env_bool("DESKTOP_PRERELEASE", True); DESKTOP_UPDATE_CHANNEL = "manual_installer"
JWT_SECRET = env("JWT_SECRET"); JWT_ACCESS_TTL_MINUTES = int(env("JWT_ACCESS_TTL", "15m").removesuffix("m") or "15"); JWT_REFRESH_TTL_DAYS = int(env("JWT_REFRESH_TTL_DAYS", "30") or "30"); DESKTOP_REDIRECT_URIS = env_list("DESKTOP_REDIRECT_URIS", "bestway-exam://auth/callback"); REDIS_URL = env("REDIS_URL"); DEEPSEEK_API_KEY = env("DEEPSEEK_API_KEY"); DEEPGRAM_API_KEY = env("DEEPGRAM_API_KEY")
