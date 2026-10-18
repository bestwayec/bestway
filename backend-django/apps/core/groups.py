"""Group membership, schedules, analytics, and Excel/CSV roster port."""
import math
import re
from io import BytesIO
from uuid import uuid4

from django.db import transaction
from django.utils import timezone

from apps.legacy_schema.models import (
    Group,
    MockAnswer,
    MockAttempt,
    ParentStudent,
    StudentProfile,
    TestAttempt,
    User,
)
from common.api.exceptions import ContractAPIException

from .system_settings import audit


def fail(code, message, status=403):
    raise ContractAPIException(code, message, status)


def child_ids(actor):
    return ParentStudent.objects.filter(parent_user_id=actor.id).values_list('student_id', flat=True)


def get_group(group_id, lock=False):
    rows = Group.objects.select_for_update() if lock else Group.objects
    group = rows.filter(id=group_id).first()
    if group is None:
        fail('GROUP_NOT_FOUND', 'Guruh topilmadi', 404)
    return group


def assert_teacher(teacher_id):
    if not User.objects.filter(id=teacher_id, role='teacher').exists():
        fail('TEACHER_NOT_FOUND', "Bunday o'qituvchi topilmadi", 400)


def list_groups(actor):
    rows = Group.objects.select_related('teacher')
    if actor.role == 'teacher':
        rows = rows.filter(teacher_id=actor.id)
    elif actor.role == 'student':
        rows = rows.filter(studentprofile__user_id=actor.id)
    elif actor.role == 'parent':
        rows = rows.filter(studentprofile__user_id__in=child_ids(actor)).distinct()
    # Count the entire roster, not just the matched student/parent join.
    return [
        dict(
            id=g.id,
            name=g.name,
            teacherId=g.teacher_id,
            teacherName=g.teacher.name if g.teacher_id and getattr(g, 'teacher', None) else None,
            schedule=g.schedule,
            studentsCount=StudentProfile.objects.filter(group_id=g.id).count(),
            createdAt=g.created_at,
        )
        for g in rows.order_by('created_at')
    ]


def _round1(val):
    if val is None or not isinstance(val, (int, float)) or not math.isfinite(val):
        return None
    return round(float(val), 1)


