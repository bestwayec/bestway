import re
from django.http import HttpResponse
from rest_framework.decorators import api_view, permission_classes
from common.auth.permissions import Authenticated
from . import groups as service
from .domain_contracts import payload, invalid
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
        cleaned_schedule = []
        for item in schedule:
            if not isinstance(item, dict): invalid('each value in nested property schedule must be either object or array')
            day = item.get('day')
            if day not in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'):
                invalid('day must be one of the following values: mon, tue, wed, thu, fri, sat, sun')
            start = item.get('startTime')
            end = item.get('endTime')
            if (not start or not end) and isinstance(item.get('time'), str) and '-' in item['time']:
                parts = item['time'].split('-')
                start = start or parts[0].strip()
                end = end or parts[1].strip()
            for key, val in [('startTime', start), ('endTime', end)]:
                if isinstance(val, str) and len(val) == 8 and val.count(':') == 2:
                    val = val[:5]
                if not isinstance(val, str) or not re.fullmatch(r'([01]\d|2[0-3]):[0-5]\d', val or ''):
                    invalid("Vaqt HH:MM formatida bo'lsin")
                if key == 'startTime': start = val
                else: end = val
            cleaned_schedule.append({'day': day, 'startTime': start, 'endTime': end})
        data['schedule'] = cleaned_schedule
    return data


@api_view(['GET', 'POST'])
@permission_classes([Authenticated])
def groups_view(request):
    if request.method == 'GET': return success(service.list_groups(request.user))
    require_role(request, 'admin', 'super_admin')
    return success(service.create(request.user, validate(payload(request, {'name', 'teacherId', 'schedule'}), True)), 201)


@api_view(['GET', 'PATCH'])
@permission_classes([Authenticated])
def group_view(request, group_id):
    if request.method == 'GET': return success(service.detail(request.user, group_id))
    actor = request.user
    if actor.role == 'teacher':
        group = service.get_group(group_id)
        if group.teacher_id != actor.id:
            service.fail('FORBIDDEN', 'Bu guruh sizga biriktirilmagan', 403)
        allowed = {'name', 'schedule', 'teacherId', 'description', 'groupId', 'id'}
        data = payload(request, allowed)
        clean_data = {k: v for k, v in data.items() if k in ('name', 'schedule')}
        return success(service.update(actor, group_id, validate(clean_data)))
    require_role(request, 'admin', 'super_admin')
    allowed = {'name', 'teacherId', 'schedule', 'description', 'groupId', 'id'}
    data = payload(request, allowed)
    clean_data = {k: v for k, v in data.items() if k in ('name', 'teacherId', 'schedule')}
    return success(service.update(actor, group_id, validate(clean_data)))


@api_view(['GET'])
@permission_classes([Authenticated])
def export_group_results_view(request, group_id):
    actor = request.user
    group = service.get_group(group_id)
    if actor.role == 'teacher' and group.teacher_id != actor.id:
        service.fail('FORBIDDEN', 'Bu guruh sizga biriktirilmagan', 403)
    elif actor.role not in ('admin', 'super_admin', 'teacher'):
        service.fail('FORBIDDEN', 'Ruxsat berilmagan', 403)

    from . import statistics
    body = statistics.students_csv(group_id)
    safe_name = re.sub(r'[^a-zA-Z0-9_\-]+', '_', group.name)
    response = HttpResponse(body, content_type='text/csv; charset=utf-8')
    response['Content-Disposition'] = f'attachment; filename="guruh-{safe_name}-vedomost.csv"'
    return response


@api_view(['POST'])
@permission_classes([Authenticated])
def add_student_view(request, group_id):
    require_role(request, 'admin', 'super_admin')
    data = payload(request, {'studentId'})
    if data.get('studentId') in ('', None): invalid('studentId should not be empty')
    if not isinstance(data['studentId'], str): invalid('studentId must be a string')
    return success(service.add_student(request.user, group_id, data['studentId']), 201)


@api_view(['DELETE'])
@permission_classes([Authenticated])
def remove_student_view(request, group_id, student_id):
    require_role(request, 'admin', 'super_admin')
    return success(service.remove_student(request.user, group_id, student_id))
