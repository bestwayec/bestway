"""REST API Views for Smart Question Parser, Excel/CSV Import, Single Audio Timestamps,
Dual-Scale Score Prediction (IELTS 0–9 & Multi-Level 0–75 CEFR), and Live Exam Rooms.
"""
from __future__ import annotations

import json

from django.db import connection
from django.http import HttpResponse
from rest_framework.decorators import api_view, permission_classes

from apps.legacy_schema.models import MockSection
from common.api.exceptions import ContractAPIException
from common.auth.permissions import Authenticated

from . import exam_import_service, live_exam_service, prediction_service
from .mock_attempt_views import success
from .views import _can_view_student, require_role


@api_view(["POST"])
@permission_classes([Authenticated])
def smart_parse_view(request):
    require_role(request, "teacher", "admin", "super_admin")
    data = request.data if isinstance(request.data, dict) else {}
    text = data.get("text") or ""
    skill = (data.get("skill") or request.query_params.get("skill") or "reading").strip().lower()
    exam_type = (data.get("examType") or data.get("type") or request.query_params.get("examType") or "ielts_academic").strip().lower()
    answers = data.get("answers") if isinstance(data.get("answers"), dict) else None

    result = exam_import_service.parse_smart_exam_text(
        text=text,
        default_skill=skill,
        exam_type=exam_type,
        provided_answers=answers,
    )
    return success(result, status=200)


@api_view(["POST"])
@permission_classes([Authenticated])
def exam_bulk_import_view(request, exam_id: str):
    require_role(request, "teacher", "admin", "super_admin")
    data = request.data if isinstance(request.data, dict) else {}
    skill = (data.get("skill") or request.query_params.get("skill") or "reading").strip().lower()
    result = exam_import_service.bulk_import_to_exam(request.user, exam_id, skill, data)
    return success(result, status=201)


@api_view(["POST"])
@permission_classes([Authenticated])
def section_bulk_import_view(request, section_id: str):
    require_role(request, "teacher", "admin", "super_admin")
    data = request.data if isinstance(request.data, dict) else {}
    result = exam_import_service.bulk_import_to_section(request.user, section_id, data)
    return success(result, status=201)


@api_view(["POST"])
@permission_classes([Authenticated])
def group_bulk_import_view(request, group_id: str):
    require_role(request, "teacher", "admin", "super_admin")
    data = request.data if isinstance(request.data, dict) else {}
    result = exam_import_service.bulk_import_to_group(request.user, group_id, data)
    return success(result, status=201)


