"""Attendance-specific differential cases; invoked only in isolated local schemas."""
from psycopg import sql


def verify_attendance(call, db, schemas, ids, state, checks, client, tokens, port):
    call('PATCH','/v1/groups/{second}',{'teacherId':'{teacher}'})
    call('POST','/v1/groups/{second}/students',{'studentId':'{other_student}'})
    def mark(records, date='2026-10-01', role='super_admin', group='{second}', **kw):
        return call('PUT','/v1/attendance/bulk',dict(groupId=group,date=date,records=records),role=role,**kw)
    present=[dict(studentId='{student}',state='present')]
    for role in (None,'student','parent','other_parent','teacher','other_teacher','admin','super_admin'):
        call('GET','/v1/attendance?month=2026-10',role=role)
        call('GET','/v1/attendance?groupId={second}&month=2026-10',role=role)
        call('GET','/v1/attendance/stats?groupId={second}&month=2026-10',role=role)
        call('GET','/v1/stats/export/attendance?groupId={second}&month=2026-10',role=role)
        mark(present,role=role)
    for params in ('?groupId=missing','?groupId={group}','?groupId={second}&studentId={other_student}',
                   '?groupId=missing&studentId={student}','?groupId={group}&studentId={student}'):
        for role in ('student','parent','other_parent','teacher','admin'):
            call('GET','/v1/attendance'+params+'&month=2026-10',role=role)
    for path in ('/v1/attendance','/v1/attendance/stats','/v1/stats/export/attendance'):
        for query in ('?groupId={second}&month=2026-13','?groupId={second}&month=2026-1',
                      '?groupId={second}&month=bad','?groupId={second}&unknown=1',
                      '?groupId={second}&page=1','?groupId={second}&month=0000-01',
                      '?groupId={second}&month=0099-12','?groupId={second}&month=9999-12','?groupId='):
            call('GET',path+query)
    for body in ({},{'groupId':None,'date':'2026-10-01','records':present},
                 {'groupId':'{second}','date':None,'records':present},
                 {'groupId':'{second}','date':'2026-10-01','records':[]},
                 {'groupId':'{second}','date':'2026-10-01','records':'bad'},
                 {'groupId':'{second}','date':'2026-10-01','records':[None]},
                 {'groupId':'{second}','date':'2026-10-01','records':[{}]},
                 {'groupId':'{second}','date':'2026-10-01','records':[{'studentId':'{student}','state':'bad'}]},
                 {'groupId':'{second}','date':'2026-10-01','records':[{'studentId':'{student}','state':'present','markedById':'foreign'}]},
                 {'groupId':'{second}','date':'2026-10-01','records':present,'extra':True}):
        call('PUT','/v1/attendance/bulk',body)
    mark([dict(studentId='missing',state='present')])
    mark(present,group='missing')
    mark(present,group='{group}')
    for day in ('bad','2026-13-01','2026-00-01','2026-10-32','2026-10-01T00:30:00+05:00',
                '2026-10-31T23:59:00-05:00','2026-09-30','2026-11-01','2026-02-31',
                '2026','2026-10','20261009','2026-W41-1','2026-282','2026-10-01 12:00:00Z',
                '2026-04-31','2026-10-01T24:00:00Z','2026-10-01T25:00:00Z',
                '2026-10-01\n','2026-10-01\r\n','2026-10-01T12:00Z','2026-10-01T12Z',
                '+2026-10-01','-0001-10-01','２０２６-10-01'):
        mark(present,date=day,label='date:'+day)
    for records in ([dict(studentId='{student}',state='absent')],
                    [dict(studentId='{student}',state='absent')],
                    [dict(studentId='{student}',state='late')],
                    [dict(studentId='{student}',state='empty')],
                    [dict(studentId='{student}',state='blank')],
                    [dict(studentId='{student}',state='absent'),dict(studentId='{student}',state='absent')],
                    [dict(studentId='{student}',state='empty'),dict(studentId='{student}',state='present')],
                    [dict(studentId='{student}',state='absent'),dict(studentId='{student}',state='blank')],
                    [dict(studentId='{student}',state='present'),dict(studentId='{other_student}',state='late')]):
        mark(records)
    for side in (0,1):
        db.execute(sql.SQL('UPDATE {}."User" SET "isActive"=false WHERE id=%s').format(sql.Identifier(schemas[side])),(ids[side]['student'],))
    mark(present,label='inactive-student-cannot-mark')
    call('GET','/v1/attendance?month=2026-10',role='parent',label='inactive-history-retained')
    mark([dict(studentId='{other_student}',state='late')],label='inactive-other-member-does-not-block')
    for side in (0,1):
        db.execute(sql.SQL('UPDATE {}."User" SET "isActive"=true WHERE id=%s').format(sql.Identifier(schemas[side])),(ids[side]['student'],))
    for path in ('/v1/attendance','/v1/attendance/stats','/v1/stats/export/attendance'):
        call('GET',path+'?groupId={second}&month=2026-10')
        call('GET',path+'?groupId=missing&month=2026-10')
    # Names exercise CSV quoting/formula safety; statistics must keep locale sort.
    for side in (0,1):
        db.execute(sql.SQL('UPDATE {}."User" SET name=%s WHERE id=%s').format(sql.Identifier(schemas[side])),('=First;"quoted"\nName',ids[side]['student']))
    call('GET','/v1/stats/export/attendance?groupId={second}&month=2026-10',label='CSV-byte-and-header-contract')
    call('GET','/v1/attendance/stats?groupId={second}&month=2026-10',label='ICU-name-order')
    for left,right in [('éclair','Eagle'),('Alice','alice'),('Ali','Али'),("O'quvchi",'Öquvchi')]:
        for side in (0,1):
            for label,name in [('student',left),('other_student',right)]:
                db.execute(sql.SQL('UPDATE {}."User" SET name=%s WHERE id=%s').format(sql.Identifier(schemas[side])),(name,ids[side][label]))
        call('GET','/v1/attendance/stats?groupId={second}&month=2026-10',label='ICU:'+left+'/'+right)
    for side in (0,1):
        db.execute(sql.SQL('UPDATE {}."User" SET name=%s WHERE id=%s').format(sql.Identifier(schemas[side])),('student',ids[side]['student']))
        db.execute(sql.SQL('UPDATE {}."User" SET name=%s WHERE id=%s').format(sql.Identifier(schemas[side])),('other_student',ids[side]['other_student']))
    call('POST','/v1/groups/{group}/students',{'studentId':'{student}'},label='attendance-history-membership-move')
    call('GET','/v1/attendance?month=2026-10',role='student',label='history-survives-membership-move')
    call('GET','/v1/attendance?groupId={group}&month=2026-10',role='parent',label='parent-group-filter-remains-ignored')
    mark(present,label='former-member-cannot-mark-in-old-group')
    call('POST','/v1/groups/{second}/students',{'studentId':'{student}'})
    from apps.core import attendance
    from types import SimpleNamespace
    from unittest.mock import patch
    before=state(0);original=attendance.upsert
    counter=0
    def fail_second(*args,**kwargs):
        nonlocal counter
        counter+=1
        if counter==2: raise RuntimeError('injected attendance write failure')
        return original(*args,**kwargs)
    with patch.object(attendance,'upsert',side_effect=fail_second):
        try:
            attendance.bulk(SimpleNamespace(id=ids[0]['super_admin'],role='super_admin'),dict(groupId=ids[0]['second'],date='2026-10-12',records=[
                dict(studentId=ids[0]['student'],state='absent'),dict(studentId=ids[0]['other_student'],state='present')]))
        except RuntimeError: pass
        else: raise AssertionError('attendance fault injection did not execute')
    assert state(0)==before
    checks.append('Attendance: failed second write rolls back entire batch, audit and parent notifications')
    # Sequential re-saving an existing absence must neither replace creation time
    # nor generate another notification. Historical group rows remain independent.
    mark([dict(studentId='{student}',state='absent')],date='2026-10-15')
    created=[db.execute(sql.SQL('SELECT "createdAt" FROM {}."Attendance" WHERE "studentId"=%s AND "groupId"=%s AND date=\'2026-10-15\'').format(sql.Identifier(schemas[side])),(ids[side]['student'],ids[side]['second'])).fetchone()[0] for side in (0,1)]
    counts=[db.execute(sql.SQL('SELECT count(*) FROM {}."Notification" WHERE type=\'attendance\'').format(sql.Identifier(schemas[side]))).fetchone()[0] for side in (0,1)]
    mark([dict(studentId='{student}',state='absent')],date='2026-10-15',label='idempotent-absence-no-notification')
    for side in (0,1):
        assert db.execute(sql.SQL('SELECT "createdAt" FROM {}."Attendance" WHERE "studentId"=%s AND "groupId"=%s AND date=\'2026-10-15\'').format(sql.Identifier(schemas[side])),(ids[side]['student'],ids[side]['second'])).fetchone()[0]==created[side]
        assert db.execute(sql.SQL('SELECT count(*) FROM {}."Notification" WHERE type=\'attendance\'').format(sql.Identifier(schemas[side]))).fetchone()[0]==counts[side]
    checks.append('Attendance: repeat absence preserves creation timestamp and emits no extra notifications in both APIs')
    from common.auth.jwt import issue_access
    originals=[side['student'] for side in tokens]
    for side in (0,1): tokens[side]['student']=issue_access(ids[side]['student'],'admin')
    mark(present,role='student',label='forged-admin-claim-does-not-elevate-database-role')
    for side in (0,1): tokens[side]['student']=issue_access(ids[side]['student'],'receptionist')
    mark(present,role='student',label='no-invented-receptionist-grant')
    for side in (0,1): tokens[side]['student']=originals[side]
    verify_concurrency(db,schemas,ids,tokens,port,checks)


