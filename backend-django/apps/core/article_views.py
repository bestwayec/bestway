from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from common.auth.authentication import OptionalMockJWTAuthentication
from . import articles as service
from .domain_contracts import payload, invalid, pagination, paginated
from .mock_attempt_views import success
from .views import require_authenticated, require_role


def validate(data, creating=False):
    for key,minimum,maximum in [('title',3,300),('body',10,None),('category',2,50)]:
        if not creating and (key not in data or data[key] is None): continue
        value=data.get(key)
        if maximum is not None and (not isinstance(value,str) or len(value)>maximum): invalid(f'{key} must be shorter than or equal to {maximum} characters')
        if not isinstance(value,str) or len(value)<minimum: invalid(f'{key} must be longer than or equal to {minimum} characters')
    if data.get('tags') is not None:
        values=data['tags'] if isinstance(data['tags'],list) else [data['tags']]
        if any(not isinstance(v,str) for v in values): invalid('each value in tags must be a string')
        if not isinstance(data['tags'],list): invalid('tags must be an array')
    return data


@api_view(['GET','POST'])
@authentication_classes([OptionalMockJWTAuthentication])
@permission_classes([AllowAny])
def articles_view(request):
    if request.method=='GET':
        query=pagination(request,('category','tag'));items,total=service.list_articles(query)
        return paginated(items,query['page'],query['limit'],total)
    require_authenticated(request);require_role(request,'admin','super_admin')
    return success(service.create(request.user,validate(payload(request,{'title','body','category','tags'}),True)),201)


@api_view(['GET','PATCH','DELETE'])
@authentication_classes([OptionalMockJWTAuthentication])
@permission_classes([AllowAny])
def article_view(request,article_id):
    if request.method=='GET':return success(service.serialize(service.get(article_id),True))
    require_authenticated(request);require_role(request,'admin','super_admin')
    if request.method=='DELETE':return success(service.delete(request.user,article_id))
    return success(service.update(request.user,article_id,validate(payload(request,{'title','body','category','tags'}))))
