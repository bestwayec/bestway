import math
import os
from rest_framework.decorators import api_view,permission_classes,authentication_classes
from rest_framework.permissions import AllowAny
from common.auth.permissions import Authenticated,roles
from common.auth.authentication import OptionalMockJWTAuthentication
from .views import require_authenticated,require_role
from .domain_contracts import payload,pagination,paginated,invalid
from .game_points_views import js_number
from .content_media import save_upload
from .mock_attempt_views import success
from . import videos as service


def validate(data,update=False):
    for key,minimum,maximum in [('title',2,200),('description',0,2000)]:
        if (key not in data or data[key] is None) and (update or key=='description'):continue
        value=data.get(key)
        if not isinstance(value,str) or len(value)>maximum:invalid(f'{key} must be shorter than or equal to {maximum} characters')
        if len(value)<minimum:invalid(f'{key} must be longer than or equal to {minimum} characters')
    if not update or ('price' in data and data['price'] is not None):
        number=js_number(data.get('price'))
        if not number>=0:invalid('price must not be less than 0')
        if not math.isfinite(number) or not number.is_integer():invalid('price must be an integer number')
        data['price']=int(number)
    if 'isFreeForApproved' in data:data['isFreeForApproved']=data['isFreeForApproved'] is True or data['isFreeForApproved']=='true'
    return data


@api_view(['GET','POST'])
@authentication_classes([OptionalMockJWTAuthentication])
@permission_classes([AllowAny])
def videos(request):
    if request.method=='GET':return success(service.listing(request.user if request.user.is_authenticated else None))
    require_authenticated(request);require_role(request,'admin','super_admin')
    if any(k not in ('file','thumbnail') or len(request.FILES.getlist(k))>1 for k in request.FILES):service.fail('BAD_REQUEST','Unexpected field')
    keys={key:save_upload(file,'videos' if key=='file' else 'thumbnails',int(os.environ.get('MAX_UPLOAD_MB','500'))*1024*1024) for key,file in request.FILES.items()}
    data={k:v for k,v in request.data.items() if k not in request.FILES}
    for key in data:
        if key not in {'title','description','price','isFreeForApproved'}:invalid(f'property {key} should not exist')
    return success(service.create(request.user,validate(data),keys,request.FILES.get('file')),201)


@api_view(['PATCH','DELETE'])
@permission_classes([Authenticated])
def video(request,identifier):
    require_role(request,*(['super_admin'] if request.method=='DELETE' else ['admin','super_admin']))
    if request.method=='DELETE':return success(service.remove(request.user,identifier))
    return success(service.update(request.user,identifier,validate(payload(request,{'title','description','price','isFreeForApproved'}),True)))


@api_view(['GET'])
@permission_classes([Authenticated])
def stream_url(request,identifier):return success(service.stream_url(request.user,identifier))


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def stream(request):return service.stream(request.query_params.get('token',''),request.headers.get('Range'))


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def thumbnail(request,identifier):return service.thumbnail(identifier)


@api_view(['POST'])
@permission_classes([roles('student')])
def purchase(request,identifier):return success(service.purchase(request.user,identifier),201)


@api_view(['POST'])
@permission_classes([roles('admin','super_admin')])
def confirm(request,identifier):
    data=payload(request,{'userId'})
    if not data.get('userId'):invalid('userId should not be empty')
    if not isinstance(data['userId'],str):invalid('userId must be a string')
    return success(service.confirm(request.user,identifier,data['userId']),201)


@api_view(['GET'])
@permission_classes([roles('admin','super_admin')])
def purchases(request):
    q=pagination(request,{'status'})
    if q.get('status') and q['status'] not in ('pending_confirmation','purchased'):invalid('status must be one of the following values: pending_confirmation, purchased')
    rows=service.VideoPurchase.objects.select_related('user','video').order_by('-created_at')
    if q.get('status'):rows=rows.filter(status=q['status'])
    total=rows.count();start=(q['page']-1)*q['limit']
    items=[dict(id=r.id,userId=r.user_id,userName=r.user.name,userPhone=r.user.phone,videoId=r.video_id,videoTitle=r.video.title,price=r.video.price,status=r.status,method=r.method,createdAt=r.created_at) for r in rows[start:start+q['limit']]]
    return paginated(items,q['page'],q['limit'],total)
