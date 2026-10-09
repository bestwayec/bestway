"""AttendanceService and attendance-only CSV export over the existing Prisma tables."""
from datetime import date, datetime, timedelta, timezone as dt_timezone
import re
import locale
import os
from functools import lru_cache
from uuid import uuid4

from django.db import transaction, connection
from django.db.models.functions import Collate
from django.utils import timezone

from apps.legacy_schema.models import Attendance, StudentProfile
from common.api.exceptions import ContractAPIException
from .groups import child_ids, get_group
from .notifications import notify_parents
from .system_settings import audit


def manage_group(actor, group_id):
    group = get_group(group_id)
    if actor.role not in ('admin', 'super_admin') and not (actor.role == 'teacher' and group.teacher_id == actor.id):
        raise ContractAPIException('FORBIDDEN', 'Bu guruh sizga biriktirilmagan', 403)
    return group


def month_rows(month=None):
    now = timezone.localtime()
    year, m = map(int, month.split('-')) if month else (now.year, now.month)
    # Date.UTC treats years 0..99 as 1900..1999, including the upper bound.
    y = year + 1900 if year < 100 else year
    next_year, next_month = (year + 1, 1) if m == 12 else (year, m + 1)
    if next_year < 100: next_year += 1900
    if next_year > 9999:
        # Prisma cannot serialize the expanded ISO year produced by Date.UTC.
        raise ContractAPIException('INTERNAL_ERROR', 'Serverda kutilmagan xatolik yuz berdi', 500)
    # Strings retain Date.UTC's 10000 upper bound without Python date's year cap.
    return Attendance.objects.extra(where=['"date" >= %s::date AND "date" < %s::date'],
        params=[f'{y:04d}-{m:02d}-01', f'{next_year:04d}-{next_month:02d}-01'])


def reference_date(value):
    """Nest slices the first ten characters before Date parsing, not TZ conversion.

    Its non-strict ISO validator permits February overflow; JavaScript rolls that
    forward. Week/ordinal/basic ISO strings can validate but fail Prisma parsing.
    """
    value = value[:10]
    legacy = re.fullmatch(r'[+-]([0-9]{4})-([0-9]{2})-([0-9])', value)
    if legacy:
        first, second, third = map(int, legacy.groups())
        # A signed four-digit year falls into V8's legacy local-date parser
        # after the ten-character slice, losing all but the first day digit.
        try:
            if 1 <= first <= 12:
                local = datetime(2000 + third, first, second, tzinfo=timezone.get_current_timezone())
            elif first >= 50:
                local = datetime(first + 1900 if first < 100 else first, second, third,
                    tzinfo=timezone.get_current_timezone())
            else: raise ValueError('invalid V8 legacy date')
            return local.astimezone(dt_timezone.utc).date()
        except ValueError:
            raise ContractAPIException('INTERNAL_ERROR', 'Serverda kutilmagan xatolik yuz berdi', 500)
    match = re.fullmatch(r'(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?', value)
    if not match:
        raise ContractAPIException('INTERNAL_ERROR', 'Serverda kutilmagan xatolik yuz berdi', 500)
    try:
        year, month, day = (int(v) if v else 1 for v in match.groups())
        return date(year, month, 1) + timedelta(days=day - 1)
    except ValueError:
        raise ContractAPIException('INTERNAL_ERROR', 'Serverda kutilmagan xatolik yuz berdi', 500)


def listing(actor, query):
    rows = month_rows(query.get('month'))
    if actor.role == 'student':
        rows = rows.filter(student_id=actor.id)
        if query.get('groupId'): rows = rows.filter(group_id=query['groupId'])
    elif actor.role == 'parent':
        children = list(child_ids(actor))
        student = query.get('studentId')
        if student and student not in children:
            raise ContractAPIException('FORBIDDEN', "Bu o'quvchi sizga bog'lanmagan", 403)
        rows = rows.filter(student_id=student) if student else rows.filter(student_id__in=children)
    else:
        if not query.get('groupId'):
            raise ContractAPIException('GROUP_ID_REQUIRED', "groupId ko'rsatilishi shart", 400)
        manage_group(actor, query['groupId'])
        rows = rows.filter(group_id=query['groupId'])
        if query.get('studentId'): rows = rows.filter(student_id=query['studentId'])
    return [dict(studentId=row.student_id, date=row.date.isoformat(), state=row.state) for row in rows.order_by('date')]


