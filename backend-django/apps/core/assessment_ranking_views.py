from rest_framework.decorators import api_view, permission_classes

from common.auth.permissions import roles

from . import assessment_rankings
from .domain_contracts import invalid
from .mock_attempt_views import success


@api_view(['GET'])
@permission_classes([roles('teacher', 'admin', 'super_admin')])
def rankings(request, group_id):
    if set(request.query_params) - {'examId', 'skill'}:
        invalid('Unknown ranking query parameter')
    skill = request.query_params.get('skill', 'writing')
    if skill not in ('writing', 'speaking'):
        invalid('skill must be writing or speaking')
    exam_id = request.query_params.get('examId')
    if exam_id is not None and (not exam_id.strip() or len(exam_id) > 255):
        invalid('examId must be a nonempty identifier')
    cache_key = f"group_rankings_{group_id}_{exam_id or 'all'}_{skill}"
    try:
        from django.core.cache import cache
        cached = cache.get(cache_key)
        if cached is not None:
            return success(cached)
    except Exception:
        cached = None
    data = assessment_rankings.rankings(request.user, group_id, exam_id, skill)
    try:
        from django.core.cache import cache
        cache.set(cache_key, data, timeout=60)
    except Exception:
        pass
    return success(data)
