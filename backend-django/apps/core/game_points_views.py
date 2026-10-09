import math
from django.http import HttpResponse
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from common.auth.authentication import OptionalMockJWTAuthentication
from common.auth.permissions import Authenticated, roles
from . import game, points
from .domain_contracts import invalid, payload
from .mock_attempt_views import success


def js_number(value):
    if value is None or isinstance(value, (list, dict)): return float('nan')
    if isinstance(value, str):
        value = value.strip()
        if not value: return 0.0
        if value.lower().startswith(('0x', '0b', '0o')):
            try: return float(int(value, 0))
            except ValueError: return float('nan')
    try: return float(value)
    except (TypeError, ValueError): return float('nan')


def query(request, allowed):
    data = {key:values[0] if len(values)==1 else values for key,values in request.query_params.lists()}
    for key in data:
        if key not in allowed: invalid(f'property {key} should not exist')
    return data


def bounded(data, key, low, high):
    if key not in data or data[key] is None: return
    value = js_number(data[key])
    if not math.isfinite(value) or value > high: invalid(f'{key} must not be greater than {high}')
    if value < low: invalid(f'{key} must not be less than {low}')
    if not value.is_integer(): invalid(f'{key} must be an integer number')
    data[key] = int(value)


def roster_query(request):
    data = query(request, {'year','month'})
    bounded(data, 'year', 2000, 2100); bounded(data, 'month', 1, 12)
    return data


@api_view(['GET'])
@permission_classes([roles('admin', 'super_admin')])
def roster_view(request):
    return success(game.roster(**roster_query(request)))


@api_view(['GET'])
@permission_classes([roles('admin', 'super_admin')])
def export_view(request):
    data = roster_query(request)
    suffix = f"{data['year']}-{data.get('month', '')}" if data.get('year') else 'joriy-oy'
    response = HttpResponse(game.roster_csv(**data), content_type='text/csv; charset=utf-8')
    response['Content-Disposition'] = f'attachment; filename="oyin-royxati-{suffix}.csv"'
    return response


@api_view(['GET'])
@permission_classes([roles('student')])
def status_view(request):
    # Reference has no DTO here: arbitrary query parameters are ignored.
    return success(game.status(request.user.id))


@api_view(['GET'])
@authentication_classes([OptionalMockJWTAuthentication])
@permission_classes([AllowAny])
def leaderboard_view(request):
    data = query(request, {'groupId','limit'})
    if 'groupId' in data and not isinstance(data['groupId'], str): invalid('groupId must be a string')
    bounded(data, 'limit', 1, 100)
    return success(points.leaderboard(data))


@api_view(['GET'])
@permission_classes([Authenticated])
def history_view(request, student_id):
    return success(points.history(request.user, student_id))


@api_view(['POST'])
@permission_classes([roles('teacher', 'admin', 'super_admin')])
def adjust_view(request, student_id):
    data = payload(request, {'change','reason'})
    change = js_number(data.get('change'))
    if change == 0: invalid("O'zgarish 0 bo'lishi mumkin emas")
    if not math.isfinite(change) or not change.is_integer(): invalid('change must be an integer number')
    reason = data.get('reason')
    if not isinstance(reason, str) or len(reason) > 300: invalid('reason must be shorter than or equal to 300 characters')
    if len(reason) < 3: invalid("Sabab kamida 3 belgidan iborat bo'lsin")
    return success(points.adjust(request.user, student_id, dict(change=int(change), reason=reason)), 201)
