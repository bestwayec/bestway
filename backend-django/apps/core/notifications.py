"""In-app notifications, audiences, parent delivery and asynchronous Telegram."""
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4
from django.db import transaction, close_old_connections
from django.utils import timezone
from apps.legacy_schema.models import Notification,User,StudentProfile,ParentStudent,Payment
from common.api.exceptions import ContractAPIException
from . import telegram_delivery
from .system_settings import audit

_delivery=ThreadPoolExecutor(max_workers=4,thread_name_prefix='bestway-telegram')
HEADS=dict(points="🏆 <b>Ball o'zgardi</b>",attendance='📅 <b>Davomat</b>',payment_reminder="💰 <b>To'lov eslatmasi</b>",test_result='📝 <b>Test natijasi</b>',announcement="📢 <b>E'lon</b>",game="🎮 <b>Oylik o'yin</b>")


def decorate(kind,text):
    safe=text.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')
    return HEADS[kind]+'\n'+'➖'*9+'\n\n'+safe


def deliver(user_ids,kind,text):
    close_old_connections()
    try:
        for chat_id in User.objects.filter(id__in=user_ids,telegram_chat_id__isnull=False).values_list('telegram_chat_id',flat=True):
            telegram_delivery.send(chat_id,decorate(kind,text))
    except Exception:logging.getLogger(__name__).warning('Notification Telegram delivery failed')
    finally:close_old_connections()


@transaction.atomic
def notify_many(user_ids,kind,text):
    unique=list(dict.fromkeys(uid for uid in user_ids if uid))
    if not unique:return
    stamp=timezone.now()
    # The shared Prisma schema uses a PostgreSQL enum, not varchar. Django's
    # multi-row UNNEST optimization casts this unmanaged CharField to varchar[].
    # Single-row batches let PostgreSQL infer the enum from the destination.
    Notification.objects.bulk_create([Notification(id=str(uuid4()),user_id=uid,type=kind,text=text,read=False,created_at=stamp) for uid in unique], batch_size=1)
    if os.environ.get('TELEGRAM_BOT_TOKEN'):
        transaction.on_commit(lambda:_delivery.submit(deliver,unique,kind,text))


def notify_parents(student_id,kind,text):
    notify_many(ParentStudent.objects.filter(student_id=student_id).values_list('parent_user_id',flat=True),kind,text)


def safe_notify(user_id,kind,text):
    try:
        with transaction.atomic():notify_many([user_id],kind,text)
    except Exception:logging.getLogger(__name__).warning('In-app notification failed')


def safe_notify_parents(student_id,kind,text):
    try:
        with transaction.atomic():notify_parents(student_id,kind,text)
    except Exception:logging.getLogger(__name__).warning('Parent notification failed')


@transaction.atomic
def broadcast(actor,data):
    audience=data['audience'];students=[]
    if audience=='all':users=User.objects.filter(is_active=True).values_list('id',flat=True)
    elif audience=='role':
        if not data.get('role'):raise ContractAPIException('ROLE_REQUIRED','Rol tanlanmagan',400)
        users=User.objects.filter(is_active=True,role=data['role']).values_list('id',flat=True)
    else:
        rows=StudentProfile.objects.filter(user__is_active=True)
        if audience=='group':
            if not data.get('groupId'):raise ContractAPIException('GROUP_ID_REQUIRED','Guruh tanlanmagan',400)
            rows=rows.filter(group_id=data['groupId'])
        else:
            now=timezone.localtime()
            paid=Payment.objects.filter(year=now.year,month=now.month,state='paid').values_list('student_id',flat=True)
            rows=rows.filter(group_id__isnull=False).exclude(user_id__in=paid)
        students=list(rows.values_list('user_id',flat=True));users=list(students)
        if data.get('includeParents') and students:
            users+=list(ParentStudent.objects.filter(student_id__in=students).values_list('parent_user_id',flat=True))
    unique=list(dict.fromkeys(users));notify_many(unique,'announcement',data['text'])
    new=dict(audience=audience,notified=len(unique),text=data['text'][:200])
    for key in ('role','groupId'):
        if key in data:new[key]=data[key]
    audit(actor,'notification.broadcast','notification',new=new)
    return dict(notified=len(unique))


def list_notifications(actor,query):
    rows=Notification.objects.filter(user_id=actor.id)
    if query.get('unreadOnly') in (True,'true','1'):rows=rows.filter(read=False)
    if query.get('type'):rows=rows.filter(type=query['type'])
    total=rows.count();start=(query['page']-1)*query['limit']
    return [dict(id=n.id,type=n.type,text=n.text,read=n.read,date=n.created_at) for n in rows.order_by('-created_at')[start:start+query['limit']]],total


@transaction.atomic
def mark_read(actor,notification_id):
    row=Notification.objects.select_for_update().filter(id=notification_id,user_id=actor.id).first()
    if row is None:raise ContractAPIException('NOTIFICATION_NOT_FOUND','Bildirishnoma topilmadi',404)
    if not row.read:row.read=True;row.save(update_fields=['read'])
    return dict(read=True)
