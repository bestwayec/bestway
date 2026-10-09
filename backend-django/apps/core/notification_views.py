from rest_framework.decorators import api_view,permission_classes
from common.auth.permissions import Authenticated,roles
from apps.legacy_schema.models import Notification,NotificationType,Role
from . import notifications as service
from .domain_contracts import payload,invalid,pagination,paginated
from .mock_attempt_views import success


@api_view(['GET'])
@permission_classes([Authenticated])
def notifications_view(request):
    query=pagination(request,('unreadOnly','type'))
    if 'type' in query and query['type'] not in NotificationType.values:invalid('type must be one of the following values: '+', '.join(NotificationType.values))
    items,total=service.list_notifications(request.user,query)
    return paginated(items,query['page'],query['limit'],total)


@api_view(['POST'])
@permission_classes([roles('admin','super_admin')])
def broadcast_view(request):
    data=payload(request,{'audience','role','groupId','includeParents','text'})
    if data.get('audience') not in ('all','role','group','debtors'):invalid('audience must be one of the following values: all, role, group, debtors')
    if data.get('role') is not None and data['role'] not in Role.values:invalid('role must be one of the following values: '+', '.join(Role.values))
    if data.get('groupId') is not None and not isinstance(data['groupId'],str):invalid('groupId must be a string')
    if data.get('includeParents') is not None and type(data['includeParents']) is not bool:invalid('includeParents must be a boolean value')
    text=data.get('text')
    if not isinstance(text,str) or len(text)>2000:invalid('text must be shorter than or equal to 2000 characters')
    if len(text)<3:invalid('text must be longer than or equal to 3 characters')
    return success(service.broadcast(request.user,data))


@api_view(['PATCH'])
@permission_classes([Authenticated])
def read_all_view(request):
    return success(dict(updated=Notification.objects.filter(user_id=request.user.id,read=False).update(read=True)))


@api_view(['PATCH'])
@permission_classes([Authenticated])
def read_view(request,notification_id):
    return success(service.mark_read(request.user,notification_id))
