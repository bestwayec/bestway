"""Parent Telegram Monitoring and Weekly Digest API Views."""
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from .views import require_authenticated, require_role, success
from apps.core.parent_bot_service import (
    get_or_create_parent_invite_code,
    send_weekly_parent_digest,
)


@api_view(["GET"])
@permission_classes([AllowAny])
def parent_invite_code_view(request):
    """Retrieve or generate 6-digit parent invite code for current student."""
    user = require_authenticated(request)
    code_data = get_or_create_parent_invite_code(user.id, getattr(user, "name", ""))
    return success(code_data)


@api_view(["POST"])
@permission_classes([AllowAny])
def send_parent_weekly_digest_view(request):
    """Trigger dispatch of weekly performance digests to parents (Teacher/Admin)."""
    require_authenticated(request)
    require_role(request, "teacher", "admin", "super_admin")

    student_id = request.data.get("studentId") if isinstance(request.data, dict) else None
    result = send_weekly_parent_digest(student_id=student_id)
    return success({
        "message": f"Haftalik hisobot {result['sentCount']} ta ota-onaga muvaffaqiyatli jo'natildi.",
        **result,
    })
