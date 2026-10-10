"""Reference mock entitlement, staff controls and persisted result support."""
from datetime import timedelta
from django.db import connection, transaction, IntegrityError
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from apps.legacy_schema.models import MockExam, MockPurchase, MockAttempt, Notification
from .mock_attempts import fail, assert_view, assert_in_progress, aware, iso, summary, SKILLS
from .mock_authoring import new_id, audit_event
from .mock_catalog import access_for, student_title


def notify(user_id,text):
    Notification.objects.create(id=new_id(),user_id=user_id,type='announcement',text=text,read=False,created_at=timezone.now())


def create_purchase(user_id,exam,**values):
    now=timezone.now()
    return MockPurchase.objects.create(id=new_id(),user_id=user_id,exam_id=exam.id,method='manual',amount=exam.price,created_at=now,updated_at=now,**values)


@transaction.atomic
def purchase(actor,exam_id):
    exam=MockExam.objects.select_for_update().filter(id=exam_id).first()
    if exam is None or not (exam.is_published or exam.is_demo):
        fail('MOCK_EXAM_NOT_FOUND','Mock imtihon topilmadi',404)
    if access_for(actor,exam)=='granted': fail('MOCK_ALREADY_ACCESSIBLE','Bu imtihon sizga allaqachon ochiq')
    row=MockPurchase.objects.filter(user_id=actor.id,exam_id=exam_id).first()
    if row is None: row=create_purchase(actor.id,exam,status='pending_confirmation')
    elif row.status!='purchased':
        row.status='pending_confirmation'; row.amount=exam.price; row.updated_at=timezone.now()
        row.save(update_fields=['status','amount','updated_at'])
    audit_event(actor,'mock.purchase.request','mockPurchase',row.id,new=dict(examId=exam_id,amount=exam.price))
    return dict(status=row.status,amount=row.amount)


@transaction.atomic
def confirm(actor,exam_id,user_id):
    exam=MockExam.objects.select_for_update().filter(id=exam_id).first()
    if exam is None: fail('MOCK_EXAM_NOT_FOUND','Mock imtihon topilmadi',404)
    row=MockPurchase.objects.filter(user_id=user_id,exam_id=exam_id).first()
    try:
        if row is None: row=create_purchase(user_id,exam,status='purchased',confirmed_by_id=actor.id)
        else:
            row.status='purchased'; row.confirmed_by_id=actor.id; row.updated_at=timezone.now()
            row.save(update_fields=['status','confirmed_by_id','updated_at'])
    except IntegrityError as error:
        if getattr(error.__cause__,'sqlstate',None)=='23503': fail('FOREIGN_KEY_VIOLATION',"Bog'liq yozuv topilmadi")
        raise
    audit_event(actor,'mock.purchase.confirm','mockPurchase',row.id,new=dict(userId=user_id,examId=exam_id))
    notify(user_id,f'"{student_title(exam.title)}" mock imtihoni siz uchun ochildi. Omad!')
    return dict(confirmed=True)


@transaction.atomic
def reject(actor,exam_id,user_id):
    # Match the request/confirm lock ordering; never silently delete purchased.
    MockExam.objects.select_for_update().filter(id=exam_id).first()
    row=MockPurchase.objects.select_related('exam').filter(user_id=user_id,exam_id=exam_id).first()
    if row is None or row.status!='pending_confirmation': fail('MOCK_PURCHASE_NOT_PENDING','Kutilayotgan xarid topilmadi',404)
    key=row.id; title=row.exam.title; row.delete()
    audit_event(actor,'mock.purchase.reject','mockPurchase',key,new=dict(userId=user_id,examId=exam_id))
    notify(user_id,f'"{student_title(title)}" mock imtihoni xarid so\'rovingiz rad etildi. Tafsilotlar uchun admin bilan bog\'laning.')
    return dict(rejected=True)


def paginate(rows,query,shape):
    page,limit=query['page'],query['limit']
    total=rows.count()
    return [shape(row) for row in rows[(page-1)*limit:page*limit]],dict(page=page,limit=limit,total=total)


def purchases(query):
    rows=MockPurchase.objects.select_related('user','exam').order_by('-created_at')
    if query.get('status'): rows=rows.filter(status=query['status'])
    def shape(p):
        return dict(id=p.id,userId=p.user_id,userName=p.user.name,userPhone=p.user.phone,examId=p.exam_id,
            examTitle=p.exam.title,amount=p.amount,status=p.status,createdAt=p.created_at)
    return paginate(rows,query,shape)


