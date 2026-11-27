from rest_framework.decorators import api_view, permission_classes

from common.auth.permissions import Authenticated, roles

from . import live_exam_guard as guard
from . import mock_attempts as engine
from .domain_contracts import invalid, payload
from .mock_attempt_views import success


@api_view(["POST"])
@permission_classes([Authenticated])
def record_guard_events_view(request, attempt_id):
    if request.user.role not in ("student", "admin", "super_admin"):
        engine.fail("FORBIDDEN", "Ruxsat berilmagan", 403)
    attempt = engine.own(request.user, attempt_id)
    data = request.data if isinstance(request.data, dict) else {}
    if isinstance(data.get("events"), list):
        recorded = guard.record_batch_events(request.user, attempt, data["events"])
        return success({"recorded": len(recorded), "items": recorded}, 201)
    raw_event = data.get("event") or data.get("eventType")
    if not isinstance(raw_event, str) or not raw_event.strip():
        invalid("event is required")
    res = guard.record_event(
        request.user,
        attempt,
        raw_event,
        skill=data.get("skill"),
        question_ref=str(data.get("questionRef") or ""),
        integrity_mode=data.get("integrityMode"),
        offline_synced=bool(data.get("offlineSynced")),
    )
    return success(res, 201)


@api_view(["GET"])
@permission_classes([roles("teacher", "admin", "super_admin")])
def teacher_guard_alerts_view(request):
    status = str(request.query_params.get("status") or "")
    group_id = str(request.query_params.get("groupId") or "")
    try:
        limit = min(100, max(1, int(request.query_params.get("limit", 30))))
    except ValueError:
        limit = 30
    return success(guard.teacher_alerts(request.user, status=status, group_id=group_id, limit=limit))


@api_view(["POST"])
@permission_classes([roles("teacher", "admin", "super_admin")])
def review_guard_incident_view(request, incident_id):
    data = payload(request, {"status", "note"})
    status = data.get("status")
    if not isinstance(status, str):
        invalid("status is required")
    return success(guard.review_incident(request.user, incident_id, status=status, note=str(data.get("note") or "")))


@api_view(["GET"])
@permission_classes([roles("teacher", "admin", "super_admin")])
def group_live_guard_view(request, group_id):
    return success(guard.group_live_guard(request.user, group_id))
