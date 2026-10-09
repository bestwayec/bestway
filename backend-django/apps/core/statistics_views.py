from django.http import HttpResponse
from rest_framework.decorators import api_view,permission_classes
from common.auth.permissions import roles
from .mock_attempt_views import success
from .game_points_views import query,bounded
from .domain_contracts import invalid
from . import statistics as service


@api_view(['GET'])
@permission_classes([roles('admin','super_admin')])
def dashboard(request): return success(service.dashboard())


@api_view(['GET'])
@permission_classes([roles('admin','super_admin')])
def income(request):
    q=query(request,{'months'});bounded(q,'months',1,24)
    return success(service.income(q.get('months',6)))


@api_view(['GET'])
@permission_classes([roles('admin','super_admin')])
def activity(request):
    q=query(request,{'range'})
    if 'range' in q and q['range'] not in ('today','7d','30d','3m','6m','year'): invalid("range today|7d|30d|3m|6m|year bo'lsin")
    return success(service.exam_activity(q.get('range','7d')))


@api_view(['GET'])
@permission_classes([roles('admin','super_admin')])
def export(request,payments=False):
    q=query(request,{'year','month'} if payments else {'groupId'})
    if payments:
        if 'year' not in q: invalid('year must not be greater than 2100')
        bounded(q,'year',2000,2100);bounded(q,'month',1,12)
        body=service.payments_csv(**q)
        filename=f'tolovlar-{q["year"]}'+(f'-{q["month"]}' if q.get('month') else '')+'.csv'
    else:
        if 'groupId' in q and not isinstance(q['groupId'],str): invalid('groupId must be a string')
        body=service.students_csv(q.get('groupId'));filename='oquvchilar.csv'
    response=HttpResponse(body,content_type='text/csv; charset=utf-8')
    response['Content-Disposition']=f'attachment; filename="{filename}"'
    return response
