"""HTTP boundary for the migrated student attempt mutations."""
from datetime import datetime

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from . import attempt_signature
from . import mock_attempts as engine
from .views import body, require_authenticated, require_role
from .views import success as envelope


def wire(value):
    # Prisma timestamps have no database timezone but represent UTC. Emit the
    # same UTC ISO strings as Nest instead of an ambiguous client-local time.
    if isinstance(value, datetime):
        return engine.iso(value)
    if isinstance(value, dict):
        return {key: wire(item) for key, item in value.items()}
    if isinstance(value, list):
        return [wire(item) for item in value]
    return value


def success(data, status=200):
    return envelope(wire(data), status)


def student(request):
    require_authenticated(request)
    require_role(request, 'student')


def validate_answer(data):
    if not isinstance(data, dict):
        engine.fail('VALIDATION_ERROR', 'nested property answers must be either object or array')
    extra = next((k for k in data if k not in {'questionId', 'response'}), None)
    if extra:
        engine.fail('VALIDATION_ERROR', f'property {extra} should not exist')
    if not isinstance(data.get('questionId'), str) or not data['questionId']:
        engine.fail('VALIDATION_ERROR', 'questionId should not be empty')
    if not isinstance(data.get('response'), str):
        engine.fail('VALIDATION_ERROR', 'response must be a string')
    if len(data['response']) > 10000:
        engine.fail('VALIDATION_ERROR', 'response must be shorter than or equal to 10000 characters')


@api_view(['POST'])
@permission_classes([AllowAny])
def start_view(request, exam_id=None):
    student(request)
    data = body(request, {'mode', 'flow', 'skills', 'skill', 'section', 'section_filter', 'examId', 'exam_id'})
    target_exam_id = exam_id or data.get('examId') or data.get('exam_id') or request.query_params.get('examId') or request.query_params.get('exam_id')
    if not target_exam_id:
        engine.fail('VALIDATION_ERROR', 'examId should not be empty')

    # Support section / section_filter / skill from body or query params
    sec = (
        data.get('skill')
        or data.get('section')
        or data.get('section_filter')
        or request.query_params.get('skill')
        or request.query_params.get('section')
        or request.query_params.get('section_filter')
    )
    if sec:
        if not isinstance(sec, str):
            engine.fail('VALIDATION_ERROR', 'section_filter must be a string')
        sec_str = sec.strip().lower()
        if sec_str not in engine.SKILLS:
            engine.fail('VALIDATION_ERROR', f'section_filter must be one of: {", ".join(engine.SKILLS)}')
        data['skills'] = [sec_str]
        data['flow'] = 'single_skill'

    if not data.get('mode') and request.query_params.get('mode'):
        data['mode'] = request.query_params.get('mode')
    if not data.get('flow') and request.query_params.get('flow'):
        data['flow'] = request.query_params.get('flow')

    if data.get('mode') is not None and data['mode'] not in ('practice', 'timed'):
        engine.fail('VALIDATION_ERROR', 'mode must be one of the following values: practice, timed')
    if data.get('flow') is not None and not isinstance(data['flow'], str):
        engine.fail('VALIDATION_ERROR', 'flow must be a string')
    if 'skills' in data:
        skills = data['skills']
        if (not isinstance(skills, list) or not 1 <= len(skills) <= 4
                or any(skill not in engine.SKILLS for skill in skills)
                or len(set(skills)) != len(skills)):
            engine.fail('VALIDATION_ERROR', 'skills must contain unique skill selections')
        if data.get('flow') == 'full_test':
            engine.fail('VALIDATION_ERROR', 'Selected task practice requires flow other than full_test')
        if not data.get('flow'):
            data['flow'] = 'single_skill' if len(skills) == 1 else 'partial_practice'
    return success(engine.start(request.user, target_exam_id, data), 201)


@api_view(['POST'])
@permission_classes([AllowAny])
def answer_view(request, attempt_id):
    student(request)
    attempt_signature.verify_request(request, attempt_id)
    data = body(request, {'questionId', 'response'})
    validate_answer(data)
    return success(engine.save_answers(request.user, attempt_id, [data]), 201)