def bulk(actor, data):
    manage_group(actor, data['groupId'])
    day = reference_date(data['date'])
    members = {p.user_id: p for p in StudentProfile.objects.filter(group_id=data['groupId']).select_related('user')}
    if any(r['studentId'] not in members for r in data['records']):
        raise ContractAPIException('STUDENT_NOT_IN_GROUP', "Ro'yxatda guruhga tegishli bo'lmagan o'quvchi bor", 400)
    if any(not members[r['studentId']].user.is_active for r in data['records']):
        raise ContractAPIException('STUDENT_BLOCKED', "Bloklangan o'quvchi uchun davomat belgilab bo'lmaydi", 400)
    previous = dict(Attendance.objects.filter(group_id=data['groupId'], date=day,
        student_id__in=[r['studentId'] for r in data['records']]).values_list('student_id', 'state'))
    marked = [r for r in data['records'] if r['state'] not in ('empty', 'blank')]
    cleared = [r for r in data['records'] if r['state'] in ('empty', 'blank')]
    with transaction.atomic():
        for r in marked:
            stamp = timezone.now()
            upsert(r['studentId'], data['groupId'], day, r['state'], actor.id, stamp)
        if cleared:
            Attendance.objects.filter(group_id=data['groupId'], date=day,
                student_id__in=[r['studentId'] for r in cleared]).delete()
    # Reference sends after the attendance transaction. Duplicates in the same
    # payload can intentionally produce multiple messages; do not deduplicate.
    for r in data['records']:
        if r['state'] == 'absent' and previous.get(r['studentId']) != 'absent':
            notify_parents(r['studentId'], 'attendance',
                f"Farzandingiz {members[r['studentId']].user.name} {day.isoformat()} kungi darsga kelmadi.")
    audit(actor, 'attendance.bulk_update', 'group', data['groupId'],
        new=dict(date=data['date'][:10], records=len(data['records'])))
    return dict(updated=len(marked), cleared=len(cleared))


def upsert(student_id, group_id, day, state, actor_id, stamp):
    # Native upsert locks a conflicting unique key atomically. Avoid Django's
    # update_or_create timestamp pre_save expansion: Prisma stores naive UTC
    # timestamps, and re-saving createdAt would shift historical values.
    with connection.cursor() as cursor:
        cursor.execute('''INSERT INTO "Attendance"
            (id,"studentId","groupId",date,state,"markedById","createdAt","updatedAt")
            VALUES (%s,%s,%s,%s,%s::"AttendanceState",%s,%s,%s)
            ON CONFLICT ("studentId","groupId",date) DO UPDATE SET
            state=EXCLUDED.state,"markedById"=EXCLUDED."markedById","updatedAt"=EXCLUDED."updatedAt"''',
            [str(uuid4()),student_id,group_id,day,state,actor_id,stamp,stamp])


def stats(actor, query):
    manage_group(actor, query['groupId'])
    rows = month_rows(query.get('month')).filter(group_id=query['groupId']).select_related('student__user')
    # Node's default localeCompare uses the host's ICU locale, not binary order
    # or Django LANGUAGE_CODE (this Windows reference resolves to ru-RU).
    rows = rows.order_by(Collate('student__user__name', reference_collation()))
    entries = {}
    for row in rows:
        entry = entries.setdefault(row.student_id, dict(studentId=row.student_id, name=row.student.user.name,
            present=0, absent=0, late=0))
        entry[row.state if row.state in ('present', 'absent') else 'late'] += 1
    return list(entries.values())


@lru_cache(maxsize=1)
def reference_collation():
    configured = os.environ.get('REFERENCE_NAME_COLLATION')
    if configured: return configured
    if os.name == 'nt':
        import ctypes
        value = ctypes.create_unicode_buffer(85)
        if not ctypes.windll.kernel32.GetUserDefaultLocaleName(value, len(value)):
            raise RuntimeError('Cannot determine reference locale')
        name = value.value
    else:
        name = (locale.getlocale(locale.LC_CTYPE)[0] or 'en-US').replace('_', '-')
    return name + '-x-icu'


def csv_cell(value):
    value = str(value)
    if re.match(r'^[=+\-@\t\r]', value): value = "'" + value
    if any(char in value for char in ('"', ';', '\n')): value = '"' + value.replace('"', '""') + '"'
    return value


def export(query):
    rows = month_rows(query.get('month')).filter(group_id=query['groupId']).select_related('student__user').order_by('date', 'student__user__name')
    labels = dict(present='Keldi', absent='Kelmadi', late='Kechikdi')
    lines = ['Sana;Ism;Holat']
    lines += [';'.join(map(csv_cell, [r.date.isoformat(), r.student.user.name, labels.get(r.state, r.state)])) for r in rows]
    return '\ufeff' + '\r\n'.join(lines)
