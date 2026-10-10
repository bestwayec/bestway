"""Monthly game lifecycle, archive/reset and sticky qualification parity."""
import logging
from uuid import uuid4
from django.db import connection, transaction
from django.db.models import Q
from django.utils import timezone
from apps.legacy_schema.models import StudentProfile, MonthlyPointsArchive
from common.api.exceptions import ContractAPIException
from .system_settings import numeric_settings, audit
from .notifications import notify_many, notify_parents
from .attendance import csv_cell


def period_key(now=None):
    now = timezone.localtime(now) if now else timezone.localtime()
    return f'{now.year}-{now.month:02d}'


def setting(key):
    return numeric_settings()[key]


def numeric(value):
    # Settings DTOs allow null: JavaScript comparisons/arithmetic coerce it to 0.
    return 0 if value is None else value


def display(value):
    return 'null' if value is None else str(value)


@transaction.atomic
def ensure_current_period(student_id):
    current = period_key()
    student = StudentProfile.objects.select_for_update().filter(user_id=student_id).first()
    if student is None or student.points_period == current: return False
    if student.points_period is None:
        StudentProfile.objects.filter(user_id=student_id, points_period__isnull=True).update(points_period=current)
        return True
    year, month = map(int, student.points_period.split('-'))
    initial = setting('initialPoints')
    # Native upsert preserves Prisma's original naive-UTC creation timestamp.
    with connection.cursor() as cursor:
        cursor.execute('''INSERT INTO "MonthlyPointsArchive"
            (id,"studentId",year,month,points,qualified,"createdAt") VALUES (%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT ("studentId",year,month) DO UPDATE SET points=EXCLUDED.points,qualified=EXCLUDED.qualified''',
            [str(uuid4()), student_id, year, month, student.current_points, student.game_qualified, timezone.now()])
    return bool(StudentProfile.objects.filter(user_id=student_id, points_period=student.points_period).update(
        current_points=initial, points_period=current, game_qualified=False, qualified_at=None))


def rollover_stale():
    current = period_key()
    ids = list(StudentProfile.objects.filter(Q(points_period__isnull=True) | ~Q(points_period=current)).values_list('user_id', flat=True))
    return sum(ensure_current_period(student_id) for student_id in ids)


def startup_recovery():
    # Reference startup is best-effort; monthly cron failures remain visible.
    try: return rollover_stale()
    except Exception:
        logging.getLogger(__name__).warning('Game startup recovery failed')
        return None


def monthly_reset():
    return rollover_stale()


def check_and_qualify(actor, student_id, points, name):
    threshold = setting('gameThreshold')
    if points < numeric(threshold): return False
    changed = StudentProfile.objects.filter(user_id=student_id, game_qualified=False).update(
        game_qualified=True, qualified_at=timezone.now())
    if not changed: return False
    # Reference commits the sticky flag before awaited notifications/audit.
    notify_many([student_id], 'game', f"Tabriklaymiz! Siz shu oylik o'yinga qo'shildingiz. Joriy ball: {points} (chegara: {display(threshold)}). Oy oxiridagi o'yinni kuting!")
    notify_parents(student_id, 'game', f"Farzandingiz {name} shu oylik o'yinga qo'shildi (joriy ball: {points}).")
    audit(actor, 'game.qualify', 'studentProfile', student_id, new=dict(points=points, threshold=threshold))
    return True


def roster(year=None, month=None):
    now = timezone.localtime()
    year = year if year is not None else now.year
    month = month if month is not None else now.month
    current = f'{year}-{month:02d}' == period_key()
    students = []
    if current:
        rows = StudentProfile.objects.filter(game_qualified=True, points_period=period_key(), user__is_active=True).select_related('user', 'group').order_by('-current_points', 'qualified_at')
        for row in rows:
            students.append(dict(studentId=row.user_id, name=row.user.name, phone=row.user.phone,
                group=row.group.name if row.group_id else None, points=row.current_points, qualifiedAt=row.qualified_at))
    else:
        rows = MonthlyPointsArchive.objects.filter(year=year, month=month, qualified=True, student__user__is_active=True).select_related('student__user', 'student__group').order_by('-points')
        for row in rows:
            student = row.student
            students.append(dict(studentId=row.student_id, name=student.user.name, phone=student.user.phone,
                group=student.group.name if student.group_id else None, points=row.points, qualifiedAt=None))
    return dict(year=year, month=month, current=current, threshold=setting('gameThreshold'), count=len(students), students=students)


def roster_csv(year=None, month=None):
    data = roster(year, month)
    lines = ["#;Ism;Telefon;Guruh;Ball;Qo'shilgan sana"]
    for index, student in enumerate(data['students'], 1):
        stamp = student['qualifiedAt']
        # Prisma timestampless values represent UTC, not the local calendar day.
        day = stamp.isoformat()[:10] if stamp else ''
        lines.append(';'.join(map(csv_cell, [index, student['name'], student['phone'], student['group'] or '', student['points'], day])))
    return '\ufeff' + '\r\n'.join(lines)


def status(student_id):
    student = StudentProfile.objects.filter(user_id=student_id).first()
    if student is None: raise ContractAPIException('STUDENT_NOT_FOUND', "O'quvchi topilmadi", 404)
    stale = student.points_period is not None and student.points_period != period_key()
    points = setting('initialPoints') if stale else student.current_points
    qualified = False if stale else student.game_qualified
    year, month = map(int, period_key().split('-'))
    threshold = setting('gameThreshold')
    return dict(year=year, month=month, points=points, threshold=threshold, qualified=qualified,
        remaining=max(0, numeric(threshold)-numeric(points)), qualifiedAt=student.qualified_at if qualified else None)
