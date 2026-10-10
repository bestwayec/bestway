import os
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.local")
from django.core.asgi import get_asgi_application
application = get_asgi_application()
