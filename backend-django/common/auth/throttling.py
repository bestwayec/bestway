"""Reference-compatible public auth request limits (per client IP)."""
from rest_framework.throttling import SimpleRateThrottle


class PublicAuthThrottle(SimpleRateThrottle):
    scope = "auth_public"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class SensitiveAuthThrottle(PublicAuthThrottle):
    scope = "auth_sensitive"
