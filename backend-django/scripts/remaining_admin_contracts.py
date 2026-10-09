"""Remaining user, marketing content and statistics differential fixtures."""
def verify_admin(call):
    roles=(None,'student','parent','teacher','admin','super_admin')
    routes=[('GET','/v1/users'),('POST','/v1/users',{}),('GET','/v1/users/{student}'),('PATCH','/v1/users/{student}',{}),
        ('DELETE','/v1/users/missing'),('GET','/v1/gallery'),('POST','/v1/gallery',{}),('GET','/v1/gallery/all'),
        ('GET','/v1/gallery/missing/image'),('PATCH','/v1/gallery/missing',{}),('DELETE','/v1/gallery/missing'),
        ('GET','/v1/teachers'),('POST','/v1/teachers',{}),('GET','/v1/teachers/all'),('GET','/v1/teachers/missing/photo'),
        ('PATCH','/v1/teachers/missing',{}),('DELETE','/v1/teachers/missing'),('GET','/v1/stats/dashboard'),('GET','/v1/stats/income'),
        ('GET','/v1/stats/exam-activity'),('GET','/v1/stats/export/students'),('GET','/v1/stats/export/payments?year=2026')]
    for route in routes:
        for role in roles: call(*route,role=role,label='remaining-admin-role:'+str(role))
    for query in ('unknown=x','page=0','limit=101','page=abc','role=invalid','search=student','groupId={group}','role=student'):
        call('GET','/v1/users?'+query)
    for target,role in [('student','parent'),('other_student','parent'),('student','teacher'),('other_teacher','teacher'),('parent','parent'),('teacher','teacher')]:
        call('GET','/v1/users/{'+target+'}',role=role)
    base=dict(name='New student',phone='+998901110001',password='SafeLocalPassword!',role='student',groupId='{group}')
    for key,value in [('name','x'),('name',None),('phone','bad'),('password','short'),('role','invalid'),('groupId',1),('unexpected',1)]:
        call('POST','/v1/users',dict(base,**{key:value}))
    call('POST','/v1/users',dict(base,role='super_admin'))
    call('POST','/v1/users',dict(base,role='admin'),role='admin')
    call('POST','/v1/users',dict(base,groupId='missing'))
    call('POST','/v1/users',base,capture='new_student')
    call('POST','/v1/users',base)
    call('GET','/v1/users/{new_student}')
    call('PATCH','/v1/users/{new_student}',dict(name='Edited',isApproved=True,groupId=None,telegramChatId='local-fixture'))
    call('PATCH','/v1/users/{new_student}',dict(role='parent'),role='admin')
    call('PATCH','/v1/users/{new_student}',dict(role='super_admin'))
    call('PATCH','/v1/users/{new_student}',dict(role='parent'))
    call('GET','/v1/users/{new_student}')
    call('DELETE','/v1/users/{super_admin}')
    call('DELETE','/v1/users/{new_student}')
    call('GET','/v1/users/{new_student}')
    teacher=dict(name=' Teacher ',specialty=' IELTS ',bio=' Biography ',achievement='8.5',experienceYears='10',socialUrl='/teacher',sortOrder='2',isActive='false')
    for key,value in [('name','x'),('name',None),('specialty',1),('socialUrl','javascript:bad'),('experienceYears',81),('sortOrder',-1),('extra',1)]:
        call('POST','/v1/teachers',dict(teacher,**{key:value}))
    call('POST','/v1/teachers',teacher,capture='teacher_card')
    call('GET','/v1/teachers');call('GET','/v1/teachers/all')
    call('PATCH','/v1/teachers/{teacher_card}',dict(isActive='true',bio='',sortOrder=0))
    call('GET','/v1/teachers');call('GET','/v1/teachers/{teacher_card}/photo')
    call('PATCH','/v1/teachers/{teacher_card}',dict(name=None))
    call('DELETE','/v1/teachers/{teacher_card}',role='admin')
    call('DELETE','/v1/teachers/{teacher_card}')
    for query in ('unknown=1','months=0','months=25','months=abc','months=1','months=24'):call('GET','/v1/stats/income?'+query)
    for range in ('today','7d','30d','3m','6m','year','invalid'):call('GET','/v1/stats/exam-activity?range='+range)
    for query in ('','year=1999','year=2101','year=abc','year=2026&month=0','year=2026&month=13','year=2026&month=10','year=2026&unknown=x'):
        call('GET','/v1/stats/export/payments'+('?' if query else '')+query)
    call('GET','/v1/stats/export/students?groupId={group}')
    call('GET','/v1/stats/export/students?unknown=x')
    for kind,field,endpoint in [('gallery','image','image'),('teachers','photo','photo')]:
        body={'label':' Gallery ','alt':'Alt','link':'/safe','sortOrder':'1'} if kind=='gallery' else {'name':'Photo teacher','specialty':'IELTS'}
        path='/v1/'+kind;capture=kind+'_image'
        for name,mime in [('bad.svg','image/png'),('bad.png','text/html')]:call('POST',path,body,files={field:(name,b'fixture-image',mime)})
        call('POST',path,body,files={field:('photo.PNG',b'fixture-image','image/png')},capture=capture)
        call('GET',path+'/{'+capture+'}/'+endpoint,role=None)
        call('PATCH',path+'/{'+capture+'}',{},files={field:('new.webp',b'new-image','image/webp')})
        call('GET',path+'/{'+capture+'}/'+endpoint,role=None)
        call('DELETE',path+'/{'+capture+'}')
        call('GET',path+'/{'+capture+'}/'+endpoint,role=None)
    video=dict(title='Paid video',price='50000',isFreeForApproved='false',description='Local fixture')
    for role in roles:
        for route in [('GET','/v1/videos'),('POST','/v1/videos',{}),('GET','/v1/videos/purchases'),('GET','/v1/videos/missing/stream-url'),
            ('POST','/v1/videos/missing/purchase'),('POST','/v1/videos/missing/confirm-purchase',{}),('PATCH','/v1/videos/missing',{}),('DELETE','/v1/videos/missing')]:call(*route,role=role)
    call('GET','/v1/videos/stream',role=None)
    call('GET','/v1/videos/missing/thumbnail',role=None)
    for field,file in [('file',('bad.html',b'bad','video/mp4')),('thumbnail',('bad.svg',b'bad','image/png'))]:call('POST','/v1/videos',video,files={field:file})
    call('POST','/v1/videos',video,files={'file':('video.mp4',b'0123456789','video/mp4'),'thumbnail':('thumb.png',b'thumb','image/png')},capture='video')
    call('GET','/v1/videos',role=None);call('GET','/v1/videos',role='student')
    call('GET','/v1/videos/{video}/thumbnail',role=None)
    call('GET','/v1/videos/{video}/stream-url',role='student')
    call('POST','/v1/videos/{video}/purchase',role='student');call('POST','/v1/videos/{video}/purchase',role='student')
    call('GET','/v1/videos/purchases?status=pending_confirmation')
    call('GET','/v1/videos/{video}/stream-url',role='student')
    call('POST','/v1/videos/{video}/confirm-purchase',{'userId':'missing'})
    call('POST','/v1/videos/{video}/confirm-purchase',{'userId':'{student}'})
    call('POST','/v1/videos/{video}/purchase',role='student')
    call('GET','/v1/videos/purchases?status=purchased')
    call('PATCH','/v1/videos/{video}',{'price':0,'isFreeForApproved':True})
    call('GET','/v1/videos',role='other_student')
    call('DELETE','/v1/videos/{video}')
