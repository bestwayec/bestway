from django.utils import timezone
from apps.legacy_schema import models as m
from .telegram_links import escape,find
from . import telegram_delivery as api

MONTHS=['yanvar','fevral','mart','aprel','may','iyun','iyul','avgust','sentabr','oktabr','noyabr','dekabr']
BTN=dict(points='🏆 Ballarim',attendance='📅 Davomatim',payment="💰 To'lovlarim",results='📝 Natijalarim',children='👨‍👩‍👦 Farzandlarim',groups='👥 Guruhlarim',grading='✍️ Baholash navbati',today='📊 Bugungi holat',debtors='💸 Qarzdorlar',help='ℹ️ Yordam')
LABEL=dict(present='✅ Keldi',absent='❌ Kelmadi',late='⏰ Kechikdi',paid="✅ To'langan",unpaid="❌ To'lanmagan",partial="🟡 Qisman to'langan",in_progress='⏳ Topshirilmoqda',grading='✍️ Baholanmoqda',completed='✅ Tayyor')
def label(value):return LABEL.get(value,value)
def money(number):return f'{number:,}'.replace(',',' ')+" so'm"
def date_uz(value):
    if hasattr(value,'tzinfo') and value.tzinfo:value=timezone.localtime(value)
    return f'{value.day}-{MONTHS[value.month-1]}'
def menu_for(role):
    rows=[['points','attendance'],['payment','results'],['help']] if role=='student' else [['children'],['attendance','payment'],['points','results'],['help']] if role=='parent' else [['groups','grading'],['help']] if role=='teacher' else [['today','debtors'],['help']]
    return dict(keyboard=[[dict(text=BTN[key]) for key in row] for row in rows],resize_keyboard=True)
def show(chat_id,role,name):api.menu(chat_id,f'👋 Xush kelibsiz, <b>{escape(name)}</b>!\n\nQuyidagi tugmalardan foydalaning:',menu_for(role))
def no_children(role):return "👨‍👩‍👦 Sizga hali farzand bog'lanmagan.\n\nSaytga kiring → <b>Farzandni ulash</b> → o'quvchining 8 belgili kodini kiriting." if role=='parent' else "ℹ️ Bu bo'lim faqat o'quvchi va ota-onalar uchun."
def targets(user):
    if user.role=='student':return [user]
    if user.role=='parent':
        ids=m.ParentStudent.objects.filter(parent_user_id=user.id).values_list('student_id',flat=True)
        return list(m.User.objects.filter(id__in=ids))
    return []
