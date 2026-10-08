"""Contained local media storage and reference-compatible authenticated streams."""
import os
from pathlib import Path
import re
from uuid import uuid4

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.http import HttpResponse, StreamingHttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.decorators import api_view, permission_classes, authentication_classes
from common.auth.authentication import OptionalMockJWTAuthentication
from rest_framework.permissions import AllowAny

from apps.legacy_schema.models import MockQuestionGroup, MockStagedMedia, MockAnswer, MockAttempt
from common.auth.permissions import Authenticated
from common.api.exceptions import ContractAPIException
from .mock_authoring import _group_or_throw, locked_exam, assert_author, assert_mutable, bump, audit_event
from .views import require_role, success
from .multilevel import SPECS

AUDIO_EXTENSIONS = ('.mp3', '.m4a', '.wav', '.ogg', '.aac', '.webm', '.mp4')
IMAGE_EXTENSIONS = ('.jpg', '.jpeg', '.png', '.webp', '.gif')


def media_url(group_id, kind):
    return f'{os.environ.get("PUBLIC_URL", "http://localhost:3001")}/v1/mock/groups/{group_id}/{kind}'


def resolve_key(key):
    root = Path(settings.MEDIA_ROOT).resolve()
    key = key.replace('\\', '/')
    target = (root / key).resolve()
    if not key or target == root or not target.is_relative_to(root) or re.match(r'^[A-Za-z]:', key):
        raise ContractAPIException('INVALID_FILE_KEY', "Fayl manzili noto'g'ri", 400)
    return target


def delete_created(key):
    """Only for fresh random files produced by this request before DB commit."""
    resolve_key(key).unlink(missing_ok=True)


def delete_unreferenced(key):
    if not key:
        return
    if MockQuestionGroup.objects.filter(Q(audio_key=key) | Q(image_key=key)).exists():
        return
    if MockAnswer.objects.filter(audio_key=key).exists():
        return
    if MockStagedMedia.objects.filter(storage_key=key).exists():
        return
    delete_created(key)


def validate_multipart(request, *, staged=False):
    allowed = ('file',) if staged else ('audio', 'image')
    files = request.FILES
    if sum(len(files.getlist(k)) for k in files) > (1 if staged else 2):
        raise ContractAPIException('UPLOAD_ERROR', 'Too many files', 400)
    if any(k not in allowed or len(files.getlist(k)) > 1 for k in files):
        raise ContractAPIException('UPLOAD_ERROR', 'Unexpected field', 400)
    fields = [(k, value) for k in request.data if k not in files for value in request.data.getlist(k)] if hasattr(request.data, 'getlist') else []
    if len(fields) > (10 if staged else 20):
        raise ContractAPIException('UPLOAD_ERROR', 'Too many fields', 400)
    if any(len(str(v).encode()) > 1024 * 1024 for _k, v in fields):
        raise ContractAPIException('UPLOAD_ERROR', 'Field value too long', 400)
    if any(k.count('[') > (3 if staged else 5) for k, _v in fields):
        raise ContractAPIException('UPLOAD_ERROR', 'Field name too long', 400)
    for name in files:
        validate_upload(files[name], name, staged=staged)


def validate_upload(upload, field='file', *, staged=False):
    extension = Path(upload.name).suffix.lower()
    mime = upload.content_type or ''
    audio = mime.startswith('audio/') and extension in AUDIO_EXTENSIONS
    image = mime.startswith('image/') and extension in IMAGE_EXTENSIONS
    if staged and not (audio or image):
        raise ContractAPIException('INVALID_FILE_TYPE', 'Audio yoki rasm yuklang', 400)
    if not staged and field == 'audio' and not audio:
        raise ContractAPIException('INVALID_FILE_TYPE', 'Audio fayl yuklang (mp3, m4a...)', 400)
    if not staged and field == 'image' and not image:
        raise ContractAPIException('INVALID_FILE_TYPE', 'Rasm fayli yuklang', 400)
    limit = (100 if staged else int(os.environ.get('MAX_UPLOAD_MB', '500'))) * 1024 * 1024
    if upload.size > limit:
        raise ContractAPIException('FILE_TOO_LARGE', 'Fayl hajmi ruxsat etilganidan katta', 400)


