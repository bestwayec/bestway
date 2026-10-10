from rest_framework.decorators import api_view, permission_classes
from common.auth.permissions import roles
from apps.legacy_schema.models import AuditLog
from . import system_settings as service
from .domain_contracts import payload, invalid, pagination, paginated
from .mock_attempt_views import success
from .views import require_role


@api_view(['GET', 'PATCH'])
@permission_classes([roles('super_admin', 'admin', 'teacher')])
def settings_view(request):
    if request.method == 'GET': return success(service.numeric_settings())
    require_role(request, 'super_admin')
    values = payload(request, service.DEFAULTS)
    ranges = dict(teacherPointLimit=(1, 1000), initialPoints=(0, 100000), monthlyFee=(0, 100000000), gameThreshold=(1, 100000))
    for key, (minimum, maximum) in ranges.items():
        if key not in values or values[key] is None: continue
        value = values[key]
        if type(value) not in (int, float) or value > maximum: invalid(f'{key} must not be greater than {maximum}')
        if value < minimum: invalid(f'{key} must not be less than {minimum}')
        if int(value) != value: invalid(f'{key} must be an integer number')
    return success(service.update_numbers(request.user, values))


@api_view(['GET', 'PUT'])
@permission_classes([roles('super_admin', 'admin', 'teacher')])
def program_policy_view(request):
    if request.method == 'GET': return success(dict(accessPolicy=service.get_json('examProgramAccessPolicy', 'SELF_SELECT')))
    require_role(request, 'super_admin')
    values = payload(request, {'accessPolicy'})
    if values.get('accessPolicy') not in ('SELF_SELECT', 'STAFF_ASSIGNED'):
        invalid('accessPolicy must be one of the following values: SELF_SELECT, STAFF_ASSIGNED')
    return success(service.update_policy(request.user, values['accessPolicy']))


@api_view(['GET', 'PUT', 'DELETE'])
@permission_classes([roles('super_admin', 'admin', 'teacher')])
def ielts_bands_view(request):
    if request.method == 'GET': return success({**service.band_tables(), 'customized': service.customized()})
    require_role(request, 'super_admin')
    values = None if request.method == 'DELETE' else payload(request, service.BAND_KEYS)
    if values is not None:
        for key in service.BAND_KEYS:
            if key in values and values[key] is not None and not isinstance(values[key], list): invalid(f'{key} must be an array')
    try: result = service.update_bands(request.user, values)
    except (ValueError, TypeError) as error: invalid(str(error))
    return success(result)


@api_view(['GET'])
@permission_classes([roles('super_admin')])
def audit_logs_view(request):
    data = pagination(request, ('entity', 'userId', 'action'))
    rows = AuditLog.objects.all()
    for key, field in [('entity', 'entity'), ('userId', 'user_id'), ('action', 'action__contains')]:
        if data.get(key): rows = rows.filter(**{field: data[key]})
    total = rows.count()
    start = (data['page'] - 1) * data['limit']
    items = [dict(id=row.id, userId=row.user_id, action=row.action, entity=row.entity,
        entityId=row.entity_id, oldValue=row.old_value, newValue=row.new_value,
        createdAt=row.created_at) for row in rows.order_by('-created_at')[start:start+data['limit']]]
    return paginated(items, data['page'], data['limit'], total)
