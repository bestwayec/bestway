import math
from rest_framework.decorators import api_view, permission_classes
from common.auth.permissions import roles
from . import payments as service
from .domain_contracts import payload, invalid
from .mock_attempt_views import success


def number(data,key,minimum,maximum=None,optional=True):
    if optional and data.get(key) is None: return
    value=data.get(key)
    try:
        n=0.0 if value is None or value=='' else float(value)
        if isinstance(value,list): n=float(value[0]) if len(value)==1 else (0.0 if not value else float('nan'))
    except (TypeError,ValueError): n=float('nan')
    if maximum is not None and (not math.isfinite(n) or n>maximum):invalid(f'{key} must not be greater than {maximum}')
    if not math.isfinite(n) or n<minimum:invalid(f'{key} must not be less than {minimum}')
    if not n.is_integer():invalid(f'{key} must be an integer number')
    data[key]=int(n)


def whitelist(data,allowed):
    for key in data:
        if key not in allowed:invalid(f'property {key} should not exist')
    return data


def period(data):
    number(data,'year',2000,2100);number(data,'month',1,12)
    return data


@api_view(['GET'])
@permission_classes([roles('admin','super_admin','parent','student','teacher')])
def list_view(request):
    data=whitelist(dict(request.query_params.items()),{'studentId','year','month','state'})
    if data.get('state') is not None and data['state'] not in ('paid','unpaid','partial'):invalid('state must be one of the following values: paid, unpaid, partial')
    return success(service.list_payments(request.user,period(data)))


@api_view(['GET'])
@permission_classes([roles('admin','super_admin','teacher')])
def debtors_view(request):
    return success(service.debtors(request.user,period(whitelist(dict(request.query_params.items()),{'year','month'}))))


@api_view(['PUT'])
@permission_classes([roles('admin','super_admin','teacher')])
def bulk_view(request):
    data=payload(request,{'year','records'});number(data,'year',2000,2100,False)
    rows=data.get('records')
    if not isinstance(rows,list) or not rows:invalid('records should not be empty')
    for r in rows:
        if not isinstance(r,dict):invalid('each value in nested property records must be either object or array')
        whitelist(r,{'studentId','month','state','amount','note'})
        if r.get('studentId') in (None,''):invalid('studentId should not be empty')
        if not isinstance(r['studentId'],str):invalid('studentId must be a string')
        number(r,'month',1,12,False)
        if r.get('state') not in ('paid','unpaid','partial','empty'):invalid('state must be one of the following values: paid, unpaid, partial, empty')
        number(r,'amount',0)
        if r.get('note') is not None:
            if not isinstance(r['note'],str) or len(r['note'])>500:invalid('note must be shorter than or equal to 500 characters')
    return success(service.bulk(request.user,data))


@api_view(['POST'])
@permission_classes([roles('admin','super_admin','teacher')])
def remind_view(request):
    data=payload(request,{'year','month','studentIds'})
    period(data)
    if data.get('studentIds') is not None:
        values=data['studentIds'] if isinstance(data['studentIds'],list) else [data['studentIds']]
        if any(not isinstance(v,str) for v in values):invalid('each value in studentIds must be a string')
        if not isinstance(data['studentIds'],list):invalid('studentIds must be an array')
    return success(service.remind(request.user,data),201)