@api_view(['POST'])
@permission_classes([AllowAny])
def answers_view(request, attempt_id):
    student(request)
    attempt_signature.verify_request(request, attempt_id)
    data = body(request, {'answers'})
    items = data.get('answers')
    if not isinstance(items, list):
        engine.fail('VALIDATION_ERROR', 'answers must be an array')
    if not 1 <= len(items) <= 200:
        engine.fail('VALIDATION_ERROR', 'answers must contain at least 1 elements' if not items else 'answers must contain no more than 200 elements')
    for item in items:
        validate_answer(item)
    return success(engine.save_answers(request.user, attempt_id, items, bulk=True), 201)


@api_view(['POST'])
@permission_classes([AllowAny])
def submit_view(request, attempt_id):
    from .mock_submissions import submit
    student(request)
    attempt_signature.verify_request(request, attempt_id)
    data = body(request, {'skills', 'skill', 'section', 'section_filter', 'confirm', 'confirmed', 'force', 'reason', 'autoSubmit', 'timeUp', 'timeout', 'answers'})
    skills = data.get('skills')
    sec = (
        data.get('skill')
        or data.get('section')
        or data.get('section_filter')
        or request.query_params.get('skill')
        or request.query_params.get('section')
        or request.query_params.get('section_filter')
    )
    if not skills and sec and isinstance(sec, str):
        sec_str = sec.strip().lower()
        if sec_str in engine.SKILLS:
            skills = [sec_str]
    if skills is not None:
        if not isinstance(skills, list):
            engine.fail('VALIDATION_ERROR', 'skills must be an array')
        if any(skill not in engine.SKILLS for skill in skills):
            engine.fail('VALIDATION_ERROR', 'each value in skills must be one of the following values: listening, reading, writing, speaking')
    force = bool(
        data.get('confirm')
        or data.get('confirmed')
        or data.get('force')
        or data.get('autoSubmit')
        or data.get('timeUp')
        or data.get('timeout')
        or request.query_params.get('force')
    )
    return success(submit(request.user, attempt_id, skills, force=force), 201)


@api_view(['POST'])
@permission_classes([AllowAny])
def switch_section_view(request, attempt_id):
    student(request)
    data = request.data or {}
    skill = data.get('skill') or request.query_params.get('skill')
    if not skill:
        from common.api.exceptions import ContractAPIException
        raise ContractAPIException('TARGET_SKILL_REQUIRED', 'target skill is required', 400)
    return success(engine.switch_section(request.user, attempt_id, skill), 200)


@api_view(['POST'])
@permission_classes([AllowAny])
def advance_view(request, attempt_id):
    student(request)
    return success(engine.advance(request.user, attempt_id), 201)


@api_view(['POST'])
@permission_classes([AllowAny])
def prepare_view(request, attempt_id, group_id):
    student(request)
    return success(engine.media_phase(request.user, attempt_id, group_id, 'listening'), 201)


@api_view(['POST'])
@permission_classes([AllowAny])
def play_view(request, attempt_id, group_id):
    student(request)
    return success(engine.media_phase(request.user, attempt_id, group_id, 'listening', True), 201)


@api_view(['POST'])
@permission_classes([AllowAny])
def speaking_start_view(request, attempt_id, question_id):
    student(request)
    return success(engine.media_phase(request.user, attempt_id, question_id, 'speaking'), 201)


@api_view(['POST'])
@permission_classes([AllowAny])
def cheat_view(request, attempt_id):
    student(request)
    allowed = {
        'event', 'reason', 'type', 'anomaly', 'details', 'timestamp', 'time',
        'description', 'detail', 'meta', 'payload', 'window', 'count',
        'app_version', 'version', 'source', 'platform'
    }
    data = body(request, allowed)
    event = data.get('event') or data.get('anomaly') or data.get('reason') or data.get('type') or data.get('details')
    if not isinstance(event, str):
        engine.fail('VALIDATION_ERROR', 'event must be a string')
    event = event.strip()
    if not event:
        engine.fail('VALIDATION_ERROR', 'event should not be empty')
    if len(event) > 50:
        engine.fail('VALIDATION_ERROR', 'event must be shorter than or equal to 50 characters')
    return success(engine.flag_cheat(request.user, attempt_id, event), 201)


