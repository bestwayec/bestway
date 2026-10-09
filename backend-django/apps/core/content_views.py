from rest_framework.decorators import api_view, permission_classes, authentication_classes
from rest_framework.permissions import AllowAny
from common.auth.permissions import Authenticated
from common.auth.authentication import OptionalMockJWTAuthentication
from .views import require_role, require_authenticated
from .mock_attempt_views import success
from . import content_media as service
from .domain_contracts import invalid


def upload(request, teacher):
    expected='photo' if teacher else 'image'
    files=list(request.FILES)
    if any(key!=expected for key in files) or any(len(request.FILES.getlist(key))>1 for key in files):
        raise service.ContractAPIException('BAD_REQUEST','Unexpected field',400)
    if len(request.data)-len(files)>20: raise service.ContractAPIException('BAD_REQUEST','Too many fields',400)
    file=request.FILES.get(expected)
    key=service.save_upload(file,'teachers' if teacher else 'gallery') if file else None
    data={key:value for key,value in request.data.items() if key not in files}
    # Multer writes before DTO validation; retain that failure boundary.
    return service.validate(data,teacher,request.method=='PATCH'),key


@api_view(['GET','POST'])
@authentication_classes([OptionalMockJWTAuthentication])
@permission_classes([AllowAny])
def cards(request, teacher=False):
    if request.method=='GET': return success(service.listing(teacher))
    require_authenticated(request);require_role(request,'admin','super_admin')
    data,key=upload(request,teacher)
    return success(service.mutate(request.user,data,teacher,file_key=key),201)


@api_view(['GET'])
@permission_classes([Authenticated])
def all_cards(request, teacher=False):
    require_role(request,'admin','super_admin')
    return success(service.listing(teacher,True))


@api_view(['PATCH','DELETE'])
@permission_classes([Authenticated])
def card(request, identifier, teacher=False):
    require_role(request,*(['super_admin'] if teacher and request.method=='DELETE' else ['admin','super_admin']))
    if request.method=='DELETE': return success(service.remove(request.user,identifier,teacher))
    data,key=upload(request,teacher)
    return success(service.mutate(request.user,data,teacher,identifier,key))


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def card_image(request, identifier, teacher=False):
    return service.image(identifier,teacher)