def text_for(user,key):
    now=timezone.localtime();first=now.date().replace(day=1)
    if key in ('points','attendance','payment','results'):
        kids=targets(user)
        if not kids:return no_children(user.role)
        parts=[]
        for kid in kids:
            if key=='points':
                profile=m.StudentProfile.objects.filter(user_id=kid.id).first()
                if not profile:continue
                logs=m.PointsLog.objects.filter(student_id=kid.id).order_by('-created_at')[:5]
                history='\n'.join(f'   {"➕" if r.change>0 else "➖"} {abs(r.change)} — {r.reason} <i>({date_uz(r.created_at)})</i>' for r in logs)
                parts.append(f'🏆 <b>{escape(kid.name)}</b>\nJoriy ball: <b>{profile.current_points}</b>\n\n<u>Oxirgi o\'zgarishlar:</u>\n'+(history or "   — hali yozuv yo'q"))
            elif key=='attendance':
                rows=list(m.Attendance.objects.filter(student_id=kid.id,date__year=now.year,date__month=now.month).order_by('-date'))
                last='\n'.join(f'   {date_uz(r.date)} — {label(r.state)}' for r in rows[:7])
                parts.append(f'📅 <b>{escape(kid.name)}</b> — {MONTHS[now.month-1]} oyi\n✅ Keldi: <b>{sum(r.state=="present" for r in rows)}</b>   ❌ Kelmadi: <b>{sum(r.state=="absent" for r in rows)}</b>   ⏰ Kechikdi: <b>{sum(r.state=="late" for r in rows)}</b>\n\n<u>Oxirgi darslar:</u>\n'+(last or "   — yozuv yo'q"))
            elif key=='payment':
                rows=list(m.Payment.objects.filter(student_id=kid.id,year=now.year).order_by('month'));debt=sum(r.state!='paid' for r in rows)
                lines='\n'.join(f'   {MONTHS[r.month-1]}: {label(r.state)}'+(f' — {money(r.amount)}' if r.amount else '') for r in rows)
                end=f"⚠️ To'lanmagan oylar: <b>{debt}</b> ta.\nSavollar bo'lsa administratsiyaga murojaat qiling." if debt else "✅ Barcha to'lovlar joyida. Rahmat!"
                parts.append(f'💰 <b>{escape(kid.name)}</b> — {now.year}-yil\n\n'+(lines or "   — to'lov yozuvi yo'q")+'\n\n'+end)
            else:
                rows=m.TestAttempt.objects.filter(student_id=kid.id).select_related('test').order_by('-started_at')[:5]
                lines='\n'.join(f'   {escape(r.test.title)}\n      {label(r.status)}'+(f' — <b>{format(r.total_score,"g") if r.total_score is not None else "null"}</b> ball' if r.status=='completed' else '')+f' <i>({date_uz(r.started_at)})</i>' for r in rows)
                parts.append(f'📝 <b>{escape(kid.name)}</b> — oxirgi testlar\n\n'+(lines or '   — hali test topshirilmagan'))
        return '\n\n➖➖➖➖➖\n\n'.join(parts)
    if key=='children':
        rows=m.ParentStudent.objects.filter(parent_user_id=user.id).select_related('student__user','student__group');parts=[]
        for row in rows:
            s=row.student;absent=m.Attendance.objects.filter(student_id=s.user_id,state='absent',date__gte=first).count();unpaid=m.Payment.objects.filter(student_id=s.user_id,year=now.year).exclude(state='paid').count()
            parts.append(f'👤 <b>{escape(s.user.name)}</b>\n   Guruh: {escape(s.group.name if s.group_id else "— (guruhga biriktirilmagan)")}\n   Ball: <b>{s.current_points}</b>\n   Bu oy kelmagan kunlar: <b>{absent}</b>\n   To\'lanmagan oylar: <b>{unpaid}</b>')
        return '👨‍👩‍👦 <b>Farzandlaringiz</b>\n\n'+'\n\n'.join(parts)+'\n\n<i>Batafsil: pastdagi tugmalar.</i>' if parts else no_children('parent')
    if key=='groups':
        parts=[]
        for group in m.Group.objects.filter(teacher_id=user.id):
            count=m.StudentProfile.objects.filter(group_id=group.id).count();marked=m.Attendance.objects.filter(group_id=group.id,date=now.date()).count()
            parts.append(f'👥 <b>{escape(group.name)}</b>\n   O\'quvchilar: <b>{count}</b>\n   Bugungi davomat: '+(f'✅ belgilangan ({marked})' if marked else '⚠️ hali belgilanmagan'))
        return '\n\n'.join(parts) or '👥 Sizga hali guruh biriktirilmagan.'
    if key=='grading':
        rows=list(m.TestAttempt.objects.filter(status='grading',student__group__teacher_id=user.id).select_related('student__user','test').order_by('finished_at')[:10])
        if not rows:return "✍️ Baholash navbati bo'sh. Barakalla! 🎉"
        lines='\n'.join(f'   • {escape(r.student.user.name)} — {escape(r.test.title)}' for r in rows)
        return f'✍️ <b>Baholash kutilmoqda: {len(rows)} ta</b>\n\n{lines}\n\n<i>Baholash saytdagi panelda amalga oshiriladi.</i>'
    if key=='today':
        from .statistics import dashboard
        data=dashboard();today=data['today'];paid=sum(m.Payment.objects.filter(year=now.year,month=now.month,state='paid').values_list('amount',flat=True))
        return f'📊 <b>Bugungi holat</b> — {date_uz(now)}\n\n👨‍🎓 O\'quvchilar: <b>{data["students"]}</b>\n👥 Guruhlar: <b>{data["groups"]}</b>\n\n<u>Bugungi davomat:</u>\n   ✅ Keldi: <b>{today["present"]}</b>\n   ❌ Kelmadi: <b>{today["absent"]}</b>\n   ⏰ Kechikdi: <b>{today["late"]}</b>\n'+('   <i>hali belgilanmagan</i>\n' if not today['marked'] else '')+f'\n💰 Bu oy tushum: <b>{money(paid)}</b>\n💸 Qarzdorlar: <b>{data["month"]["debtors"]}</b>\n✍️ Baholanmagan testlar: <b>{data["queue"]["grading"]}</b>'
    if key=='debtors':
        rows=[]
        for s in m.StudentProfile.objects.filter(user__is_active=True,group_id__isnull=False).select_related('user'):
            payment=m.Payment.objects.filter(student_id=s.user_id,year=now.year,month=now.month).first()
            if not payment or payment.state!='paid':rows.append((s,payment))
        if not rows:return f"✅ {MONTHS[now.month-1]} oyida qarzdor yo'q. Ajoyib!"
        lines='\n'.join(f'   • {escape(s.user.name)} — {escape(s.user.phone)} {label(p.state if p else "unpaid")}' for s,p in rows[:20]);more=f'\n\n<i>…va yana {len(rows)-20} ta</i>' if len(rows)>20 else ''
        return f'💸 <b>Qarzdorlar — {MONTHS[now.month-1]}</b> ({len(rows)} ta)\n\n{lines}{more}\n\n<i>Eslatma yuborish: admin panel → To\'lovlar → "Eslatma yuborish".</i>'
    per_role=dict(student="Tugmalar orqali ballaringiz, davomatingiz, to'lovlaringiz va test natijalaringizni ko'rasiz.",parent="Tugmalar orqali farzandingiz ballari, davomati, to'lovlari va test natijalarini kuzatasiz.",teacher="Guruhlaringiz va baholash navbatini ko'rasiz. Baholash saytdagi panelda bajariladi.",admin="Markazning bugungi holati va qarzdorlar ro'yxatini ko'rasiz. To'liq boshqaruv — admin panelda.",super_admin="Markazning bugungi holati va qarzdorlar. To'liq boshqaruv — admin panelda.")
    return 'ℹ️ <b>Yordam</b>\n\nBu bot orqali markaz yangiliklari va shaxsiy xabarlar keladi.\n\n<u>Buyruqlar:</u>\n/menu — menyuni ko\'rsatish\n/status — bog\'lanish holati\n/unlink — akkauntni uzish\n\n'+per_role.get(user.role,'')+"\n\nSavollar bo'lsa administratsiyaga murojaat qiling."


def handle(chat_id,text):
    user=find(chat_id,True)
    if not user:return False
    key=next((key for key,value in BTN.items() if value==text),None)
    if key is None:return False
    api.send(chat_id,text_for(user,key));return True