@api_view(['POST'])
@permission_classes([AllowAny])
def telemetry_view(request, attempt_id):
    student(request)
    allowed = {'event', 'timestamp', 'time', 'blurCount', 'blur_count', 'metadata', 'meta', 'details'}
    data = body(request, allowed)
    result = engine.record_telemetry(request.user, attempt_id, data)
    return Response({
        'success': True,
        'antiCheatCount': result['antiCheatCount'],
        'recorded': True,
        'data': result,
    }, status=200)


@api_view(['PUT'])
@permission_classes([AllowAny])
def annotations_view(request, attempt_id):
    student(request)
    data = body(request, {'annotations'})
    if data.get('annotations') is not None and not isinstance(data['annotations'], list):
        engine.fail('VALIDATION_ERROR', 'annotations must be an array')
    return success(engine.annotations(request.user, attempt_id, data.get('annotations')))


@api_view(['GET'])
@permission_classes([AllowAny])
def mine_view(request):
    student(request)
    allowed = {'page', 'limit', 'status', 'examId', 'studentId', 'program'}
    query = dict(request.query_params.items())
    extra = next((k for k in query if k not in allowed), None)
    if extra:
        engine.fail('VALIDATION_ERROR', f'property {extra} should not exist')
    for key, default, maximum in [('page', 1, None), ('limit', 20, 100)]:
        try:
            numeric = float(query.get(key, default))
            value = int(numeric)
            if numeric != value or value < 1 or maximum and value > maximum:
                raise ValueError
        except (ValueError, OverflowError):
            engine.fail('VALIDATION_ERROR', f'{key} must be an integer number')
        query[key] = value
    if query.get('status') is not None and query['status'] not in ('in_progress', 'grading', 'completed'):
        engine.fail('VALIDATION_ERROR', 'status must be one of the following values: in_progress, grading, completed')
    if query.get('program') is not None and query['program'] not in ('IELTS', 'MULTILEVEL'):
        engine.fail('VALIDATION_ERROR', 'program must be one of the following values: IELTS, MULTILEVEL')
    data, meta = engine.my_attempts(request.user, query)
    return Response(dict(success=True, data=wire(data), meta=meta))


@api_view(['GET','DELETE'])
@permission_classes([AllowAny])
def detail_view(request, attempt_id):
    require_authenticated(request)
    if request.method=='DELETE':
        require_role(request,'admin','super_admin')
        from .mock_support import delete
        return success(delete(request.user,attempt_id))
    return success(engine.detail(request.user, attempt_id))


@api_view(['POST'])
@permission_classes([AllowAny])
def speaking_upload_view(request, attempt_id, question_id):
    student(request)
    # Same one-file field contract as FileInterceptor('audio').
    if any(key != 'audio' or len(request.FILES.getlist(key)) != 1 for key in request.FILES):
        engine.fail('UPLOAD_ERROR', 'Unexpected field')
    return success(engine.upload_speaking(request.user, attempt_id, question_id, request.FILES.get('audio')), 201)


@api_view(['GET'])
@permission_classes([AllowAny])
def speaking_audio_view(request, attempt_id, question_id):
    require_authenticated(request)
    from apps.legacy_schema.models import MockAnswer, MockAttempt

    from .mock_attempt_audio import stream_audio
    from .mock_media import resolve_key
    attempt = MockAttempt.objects.filter(id=attempt_id).first()
    if attempt is None:
        engine.fail('MOCK_ATTEMPT_NOT_FOUND', 'Urinish topilmadi', 404)
    engine.assert_view(request.user, attempt.student_id)
    answer = MockAnswer.objects.filter(attempt_id=attempt_id, question_id=question_id).first()
    if answer is None or not answer.audio_key or not resolve_key(answer.audio_key).is_file():
        engine.fail('FILE_NOT_FOUND', 'Audio topilmadi', 404)
    return stream_audio(request, resolve_key(answer.audio_key))


