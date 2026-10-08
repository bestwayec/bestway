import re

from rest_framework.decorators import api_view, permission_classes
from common.auth.permissions import Authenticated
from common.api.exceptions import ContractAPIException
from .views import require_role, success
from . import mock_imports
from .mock_import_validate import validate_package


def import_body(request, *, commit=False):
    raw = request.body.decode('utf-8')
    data = request.data
    allowed = ('package', 'mediaBindings', 'validatedChecksum', 'targetExamId') if commit else ('package', 'mediaBindings')
    if not isinstance(data, dict):
        raise ContractAPIException('VALIDATION_ERROR', 'Validatsiya xatosi', 400)
    for key in data:
        if key not in allowed:
            raise ContractAPIException('VALIDATION_ERROR', f'property {key} should not exist', 400)
    if commit:
        if not isinstance(data.get('validatedChecksum'), str) or not re.fullmatch('[0-9a-f]{64}', data['validatedChecksum']):
            raise ContractAPIException('VALIDATION_ERROR', 'validatedChecksum must match /^[0-9a-f]{64}$/ regular expression', 400)
        if data.get('targetExamId') is not None and (not isinstance(data['targetExamId'], str) or not re.fullmatch(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', data['targetExamId'])):
            raise ContractAPIException('VALIDATION_ERROR', 'targetExamId must be a UUID', 400)
    if not isinstance(data.get('package'), dict):
        raise ContractAPIException('VALIDATION_ERROR', 'package must be an object', 400)
    if data.get('mediaBindings') is not None and not isinstance(data['mediaBindings'], dict):
        raise ContractAPIException('VALIDATION_ERROR', 'mediaBindings must be an object', 400)
    return data, raw


@api_view(['POST'])
@permission_classes([Authenticated])
def validate_import_view(request):
    require_role(request, 'teacher', 'admin', 'super_admin')
    data, raw = import_body(request)
    return success(validate_package(data['package'], data.get('mediaBindings'), raw))


@api_view(['POST'])
@permission_classes([Authenticated])
def commit_import_view(request):
    require_role(request, 'teacher', 'admin', 'super_admin')
    data, raw = import_body(request, commit=True)
    result = mock_imports.commit_import(request.user, data['package'], data.get('mediaBindings') or {},
        data['validatedChecksum'], raw, data.get('targetExamId'))
    return success(result, status=200 if result['replay'] else 201)


@api_view(['POST'])
@permission_classes([Authenticated])
def stage_import_media_view(request):
    require_role(request, 'teacher', 'admin', 'super_admin')
    from .mock_media import validate_multipart
    validate_multipart(request, staged=True)
    return success(mock_imports.stage_media(request.user, request.FILES.get('file')), status=201)


@api_view(['GET'])
@permission_classes([Authenticated])
def import_by_package_view(request, package_id, revision):
    require_role(request, 'teacher', 'admin', 'super_admin')
    if not re.fullmatch(r'-?[0-9]+', revision):
        raise ContractAPIException('BAD_REQUEST', 'Validation failed (numeric string is expected)', 400)
    return success(mock_imports.by_package(request.user, package_id, int(revision)))


@api_view(['GET'])
@permission_classes([Authenticated])
def import_by_exam_view(request, exam_id):
    require_role(request, 'teacher', 'admin', 'super_admin')
    return success(mock_imports.by_exam(request.user, exam_id))


@api_view(['POST'])
@permission_classes([Authenticated])
def resolve_import_issue_view(request, issue_id):
    require_role(request, 'teacher', 'admin', 'super_admin')
    return success(mock_imports.resolve_issue(request.user, issue_id))
