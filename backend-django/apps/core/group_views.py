import re

from django.http import HttpResponse
from rest_framework.decorators import api_view, permission_classes

from common.auth.permissions import Authenticated

from . import classroom_roster, group_report, groups as service
from .domain_contracts import invalid, payload
from .mock_attempt_views import success
from .views import require_role


def validate(data, create=False):
    if create or ('name' in data and data['name'] is not None):
        value = data.get('name')
        if not isinstance(value, str) or len(value) > 100: invalid('name must be shorter than or equal to 100 characters')
        if len(value) < 2: invalid('name must be longer than or equal to 2 characters')
    if data.get('teacherId') is not None and not isinstance(data['teacherId'], str): invalid('teacherId must be a string')
    schedule = data.get('schedule')
    if schedule is not None:
        if not isinstance(schedule, list): invalid('schedule must be an array')
        if len(schedule) > 28: invalid('schedule supports up to 28 weekly slots')
        cleaned_schedule = []
        for item in schedule:
            if not isinstance(item, dict): invalid('each value in nested property schedule must be either object or array')
            raw_day = item.get('day')
            day = str(raw_day).strip().lower()[:3] if raw_day else ''
            if day not in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'):
                invalid('day must be one of the following values: mon, tue, wed, thu, fri, sat, sun')
            start = item.get('startTime')
            end = item.get('endTime')
            time_val = item.get('time')
            if isinstance(time_val, str):
                if '-' in time_val:
                    parts = time_val.split('-')
                    start = start or parts[0].strip()
                    end = end or parts[1].strip()
                else:
                    start = start or time_val.strip()
                    end = end or start
            if not start:
                start = '09:00'
            if not end:
                end = start
            for key, val in [('startTime', start), ('endTime', end)]:
                if isinstance(val, str) and len(val) >= 5:
                    val = val[:5]
                if not isinstance(val, str) or not re.fullmatch(r'([01]\d|2[0-3]):[0-5]\d', val or ''):
                    invalid("Vaqt HH:MM formatida bo'lsin")
                if key == 'startTime': start = val
                else: end = val
            if start > end:
                invalid("Dars boshlanishi tugashidan oldin bo‘lishi kerak")
            if any(slot['day'] == day and (slot['startTime'], slot['endTime']) == (start, end)
                   or slot['day'] == day and start < slot['endTime'] and end > slot['startTime']
                   for slot in cleaned_schedule):
                invalid("Dars jadvali takrorlangan yoki ustma-ust tushgan")
            cleaned_schedule.append({'day': day, 'startTime': start, 'endTime': end})
        data['schedule'] = cleaned_schedule
    return data


@api_view(['GET', 'POST'])
@permission_classes([Authenticated])
def groups_view(request):
    if request.method == 'GET':
        archive = request.query_params.get("archived", "false")
        search = request.query_params.get("search", "").strip()
        if archive not in ("true", "false") or len(search) > 100:
            invalid("Guruh filtri yaroqsiz")
        return success(service.list_groups(request.user, archived=archive == "true", search=search))
    require_role(request, 'teacher', 'admin', 'super_admin')
    raw = payload(request, {'name', 'teacherId', 'schedule', 'description'})
    clean = {k: v for k, v in raw.items() if k in ('name', 'teacherId', 'schedule')}
    return success(service.create(request.user, validate(clean, True)), 201)


@api_view(['GET', 'PATCH'])
@permission_classes([Authenticated])
def group_view(request, group_id):
    if request.method == 'GET':
        return success(service.detail(request.user, group_id))
    actor = request.user
    if actor.role == 'teacher':
        group = service.get_group(group_id)
        if group.teacher_id != actor.id:
            service.fail('FORBIDDEN', 'Bu guruh sizga biriktirilmagan', 403)
        allowed = {'name', 'schedule', 'teacherId', 'description', 'groupId', 'id'}
        data = payload(request, allowed)
        clean_data = {k: v for k, v in data.items() if k in ('name', 'schedule', 'teacherId')}
        return success(service.update(actor, group_id, validate(clean_data)))
    require_role(request, 'admin', 'super_admin')
    allowed = {'name', 'teacherId', 'schedule', 'description', 'groupId', 'id'}
    data = payload(request, allowed)
    clean_data = {k: v for k, v in data.items() if k in ('name', 'teacherId', 'schedule')}
    return success(service.update(actor, group_id, validate(clean_data)))


