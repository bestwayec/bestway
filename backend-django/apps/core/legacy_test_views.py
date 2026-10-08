"""Exact legacy DTO/HTTP boundary; no test-authoring or teacher grading routes."""
from django.http import HttpResponse
from django.core.cache import cache
from rest_framework.decorators import api_view, permission_classes, authentication_classes, renderer_classes
from rest_framework.renderers import JSONRenderer
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from common.auth.authentication import OptionalMockJWTAuthentication
from apps.legacy_schema.models import Question, TestAttempt
from . import legacy_tests as service
from .views import body, require_authenticated, require_role
from .mock_attempt_views import success, wire
from .mock_media import resolve_key
from .mock_attempt_audio import stream_audio
from threading import Lock

_THROTTLE_LOCK=Lock()


class CertificateJSONRenderer(JSONRenderer):
    # Match Nest's JSON error content type without changing other API routes.
    charset='utf-8'


def student(request):
    require_authenticated(request); require_role(request,'student')


def query(request,attempts=False):
    data=dict(request.query_params.items()); allowed={'page','limit','program'}|({'status','studentId','testId'} if attempts else {'type'})
    extra=next((k for k in data if k not in allowed),None)
    if extra: service.fail('VALIDATION_ERROR',f'property {extra} should not exist')
    for key,default in [('page',1),('limit',20)]:
        try:
            value=float(data.get(key,default) or 0)
            if not value.is_integer(): raise ValueError
            value=int(value)
        except (ValueError,OverflowError): service.fail('VALIDATION_ERROR',f'{key} must be an integer number')
        if key=='limit' and value>100: service.fail('VALIDATION_ERROR','limit must not be greater than 100')
        if value<1: service.fail('VALIDATION_ERROR',f'{key} must not be less than 1')
        data[key]=value
    for key,values in [('program',('IELTS','MULTILEVEL')),('type',('ielts','multilevel')),('status',('in_progress','grading','completed'))]:
        if key in data and data[key] not in values:
            message=f'{key} must be one of the following values: '+', '.join(values)
            service.fail('VALIDATION_ERROR',message)
    return data


def page(result):
    items,meta=result
    return Response(dict(success=True,data=wire(items),meta=meta))


@api_view(['GET'])
@authentication_classes([OptionalMockJWTAuthentication])
@permission_classes([AllowAny])
def list_view(request):
    return page(service.catalogue(request.user if request.user.is_authenticated else None,query(request)))


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def demos_view(request):
    return page(service.catalogue(None,query(request),True))


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def demo_view(request,test_id):
    return success(service.definition(None,test_id,True))


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def demo_submit_view(request,test_id):
    data=body(request,{'answers'})
    if data.get('answers') is not None and not isinstance(data['answers'],dict):
        service.fail('VALIDATION_ERROR','answers must be an object')
    return success(service.demo_score(test_id,data.get('answers') or {}),201)


@api_view(['GET'])
@permission_classes([AllowAny])
def test_view(request,test_id):
    require_authenticated(request)
    return success(service.definition(request.user,test_id))


@api_view(['POST'])
@permission_classes([AllowAny])
def start_view(request,test_id):
    student(request)
    return success(service.start(request.user,test_id),201)


@api_view(['GET'])
@permission_classes([AllowAny])
def mine_view(request):
    student(request)
    return page(service.history(request.user,query(request,True),True))


@api_view(['GET'])
@permission_classes([AllowAny])
def attempts_view(request):
    require_authenticated(request); require_role(request,'teacher','admin','super_admin')
    return page(service.history(request.user,query(request,True)))


@api_view(['GET'])
@permission_classes([AllowAny])
def attempt_view(request,attempt_id):
    require_authenticated(request)
    return success(service.detail(request.user,attempt_id))


def validate_question(data):
    if not data.get('questionId'):
        service.fail('VALIDATION_ERROR','questionId should not be empty')
    if not isinstance(data['questionId'],str):
        service.fail('VALIDATION_ERROR','questionId must be a string')


@api_view(['POST'])
@permission_classes([AllowAny])
def answer_view(request,attempt_id):
    student(request); data=body(request,{'questionId','answer'}); validate_question(data)
    if not isinstance(data.get('answer'),str): service.fail('VALIDATION_ERROR','answer must be a string')
    return success(service.save(request.user,attempt_id,data),201)