def _compute_student_and_group_analytics(student_ids):
    per_student = {
        sid: {
            'completedExamsCount': 0,
            'listeningScore': None,
            'readingScore': None,
            'writingScore': None,
            'speakingScore': None,
            'overallBand': None,
            'lastAttemptAt': None,
        }
        for sid in student_ids
    }
    if not student_ids:
        return per_student, {
            'averageBandScore': None,
            'totalCompletedAttempts': 0,
            'activeStudentsCount': 0,
        }

    try:
        mock_attempts = list(
            MockAttempt.objects.filter(student_id__in=student_ids)
            .select_related('exam')
            .order_by('-finished_at', '-submitted_at', '-started_at')
        )
    except Exception:
        mock_attempts = []

    try:
        legacy_attempts = list(
            TestAttempt.objects.filter(student_id__in=student_ids)
            .order_by('-finished_at', '-started_at')
        )
    except Exception:
        legacy_attempts = []

    mock_by_student = {}
    for att in mock_attempts:
        mock_by_student.setdefault(att.student_id, []).append(att)

    legacy_by_student = {}
    for att in legacy_attempts:
        legacy_by_student.setdefault(att.student_id, []).append(att)

    all_overall_bands = []
    total_completed = 0
    active_students = 0

    for sid in student_ids:
        s_mocks = mock_by_student.get(sid, [])
        s_legacies = legacy_by_student.get(sid, [])
        completed_mocks = [a for a in s_mocks if getattr(a, 'status', None) == 'completed']
        completed_legacies = [a for a in s_legacies if getattr(a, 'status', None) == 'completed']
        comp_count = len(completed_mocks) + len(completed_legacies)
        total_completed += comp_count
        if comp_count > 0 or s_mocks or s_legacies:
            active_students += 1

        l_scores, r_scores, w_scores, sp_scores, ov_scores = [], [], [], [], []
        last_dt = None

        for a in completed_mocks or s_mocks:
            dt = getattr(a, 'finished_at', None) or getattr(a, 'submitted_at', None) or getattr(a, 'started_at', None)
            if dt and (last_dt is None or dt > last_dt):
                last_dt = dt
            bands = getattr(a, 'section_bands', None) or {}
            std_scores = getattr(a, 'standard_scores', None) or {}
            raw_scores = getattr(a, 'raw_scores', None) or {}

            def _extract_skill(skill):
                if isinstance(bands, dict) and bands.get(skill) is not None:
                    return bands.get(skill)
                if isinstance(std_scores, dict):
                    sv = std_scores.get(skill)
                    if isinstance(sv, dict) and sv.get('estimatedStandardScore') is not None:
                        return sv.get('estimatedStandardScore')
                    if isinstance(sv, (int, float)):
                        return sv
                if isinstance(raw_scores, dict):
                    rv = raw_scores.get(skill)
                    if isinstance(rv, dict) and rv.get('score') is not None:
                        return rv.get('score')
                    if isinstance(rv, (int, float)):
                        return rv
                return None

            for skill, bucket in [
                ('listening', l_scores),
                ('reading', r_scores),
                ('writing', w_scores),
                ('speaking', sp_scores),
            ]:
                val = _extract_skill(skill)
                if isinstance(val, (int, float)) and math.isfinite(val):
                    bucket.append(float(val))

            ov = getattr(a, 'overall_band', None)
            if ov is None:
                ov = getattr(a, 'overall_score', None)
            if isinstance(ov, (int, float)) and math.isfinite(ov):
                ov_scores.append(float(ov))

        for la in completed_legacies:
            dt = getattr(la, 'finished_at', None) or getattr(la, 'started_at', None)
            if dt and (last_dt is None or dt > last_dt):
                last_dt = dt
            ts = getattr(la, 'total_score', None)
            if isinstance(ts, (int, float)) and math.isfinite(ts):
                ov_scores.append(float(ts))

        overall_val = _round1(ov_scores[0]) if ov_scores else None
        if overall_val is not None:
            all_overall_bands.append(overall_val)

        per_student[sid] = {
            'completedExamsCount': comp_count,
            'listeningScore': _round1(l_scores[0]) if l_scores else None,
            'readingScore': _round1(r_scores[0]) if r_scores else None,
            'writingScore': _round1(w_scores[0]) if w_scores else None,
            'speakingScore': _round1(sp_scores[0]) if sp_scores else None,
            'overallBand': overall_val,
            'lastAttemptAt': last_dt,
        }

    avg_band = _round1(sum(all_overall_bands) / len(all_overall_bands)) if all_overall_bands else None
    return per_student, {
        'averageBandScore': avg_band,
        'totalCompletedAttempts': total_completed,
        'activeStudentsCount': active_students,
    }


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

    student_ids = [s.user_id for s in students]
    per_student, group_analytics = _compute_student_and_group_analytics(student_ids)

    student_rows = []
    for s in students:
        stats = per_student.get(s.user_id, {})
        row = dict(
            studentId=s.user_id,
            name=s.user.name,
            **({'phone': s.user.phone, 'email': getattr(s.user, 'email', None)} if show_phones else {}),
            isActive=s.user.is_active,
            isApproved=s.is_approved,
            currentPoints=s.current_points,
            completedExamsCount=stats.get('completedExamsCount', 0),
            listeningScore=stats.get('listeningScore'),
            readingScore=stats.get('readingScore'),
            writingScore=stats.get('writingScore'),
            speakingScore=stats.get('speakingScore'),
            overallBand=stats.get('overallBand'),
            lastAttemptAt=stats.get('lastAttemptAt'),
        )
        student_rows.append(row)

    teacher_name = None
    if group.teacher_id:
        try:
            teacher_name = group.teacher.name if getattr(group, 'teacher', None) else None
        except Exception:
            teacher_name = None

    return dict(
        id=group.id,
        name=group.name,
        teacherId=group.teacher_id,
        teacherName=teacher_name,
        schedule=group.schedule,
        createdAt=group.created_at,
        students=student_rows,
        members=student_rows,
        analytics=group_analytics,
    )


def create(actor, data=None):
    # Support both create(actor, data) and create(payload, actor=...) signatures
    if isinstance(actor, dict) and (data is None or hasattr(data, 'role')):
        actor, data = data, actor
    data = dict(data or {})
    teacher_id = data.get('teacherId')
    if not teacher_id and actor is not None and getattr(actor, 'role', None) == 'teacher':
        teacher_id = actor.id
        data['teacherId'] = teacher_id
    elif teacher_id:
        if not (actor is not None and getattr(actor, 'role', None) == 'teacher' and teacher_id == getattr(actor, 'id', None)):
            assert_teacher(teacher_id)
    with transaction.atomic():
        group = Group.objects.create(
            id=str(uuid4()),
            name=data['name'],
            teacher_id=teacher_id,
            schedule=data.get('schedule'),
            created_at=timezone.now(),
        )
        if actor is not None:
            audit(actor, 'group.create', 'group', group.id, new=dict(name=group.name, teacherId=group.teacher_id))
            return detail(actor, group.id)
        return dict(id=group.id, name=group.name, teacherId=group.teacher_id, schedule=group.schedule, createdAt=group.created_at)


