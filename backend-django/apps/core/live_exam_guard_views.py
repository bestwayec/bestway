from django.db import transaction
from django.utils.dateparse import parse_datetime
from rest_framework.decorators import api_view, permission_classes

from common.auth.permissions import Authenticated, roles

from . import exam_session
from . import live_exam_guard as guard
from . import mock_attempts as engine
from .domain_contracts import invalid, payload
from .mock_attempt_views import success


def _observation(data):
    if not isinstance(data, dict) or data.keys() - {
        "event", "eventType", "observedAt", "offlineSynced", "eventId", "skill", "questionRef", "integrityMode",
    }:
        invalid("Invalid exam observation")
    event = data.get("event") or data.get("eventType")
    if not isinstance(event, str) or not 0 < len(event) <= 48:
        invalid("event is required")
    offline = data.get("offlineSynced", False)
    if type(offline) is not bool:
        invalid("offlineSynced must be a boolean")
    observed_at = data.get("observedAt")
    if observed_at is not None:
        if not offline or not isinstance(observed_at, str) or len(observed_at) > 40:
            invalid("Invalid observedAt")
        try:
            observed_at = parse_datetime(observed_at)
        except ValueError:
            invalid("Invalid observedAt")
        if observed_at is None:
            invalid("Invalid observedAt")
    if offline and observed_at is None:
        invalid("Offline observations require observedAt")
    skill, question_ref = data.get("skill"), data.get("questionRef", "")
    if (skill is not None and not isinstance(skill, str)) or not isinstance(question_ref, str):
        invalid("Invalid exam observation")
    return {
        "raw_event": event, "offline_synced": offline, "observed_at": observed_at,
        "event_id": data.get("eventId"), "skill": skill, "question_ref": question_ref,
    }


@api_view(["POST"])
@permission_classes([Authenticated])
@transaction.atomic
def record_guard_events_view(request, attempt_id):
    if request.user.role != "student":
        engine.fail("FORBIDDEN", "Ruxsat berilmagan", 403)
    attempt = engine.own(request.user, attempt_id, lock=True)
    if not isinstance(request.data, dict):
        invalid("Invalid exam observation")
    data = request.data
    batch = "events" in data
    if batch and (data.keys() != {"events"} or not isinstance(data["events"], list) or not 0 < len(data["events"]) <= 50):
        invalid("events must contain 1 to 50 exam observations")
    observations = [_observation(item) for item in (data["events"] if batch else [data])]
    exam_session.guard_observation(request, attempt_id, recovery=any(item["offline_synced"] for item in observations))
    recorded = [guard.record_event(request.user, attempt, **item) for item in observations]
    return success({"recorded": len(recorded), "items": recorded} if batch else recorded[0], 201)


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
