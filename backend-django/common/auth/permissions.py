from rest_framework.permissions import BasePermission
from common.api.exceptions import ContractAPIException
class Authenticated(BasePermission):
    """Return the Nest contract's missing-bearer response, not DRF's default."""
    def has_permission(self, request, view):
        if not request.user or not getattr(request.user, "is_authenticated", False):
            raise ContractAPIException("UNAUTHORIZED", "Avval tizimga kiring", 401)
        return True
class HasRole(BasePermission):
    roles: tuple[str,...] = ()
    def has_permission(self, request, view):
        if not request.user or not getattr(request.user,"is_authenticated",False): raise ContractAPIException("UNAUTHORIZED", "Avval tizimga kiring", 401)
        if self.roles and request.user.role not in self.roles: raise ContractAPIException("FORBIDDEN", "Bu amal uchun rolingiz yetarli emas", 403)
        return True
def roles(*allowed: str):
    return type("RolePermission", (HasRole,), {"roles":allowed})