@transaction.atomic
def update(actor, group_id, data):
    group = get_group(group_id, True)
    if data.get('teacherId'):
        assert_teacher(data['teacherId'])
    old = dict(name=group.name, teacherId=group.teacher_id)
    changed = []
    for key, field in [('name', 'name'), ('teacherId', 'teacher_id'), ('schedule', 'schedule')]:
        if key in data:
            setattr(group, field, data[key])
            changed.append(field)
    if changed:
        group.save(update_fields=changed)
    audit(
        actor,
        'group.update',
        'group',
        group_id,
        old=old,
        new=dict(
            name=data.get('name') if data.get('name') is not None else old['name'],
            teacherId=data.get('teacherId') if data.get('teacherId') is not None else old['teacherId'],
        ),
    )
    return detail(actor, group_id)


@transaction.atomic
def add_student(actor, group_id, student_id):
    group = get_group(group_id, True)
    if actor.role == 'teacher' and group.teacher_id != actor.id:
        fail('FORBIDDEN', 'Bu guruh sizga biriktirilmagan', 403)
    profile = StudentProfile.objects.select_for_update().filter(user_id=student_id).first()
    if profile is None:
        fail('STUDENT_NOT_FOUND', "O'quvchi topilmadi", 404)
    old = profile.group_id
    profile.group_id = group_id
    profile.save(update_fields=['group_id'])
    audit(actor, 'group.add_student', 'studentProfile', student_id, old=dict(groupId=old), new=dict(groupId=group_id))
    return dict(groupId=group_id, studentId=student_id, added=True)


@transaction.atomic
def remove_student(actor, group_id, student_id):
    group = get_group(group_id, True)
    if actor.role == 'teacher' and group.teacher_id != actor.id:
        fail('FORBIDDEN', 'Bu guruh sizga biriktirilmagan', 403)
    profile = StudentProfile.objects.select_for_update().filter(user_id=student_id).first()
    if profile is None or profile.group_id != group_id:
        fail('STUDENT_NOT_IN_GROUP', "O'quvchi bu guruhda emas", 404)
    profile.group_id = None
    profile.save(update_fields=['group_id'])
    audit(actor, 'group.remove_student', 'studentProfile', student_id, old=dict(groupId=group_id), new=dict(groupId=None))
    return dict(removed=True)


