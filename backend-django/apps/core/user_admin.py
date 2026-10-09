"""User administration with source DTOs and exact non-atomic update boundaries."""
import bcrypt
import re
from uuid import uuid4
from django.db import connection, transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from common.auth.permissions import Authenticated
from common.api.exceptions import ContractAPIException
from apps.legacy_schema.models import User, StudentProfile, PointsLog, Group, RefreshToken
from .views import require_role, _user_detail, ROLES
from .domain_contracts import payload, pagination, paginated, invalid,js_length
from .mock_attempt_views import success
from .system_settings import audit, numeric_settings
from .auth_service import unique_link_code


def validate(data, update=False):
    for key,low,high in [('name',2,100),('password',8,72)]:
        if update and (key not in data or data[key] is None): continue
        value=data.get(key)
        if not isinstance(value,str) or js_length(value)>high: invalid(f'{key} must be shorter than or equal to {high} characters')
        if js_length(value)<low: invalid(f'{key} must be longer than or equal to {low} characters')
    if not update or ('phone' in data and data['phone'] is not None):
        if not isinstance(data.get('phone'),str) or not re.fullmatch(r'\+?[0-9]{9,15}',data['phone']):
            invalid("Telefon raqam formati noto'g'ri (masalan +998901234567)")
    if not update or ('role' in data and data['role'] is not None):
        if data.get('role') not in ROLES: invalid('role must be one of the following values: super_admin, admin, teacher, student, parent')
    for key in ('isActive','isApproved'):
        if key in data and data[key] is not None and not isinstance(data[key],bool): invalid(f'{key} must be a boolean value')
    for key in ('groupId','telegramChatId'):
        if key in data and data[key] is not None and not isinstance(data[key],str): invalid(f'{key} must be a string')
    return data


def detail(actor, identifier):
    from .mock_attempt_views import wire
    with connection.cursor() as cursor: return wire(_user_detail(cursor,actor,identifier))


def group_exists(identifier):
    if identifier and not Group.objects.filter(id=identifier).exists(): raise ContractAPIException('GROUP_NOT_FOUND','Guruh topilmadi',404)


def create(actor,data):
    if data['role']=='super_admin': raise ContractAPIException('FORBIDDEN',"Super admin yaratib bo'lmaydi",403)
    if data['role']=='admin' and actor.role!='super_admin': raise ContractAPIException('FORBIDDEN',"Admin qo'shish huquqi faqat super adminda",403)
    if User.objects.filter(phone=data['phone']).exists(): raise ContractAPIException('PHONE_TAKEN',"Bu telefon raqam allaqachon ro'yxatdan o'tgan",409)
    group_exists(data.get('groupId'))
    hashed=bcrypt.hashpw(data['password'].encode(),bcrypt.gensalt(rounds=12)).decode()
    initial=numeric_settings()['initialPoints']
    identifier=str(uuid4())
    with transaction.atomic():
        User.objects.create(id=identifier,name=data['name'],phone=data['phone'],password_hash=hashed,role=data['role'],is_active=True,created_at=timezone.now(),updated_at=timezone.now())
        if data['role']=='student':
            with connection.cursor() as cursor: code=unique_link_code(cursor)
            with connection.cursor() as cursor:
                cursor.execute('''INSERT INTO "StudentProfile" ("userId","groupId","currentPoints","linkCode","availablePrograms","activeProgram")
                    VALUES (%s,%s,%s,%s,ARRAY['IELTS']::"ExamProgram"[],'IELTS'::"ExamProgram")''',[identifier,data.get('groupId'),initial,code])
            PointsLog.objects.create(id=str(uuid4()),student_id=identifier,change=initial,reason="Boshlang'ich ball",created_at=timezone.now())
    audit(actor,'user.create','user',identifier,new={k:data[k] for k in ('name','phone','role')})
    return detail(actor,identifier)


