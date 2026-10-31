import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.local")
from django.core.asgi import get_asgi_application

django_http_app = get_asgi_application()


async def application(scope, receive, send):
    if scope.get("type") == "websocket" and scope.get("path", "").startswith("/ws/bamboozle/"):
        from apps.bamboozle.consumers import bamboozle_websocket_consumer
        await bamboozle_websocket_consumer(scope, receive, send)
    else:
        await django_http_app(scope, receive, send)
