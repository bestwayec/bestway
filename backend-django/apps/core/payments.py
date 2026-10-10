"""Manual monthly payments: reference ownership, empty cells, audits and reminders."""
from uuid import uuid4
from django.db import transaction
from django.utils import timezone
from apps.legacy_schema.models import Payment, StudentProfile, ParentStudent
from common.api.exceptions import ContractAPIException
from .system_settings import audit
from .notifications import notify_many, notify_parents

UZ_MONTHS = ['yanvar','fevral','mart','aprel','may','iyun','iyul','avgust','sentabr','oktabr','noyabr','dekabr']


def teacher_students(actor):
    return list(StudentProfile.objects.filter(group__teacher_id=actor.id).values_list('user_id', flat=True))


def list_payments(actor, query):
    rows = Payment.objects.select_related('student__user')
    for key in ('year','month','state'):
        if query.get(key): rows = rows.filter(**{key: query[key]})
    requested = query.get('studentId')
    if actor.role == 'student': rows = rows.filter(student_id=actor.id)
    elif actor.role in ('parent','teacher'):
        allowed = list(ParentStudent.objects.filter(parent_user_id=actor.id).values_list('student_id',flat=True)) if actor.role == 'parent' else teacher_students(actor)
        if requested and requested not in allowed:
            message = "Bu o'quvchi sizga bog'lanmagan" if actor.role == 'parent' else "Bu o'quvchi sizning guruhingizda emas"
            raise ContractAPIException('FORBIDDEN', message, 403)
        rows = rows.filter(student_id=requested) if requested else rows.filter(student_id__in=allowed)
    elif requested: rows = rows.filter(student_id=requested)
    return [dict(studentId=p.student_id,studentName=p.student.user.name,month=p.month,year=p.year,
                 state=p.state,amount=p.amount,method=p.method,note=p.note) for p in rows.order_by('-year','-month')]


def bulk(actor, data):
    records = data['records']; ids = {r['studentId'] for r in records}
    profiles = list(StudentProfile.objects.filter(user_id__in=ids).select_related('user'))
    known = {p.user_id for p in profiles}
    if any(r['studentId'] not in known for r in records):
        raise ContractAPIException('STUDENT_NOT_FOUND', "Ro'yxatda mavjud bo'lmagan o'quvchi bor", 400)
    if actor.role == 'teacher' and not ids.issubset(set(teacher_students(actor))):
        raise ContractAPIException('FORBIDDEN', "Bu o'quvchi sizning guruhingizda emas", 403)
    if any(not p.user.is_active for p in profiles):
        raise ContractAPIException('STUDENT_BLOCKED', "Bloklangan o'quvchi uchun to'lov holatini belgilab bo'lmaydi", 400)
    existing = Payment.objects.filter(year=data['year'],student_id__in=ids,month__in={r['month'] for r in records})
    previous = {(p.student_id,p.month):dict(state=p.state,amount=p.amount) for p in existing}
    with transaction.atomic():
        # Reference partitions records: all upserts, then all clears. Duplicates
        # are intentional and must not be deduplicated or processed in input order.
        for r in records:
            if r['state'] == 'empty': continue
            key = dict(student_id=r['studentId'],month=r['month'],year=data['year'])
            stamp=timezone.now()
            changes=dict(state=r['state'],note=r.get('note'),marked_by_id=actor.id,updated_at=stamp)
            if 'amount' in r: changes['amount']=r['amount']
            # update_or_create retries a concurrent unique-key insert and locks
            # the winner, matching Prisma upsert rather than leaking a 409 race.
            Payment.objects.update_or_create(**key,defaults=changes,create_defaults={**changes,
                'amount':r.get('amount') or 0,'id':str(uuid4()),'method':'manual','created_at':stamp})
        for r in records:
            if r['state'] == 'empty': Payment.objects.filter(student_id=r['studentId'],month=r['month'],year=data['year']).delete()
    for r in records:
        old = previous.get((r['studentId'],r['month']))
        new = dict(state=r['state']) if r['state']=='empty' else dict(state=r['state'],amount=r.get('amount') or 0)
        if (r['state']=='empty' and old) or (r['state']!='empty' and old!=new):
            audit(actor,'payment.set','payment',f"{r['studentId']}:{data['year']}-{r['month']}",old=old,new=new)
    return dict(updated=len(records))


def period(data):
    now = timezone.localtime()
    return data.get('month') or now.month, data.get('year') or now.year


def debtors(actor, data):
    month,year = period(data)
    students = StudentProfile.objects.filter(user__is_active=True).select_related('user','group')
    students = students.filter(group__teacher_id=actor.id) if actor.role=='teacher' else students.filter(group_id__isnull=False)
    payments = {p.student_id:p for p in Payment.objects.filter(year=year,month=month)}
    result=[]
    for student in students:
        p = payments.get(student.user_id)
        if p and p.state=='paid': continue
        result.append(dict(studentId=student.user_id,name=student.user.name,phone=student.user.phone,
            groupName=student.group.name if student.group_id else None,state=p.state if p else 'empty',
            amount=p.amount if p else 0,note=p.note if p else None))
    return result


def remind(actor, data):
    month,year = period(data);targets=debtors(actor,dict(month=month,year=year))
    if data.get('studentIds'): targets=[d for d in targets if d['studentId'] in data['studentIds']]
    for d in targets:
        notify_many([d['studentId']],'payment_reminder',f"To'lov eslatmasi: {year}-yil {UZ_MONTHS[month-1]} oyi uchun to'lov qayd etilmagan. Iltimos, administratsiyaga murojaat qiling.")
        notify_parents(d['studentId'],'payment_reminder',f"Farzandingiz {d['name']} uchun {year}-yil {UZ_MONTHS[month-1]} oyi to'lovi qayd etilmagan.")
    audit(actor,'payment.remind','payment',new=dict(year=year,month=month,notified=len(targets)))
    return dict(notified=len(targets))
