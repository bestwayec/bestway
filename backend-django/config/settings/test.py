import os

os.environ.setdefault("DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/education_center?schema=public")

from .base import *

# pytest-django uses an isolated database derived from this name; it never targets education_center.
DATABASES["default"]["NAME"] = "test_bestway_django_phase1"
DATABASES["default"]["TEST"] = {"NAME": "test_bestway_django_phase1"}
ALLOWED_HOSTS = ["testserver", "localhost", "127.0.0.1"]
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