def verify_concurrency(db,schemas,ids,tokens,port,checks):
    import json
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from urllib.request import Request,urlopen
    from urllib.error import HTTPError
    from django.db import connections
    from rest_framework.test import APIClient
    for side in (0,1):
        for states,day in [(('present','present'),'2026-10-20'),(('absent','late'),'2026-10-21'),(('absent','absent'),'2026-10-21')]:
            if states==('absent','absent'):
                db.execute(sql.SQL('UPDATE {}."Attendance" SET state=\'absent\' WHERE "studentId"=%s AND "groupId"=%s AND date=%s::date').format(sql.Identifier(schemas[side])),(ids[side]['student'],ids[side]['second'],day))
            barrier=Barrier(2)
            before=db.execute(sql.SQL('SELECT count(*) FROM {}."Notification" WHERE type=\'attendance\'').format(sql.Identifier(schemas[side]))).fetchone()[0]
            def write(state):
                body=dict(groupId=ids[side]['second'],date=day,records=[dict(studentId=ids[side]['student'],state=state)])
                barrier.wait(timeout=10)
                if side==0:
                    client=APIClient();client.credentials(HTTP_AUTHORIZATION='Bearer '+tokens[0]['super_admin'])
                    try:
                        response=client.put('/v1/attendance/bulk',body,format='json')
                        return response.status_code,json.loads(response.content)
                    finally:connections.close_all()
                request=Request(f'http://127.0.0.1:{port}/v1/attendance/bulk',data=json.dumps(body).encode(),
                    headers={'Authorization':'Bearer '+tokens[1]['super_admin'],'Content-Type':'application/json'},method='PUT')
                try:response=urlopen(request,timeout=20)
                except HTTPError as error:response=error
                return response.status,json.loads(response.read())
            with ThreadPoolExecutor(max_workers=2) as executor:outcomes=list(executor.map(write,states))
            assert outcomes==[(200,dict(success=True,data=dict(updated=1,cleared=0)))]*2,outcomes
            rows=db.execute(sql.SQL('SELECT state,"createdAt" FROM {}."Attendance" WHERE "studentId"=%s AND "groupId"=%s AND date=%s::date').format(sql.Identifier(schemas[side])),(ids[side]['student'],ids[side]['second'],day)).fetchall()
            assert len(rows)==1 and rows[0][0] in states,rows
            after=db.execute(sql.SQL('SELECT count(*) FROM {}."Notification" WHERE type=\'attendance\'').format(sql.Identifier(schemas[side]))).fetchone()[0]
            if states==('present','present'): assert after==before
            elif states==('absent','late'): assert after==before+1
            else: assert after==before
            checks.append('Attendance: '+('Django' if side==0 else 'NestJS')+' concurrent '+str(states)+' both succeed with one row; notifications='+str(after-before))
