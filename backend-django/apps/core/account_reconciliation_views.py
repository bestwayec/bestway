from rest_framework.decorators import api_view, permission_classes

from common.auth.permissions import roles

from . import account_reconciliation as service
from .domain_contracts import invalid, payload
from .mock_attempt_views import success


@api_view(["GET"])
@permission_classes([roles("admin", "super_admin")])
def duplicates_view(request):
    return success({
        "duplicates": service.discover_duplicates(request.user),
        "history": service.history(request.user),
    })


@api_view(["POST"])
@permission_classes([roles("admin", "super_admin")])
def preview_view(request):
    data = payload(request, {"sourceUserId", "canonicalUserId", "verificationId", "verifiedOwnership", "transferTelegram"})
    source_id = data.get("sourceUserId")
    canonical_id = data.get("canonicalUserId")
    if not isinstance(source_id, str) or not source_id or not isinstance(canonical_id, str) or not canonical_id:
        invalid("sourceUserId and canonicalUserId are required")
    return success(service.preview_merge(
        request.user,
        source_id,
        canonical_id,
        verified_ownership=data.get("verifiedOwnership", False),
        transfer_telegram=data.get("transferTelegram", False),
        verification_id=data.get("verificationId", ""),
    ))


@api_view(["POST"])
@permission_classes([roles("super_admin")])
def verify_identity_view(request):
    data = payload(request, {"sourceUserId", "canonicalUserId", "method", "reference"})
    source_id = data.get("sourceUserId")
    canonical_id = data.get("canonicalUserId")
    if not isinstance(source_id, str) or not source_id or not isinstance(canonical_id, str) or not canonical_id:
        invalid("sourceUserId and canonicalUserId are required")
    return success(service.record_verification(
        request.user, source_id, canonical_id, method=data.get("method"), reference=data.get("reference"),
    ), 201)


@api_view(["POST"])
@permission_classes([roles("admin", "super_admin")])
def merge_view(request):
    data = payload(request, {
        "sourceUserId",
        "canonicalUserId",
        "reason",
        "confirmText",
        "previewToken",
        "verificationId",
        "verifiedOwnership",
        "transferTelegram",
    })
    source_id = data.get("sourceUserId")
    canonical_id = data.get("canonicalUserId")
    if not isinstance(source_id, str) or not source_id or not isinstance(canonical_id, str) or not canonical_id:
        invalid("sourceUserId and canonicalUserId are required")
    return success(service.execute_merge(
        request.user,
        source_id,
        canonical_id,
        reason=str(data.get("reason") or ""),
        confirm_text=str(data.get("confirmText") or ""),
        preview_token=str(data.get("previewToken") or ""),
        verified_ownership=data.get("verifiedOwnership", False),
        transfer_telegram=data.get("transferTelegram", False),
        verification_id=data.get("verificationId", ""),
    ))
