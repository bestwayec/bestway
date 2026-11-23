"""Exam Builder 2.0 completion: lifecycle, question bank, template export (staff only)."""
from rest_framework.decorators import api_view, permission_classes

from common.api.exceptions import ContractAPIException
from common.auth.permissions import Authenticated

from . import mock_lifecycle, question_bank
from .views import body, require_role, success


def _staff(request):
    require_role(request, 'teacher', 'admin', 'super_admin')


@api_view(['POST'])
@permission_classes([Authenticated])
def exam_validate_view(request, exam_id):
    _staff(request)
    return success(mock_lifecycle.validate_exam(request.user, exam_id))


@api_view(['POST'])
@permission_classes([Authenticated])
def exam_archive_view(request, exam_id):
    _staff(request)
    return success(mock_lifecycle.archive_exam(request.user, exam_id))


@api_view(['POST'])
@permission_classes([Authenticated])
def exam_restore_view(request, exam_id):
    _staff(request)
    return success(mock_lifecycle.restore_exam(request.user, exam_id))


@api_view(['GET'])
@permission_classes([Authenticated])
def bank_groups_view(request):
    _staff(request)
    return success(question_bank.search_groups(request.user, request.query_params))


@api_view(['POST'])
@permission_classes([Authenticated])
def bank_insert_view(request, exam_id):
    _staff(request)
    data = body(request, {'groupIds'})
    return success(question_bank.insert_groups(request.user, exam_id, data.get('groupIds')), status=201)


@api_view(['GET'])
@permission_classes([Authenticated])
def exam_template_view(request, exam_id):
    """Reusable package without answer keys (same schema 1.0 as export)."""
    _staff(request)
    from .mock_export import export_package
    group_id = request.query_params.get('groupId') or None
    if group_id is not None and len(group_id) > 64:
        raise ContractAPIException('VALIDATION_ERROR', 'groupId is invalid', 400)
    return success(export_package(request.user, exam_id, request.query_params.get('skill') or None, template=True, group_id=group_id))