@api_view(['POST'])
@permission_classes([AllowAny])
def marks_view(request,attempt_id):
    student(request); data=body(request,{'questionId','highlights','note'}); validate_question(data)
    if data.get('highlights') is not None:
        highlights=data['highlights']
        if not isinstance(highlights,list) or any(not isinstance(h,str) for h in highlights):
            service.fail('VALIDATION_ERROR','each value in highlights must be a string' if isinstance(highlights,list) else 'each value in highlights must be a string')
    if data.get('note') is not None:
        if not isinstance(data['note'],str): service.fail('VALIDATION_ERROR','note must be a string')
        if len(data['note'])>2000: service.fail('VALIDATION_ERROR','note must be shorter than or equal to 2000 characters')
    return success(service.save(request.user,attempt_id,data,True),201)


@api_view(['POST'])
@permission_classes([AllowAny])
def cheat_view(request,attempt_id):
    student(request)
    # Nest's route throttle is per IP/handler, not per attempt or student.
    import time
    key='legacy-test-cheat:'+request.META.get('REMOTE_ADDR','')
    now=time.time()
    with _THROTTLE_LOCK:
        state=cache.get(key,dict(hits=[],blockedUntil=0))
        if state['blockedUntil']>now: service.fail('TOO_MANY_REQUESTS','ThrottlerException: Too Many Requests',429)
        values=[] if state['blockedUntil'] else [t for t in state['hits'] if t>now-60]
        if len(values)>=30:
            cache.set(key,dict(hits=values,blockedUntil=now+60),60)
            service.fail('TOO_MANY_REQUESTS','ThrottlerException: Too Many Requests',429)
        cache.set(key,dict(hits=values+[now],blockedUntil=0),60)
    data=body(request,{'event'}); event=data.get('event')
    if isinstance(event,str) and len(event)>50: service.fail('VALIDATION_ERROR','event must be shorter than or equal to 50 characters')
    if event in ('',None): service.fail('VALIDATION_ERROR','event should not be empty')
    if not isinstance(event,str): service.fail('VALIDATION_ERROR','event must be a string')
    return success(service.cheat(request.user,attempt_id,event),201)


@api_view(['POST'])
@permission_classes([AllowAny])
def submit_view(request,attempt_id):
    student(request)
    return success(service.submit(request.user,attempt_id),201)


@api_view(['GET'])
@authentication_classes([OptionalMockJWTAuthentication])
@permission_classes([AllowAny])
def audio_view(request,question_id):
    q=Question.objects.select_related('test').filter(id=question_id).first()
    if q is None: service.fail('QUESTION_NOT_FOUND','Savol topilmadi',404)
    if not q.audio_url or not resolve_key(q.audio_url).is_file(): service.fail('FILE_NOT_FOUND','Audio topilmadi',404)
    if not q.test.is_demo:
        require_authenticated(request)
        if request.user.role=='student':
            service.assert_program(request.user,q.test)
            rows=TestAttempt.objects.filter(test_id=q.test_id,student_id=request.user.id,status='in_progress').order_by('-started_at')
            explicit=request.query_params.get('attemptId')
            attempt=rows.filter(id=explicit).first() if explicit else rows.first()
            if attempt is None or q.id not in attempt.question_order: service.fail('ATTEMPT_NOT_FOUND','Urinish topilmadi',404)
            service.assert_time(attempt)
        else:
            require_role(request,'teacher','admin','super_admin')
    response=stream_audio(request,resolve_key(q.audio_url))
    if response.status_code==416:
        del response['Content-Type']
    return response


@api_view(['GET'])
@permission_classes([AllowAny])
@renderer_classes([CertificateJSONRenderer])
def certificate_view(request,attempt_id):
    require_authenticated(request)
    from .legacy_test_certificate import generate
    data=service.detail(request.user,attempt_id,True)
    response=HttpResponse(generate(data),content_type='application/pdf')
    response['Content-Disposition']=f'attachment; filename="certificate-{attempt_id}.pdf"'
    return response
