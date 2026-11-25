"""Group monitoring based on recorded results and attendance."""
from collections import defaultdict
from datetime import timedelta

from django.utils import timezone

from apps.legacy_schema.models import Attendance, MockAttempt, StudentProfile, User
from common.api.exceptions import ContractAPIException
from .groups import get_group


def get_group_analytics(actor: User, group_id: str) -> dict:
    group = get_group(group_id)
    if actor.role not in ('admin', 'super_admin') and not (actor.role == 'teacher' and group.teacher_id == actor.id):
        raise ContractAPIException('FORBIDDEN', 'Bu guruh sizga biriktirilmagan', 403)

    profiles = list(StudentProfile.objects.filter(group_id=group_id).select_related('user').order_by('user__name'))
    ids = [profile.user_id for profile in profiles]
    attempts = list(MockAttempt.objects.filter(student_id__in=ids, status='completed').select_related('exam').order_by('-finished_at'))
    attendance = Attendance.objects.filter(group_id=group_id, date__gte=timezone.localdate() - timedelta(days=30))
    by_student = defaultdict(list)
    records = defaultdict(list)
    for attempt in attempts:
        by_student[attempt.student_id].append(attempt)
    for record in attendance:
        records[record.student_id].append(record)

    students = []
    group_scores = defaultdict(list)
    for profile in profiles:
        user = profile.user
        own = by_student[profile.user_id]
        scores = defaultdict(list)
        for attempt in own:
            exam_type = attempt.exam.type
            if exam_type in ('ielts_academic', 'ielts_general') and attempt.overall_band is not None:
                scores[exam_type].append(attempt.overall_band)
            elif exam_type == 'multilevel' and attempt.overall_score is not None:
                scores[exam_type].append(attempt.overall_score)
        averages = {scale: round(sum(values) / len(values), 1) for scale, values in scores.items()}
        for scale, value in averages.items():
            group_scores[scale].append(value)
        average = next(iter(averages.values())) if len(averages) == 1 else None
        attendance_rows = records[profile.user_id]
        attendance_rate = round(100 * sum(1 if row.state == 'present' else .5 if row.state == 'late' else 0 for row in attendance_rows) / len(attendance_rows)) if attendance_rows else None
        last = max((a.finished_at for a in own if a.finished_at), default=None)
        students.append(dict(studentId=profile.user_id, name=user.name, phone=user.phone or '', isActive=user.is_active,
            points=profile.current_points, mockAttemptsCount=len(own), essaysCount=sum('writing' in (a.submitted_sections or []) for a in own),
            averageScore=average, scoresByScale=averages, scoreLabel=f'{average:.1f}' if average is not None else '—',
            attendanceRate=attendance_rate, lastActiveAt=last.isoformat() if last else None))
    scale_averages = {scale: round(sum(values) / len(values), 1) for scale, values in group_scores.items()}
    rates = [student['attendanceRate'] for student in students if student['attendanceRate'] is not None]
    return dict(groupId=group.id, groupName=group.name, teacherName=group.teacher.name if group.teacher else '',
        totalStudents=len(profiles), groupAverageScore=next(iter(scale_averages.values())) if len(scale_averages) == 1 else None,
        groupAveragesByScale=scale_averages, groupAverageAttendance=round(sum(rates) / len(rates)) if rates else None,
        totalMockAttempts=len(attempts), totalEssays=sum(student['essaysCount'] for student in students), students=students,
        weakTopicsHeatmap=[], updatedAt=timezone.now().isoformat())
