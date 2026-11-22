"""HTTP surface for gated Listening audio and content rights (staff only)."""
from rest_framework.decorators import api_view, permission_classes

from apps.core.mock_authoring import assert_author
from apps.core.views import body, require_role, success
from apps.legacy_schema.models import MockExam
from common.api.exceptions import ContractAPIException
from common.auth.permissions import Authenticated

from . import audio_upload, gates

STAFF = ('teacher', 'admin', 'super_admin')


def _exam(exam_id):
    exam = MockExam.objects.filter(id=exam_id).first()
    if exam is None:
        raise ContractAPIException('MOCK_EXAM_NOT_FOUND', 'Mock imtihon topilmadi', 404)
    return exam


@api_view(['GET'])
@permission_classes([Authenticated])
def exam_gate_view(request, exam_id):
    require_role(request, *STAFF)
    exam = _exam(exam_id)
    assert_author(request.user, exam)
    return success(gates.gate_payload(exam))


@api_view(['POST'])
@permission_classes([Authenticated])
def listening_audio_view(request, group_id):
    require_role(request, *STAFF)
    files = request.FILES
    if set(files) != {'audio'} or len(files.getlist('audio')) != 1:
        raise ContractAPIException('NO_FILE', 'Upload exactly one MP3 or M4A file in the "audio" field', 400)
    if hasattr(request.data, 'keys') and set(request.data.keys()) - {'audio'}:
        raise ContractAPIException('UPLOAD_ERROR', 'Unexpected field', 400)
    return success(audio_upload.upload_part_audio(request.user, group_id, files['audio']), status=201)


@api_view(['POST'])
@permission_classes([Authenticated])
def listening_audio_verify_view(request, group_id):
    require_role(request, 'admin', 'super_admin')
    data = body(request, {'attestation', 'listenedFully', 'heardQuestions', 'note'})
    return success(audio_upload.verify_part_audio(request.user, group_id, data))


@api_view(['POST'])
@permission_classes([Authenticated])
def content_rights_view(request, exam_id):
    require_role(request, 'admin', 'super_admin')
    data = body(request, {'status', 'evidence', 'attestation'})
    return success(audio_upload.set_content_rights(request.user, exam_id, data))