def _extract_uploaded_images(request, max_size=10 * 1024 * 1024):
    import base64
    from pathlib import Path


    allowed_exts = {'.jpg', '.jpeg', '.png', '.webp'}
    allowed_mimes = {'image/jpeg', 'image/jpg', 'image/png', 'image/webp'}
    extracted = []

    files = []
    if hasattr(request, 'FILES') and request.FILES:
        for key in ('images', 'image', 'files', 'file'):
            if key in request.FILES:
                files.extend(request.FILES.getlist(key))
        if not files:
            for key in request.FILES:
                files.extend(request.FILES.getlist(key))

    for upload in files:
        ext = Path(getattr(upload, 'name', '') or 'page.jpg').suffix.lower() or '.jpg'
        mime = (getattr(upload, 'content_type', '') or 'image/jpeg').lower().split(';')[0].strip()
        if ext not in allowed_exts and mime not in allowed_mimes:
            engine.fail('INVALID_FILE_TYPE', 'Rasm formati faqat JPG, PNG yoki WEBP bo‘lishi kerak', 400)
        if getattr(upload, 'size', 0) > max_size:
            engine.fail('FILE_TOO_LARGE', 'Har bir rasm hajmi 10 MB dan oshmasligi kerak', 400)
        upload.seek(0)
        raw_bytes = upload.read()
        if len(raw_bytes) > max_size:
            engine.fail('FILE_TOO_LARGE', 'Har bir rasm hajmi 10 MB dan oshmasligi kerak', 400)
        if not raw_bytes:
            engine.fail('INVALID_FILE', 'Yuklangan rasm bo‘sh', 400)
        if ext not in allowed_exts:
            ext = {
                'image/png': '.png',
                'image/webp': '.webp',
            }.get(mime, '.jpg')
        if mime not in allowed_mimes:
            mime = {
                '.png': 'image/png',
                '.webp': 'image/webp',
            }.get(ext, 'image/jpeg')
        extracted.append((raw_bytes, mime, ext))

    if not extracted and isinstance(getattr(request, 'data', None), dict):
        raw_list = request.data.get('images') or (
            [request.data['image']] if request.data.get('image') else []
        )
        if isinstance(raw_list, list):
            for item in raw_list:
                if not isinstance(item, str) or not item.strip():
                    continue
                mime = 'image/jpeg'
                ext = '.jpg'
                b64_part = item.strip()
                if b64_part.startswith('data:'):
                    header, _, b64_part = b64_part.partition(',')
                    if 'image/png' in header:
                        mime, ext = 'image/png', '.png'
                    elif 'image/webp' in header:
                        mime, ext = 'image/webp', '.webp'
                    elif 'image/jpeg' in header or 'image/jpg' in header:
                        mime, ext = 'image/jpeg', '.jpg'
                    else:
                        engine.fail('INVALID_FILE_TYPE', 'Rasm formati faqat JPG, PNG yoki WEBP bo‘lishi kerak', 400)
                try:
                    raw_bytes = base64.b64decode(b64_part)
                except Exception:
                    engine.fail('INVALID_FILE_TYPE', 'Base64 rasm formati noto‘g‘ri', 400)
                if len(raw_bytes) > max_size:
                    engine.fail('FILE_TOO_LARGE', 'Har bir rasm hajmi 10 MB dan oshmasligi kerak', 400)
                extracted.append((raw_bytes, mime, ext))

    if not extracted:
        engine.fail('NO_FILE', 'Kamida bitta rasm yuklang (JPG, PNG, WEBP)', 400)
    return extracted