def export_group_xlsx(actor, group_id) -> tuple[bytes, str]:
    """Generate a styled Excel (.xlsx) workbook of group student exam results."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    group = get_group(group_id)
    if actor.role == 'teacher' and group.teacher_id != actor.id:
        fail('FORBIDDEN', 'Bu guruh sizga biriktirilmagan', 403)
    elif actor.role not in ('admin', 'super_admin', 'teacher'):
        fail('FORBIDDEN', 'Ruxsat berilmagan', 403)

    students = list(
        StudentProfile.objects.filter(group_id=group_id)
        .select_related('user')
        .order_by('user__name')
    )
    student_ids = [s.user_id for s in students]

    try:
        attempts = list(
            MockAttempt.objects.filter(student_id__in=student_ids)
            .select_related('exam', 'student__user')
            .order_by('student__user__name', '-finished_at', '-started_at')
        )
    except Exception:
        attempts = []

    attempt_ids = [a.id for a in attempts]
    feedback_by_attempt = {}
    if attempt_ids:
        try:
            answers = list(
                MockAnswer.objects.filter(attempt_id__in=attempt_ids)
                .exclude(feedback=None)
                .exclude(feedback='')
            )
            for ans in answers:
                feedback_by_attempt.setdefault(ans.attempt_id, []).append(ans.feedback.strip())
        except Exception:
            pass

    attempts_by_student = {}
    for att in attempts:
        attempts_by_student.setdefault(att.student_id, []).append(att)

    wb = Workbook()
    ws = wb.active
    ws.title = "Group Results"

    headers = [
        "Student Name",
        "Email / Phone",
        "Group Name",
        "Exam Type",
        "Listening",
        "Reading",
        "Writing",
        "Speaking",
        "Overall Band",
        "CEFR Level",
        "Submitted Date",
        "Teacher Feedback Summary",
    ]
    ws.append(headers)

    header_fill = PatternFill(start_color="065F46", end_color="065F46", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF", size=11)
    thin_side = Side(border_style="thin", color="D1D5DB")
    cell_border = Border(left=thin_side, right=thin_side, top=thin_side, bottom=thin_side)

    for col_idx in range(1, len(headers) + 1):
        cell = ws.cell(row=1, column=col_idx)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = cell_border

    l_vals, r_vals, w_vals, sp_vals, ov_vals = [], [], [], [], []

    def _num(val, bucket):
        if isinstance(val, (int, float)) and math.isfinite(val):
            bucket.append(float(val))
            return round(float(val), 1)
        return "-"

    for s in students:
        contact = getattr(s.user, 'email', None) or getattr(s.user, 'phone', None) or '-'
        s_atts = attempts_by_student.get(s.user_id, [])
        if not s_atts:
            ws.append([
                s.user.name,
                contact,
                group.name,
                "Not Attempted",
                "-",
                "-",
                "-",
                "-",
                "-",
                "-",
                "-",
                "No exam submissions yet",
            ])
            continue

        for att in s_atts:
            bands = getattr(att, 'section_bands', None) or {}
            exam_title = att.exam.title if getattr(att, 'exam', None) else getattr(att, 'exam_type', 'IELTS Mock')
            l_v = _num(bands.get('listening'), l_vals)
            r_v = _num(bands.get('reading'), r_vals)
            w_v = _num(bands.get('writing'), w_vals)
            sp_v = _num(bands.get('speaking'), sp_vals)
            raw_ov = getattr(att, 'overall_band', None)
            if raw_ov is None:
                raw_ov = getattr(att, 'overall_score', None)
            ov_v = _num(raw_ov, ov_vals)
            cefr = getattr(att, 'cefr_level', None) or "-"
            dt = getattr(att, 'finished_at', None) or getattr(att, 'submitted_at', None) or getattr(att, 'started_at', None)
            dt_str = dt.strftime("%Y-%m-%d %H:%M") if hasattr(dt, 'strftime') else (str(dt)[:16] if dt else "-")
            fb_list = feedback_by_attempt.get(att.id, [])
            fb_summary = " | ".join(fb_list)[:250] if fb_list else ("Completed" if getattr(att, 'status', '') == 'completed' else str(getattr(att, 'status', '-')))

            ws.append([
                s.user.name,
                contact,
                group.name,
                exam_title,
                l_v,
                r_v,
                w_v,
                sp_v,
                ov_v,
                cefr,
                dt_str,
                fb_summary,
            ])

    # Group Average Footer Row
    def _avg(bucket):
        return round(sum(bucket) / len(bucket), 1) if bucket else "-"

    footer_row = [
        "GROUP AVERAGE",
        f"{len(students)} Students",
        group.name,
        f"{len(attempts)} Attempts",
        _avg(l_vals),
        _avg(r_vals),
        _avg(w_vals),
        _avg(sp_vals),
        _avg(ov_vals),
        "-",
        timezone.now().strftime("%Y-%m-%d"),
        "Group Summary",
    ]
    ws.append(footer_row)
    footer_idx = ws.max_row
    footer_fill = PatternFill(start_color="ECFDF5", end_color="ECFDF5", fill_type="solid")
    footer_font = Font(bold=True, color="065F46")
    for col_idx in range(1, len(headers) + 1):
        c = ws.cell(row=footer_idx, column=col_idx)
        c.fill = footer_fill
        c.font = footer_font
        c.border = cell_border

    # Auto-adjust column widths
    for col_idx in range(1, len(headers) + 1):
        col_letter = get_column_letter(col_idx)
        max_len = max(
            len(str(ws.cell(row=row_idx, column=col_idx).value or ""))
            for row_idx in range(1, ws.max_row + 1)
        )
        ws.column_dimensions[col_letter].width = min(max(max_len + 4, 14), 45)

    buf = BytesIO()
    wb.save(buf)
    safe_name = re.sub(r'[^a-zA-Z0-9_\-]+', '_', group.name or 'group').strip('_') or 'group'
    date_str = timezone.now().strftime("%Y%m%d")
    filename = f"group_{safe_name}_{date_str}.xlsx"
    return buf.getvalue(), filename
