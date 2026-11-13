"""Staff read of the question item bank (metadata only, no answer keys)."""
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny

from . import item_metadata
from .views import require_authenticated, require_role, success


@api_view(['GET'])
@permission_classes([AllowAny])
def item_bank_view(request):
    require_authenticated(request)
    require_role(request, 'teacher', 'admin', 'super_admin')
    return success(item_metadata.list_items(request.query_params))
