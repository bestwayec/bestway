"""Exact Nest attendance DTO boundaries and authenticated routes."""
import re
from django.http import HttpResponse
from rest_framework.decorators import api_view, permission_classes
from common.auth.permissions import Authenticated, roles
from . import attendance as service
from .domain_contracts import payload, invalid
from .mock_attempt_views import success

# validator.js isISO8601, non-strict default used by @IsISO8601().
ISO8601 = re.compile(r'^([\+-]?\d{4}(?!\d{2}\b))((-?)((0[1-9]|1[0-2])(\3([12]\d|0[1-9]|3[01]))?|W([0-4]\d|5[0-3])(-?[1-7])?|(00[1-9]|0[1-9]\d|[12]\d{2}|3([0-5]\d|6[1-6])))([T\s]((([01]\d|2[0-3])((:?)[0-5]\d)?|24:?00)([\.,]\d+(?!:))?)?(\17[0-5]\d([\.,]\d+)?)?([zZ]|([\+-])([01]\d|2[0-3]):?([0-5]\d)?)?)?)?$')
ISO8601 = re.compile(ISO8601.pattern.replace(r'\d', '[0-9]'))


def string(data, key, required=False, not_empty=False):
    if not required and data.get(key) is None: return
    if not_empty and data.get(key) in (None, ''): invalid(f'{key} should not be empty')
    if not isinstance(data.get(key), str): invalid(f'{key} must be a string')


def query(request, kind='list'):
    data = dict(request.query_params.items())
    allowed = {'groupId', 'month', 'studentId'} if kind == 'list' else {'groupId', 'month'}
    for key in data:
        if key not in allowed: invalid(f'property {key} should not exist')
    string(data, 'groupId', required=kind != 'list', not_empty=kind == 'stats')
    if 'month' in data and not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', data['month'], re.ASCII):
        invalid("month formati YYYY-MM bo'lsin")
    if kind == 'list': string(data, 'studentId')
    return data


@api_view(['GET'])
@permission_classes([Authenticated])
def list_view(request):
    return success(service.listing(request.user, query(request)))


@api_view(['GET'])
@permission_classes([roles('teacher', 'admin', 'super_admin')])
def stats_view(request):
    return success(service.stats(request.user, query(request, 'stats')))


@api_view(['PUT'])
@permission_classes([roles('teacher', 'admin', 'super_admin')])
def bulk_view(request):
    data = payload(request, {'groupId', 'date', 'records'})
    string(data, 'groupId', required=True, not_empty=True)
    if not isinstance(data.get('date'), str) or not ISO8601.fullmatch(data['date']):
        invalid('date must be a valid ISO 8601 date string')
    rows = data.get('records')
    if not isinstance(rows, list) or not rows: invalid('records should not be empty')
    for row in rows:
        if not isinstance(row, dict): invalid('each value in nested property records must be either object or array')
        for key in row:
            if key not in ('studentId', 'state'): invalid(f'property {key} should not exist')
        string(row, 'studentId', required=True, not_empty=True)
        if row.get('state') not in ('present', 'absent', 'late', 'empty', 'blank'):
            invalid('state must be one of the following values: present, absent, late, empty, blank')
    return success(service.bulk(request.user, data))


@api_view(['GET'])
@permission_classes([roles('admin', 'super_admin')])
def export_view(request):
    data = query(request, 'export')
    response = HttpResponse(service.export(data), content_type='text/csv; charset=utf-8')
    response['Content-Disposition'] = f'attachment; filename="davomat-{data.get("month", "joriy-oy")}.csv"'
    return response
