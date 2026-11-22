"""HTTP surface of the Teacher Workspace 2.0 (thin wrappers; all rules live in teacher_workspace.py)."""
from rest_framework.decorators import api_view, permission_classes

from common.auth.permissions import Authenticated

from . import teacher_workspace as tw
from .views import body, success


@api_view(['GET'])
@permission_classes([Authenticated])
def overview(request):
    return success(tw.overview(request.user))


@api_view(['GET', 'PUT'])
@permission_classes([Authenticated])
def group_attendance(request, group_id):
    tw._require_staff(request.user)
    if request.method == 'GET':
        params = dict(request.query_params.items())
        if set(params) - {'date'}:
            tw.fail('VALIDATION_ERROR', 'Validatsiya xatosi')
        return success(tw.attendance_day(request.user, group_id, params.get('date')))
    return success(tw.save_attendance(request.user, group_id, body(request, {'date', 'records', 'revision'})))


@api_view(['GET'])
@permission_classes([Authenticated])
def group_attendance_history(request, group_id):
    tw._require_staff(request.user)
    return success(tw.attendance_history(request.user, group_id))


HOMEWORK_FIELDS = {'type', 'title', 'deadline', 'quizId', 'newQuiz', 'timeLimitMinutes', 'maxAttempts', 'vocabularySetId', 'examId',
                   'lessonId', 'minPassPercent'}


@api_view(['GET', 'POST'])
@permission_classes([Authenticated])
def group_homework(request, group_id):
    if request.method == 'GET':
        return success(tw.group_homework(request.user, group_id))
    result = tw.assign_homework(request.user, group_id, body(request, HOMEWORK_FIELDS))
    return success(result, 201 if result['created'] else 200)


@api_view(['GET'])
@permission_classes([Authenticated])
def group_homework_options(request, group_id):
    return success(tw.assign_options(request.user, group_id))


@api_view(['POST'])
@permission_classes([Authenticated])
def group_homework_preview(request, group_id):
    return success(tw.preview_homework(request.user, group_id, body(request, HOMEWORK_FIELDS)))


@api_view(['GET'])
@permission_classes([Authenticated])
def homework_results(request, kind, assignment_id):
    return success(tw.homework_results(request.user, kind, assignment_id))


@api_view(['POST'])
@permission_classes([Authenticated])
def homework_remind(request, kind, assignment_id):
    return success(tw.remind_pending(request.user, kind, assignment_id))


@api_view(['GET'])
@permission_classes([Authenticated])
def student_homework(request):
    return success(tw.student_homework(request.user))
