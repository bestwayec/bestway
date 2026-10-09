"""Points history, teacher-scoped adjustment and public competition ranking."""
from uuid import uuid4
from django.db import transaction
from django.db.models import F
from django.utils import timezone
from apps.legacy_schema.models import StudentProfile, ParentStudent, PointsLog, User
from common.api.exceptions import ContractAPIException
from . import game
from .system_settings import audit
from .notifications import safe_notify, safe_notify_parents


def assert_can_view(actor, student_id):
    if actor.role in ('admin', 'super_admin') or (actor.role == 'student' and actor.id == student_id): return
    if actor.role == 'parent' and ParentStudent.objects.filter(parent_user_id=actor.id, student_id=student_id).exists(): return
    if actor.role == 'teacher' and StudentProfile.objects.filter(user_id=student_id, group__teacher_id=actor.id).exists(): return
    raise ContractAPIException('FORBIDDEN', "Bu ma'lumotni ko'rish huquqingiz yo'q", 403)


def history(actor, student_id):
    assert_can_view(actor, student_id)
    student = StudentProfile.objects.filter(user_id=student_id).first()
    if student is None: raise ContractAPIException('STUDENT_NOT_FOUND', "O'quvchi topilmadi", 404)
    rows = list(PointsLog.objects.filter(student_id=student_id).order_by('-created_at')[:100])
    names = dict(User.objects.filter(id__in=[r.by_user_id for r in rows if r.by_user_id]).values_list('id', 'name'))
    return dict(current=student.current_points, history=[dict(change=r.change, reason=r.reason,
        byUserId=r.by_user_id, byUserName=names.get(r.by_user_id) if r.by_user_id else 'Tizim', date=r.created_at) for r in rows])


def adjust(actor, student_id, data):
    student = StudentProfile.objects.filter(user_id=student_id).select_related('group', 'user').first()
    if student is None: raise ContractAPIException('STUDENT_NOT_FOUND', "O'quvchi topilmadi", 404)
    if actor.role == 'teacher':
        if not student.group_id or student.group.teacher_id != actor.id:
            raise ContractAPIException('FORBIDDEN', "Bu o'quvchi sizning guruhingizda emas", 403)
        limit = game.setting('teacherPointLimit')
        if abs(data['change']) > game.numeric(limit):
            raise ContractAPIException('POINT_LIMIT_EXCEEDED', f"O'qituvchi bir amalda ko'pi bilan ±{game.display(limit)} ball o'zgartira oladi", 403)
    with transaction.atomic():
        game.ensure_current_period(student_id)
        StudentProfile.objects.filter(user_id=student_id).update(current_points=F('current_points')+data['change'])
        updated = StudentProfile.objects.get(user_id=student_id)
        PointsLog.objects.create(id=str(uuid4()), student_id=student_id, change=data['change'], reason=data['reason'],
            by_user_id=actor.id, created_at=timezone.now())
    old = updated.current_points-data['change']
    sign = '+' if data['change'] > 0 else ''
    safe_notify(student_id, 'points', f"Ball o'zgarishi: {sign}{data['change']} ({data['reason']}). Joriy ball: {updated.current_points}.")
    safe_notify_parents(student_id, 'points', f"Farzandingiz {student.user.name} balli o'zgardi: {sign}{data['change']} ({data['reason']}). Joriy ball: {updated.current_points}.")
    audit(actor, 'points.adjust', 'studentProfile', student_id, old=dict(points=old),
        new=dict(points=updated.current_points, change=data['change'], reason=data['reason']))
    game.check_and_qualify(actor, student_id, updated.current_points, student.user.name)
    return dict(current=updated.current_points)


def leaderboard(query):
    rows = StudentProfile.objects.filter(user__is_active=True).select_related('user')
    if query.get('groupId'): rows = rows.filter(group_id=query['groupId'])
    rows = rows.order_by('-current_points', 'created_at')[:query.get('limit', 50)]
    result = []; rank = 0; previous = None
    for index, row in enumerate(rows, 1):
        if row.current_points != previous: rank = index; previous = row.current_points
        result.append(dict(studentId=row.user_id, name=row.user.name, points=row.current_points, rank=rank))
    return result