def history(actor,query):
    rows=MockAttempt.objects.select_related('exam','student__user').order_by('-started_at')
    for key,field in [('status','status'),('studentId','student_id'),('examId','exam_id')]:
        if query.get(key): rows=rows.filter(**{field:query[key]})
    if query.get('program'): rows=rows.filter(exam__type__in=['multilevel'] if query['program']=='MULTILEVEL' else ['ielts_academic','ielts_general'])
    if actor.role=='teacher': rows=rows.filter(student__group__teacher_id=actor.id)
    def shape(a):
        value=summary(a,detail=True); value['examTitle']=a.exam.title
        return value
    return paginate(rows,query,shape)


def locked(actor,attempt_id):
    row=MockAttempt.objects.select_for_update().filter(id=attempt_id).first()
    if row is None: fail('MOCK_ATTEMPT_NOT_FOUND','Urinish topilmadi',404)
    assert_view(actor,row.student_id)
    return row


@transaction.atomic
def extend(actor,attempt_id,minutes):
    row=locked(actor,attempt_id); assert_in_progress(row)
    def shift(value): return aware(value)+timedelta(minutes=minutes) if value else value
    row.deadline_at=shift(row.deadline_at); row.overall_deadline_at=shift(row.overall_deadline_at)
    if row.section_deadlines is not None:
        row.section_deadlines={k:iso(shift(parse_datetime(v))) for k,v in row.section_deadlines.items()}
    row.save(update_fields=['deadline_at','overall_deadline_at','section_deadlines'])
    audit_event(actor,'mock.attempt.extend','mockAttempt',row.id,new=dict(minutes=minutes))
    return dict(saved=True,deadlineAt=row.deadline_at,overallDeadlineAt=row.overall_deadline_at,
        sectionDeadlines=row.section_deadlines,serverTime=timezone.now())


@transaction.atomic
def reopen(actor,attempt_id):
    row=locked(actor,attempt_id)
    if row.status!='grading': fail('MOCK_CANNOT_REOPEN','Faqat baholanayotgan urinish qayta ochiladi')
    row.status='in_progress'; row.submitted_at=None; row.save(update_fields=['status','submitted_at'])
    audit_event(actor,'mock.attempt.reopen','mockAttempt',row.id)
    return dict(saved=True,status='in_progress')


@transaction.atomic
def delete(actor,attempt_id):
    row=MockAttempt.objects.select_for_update().filter(id=attempt_id).first()
    if row is None: fail('MOCK_ATTEMPT_NOT_FOUND','Urinish topilmadi',404)
    # Existing PostgreSQL foreign keys own the complete cascade, including jobs.
    with connection.cursor() as cursor:
        cursor.execute('DELETE FROM "MockAnswer" WHERE "attemptId"=%s',[attempt_id])
        cursor.execute('DELETE FROM "MockCheatEvent" WHERE "attemptId"=%s',[attempt_id])
        cursor.execute('DELETE FROM "MockAttempt" WHERE id=%s',[attempt_id])
    audit_event(actor,'mock.attempt.delete','mockAttempt',attempt_id,old=dict(studentId=row.student_id,examId=row.exam_id))
    return dict(deleted=True)


def certificate_data(actor,attempt_id):
    row=MockAttempt.objects.select_related('exam','student__user').filter(id=attempt_id).first()
    if row is None: fail('MOCK_ATTEMPT_NOT_FOUND','Urinish topilmadi',404)
    assert_view(actor,row.student_id)
    if row.status!='completed': fail('MOCK_ATTEMPT_NOT_COMPLETED','Natija hali tayyor emas')
    sections=[dict(skill=skill,score=raw['score'],max=raw['max'],band=(row.section_bands or {}).get(skill),
        standardScore=(row.standard_scores or {}).get(skill,{}).get('estimatedStandardScore'))
        for skill in SKILLS if (raw:=(row.raw_scores or {}).get(skill))]
    return dict(studentName=row.student.user.name,examTitle=student_title(row.exam.title) if actor.role=='student' else row.exam.title,
        examType=row.exam.type,level=row.exam.level,isIelts=row.exam.type!='multilevel',finishedAt=row.finished_at or timezone.now(),
        attemptId=row.id,sections=sections,overallBand=row.overall_band,overallScore=row.overall_score,
        specificationVersion=row.specification_version,cefrLevel=row.cefr_level)
