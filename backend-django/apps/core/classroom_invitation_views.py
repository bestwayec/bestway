from rest_framework.decorators import api_view, permission_classes

from common.auth.permissions import Authenticated
from . import classroom_invitations as invitations
from .domain_contracts import invalid, payload
from .mock_attempt_views import success


@api_view(["GET", "POST", "DELETE"])
@permission_classes([Authenticated])
def manage(request, group_id):
    if request.method == "GET":
        return success(invitations.invitation_status(request.user, group_id))
    if request.method == "DELETE":
        return success(invitations.revoke(request.user, group_id))
    data = payload(request, {"requiresApproval", "expiresInHours", "maxUses"})
    approval = data.get("requiresApproval", False)
    expires = data.get("expiresInHours", 168)
    max_uses = data.get("maxUses")
    if type(approval) is not bool or type(expires) is not int or not 1 <= expires <= 720:
        invalid("Invalid approval mode or expiration")
    if max_uses is not None and (type(max_uses) is not int or not 1 <= max_uses <= 1000):
        invalid("maxUses must be between 1 and 1000")
    return success(invitations.issue(
        request.user, group_id, requires_approval=approval, expires_in_hours=expires, max_uses=max_uses,
    ), 201)


@api_view(["POST"])
@permission_classes([Authenticated])
def decide(request, group_id, request_id):
    data = payload(request, {"approve"})
    if type(data.get("approve")) is not bool:
        invalid("approve must be boolean")
    return success(invitations.decide(request.user, group_id, request_id, approve=data["approve"]))


@api_view(["POST"])
@permission_classes([Authenticated])
def join(request):
    data = payload(request, {"code", "preview"})
    if type(data.get("preview")) is not bool or not isinstance(data.get("code"), str) or len(data["code"]) > 40:
        invalid("Invalid invitation request")
    if data["preview"]:
        return success(invitations.preview(request.user, data["code"]))
    return success(invitations.redeem(request.user, data["code"], source="web"))