def store_upload(upload, field='file', *, staged=False):
    validate_upload(upload, field, staged=staged)
    key = f'mock/{uuid4()}{Path(upload.name).suffix.lower()}'
    path = resolve_key(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open('xb') as stream:
            for chunk in upload.chunks():
                stream.write(chunk)
    except Exception:
        path.unlink(missing_ok=True)
        raise
    return key


def set_group_media(actor, group_id, files):
    group = _group_or_throw(group_id)
    saved = []
    try:
        with transaction.atomic():
            exam = locked_exam(group.section.exam_id)
            assert_author(actor, exam)
            assert_mutable(exam)
            group = MockQuestionGroup.objects.select_for_update().get(id=group_id)
            if not files.get('audio') and not files.get('image'):
                raise ContractAPIException('NO_FILE', 'Fayl yuklanmadi (audio yoki image)', 400)
            old = []
            changed = []
            for kind in ('audio', 'image'):
                upload = files.get(kind)
                if upload is None:
                    continue
                field = f'{kind}_key'
                old.append(getattr(group, field))
                key = store_upload(upload, kind)
                saved.append(key)
                setattr(group, field, key)
                changed.append(field)
            group.save(update_fields=changed)
            bump(exam)
            for key in old:
                transaction.on_commit(lambda key=key: delete_unreferenced(key), robust=True)
    except Exception:
        for key in saved:
            delete_created(key)
        raise
    audit_event(actor, 'mock.group.media', 'mockQuestionGroup', group.id)
    return dict(id=group.id, hasAudio=bool(group.audio_key),
        audioUrl=media_url(group.id, 'audio') if group.audio_key else None,
        imageUrl=media_url(group.id, 'image') if group.image_key else None, version=exam.content_version)


def record_audio_access(actor, attempt_id, group_id):
    """Media endpoint's existing attempt playback gate, not new Stage B routes."""
    with transaction.atomic():
        attempt = MockAttempt.objects.select_for_update().filter(id=attempt_id).first()
        if attempt is None or attempt.student_id != actor.id:
            raise ContractAPIException('MOCK_ATTEMPT_NOT_FOUND', 'Attempt not found', 404)
        if attempt.mode != 'timed':
            return
        group = MockQuestionGroup.objects.select_related('section').filter(id=group_id).first()
        if group is None or group.section.skill != 'listening' or not group.audio_key:
            return
        if group.section.exam_id != attempt.exam_id:
            raise ContractAPIException('QUESTION_NOT_IN_EXAM', 'Audio outside attempt', 403)
        if attempt.status != 'in_progress':
            raise ContractAPIException('MOCK_ATTEMPT_FINISHED', 'Bu urinish allaqachon yakunlangan', 400)
        now = timezone.now()
        deadline = attempt.overall_deadline_at or attempt.deadline_at
        from .mock_attempts import aware
        if deadline and now > aware(deadline):
            raise ContractAPIException('MOCK_TIME_UP', 'Vaqt tugadi — imtihonni yakunlang', 400)
        section_deadline = (attempt.section_deadlines or {}).get(attempt.current_skill)
        if section_deadline and now > parse_datetime(section_deadline):
            raise ContractAPIException('MOCK_SECTION_TIME_UP', 'Bo‘lim vaqti tugadi — keyingi bo‘limga o‘ting', 400)
        if attempt.flow_mode == 'full_test' and attempt.current_skill != 'listening':
            raise ContractAPIException('SECTION_LOCKED', 'Listening section is locked', 403)
        if attempt.specification_version in SPECS:
            phase = (attempt.media_state or {}).get(group_id) or {}
            if not phase.get('plays') or now > parse_datetime(phase['expiresAt']):
                raise ContractAPIException('AUDIO_REPLAY_BLOCKED', 'Start the scheduled playback first', 403)
            return
        plays = attempt.audio_plays or {}
        count = plays.get(group_id, 0) + 1
        if count > group.audio_play_limit:
            raise ContractAPIException('AUDIO_REPLAY_BLOCKED', 'Audio bir marta eshitiladi (exam rejimi)', 403)
        attempt.audio_plays = dict(plays, **{group_id: count})
        attempt.save(update_fields=['audio_plays'])


def stream_media(request, group_id, kind):
    from .mock_catalog import is_staff, access_for
    actor = request.user if request.user.is_authenticated else None
    attempt_id = request.query_params.get('attemptId')
    if kind == 'audio' and actor and actor.role == 'student':
        # Approved Stage B security difference: omitted IDs no longer bypass
        # timed playback gates. Bind unchanged practice-client requests to the
        # one active student/exam attempt, never to a completed or foreign one.
        with transaction.atomic():
            bound_group = _group_or_throw(group_id)
            rows = MockAttempt.objects.select_for_update().filter(student_id=actor.id,
                exam_id=bound_group.section.exam_id, status='in_progress')
            attempt = rows.filter(id=attempt_id).first() if attempt_id else rows.order_by('-started_at').first()
            if attempt is None:
                raise ContractAPIException('MOCK_ATTEMPT_NOT_FOUND', 'Active attempt required for student audio', 404)
            attempt_id = attempt.id
            record_audio_access(actor, attempt_id, group_id)
    elif kind == 'audio' and attempt_id and actor:
        record_audio_access(actor, attempt_id, group_id)
    group = _group_or_throw(group_id)
    exam = group.section.exam
    if not is_staff(actor) and not exam.is_published and not exam.is_demo:
        raise ContractAPIException('MOCK_EXAM_NOT_FOUND', 'Mock imtihon topilmadi', 404)
    if kind == 'audio' and exam.type == 'multilevel' and actor and actor.role == 'student':
        timed = MockAttempt.objects.filter(student_id=actor.id, exam_id=exam.id, mode='timed', status='in_progress').first()
        if timed and attempt_id != timed.id:
            raise ContractAPIException('AUDIO_REPLAY_BLOCKED', 'Timed playback requires its active attempt', 403)
    key = getattr(group, f'{kind}_key')
    if not key or not resolve_key(key).is_file():
        raise ContractAPIException('FILE_NOT_FOUND', 'Fayl topilmadi', 404)
    if actor is None and (exam.type == 'multilevel' or not exam.is_demo):
        raise ContractAPIException('UNAUTHORIZED', 'Avval tizimga kiring', 401)
    if actor and not is_staff(actor):
        access = access_for(actor, exam)
        if access == 'pending':
            raise ContractAPIException('MOCK_PURCHASE_PENDING', 'Xaridingiz tasdiqlanishini kuting', 402)
        if access != 'granted':
            raise ContractAPIException('MOCK_PAYMENT_REQUIRED', "Bu imtihon uchun to'lov talab qilinadi", 402)
    path = resolve_key(key)
    size = path.stat().st_size
    content_type = {'.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.aac': 'audio/aac'}.get(path.suffix.lower(), 'audio/mpeg') if kind == 'audio' else 'image/*'
    start, end, status = 0, size - 1, 200
    if request.headers.get('Range'):
        match = re.search(r'bytes=([0-9]*)-([0-9]*)', request.headers['Range'])
        start = int(match[1]) if match and match[1] else 0
        end = int(match[2]) if match and match[2] else size - 1
        if start >= size or end >= size or start > end:
            result = HttpResponse(status=416)
            result['Content-Range'] = f'bytes */{size}'
            return result
        status = 206
    def chunks():
        with path.open('rb') as stream:
            stream.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                chunk = stream.read(min(64 * 1024, remaining))
                if not chunk:
                    break
                yield chunk
                remaining -= len(chunk)
    response = StreamingHttpResponse(chunks(), status=status, content_type=content_type)
    response['Content-Length'], response['Accept-Ranges'] = str(end - start + 1), 'bytes'
    if status == 206:
        response['Content-Range'] = f'bytes {start}-{end}/{size}'
    return response


@api_view(['POST'])
@permission_classes([Authenticated])
def group_media_view(request, group_id):
    require_role(request, 'teacher', 'admin', 'super_admin')
    validate_multipart(request)
    return success(set_group_media(request.user, group_id, request.FILES), status=201)


@api_view(['GET'])
@permission_classes([AllowAny])
@authentication_classes([OptionalMockJWTAuthentication])
def group_audio_view(request, group_id):
    return stream_media(request, group_id, 'audio')


@api_view(['GET'])
@permission_classes([AllowAny])
@authentication_classes([OptionalMockJWTAuthentication])
def group_image_view(request, group_id):
    return stream_media(request, group_id, 'image')