def update(actor,identifier,data):
    user=User.objects.filter(id=identifier).first()
    if user is None: raise ContractAPIException('USER_NOT_FOUND','Foydalanuvchi topilmadi',404)
    student=StudentProfile.objects.filter(user_id=identifier).first()
    if user.role=='super_admin' and actor.role!='super_admin': raise ContractAPIException('FORBIDDEN','Super adminni faqat super admin tahrirlaydi',403)
    if 'role' in data and actor.role!='super_admin': raise ContractAPIException('FORBIDDEN',"Rolni faqat super admin o'zgartira oladi",403)
    if data.get('role')=='super_admin': raise ContractAPIException('FORBIDDEN','super_admin rolini berish mumkin emas',403)
    if data.get('phone') and data['phone']!=user.phone and User.objects.filter(phone=data['phone']).exists(): raise ContractAPIException('PHONE_TAKEN','Bu telefon raqam band',409)
    old=dict(name=user.name,phone=user.phone,role=user.role,isActive=user.is_active)
    if student: old.update(isApproved=student.is_approved,groupId=student.group_id)
    if 'isApproved' in data or 'groupId' in data:
        if student is None: raise ContractAPIException('NOT_A_STUDENT',"Bu foydalanuvchi o'quvchi emas",400)
        group_exists(data.get('groupId'))
        values={column:data[key] for key,column in [('isApproved','is_approved'),('groupId','group_id')] if key in data}
        StudentProfile.objects.filter(user_id=identifier).update(**values)
    values={column:data[key] for key,column in [('name','name'),('phone','phone'),('role','role'),('isActive','is_active'),('telegramChatId','telegram_chat_id')] if key in data}
    if data.get('password'): values['password_hash']=bcrypt.hashpw(data['password'].encode(),bcrypt.gensalt(rounds=12)).decode()
    if values: User.objects.filter(id=identifier).update(**values,updated_at=timezone.now())
    new={key:(data[key] if data.get(key) is not None else old[key]) for key in old}
    if 'groupId' in data: new['groupId']=data['groupId']
    new['passwordChanged']=bool(data.get('password'))
    audit(actor,'user.update','user',identifier,old=old,new=new)
    return detail(actor,identifier)


def deactivate(actor,identifier):
    user=User.objects.filter(id=identifier).first()
    if user is None: raise ContractAPIException('USER_NOT_FOUND','Foydalanuvchi topilmadi',404)
    if user.role=='super_admin': raise ContractAPIException('FORBIDDEN',"Super adminni o'chirib bo'lmaydi",403)
    if identifier==actor.id: raise ContractAPIException('FORBIDDEN',"O'z akkauntingizni o'chira olmaysiz",403)
    User.objects.filter(id=identifier).update(is_active=False,updated_at=timezone.now())
    RefreshToken.objects.filter(user_id=identifier).delete()
    audit(actor,'user.deactivate','user',identifier,old=dict(isActive=True),new=dict(isActive=False))
    return dict(deactivated=True)


@api_view(['GET','POST'])
@permission_classes([Authenticated])
def users(request):
    require_role(request,'admin','super_admin')
    if request.method=='POST': return success(create(request.user,validate(payload(request,{'name','phone','password','role','groupId'}))),201)
    q=pagination(request,{'role','groupId','search'})
    if q.get('role') and q['role'] not in ROLES: invalid('role must be one of the following values: super_admin, admin, teacher, student, parent')
    rows=User.objects.all()
    if q.get('role'): rows=rows.filter(role=q['role'])
    if q.get('groupId'): rows=rows.filter(id__in=StudentProfile.objects.filter(group_id=q['groupId']).values('user_id'))
    if q.get('search'): rows=rows.filter(Q(name__icontains=q['search'])|Q(phone__contains=q['search']))
    total=rows.count();start=(q['page']-1)*q['limit']
    # List shapes omit parent children/teacher groups, unlike detail.
    from .views import _lookup_user, _user_shape
    with connection.cursor() as cursor: items=[_user_shape(_lookup_user(cursor,user.id),True) for user in rows.order_by('-created_at')[start:start+q['limit']]]
    return paginated(items,q['page'],q['limit'],total)


@api_view(['GET','PATCH','DELETE'])
@permission_classes([Authenticated])
def user(request,user_id):
    if request.method=='GET': return success(detail(request.user,user_id))
    require_role(request,*(['super_admin'] if request.method=='DELETE' else ['admin','super_admin']))
    if request.method=='DELETE': return success(deactivate(request.user,user_id))
    data=validate(payload(request,{'name','phone','password','role','isActive','isApproved','groupId','telegramChatId'}),True)
    return success(update(request.user,user_id,data))
