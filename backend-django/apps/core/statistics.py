"""Administrative statistics and remaining CSV exports."""
import math
from datetime import datetime, timedelta
from django.utils import timezone
from apps.legacy_schema import models as m
from .attendance import csv_cell


def rounded(value, places=0):
    scale=10**places
    return math.floor(value*scale+0.5)/scale if places else math.floor(value+0.5)


def month_start(year,month):
    year,month=year+(month-1)//12,(month-1)%12+1
    return datetime(year,month,1,tzinfo=timezone.get_current_timezone())


def income(months=6):
    now=timezone.localtime();out=[]
    for index in range(months-1,-1,-1):
        stamp=month_start(now.year,now.month-index)
        rows=list(m.Payment.objects.filter(year=stamp.year,month=stamp.month,state__in=['paid','partial']))
        out.append(dict(month=stamp.month,year=stamp.year,income=sum(r.amount for r in rows),paidCount=sum(r.state=='paid' for r in rows)))
    return out


def dashboard():
    now=timezone.localtime();today=now.date()
    active=m.StudentProfile.objects.filter(user__is_active=True)
    attendance=list(m.Attendance.objects.filter(date=today).values_list('state',flat=True))
    payments=m.Payment.objects.filter(year=now.year,month=now.month)
    present=attendance.count('present');late=attendance.count('late')
    paid_ids=payments.filter(state='paid').values_list('student_id',flat=True)
    return dict(students=active.count(),approvedStudents=active.filter(is_approved=True).count(),
        teachers=m.User.objects.filter(role='teacher',is_active=True).count(),parents=m.User.objects.filter(role='parent',is_active=True).count(),
        groups=m.Group.objects.count(),tests=m.Test.objects.filter(is_active=True).count(),videos=m.VideoLesson.objects.count(),
        mock=dict(exams=m.MockExam.objects.filter(is_published=True).count(),gradingQueue=m.MockAttempt.objects.filter(status='grading').count(),pendingPurchases=m.MockPurchase.objects.filter(status='pending_confirmation').count()),
        today=dict(date=today.isoformat(),marked=len(attendance),present=present,absent=attendance.count('absent'),late=late,attendanceRate=rounded((present+late)/len(attendance)*100) if attendance else None),
        month=dict(month=now.month,year=now.year,income=sum(payments.filter(state__in=['paid','partial']).values_list('amount',flat=True)),paidCount=payments.filter(state='paid').count(),debtors=active.filter(group_id__isnull=False).exclude(user_id__in=paid_ids).count()),
        queue=dict(grading=m.TestAttempt.objects.filter(status='grading').count(),pendingPurchases=m.VideoPurchase.objects.filter(status='pending_confirmation').count()))


def exam_activity(range='7d'):
    now=timezone.localtime();day=now.replace(hour=0,minute=0,second=0,microsecond=0)
    if range=='today': buckets=[(day+timedelta(hours=h),day+timedelta(hours=h+1)) for h in builtins_range(24)]
    elif range in ('7d','30d'):
        days=7 if range=='7d' else 30;first=day-timedelta(days=days-1)
        buckets=[(first+timedelta(days=i),first+timedelta(days=i+1)) for i in builtins_range(days)]
    elif range in ('3m','6m'):
        weeks=13 if range=='3m' else 26;monday=day-timedelta(days=day.weekday())
        buckets=[(monday-timedelta(weeks=i),monday-timedelta(weeks=i-1)) for i in builtins_range(weeks-1,-1,-1)]
    else: buckets=[(month_start(now.year,month),month_start(now.year,month+1)) for month in builtins_range(1,now.month+1)]
    attempts=list(m.TestAttempt.objects.filter(started_at__gte=buckets[0][0]))
    def avg(rows):
        values=[row.total_score if row.total_score is not None else row.auto_score for row in rows]
        values=[v for v in values if v is not None and math.isfinite(v)]
        return rounded(sum(values)/len(values),1) if values else None
    data=[]
    for start,end in buckets:
        rows=[r for r in attempts if start<=r.started_at<end]
        data.append(dict(key=start.strftime('%Y-%m-%dT%H:%M:00'),started=len(rows),completed=sum(r.status=='completed' for r in rows),avgScore=avg(rows)))
    started=sum(r['started'] for r in data);completed=sum(r['completed'] for r in data)
    # Source overall average includes all fetched future attempts, unlike buckets.
    return dict(range=range,buckets=data,totals=dict(started=started,completed=completed,avgScore=avg(attempts),completionRate=rounded(completed/started*100,1) if started else 0))


from builtins import range as builtins_range


def csv(headers,rows):
    return '\ufeff'+'\r\n'.join(';'.join(csv_cell(cell) for cell in row) for row in [headers,*rows])


def students_csv(group_id=None):
    rows=m.StudentProfile.objects.filter(user__is_active=True).select_related('user','group').order_by('user__name')
    if group_id: rows=rows.filter(group_id=group_id)
    out=[]
    for row in rows:
        parent_ids=list(m.ParentStudent.objects.filter(student_id=row.user_id).values_list('parent_user_id',flat=True))
        parents=list(m.User.objects.filter(id__in=parent_ids))
        out.append([row.user.name,row.user.phone,row.group.name if row.group_id else '',row.current_points,'Ha' if row.is_approved else "Yo'q",
            ', '.join(p.name for p in parents),', '.join(p.phone for p in parents),row.user.created_at.isoformat()[:10]])
    return csv(['Ism','Telefon','Guruh','Ball','Tasdiqlangan','Ota-ona','Ota-ona tel',"Ro'yxatdan o'tgan"],out)


def payments_csv(year,month=None):
    rows=m.Payment.objects.filter(year=year).select_related('student__user','student__group').order_by('month','student__user__name')
    if month: rows=rows.filter(month=month)
    names=dict(m.User.objects.values_list('id','name'))
    return csv(['Oy','Yil','Ism','Telefon','Guruh','Holat','Summa','Izoh','Kim belgiladi'],[
        [r.month,r.year,r.student.user.name,r.student.user.phone,r.student.group.name if r.student.group_id else '',
         {'paid':"To'langan",'unpaid':"To'lanmagan",'partial':'Qisman'}.get(r.state,r.state),r.amount,r.note or '',names.get(r.marked_by_id,'')] for r in rows])