@api_view(['POST'])
@permission_classes([AllowAny])
def writing_ocr_view(request, attempt_id, question_id=None):
    from uuid import uuid4

    from django.utils import timezone

    from apps.legacy_schema.models import MockAnswer, MockAttempt, MockQuestion

    from . import writing_ocr
    from .content_media import storage_path

    require_authenticated(request)
    if request.user.role not in ('student', 'teacher', 'admin', 'super_admin'):
        engine.fail('FORBIDDEN', 'Ruxsat berilmagan', 403)

    if not question_id and isinstance(getattr(request, 'data', None), dict):
        question_id = request.data.get('questionId') or request.data.get('question_id')
    if not question_id:
        question_id = request.query_params.get('questionId') or request.query_params.get('question_id')

    attempt = MockAttempt.objects.filter(id=attempt_id).first()
    if attempt is None:
        engine.fail('MOCK_ATTEMPT_NOT_FOUND', 'Urinish topilmadi', 404)
    if request.user.role == 'student' and attempt.student_id != request.user.id:
        engine.fail('MOCK_ATTEMPT_NOT_FOUND', 'Urinish topilmadi', 404)

    if not question_id:
        first_q = MockQuestion.objects.filter(
            group__section__exam_id=attempt.exam_id,
            group__section__skill='writing',
        ).order_by('sort_order', 'number').first()
        if first_q:
            question_id = first_q.id
        else:
            engine.fail('VALIDATION_ERROR', 'questionId should not be empty', 400)

    uploaded_items = _extract_uploaded_images(request)
    image_keys = []
    image_urls = []
    ocr_inputs = []

    for raw_bytes, mime, ext in uploaded_items:
        key = f"writing-ocr/{attempt_id}/{uuid4()}{ext}"
        target = storage_path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw_bytes)
        image_keys.append(key)
        image_urls.append(f"/media/{key}")
        ocr_inputs.append((raw_bytes, mime))

    ocr_result = writing_ocr.extract_text_from_images(ocr_inputs)
    ocr_text = ocr_result.get('ocrText', '')

    existing = MockAnswer.objects.filter(attempt_id=attempt_id, question_id=question_id).first()
    existing_rubric = dict(existing.rubric_scores) if (existing and isinstance(existing.rubric_scores, dict)) else {}
    prev_keys = list(existing_rubric.get('imageKeys') or [])
    merged_keys = prev_keys + [k for k in image_keys if k not in prev_keys]

    append_flag = False
    if isinstance(getattr(request, 'data', None), dict):
        append_flag = str(request.data.get('append', '')).lower() in ('1', 'true', 'yes')
    if not append_flag:
        append_flag = str(request.query_params.get('append', '')).lower() in ('1', 'true', 'yes')

    if append_flag and existing and existing.response and existing.response.strip():
        final_text = f"{existing.response.strip()}\n\n{ocr_text}".strip()
    else:
        final_text = ocr_text

    word_count = writing_ocr._count_words(final_text)
    rubric_payload = {
        **existing_rubric,
        'imageKeys': merged_keys,
        'ocrText': final_text,
        'wordCount': word_count,
    }
    now = timezone.now()
    MockAnswer.objects.update_or_create(
        attempt_id=attempt_id,
        question_id=question_id,
        defaults=dict(
            response=final_text,
            rubric_scores=rubric_payload,
            updated_at=now,
        ),
        create_defaults=dict(
            id=str(uuid4()),
            response=final_text,
            rubric_scores=rubric_payload,
            is_graded=False,
            updated_at=now,
        ),
    )

    try:
        m_state = attempt.media_state if isinstance(attempt.media_state, dict) else {}
        m_images = list(m_state.get('writing_images') or [])
        for k in merged_keys:
            u = f"/media/{k}"
            if u not in m_images:
                m_images.append(u)
        m_state['writing_images'] = m_images
        MockAttempt.objects.filter(id=attempt.id).update(media_state=m_state)
    except Exception:
        pass

    return success({
        'ocrText': final_text,
        'pages': ocr_result.get('pages', []),
        'imageKeys': merged_keys,
        'imageUrls': [f"/media/{k}" for k in merged_keys],
        'wordCount': word_count,
        'questionId': question_id,
        'provider': ocr_result.get('provider', 'gemini'),
    }, 200)


@api_view(['POST'])
@permission_classes([AllowAny])
def standalone_writing_ocr_view(request):
    from . import writing_ocr

    require_authenticated(request)
    uploaded_items = _extract_uploaded_images(request)
    ocr_inputs = [(raw_bytes, mime) for raw_bytes, mime, _ext in uploaded_items]

    evaluate_flag = False
    task_prompt = ''
    task_type = 'task2'
    if isinstance(getattr(request, 'data', None), dict):
        evaluate_flag = str(request.data.get('evaluate', '')).lower() in ('1', 'true', 'yes')
        task_prompt = str(request.data.get('prompt') or request.data.get('taskPrompt') or '')
        task_type = str(request.data.get('taskType') or request.data.get('task_type') or 'task2')
    if not evaluate_flag:
        evaluate_flag = str(request.query_params.get('evaluate', '')).lower() in ('1', 'true', 'yes')

    if evaluate_flag:
        result = writing_ocr.extract_and_evaluate_images(ocr_inputs, task_prompt=task_prompt, task_type=task_type)
        return success(result, 200)

    ocr_result = writing_ocr.extract_text_from_images(ocr_inputs)
    return success(ocr_result, 200)

