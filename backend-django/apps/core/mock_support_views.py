"""The ten scoped mock access/staff/result HTTP contracts."""
import math
from django.http import HttpResponse
from rest_framework.decorators import api_view, permission_classes, renderer_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from . import mock_support as service
from .mock_attempt_views import success, wire
from .legacy_test_views import CertificateJSONRenderer
from .views import body, require_authenticated, require_role
from .mock_scoring import trim


def number(value):
    if isinstance(value,str):
        value=trim(value)
        if not value: return 0.0
        if value.lower().startswith(('0x','0o','0b')): return float(int(value,0))
    return float(value)


def allow(request,*roles):
    require_authenticated(request)
    if roles: require_role(request,*roles)


def query(request,purchases=False):
    data=dict(request.query_params.items())
    allowed={'page','limit','status'} | (set() if purchases else {'studentId','examId','program'})
    for key in data:
        if key not in allowed: service.fail('VALIDATION_ERROR',f'property {key} should not exist')
    for key,default in [('page',1),('limit',20)]:
        try:
            value=number(data.get(key,default))
        except (ValueError,TypeError,OverflowError): value=float('nan')
        if key=='limit' and not value<=100: service.fail('VALIDATION_ERROR','limit must not be greater than 100')
        if not value>=1: service.fail('VALIDATION_ERROR',f'{key} must not be less than 1')
        if not value.is_integer(): service.fail('VALIDATION_ERROR',f'{key} must be an integer number')
        data[key]=int(value)
    for key,values in [('status',('pending_confirmation','purchased') if purchases else ('in_progress','grading','completed')),('program',('IELTS','MULTILEVEL'))]:
        if key in data and data[key] not in values: service.fail('VALIDATION_ERROR',f'{key} must be one of the following values: '+', '.join(values))
    return data


def page(values):
    rows,meta=values
    return Response(dict(success=True,data=wire(rows),meta=meta))


@api_view(['POST'])
@permission_classes([AllowAny])
def purchase_view(request,exam_id):
    allow(request,'student')
    return success(service.purchase(request.user,exam_id),201)


@api_view(['GET'])
@permission_classes([AllowAny])
def purchases_view(request):
    allow(request,'admin','super_admin')
    return page(service.purchases(query(request,True)))


def user_id(request):
    data=body(request,{'userId'}); value=data.get('userId')
    if value is None or value=='': service.fail('VALIDATION_ERROR','userId should not be empty')
    if not isinstance(value,str): service.fail('VALIDATION_ERROR','userId must be a string')
    return value


@api_view(['POST'])
@permission_classes([AllowAny])
def confirm_view(request,exam_id):
    allow(request,'admin','super_admin')
    return success(service.confirm(request.user,exam_id,user_id(request)),201)


@api_view(['POST'])
@permission_classes([AllowAny])
def reject_view(request,exam_id):
    allow(request,'admin','super_admin')
    return success(service.reject(request.user,exam_id,user_id(request)),201)


@api_view(['GET'])
@permission_classes([AllowAny])
def attempts_view(request):
    allow(request,'teacher','admin','super_admin')
    return page(service.history(request.user,query(request)))


@api_view(['POST'])
@permission_classes([AllowAny])
def force_view(request,attempt_id):
    allow(request,'teacher','admin','super_admin')
    from .mock_submissions import submit
    return success(submit(request.user,attempt_id,force=True),201)


@api_view(['POST'])
@permission_classes([AllowAny])
def extend_view(request,attempt_id):
    allow(request,'teacher','admin','super_admin'); data=body(request,{'minutes'})
    try:
        raw=data['minutes']
        if raw is None: raise ValueError
        value=number(raw)
        if not math.isfinite(value): raise ValueError
    except (KeyError,ValueError,TypeError,OverflowError): service.fail('VALIDATION_ERROR','minutes must not be greater than 180')
    if value>180: service.fail('VALIDATION_ERROR','minutes must not be greater than 180')
    if value<1: service.fail('VALIDATION_ERROR','minutes must not be less than 1')
    if not value.is_integer(): service.fail('VALIDATION_ERROR','minutes must be an integer number')
    return success(service.extend(request.user,attempt_id,int(value)),201)


@api_view(['POST'])
@permission_classes([AllowAny])
def reopen_view(request,attempt_id):
    allow(request,'teacher','admin','super_admin')
    return success(service.reopen(request.user,attempt_id),201)


@api_view(['DELETE'])
@permission_classes([AllowAny])
def delete_view(request,attempt_id):
    allow(request,'admin','super_admin')
    return success(service.delete(request.user,attempt_id))


@api_view(['GET'])
@permission_classes([AllowAny])
@renderer_classes([CertificateJSONRenderer])
def certificate_view(request,attempt_id):
    allow(request)
    from .mock_certificate import generate
    response=HttpResponse(generate(service.certificate_data(request.user,attempt_id)),content_type='application/pdf')
    response['Content-Disposition']=f'attachment; filename="mock-{attempt_id}.pdf"'
    return response