def _build_excel_response(actor, group_id, params):
    xlsx_bytes = group_report.generate_group_workbook(actor, group_id, params.get("month"), params)
    response = HttpResponse(
        xlsx_bytes,
        content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    response['Content-Disposition'] = 'attachment; filename="classroom-report.xlsx"'
    return response


@api_view(['GET'])
@permission_classes([Authenticated])
def export_group_excel_view(request, group_id):
    return _build_excel_response(request.user, group_id, request.query_params)


@api_view(['GET'])
@permission_classes([Authenticated])
def export_group_results_view(request, group_id):
    fmt = (request.query_params.get('format') or '').strip().lower()
    if fmt in ('xlsx', 'excel'):
        return _build_excel_response(request.user, group_id, request.query_params)

    actor = request.user
    group = service.get_group(group_id)
    if actor.role == 'teacher' and group.teacher_id != actor.id:
        service.fail('FORBIDDEN', 'Bu guruh sizga biriktirilmagan', 403)
    elif actor.role not in ('admin', 'super_admin', 'teacher'):
        service.fail('FORBIDDEN', 'Ruxsat berilmagan', 403)

    body = group_report.generate_group_monthly_csv(actor, group_id, request.query_params.get("month"), request.query_params)
    safe_name = re.sub(r'[^a-zA-Z0-9_\-]+', '_', group.name)
    response = HttpResponse(body, content_type='text/csv; charset=utf-8')
    response['Content-Disposition'] = f'attachment; filename="guruh-{safe_name}-natijalar.csv"'
    return response


@api_view(['POST'])
@permission_classes([Authenticated])
def add_student_view(request, group_id):
    require_role(request, 'teacher', 'admin', 'super_admin')
    data = payload(request, {'studentId', 'sourceGroupId'})
    if data.get('studentId') in ('', None):
        invalid('studentId should not be empty')
    if not isinstance(data['studentId'], str):
        invalid('studentId must be a string')
    source = data.get('sourceGroupId')
    if 'sourceGroupId' in data and (not isinstance(source, str) or not source or len(source) > 255):
        invalid('sourceGroupId must identify a group')
    return success(service.add_student(request.user, group_id, data['studentId'], source_group_id=source), 201)


@api_view(['DELETE'])
@permission_classes([Authenticated])
def remove_student_view(request, group_id, student_id):
    require_role(request, 'teacher', 'admin', 'super_admin')
    return success(service.remove_student(request.user, group_id, student_id))



@api_view(["GET", "PUT"])
@permission_classes([Authenticated])
def classroom_archive_view(request, group_id):
    require_role(request, "teacher", "admin", "super_admin")
    if request.method == "GET":
        return success(classroom_roster.archive_status(request.user, group_id))
    data = payload(request, {"archived"})
    if type(data.get("archived")) is not bool:
        invalid("archived must be boolean")
    return success(classroom_roster.archive(request.user, group_id, data["archived"]))


@api_view(["POST"])
@permission_classes([Authenticated])
def bulk_classroom_membership_view(request, group_id):
    require_role(request, "teacher", "admin", "super_admin")
    data = payload(request, {"action", "studentIds"})
    identifiers, action = data.get("studentIds"), data.get("action")
    if action not in ("add", "remove") or not isinstance(identifiers, list) or not 1 <= len(identifiers) <= 100:
        invalid("Select 1–100 students and a supported action")
    if any(not isinstance(value, str) or not 1 <= len(value) <= 255 for value in identifiers):
        invalid("Invalid student ID")
    if len(set(identifiers)) != len(identifiers):
        invalid("Student IDs must be unique")
    return success(classroom_roster.bulk_membership(request.user, group_id, identifiers, action))


@api_view(["GET"])
@permission_classes([Authenticated])
def classroom_student_history_view(request, group_id, student_id):
    require_role(request, "teacher", "admin", "super_admin")
    return success(classroom_roster.history(request.user, group_id, student_id))


@api_view(["GET"])
@permission_classes([Authenticated])
def classroom_member_history_view(request, group_id):
    require_role(request, "teacher", "admin", "super_admin")
    search = request.query_params.get("search", "").strip()
    page = request.query_params.get("page", "1")
    if len(search) > 100 or not re.fullmatch(r"[1-9][0-9]{0,3}", page):
        invalid("Invalid history filter")
    return success(classroom_roster.member_history(request.user, group_id, search, int(page)))
