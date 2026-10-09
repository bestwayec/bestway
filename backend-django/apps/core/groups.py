"""Group membership, schedules and role-scoped roster port."""
from uuid import uuid4
from django.db import transaction
from django.utils import timezone
from apps.legacy_schema.models import Group, StudentProfile, ParentStudent, User
from common.api.exceptions import ContractAPIException
from .system_settings import audit


def fail(code, message, status=403):
    raise ContractAPIException(code, message, status)


def child_ids(actor):
    return ParentStudent.objects.filter(parent_user_id=actor.id).values_list('student_id', flat=True)


def get_group(group_id, lock=False):
    rows = Group.objects.select_for_update() if lock else Group.objects
    group = rows.filter(id=group_id).first()
    if group is None: fail('GROUP_NOT_FOUND', 'Guruh topilmadi', 404)
    return group


def assert_teacher(teacher_id):
    if not User.objects.filter(id=teacher_id, role='teacher').exists():
        fail('TEACHER_NOT_FOUND', "Bunday o'qituvchi topilmadi", 400)


def list_groups(actor):
    rows = Group.objects.select_related('teacher')
    if actor.role == 'teacher': rows = rows.filter(teacher_id=actor.id)
    elif actor.role == 'student': rows = rows.filter(studentprofile__user_id=actor.id)
    elif actor.role == 'parent': rows = rows.filter(studentprofile__user_id__in=child_ids(actor)).distinct()
    # Count the entire roster, not just the matched student/parent join.
    return [dict(id=g.id, name=g.name, teacherId=g.teacher_id,
        teacherName=g.teacher.name if g.teacher_id else None, schedule=g.schedule,
        studentsCount=StudentProfile.objects.filter(group_id=g.id).count(), createdAt=g.created_at)
        for g in rows.order_by('created_at')]


def detail(actor, group_id):
    group = get_group(group_id)
    students = list(StudentProfile.objects.filter(group_id=group_id).select_related('user').order_by('user__name'))
    if actor.role == 'teacher' and group.teacher_id != actor.id:
        fail('FORBIDDEN', 'Bu guruh sizga biriktirilmagan')
    if actor.role == 'student' and not any(s.user_id == actor.id for s in students):
        fail('FORBIDDEN', "Siz bu guruh a'zosi emassiz")
    if actor.role == 'parent' and not any(s.user_id in set(child_ids(actor)) for s in students):
        fail('FORBIDDEN', "Farzandingiz bu guruhda o'qimaydi")
    show_phones = actor.role not in ('student', 'parent')
    return dict(id=group.id, name=group.name, teacherId=group.teacher_id,
        teacherName=group.teacher.name if group.teacher_id else None,
        schedule=group.schedule, createdAt=group.created_at,
        students=[dict(studentId=s.user_id, name=s.user.name,
            **({'phone': s.user.phone} if show_phones else {}), isActive=s.user.is_active,
            isApproved=s.is_approved, currentPoints=s.current_points) for s in students])


@transaction.atomic
def create(actor, data):
    if data.get('teacherId'): assert_teacher(data['teacherId'])
    group = Group.objects.create(id=str(uuid4()), name=data['name'], teacher_id=data.get('teacherId'),
        schedule=data.get('schedule'), created_at=timezone.now())
    audit(actor, 'group.create', 'group', group.id, new=dict(name=group.name, teacherId=group.teacher_id))
    return detail(actor, group.id)


@transaction.atomic
def update(actor, group_id, data):
    group = get_group(group_id, True)
    if data.get('teacherId'): assert_teacher(data['teacherId'])
    old = dict(name=group.name, teacherId=group.teacher_id)
    changed = []
    for key, field in [('name', 'name'), ('teacherId', 'teacher_id'), ('schedule', 'schedule')]:
        if key in data:
            setattr(group, field, data[key])
            changed.append(field)
    if changed: group.save(update_fields=changed)
    # Reference audit's null-coalescing retains the old teacher even on removal.
    audit(actor, 'group.update', 'group', group_id, old=old,
        new=dict(name=data.get('name') if data.get('name') is not None else old['name'], teacherId=data.get('teacherId') if data.get('teacherId') is not None else old['teacherId']))
    return detail(actor, group_id)


@transaction.atomic
def add_student(actor, group_id, student_id):
    get_group(group_id, True)
    profile = StudentProfile.objects.select_for_update().filter(user_id=student_id).first()
    if profile is None: fail('STUDENT_NOT_FOUND', "O'quvchi topilmadi", 404)
    old = profile.group_id
    profile.group_id = group_id
    profile.save(update_fields=['group_id'])
    audit(actor, 'group.add_student', 'studentProfile', student_id, old=dict(groupId=old), new=dict(groupId=group_id))
    return dict(groupId=group_id, studentId=student_id, added=True)


@transaction.atomic
def remove_student(actor, group_id, student_id):
    profile = StudentProfile.objects.select_for_update().filter(user_id=student_id).first()
    if profile is None or profile.group_id != group_id:
        fail('STUDENT_NOT_IN_GROUP', "O'quvchi bu guruhda emas", 404)
    profile.group_id = None
    profile.save(update_fields=['group_id'])
    audit(actor, 'group.remove_student', 'studentProfile', student_id, old=dict(groupId=group_id), new=dict(groupId=None))
    return dict(removed=True)
