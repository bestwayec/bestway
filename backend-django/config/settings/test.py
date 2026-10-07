import os

os.environ.setdefault("DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/education_center?schema=public")

from .base import *  # noqa: F403

# pytest-django uses an isolated database derived from this name; it never targets education_center.
DATABASES["default"]["NAME"] = "test_bestway_django_phase1"  # noqa: F405
DATABASES["default"]["TEST"] = {"NAME": "test_bestway_django_phase1"}  # noqa: F405
ALLOWED_HOSTS = ["testserver", "localhost", "127.0.0.1"]  # noqa: F405
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
