from rest_framework.throttling import SimpleRateThrottle


class GlobalAPIThrottle(SimpleRateThrottle):
    """Shared source-IP budget; endpoint auth throttles retain their own rates."""

    scope = "api"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}
