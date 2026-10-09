import math
from rest_framework.decorators import api_view,permission_classes,authentication_classes
from rest_framework.permissions import AllowAny
from common.auth.authentication import OptionalMockJWTAuthentication
from common.auth.permissions import roles
from . import legacy_authoring as service
from .legacy_import_parser import parse
from .legacy_test_views import list_view,test_view
from .views import require_authenticated,require_role
from .mock_attempt_views import success
from .domain_contracts import payload,invalid
from .game_points_views import js_number

TEST_KEYS={'type','title','level','isDemo','durationMinutes','sectionQuestionCounts'}
QUESTION_KEYS={'section','type','prompt','options','correctAnswer','maxScore','passageText','instructions','audioUrl'}


@api_view(['GET','POST'])
@authentication_classes([OptionalMockJWTAuthentication])
@permission_classes([AllowAny])
def tests(request):
    if request.method=='GET':return list_view(request._request)
    require_authenticated(request);require_role(request,'admin','super_admin')
    return success(service.mutate_test(request.user,service.validate(payload(request,TEST_KEYS))),201)


@api_view(['GET','PATCH'])
@permission_classes([AllowAny])
def test(request,test_id):
    if request.method=='GET':return test_view(request._request,test_id)
    require_authenticated(request);require_role(request,'admin','super_admin')
    return success(service.mutate_test(request.user,service.validate(payload(request,TEST_KEYS-{'type'}|{'isActive'}),update=True),test_id))


@api_view(['POST'])
@permission_classes([roles('admin','super_admin')])
def question_create(request,test_id):
    data=service.validate(payload(request,QUESTION_KEYS),question=True)
    return success(service.mutate_question(request.user,data,test_id=test_id),201)


@api_view(['PATCH','DELETE'])
@permission_classes([roles('admin','super_admin')])
def question(request,question_id):
    if request.method=='DELETE':return success(service.remove_question(request.user,question_id))
    data=service.validate(payload(request,QUESTION_KEYS),question=True,update=True)
    return success(service.mutate_question(request.user,data,identifier=question_id))


@api_view(['POST'])
@permission_classes([roles('admin','super_admin')])
def imports(request,test_id=None):
    data=service.validate(payload(request,{'text','defaultSection'}),importing=True)
    return success(service.import_questions(request.user,test_id,data) if test_id else parse(data['text'],data.get('defaultSection')),201)


@api_view(['GET','POST'])
@authentication_classes([OptionalMockJWTAuthentication])
@permission_classes([AllowAny])
def audio(request,question_id):
    if request.method=='GET':
        from .legacy_test_views import audio_view
        return audio_view(request._request,question_id)
    require_authenticated(request);require_role(request,'admin','super_admin')
    if any(k!='audio' for k in request.FILES) or len(request.FILES.getlist('audio'))>1:invalid('Unexpected field')
    return success(service.upload_audio(request.user,question_id,request.FILES.get('audio')),201)


@api_view(['POST'])
@permission_classes([roles('teacher','admin','super_admin')])
def grade(request,attempt_id):
    data=payload(request,{'questionId','score','comment'})
    if not data.get('questionId'):invalid('questionId should not be empty')
    if not isinstance(data['questionId'],str):invalid('questionId must be a string')
    score=js_number(data.get('score'))
    if not score>=0:invalid('score must not be less than 0')
    if not math.isfinite(score):invalid('score must be a number conforming to the specified constraints')
    if data.get('comment') is not None and (not isinstance(data['comment'],str) or len(data['comment'])>1000):invalid('comment must be shorter than or equal to 1000 characters')
    return success(service.grade(request.user,attempt_id,dict(data,score=score)),201)
