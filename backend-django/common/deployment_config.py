from urllib.parse import urlsplit
from django.core.exceptions import ImproperlyConfigured


def require_public_origin(value):
    try:
        parsed = urlsplit(value)
        valid = (parsed.scheme == 'https' and parsed.hostname and not parsed.username
                 and not parsed.password and parsed.path in ('', '/')
                 and not parsed.query and not parsed.fragment)
        parsed.port  # Reject malformed ports.
        if not valid:
            raise ValueError()
    except (ValueError, TypeError):
        raise ImproperlyConfigured('PUBLIC_URL must be an HTTPS origin without paths, credentials or query parameters') from None
    return value.removesuffix('/')
