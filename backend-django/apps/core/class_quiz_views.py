"""HTTP surface of the classroom quiz engine. Thin by design: authentication + request shape only."""
from django.http import HttpResponse
from django.utils.dateparse import parse_datetime
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny

from common.api.exceptions import ContractAPIException
from common.auth.permissions import Authenticated

from . import class_quiz as quiz
from .views import body, success


def _deadline(value):
    parsed = parse_datetime(value) if isinstance(value, str) else None
    if parsed is None or parsed.tzinfo is None:
        raise ContractAPIException('VALIDATION_ERROR', 'deadline must be an ISO-8601 timestamp with a time zone', 400)
    return parsed


@api_view(['GET', 'POST'])
@permission_classes([Authenticated])
def quizzes(request):
    if request.method == 'GET':
        return success(quiz.list_quizzes(request.user))
    data = body(request, {'title', 'description', 'category', 'timeLimitMinutes', 'maxAttempts', 'shuffleQuestions'})
    return success(quiz.create_quiz(request.user, data), 201)


@api_view(['GET', 'PATCH'])
@permission_classes([Authenticated])
def quiz_detail(request, quiz_id):
    if request.method == 'GET':
        return success(quiz.get_quiz(request.user, quiz_id))
    data = body(request, {'title', 'description', 'category', 'timeLimitMinutes', 'maxAttempts', 'shuffleQuestions'})
    return success(quiz.update_quiz(request.user, quiz_id, data))


@api_view(['PUT', 'POST'])
@permission_classes([Authenticated])
def quiz_questions(request, quiz_id):
    if request.method == 'PUT':
        data = body(request, {'questions'})
        return success(quiz.replace_questions(request.user, quiz_id, data.get('questions')))
    data = body(request, {'text', 'answerKey', 'replace'})
    return success(quiz.import_questions(request.user, quiz_id, data.get('text'), data.get('answerKey'), replace=data.get('replace', True) is not False))


@api_view(['GET'])
@permission_classes([Authenticated])
def quiz_preview(request, quiz_id):
    return success(quiz.preview(request.user, quiz_id))


@api_view(['POST'])
@permission_classes([Authenticated])
def quiz_publish(request, quiz_id):
    return success(quiz.publish_quiz(request.user, quiz_id))


@api_view(['POST'])
@permission_classes([Authenticated])
def quiz_assign(request, quiz_id):
    data = body(request, {'groupIds', 'deadline', 'timeLimitMinutes', 'maxAttempts'})
    return success(quiz.assign_quiz(request.user, quiz_id, data.get('groupIds'), _deadline(data.get('deadline')),
                                    time_limit_minutes=data.get('timeLimitMinutes'), max_attempts=data.get('maxAttempts')), 201)


@api_view(['GET'])
@permission_classes([Authenticated])
def my_assignments(request):
    return success(quiz.my_assignments(request.user))


@api_view(['POST'])
@permission_classes([Authenticated])
def assignment_start(request, assignment_id):
    return success(quiz.start_attempt(request.user, assignment_id), 201)


@api_view(['GET'])
@permission_classes([Authenticated])
def assignment_overview(request, assignment_id):
    return success(quiz.assignment_overview(request.user, assignment_id))


@api_view(['GET'])
@permission_classes([Authenticated])
def assignment_export(request, assignment_id):
    response = HttpResponse(quiz.export_csv(request.user, assignment_id), content_type='text/csv; charset=utf-8')
    response['Content-Disposition'] = 'attachment; filename="class-quiz-results.csv"'
    return response


@api_view(['GET'])
@permission_classes([Authenticated])
def attempt_detail(request, attempt_id):
    return success(quiz.get_attempt(request.user, attempt_id))


@api_view(['POST'])
@permission_classes([Authenticated])
def attempt_answer(request, attempt_id):
    data = body(request, {'questionId', 'response'})
    return success(quiz.save_answer(request.user, attempt_id, data.get('questionId'), data.get('response')), 201)


@api_view(['POST'])
@permission_classes([Authenticated])
def attempt_finish(request, attempt_id):
    return success(quiz.finish_attempt(request.user, attempt_id), 201)


@api_view(['GET'])
@permission_classes([Authenticated])
def attempt_result(request, attempt_id):
    return success(quiz.my_result(request.user, attempt_id))


@api_view(['GET'])
@permission_classes([Authenticated])
def attempt_staff(request, attempt_id):
    return success(quiz.attempt_for_staff(request.user, attempt_id))


@api_view(['GET'])
@permission_classes([Authenticated])
def child_results(request, student_id):
    return success(quiz.parent_results(request.user, student_id))
