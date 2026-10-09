"""Container readiness checks HTTP, PostgreSQL and the shared throttle cache."""
import os
import sys
import urllib.request


def main():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.production')
    try:
        import django
        django.setup()
        from django.core.cache import cache
        from django.db import connection
        with connection.cursor() as cursor:
            cursor.execute('SELECT 1')
            if cursor.fetchone() != (1,):
                return 1
        cache.get('container-readiness')
        port = int(os.environ.get('HEALTHCHECK_PORT', '8000'))
        request = urllib.request.Request(f'http://127.0.0.1:{port}/v1/health',
                                         headers={'Host': 'api.bestwayec.uz'})
        with urllib.request.urlopen(request, timeout=3) as response:
            return 0 if response.status == 200 else 1
    except Exception:
        # Health status does not expose provider credentials or connection details.
        return 1


if __name__ == '__main__':
    sys.exit(main())