@api_view(["GET"])
@permission_classes([Authenticated])
def excel_template_view(request):
    require_role(request, "teacher", "admin", "super_admin")
    exam_type = (request.query_params.get("examType") or request.query_params.get("type") or "ielts_academic").strip().lower()
    skill = (request.query_params.get("skill") or "reading").strip().lower()
    xlsx_bytes, filename = exam_import_service.generate_excel_template(exam_type=exam_type, skill=skill)
    response = HttpResponse(
        xlsx_bytes,
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


@api_view(["POST"])
@permission_classes([Authenticated])
def excel_import_view(request, exam_id: str | None = None):
    require_role(request, "teacher", "admin", "super_admin")
    upload = request.FILES.get("file") or request.FILES.get("excel") or request.FILES.get("spreadsheet")
    if upload is None:
        raise ContractAPIException("VALIDATION_ERROR", "Excel (.xlsx) yoki CSV fayl yuklanmadi", 400)

    file_bytes = upload.read()
    filename = getattr(upload, "name", "import.xlsx")
    data = request.data if hasattr(request, "data") else {}
    target_exam_id = exam_id or data.get("examId") or request.query_params.get("examId")
    group_id = data.get("groupId") or request.query_params.get("groupId")
    skill = (data.get("skill") or request.query_params.get("skill") or "reading").strip().lower()
    preview_only = str(data.get("previewOnly") or request.query_params.get("previewOnly") or "").lower() in (
        "1",
        "true",
        "yes",
    )
    replace_existing = str(data.get("replaceExisting", "true")).lower() not in ("0", "false", "no")

    if preview_only or (not target_exam_id and not group_id):
        parsed = exam_import_service.parse_spreadsheet_bytes(file_bytes, filename=filename)
        return success(parsed, status=200)

    if not target_exam_id and group_id:
        from apps.legacy_schema.models import MockQuestionGroup

        grp = MockQuestionGroup.objects.select_related("section").filter(id=group_id).first()
        if not grp:
            raise ContractAPIException("MOCK_GROUP_NOT_FOUND", "Savollar guruhi topilmadi", 404)
        target_exam_id = grp.section.exam_id
        skill = grp.section.skill

    result = exam_import_service.import_spreadsheet_to_exam(
        actor=request.user,
        exam_id=target_exam_id,
        file_bytes=file_bytes,
        filename=filename,
        skill=skill,
        group_id=group_id,
        replace_existing=replace_existing,
    )
    return success(result, status=201)


@api_view(["GET", "POST", "PUT"])
@permission_classes([Authenticated])
def exam_audio_timestamps_view(request, exam_id: str):
    if request.method == "GET":
        return success(exam_import_service.get_listening_timestamps(exam_id))

    require_role(request, "teacher", "admin", "super_admin")
    data = request.data if hasattr(request, "data") else {}
    raw_ts = data.get("timestamps")
    if isinstance(raw_ts, str):
        try:
            raw_ts = json.loads(raw_ts)
        except Exception:
            raw_ts = []
    if not isinstance(raw_ts, list):
        raw_ts = []

    audio_key = data.get("audioKey")
    audio_url = data.get("audioUrl")
    duration_sec = data.get("durationSec") or data.get("audioDurationSec")
    if duration_sec is not None and str(duration_sec).strip() != "":
        try:
            duration_sec = int(float(duration_sec))
        except ValueError:
            duration_sec = None
    else:
        duration_sec = None

    uploaded_audio = request.FILES.get("audio") or request.FILES.get("file")
    result = exam_import_service.save_listening_timestamps(
        actor=request.user,
        exam_id=exam_id,
        timestamps=raw_ts,
        audio_key=audio_key,
        audio_url=audio_url,
        duration_sec=duration_sec,
        uploaded_file=uploaded_audio,
    )
    return success(result, status=200)


@api_view(["POST", "PUT"])
@permission_classes([Authenticated])
def section_audio_timestamps_view(request, section_id: str):
    require_role(request, "teacher", "admin", "super_admin")
    section = MockSection.objects.filter(id=section_id).first()
    if not section:
        raise ContractAPIException("MOCK_SECTION_NOT_FOUND", "Bo'lim topilmadi", 404)
    return exam_audio_timestamps_view(request._request, exam_id=section.exam_id)


@api_view(["GET", "PATCH", "PUT"])
@permission_classes([Authenticated])
def my_prediction_view(request):
    if request.method in ("PATCH", "PUT"):
        data = request.data if isinstance(request.data, dict) else {}
        return success(prediction_service.update_student_target(request.user.id, data))

    limit_param = request.query_params.get("limit", 5)
    try:
        limit = int(limit_param)
    except (TypeError, ValueError):
        limit = 5
    return success(prediction_service.get_student_prediction(request.user.id, limit=limit))


@api_view(["GET"])
@permission_classes([Authenticated])
def student_prediction_view(request, student_id: str):
    with connection.cursor() as cursor:
        _can_view_student(cursor, request.user, student_id)
    limit_param = request.query_params.get("limit", 5)
    try:
        limit = int(limit_param)
    except (TypeError, ValueError):
        limit = 5
    return success(prediction_service.get_student_prediction(student_id, limit=limit))


@api_view(["GET", "POST"])
@permission_classes([Authenticated])
def live_rooms_view(request):
    if request.method == "GET":
        group_id = request.query_params.get("groupId")
        status = request.query_params.get("status")
        return success(live_exam_service.list_sessions(request.user, group_id=group_id, status=status))

    require_role(request, "teacher", "admin", "super_admin")
    data = request.data if isinstance(request.data, dict) else {}
    return success(live_exam_service.create_session(request.user, data), status=201)


@api_view(["GET", "POST"])
@permission_classes([Authenticated])
def live_room_join_view(request):
    if request.method == "GET":
        pin = request.query_params.get("pin") or ""
        sim_mode = request.query_params.get("simulatorMode") or request.query_params.get("mode")
    else:
        data = request.data if isinstance(request.data, dict) else {}
        pin = data.get("pin") or request.query_params.get("pin") or ""
        sim_mode = data.get("simulatorMode") or data.get("mode")
    return success(
        live_exam_service.join_by_pin(request.user, pin=str(pin), simulator_mode_override=sim_mode),
        status=200 if request.method == "GET" else 201,
    )


@api_view(["GET"])
@permission_classes([Authenticated])
def live_room_pin_view(request, pin: str):
    return success(live_exam_service.get_session_by_pin(pin))


@api_view(["GET"])
@permission_classes([Authenticated])
def live_room_detail_view(request, room_id: str):
    return success(live_exam_service.get_session_detail(request.user, room_id))


@api_view(["GET"])
@permission_classes([Authenticated])
def live_room_monitor_view(request, room_id: str):
    require_role(request, "teacher", "admin", "super_admin")
    return success(live_exam_service.get_monitor_data(request.user, room_id))


@api_view(["POST"])
@permission_classes([Authenticated])
def live_room_progress_view(request, room_id: str):
    data = request.data if isinstance(request.data, dict) else {}
    return success(live_exam_service.update_progress(request.user, room_id, data))


@api_view(["POST"])
@permission_classes([Authenticated])
def live_room_close_view(request, room_id: str):
    require_role(request, "teacher", "admin", "super_admin")
    return success(live_exam_service.close_session(request.user, room_id))


@api_view(["GET"])
@permission_classes([Authenticated])
def live_room_export_excel_view(request, room_id: str):
    require_role(request, "teacher", "admin", "super_admin")
    xlsx_bytes, filename = live_exam_service.export_session_excel(request.user, room_id)
    response = HttpResponse(
        xlsx_bytes,
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response
