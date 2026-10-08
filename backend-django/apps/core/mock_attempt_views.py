"""HTTP boundary for the migrated student attempt mutations."""
from datetime import datetime
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from . import mock_attempts as engine
from .views import body, require_authenticated, require_role, success as envelope


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
def start_view(request, exam_id):
    student(request)
    data = body(request, {'mode', 'flow'})
    if data.get('mode') is not None and data['mode'] not in ('practice', 'timed'):
        engine.fail('VALIDATION_ERROR', 'mode must be one of the following values: practice, timed')
    if data.get('flow') is not None and not isinstance(data['flow'], str):
        engine.fail('VALIDATION_ERROR', 'flow must be a string')
    return success(engine.start(request.user, exam_id, data), 201)


@api_view(['POST'])
@permission_classes([AllowAny])
def answer_view(request, attempt_id):
    student(request)
    data = body(request, {'questionId', 'response'})
    validate_answer(data)
    return success(engine.save_answers(request.user, attempt_id, [data]), 201)


@api_view(['POST'])
@permission_classes([AllowAny])
def answers_view(request, attempt_id):
    student(request)
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
    data = body(request, {'event'})
    event = data.get('event')
    if not isinstance(event, str):
        engine.fail('VALIDATION_ERROR', 'event must be a string')
    if not event:
        engine.fail('VALIDATION_ERROR', 'event should not be empty')
    if len(event) > 50:
        engine.fail('VALIDATION_ERROR', 'event must be shorter than or equal to 50 characters')
    return success(engine.flag_cheat(request.user, attempt_id, event), 201)


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


@api_view(['GET'])
@permission_classes([AllowAny])
def detail_view(request, attempt_id):
    require_authenticated(request)
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
    from apps.legacy_schema.models import MockAttempt, MockAnswer
    from .mock_media import resolve_key
    from .mock_attempt_audio import stream_audio
    attempt = MockAttempt.objects.filter(id=attempt_id).first()
    if attempt is None:
        engine.fail('MOCK_ATTEMPT_NOT_FOUND', 'Urinish topilmadi', 404)
    engine.assert_view(request.user, attempt.student_id)
    answer = MockAnswer.objects.filter(attempt_id=attempt_id, question_id=question_id).first()
    if answer is None or not answer.audio_key or not resolve_key(answer.audio_key).is_file():
        engine.fail('FILE_NOT_FOUND', 'Audio topilmadi', 404)
    return stream_audio(request, resolve_key(answer.audio_key))
