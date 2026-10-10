import re
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
        for item in schedule:
            if not isinstance(item, dict): invalid('each value in nested property schedule must be either object or array')
            for key in item:
                if key not in ('day', 'startTime', 'endTime'): invalid(f'property {key} should not exist')
            if item.get('day') not in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'):
                invalid('day must be one of the following values: mon, tue, wed, thu, fri, sat, sun')
            for key in ('startTime', 'endTime'):
                if not isinstance(item.get(key), str) or not re.fullmatch(r'([01]\d|2[0-3]):[0-5]\d', item[key]): invalid("Vaqt HH:MM formatida bo'lsin")
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
    require_role(request, 'admin', 'super_admin')
    return success(service.update(request.user, group_id, validate(payload(request, {'name', 'teacherId', 'schedule'}))))


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
