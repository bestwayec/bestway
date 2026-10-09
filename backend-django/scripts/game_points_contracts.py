"""Game/points API and lifecycle comparisons in the harness's disposable schemas."""
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4
from psycopg import sql
from django.utils import timezone
from apps.core import game, points


def verify_game_points(call,db,schemas,ids,state,checks,control,tokens,port):
    now=timezone.localtime();current=game.period_key();previous=now.replace(day=1)-timedelta(days=1)
    old=f'{previous.year}-{previous.month:02d}'
    call('PATCH','/v1/settings',dict(initialPoints=100,teacherPointLimit=20,gameThreshold=150))
    def seed(label,**fields):
        columns=dict(current_points='currentPoints',points_period='pointsPeriod',game_qualified='gameQualified',qualified_at='qualifiedAt')
        for side in (0,1):
            parts=[sql.SQL('{}=%s').format(sql.Identifier(columns[key])) for key in fields]
            db.execute(sql.SQL('UPDATE {}."StudentProfile" SET {} WHERE "userId"=%s').format(
                sql.Identifier(schemas[side]),sql.SQL(',').join(parts)),(*fields.values(),ids[side][label]))
    seed('student',current_points=140,points_period=None,game_qualified=False,qualified_at=None)
    seed('other_student',current_points=140,points_period=current,game_qualified=False,qualified_at=None)
    for side in (0,1):
        for label,stamp in [('student','2020-01-01'),('other_student','2020-01-02')]:
            db.execute(sql.SQL('UPDATE {}."StudentProfile" SET "createdAt"=%s::timestamp WHERE "userId"=%s').format(sql.Identifier(schemas[side])),(stamp,ids[side][label]))
    for role in (None,'student','parent','other_parent','teacher','other_teacher','admin','super_admin'):
        call('GET','/v1/game/roster',role=role)
        call('GET','/v1/game/roster/export',role=role)
        call('GET','/v1/game/status?ignored=anything',role=role)
        call('GET','/v1/points/leaderboard',role=role)
        call('GET','/v1/points/{student}',role=role)
        call('POST','/v1/points/{student}/adjust',dict(change=1,reason='Role check'),role=role)
    for path in ('/v1/game/roster','/v1/game/roster/export'):
        for query in ('?year=2000','?month=1','?year=2100&month=12','?year=1999','?year=2101','?month=0','?month=13',
                      '?year=bad','?year=2026.5','?unknown=1'):
            call('GET',path+query)
    for query in ('?limit=1','?limit=100','?limit=0','?limit=101','?limit=1.5','?limit=bad',
                  '?groupId={second}','?groupId=missing','?page=1'):
        call('GET','/v1/points/leaderboard'+query,role=None)
    for label in ('{other_student}','missing'):
        for role in ('student','parent','teacher','other_teacher','admin'):
            call('GET','/v1/points/'+label,role=role)
            call('POST','/v1/points/'+label+'/adjust',dict(change=1,reason='Access check'),role=role)
    for body in ({},{'change':0,'reason':'Zero'},{'change':1.5,'reason':'Float'},
                 {'change':'bad','reason':'Invalid number'},{'change':None,'reason':'Null'},
                 {'change':1,'reason':'xx'},{'change':1,'reason':None},{'change':1,'reason':'x'*301},
                 {'change':1,'reason':'Extra field','currentPoints':10000},
                 {'change':'2','reason':'String coercion'},{'change':True,'reason':'Boolean coercion'},
                 {'change':'0x02','reason':'Hex coercion'},{'change':[],'reason':'Array rejected'},
                 {'change':2147483648,'reason':'Integer overflow'}):
        call('POST','/v1/points/{student}/adjust',body)
    for amount in (20,21,-20,-21):
        call('POST','/v1/points/{student}/adjust',dict(change=amount,reason='Teacher limit'),role='teacher')
    # Sticky qualification persists when points drop below the threshold.
    seed('student',current_points=149,points_period=current,game_qualified=False,qualified_at=None)
    call('POST','/v1/points/{student}/adjust',dict(change=1,reason='Exact threshold'))
    call('POST','/v1/points/{student}/adjust',dict(change=-200,reason='Below threshold allowed'))
    call('GET','/v1/game/status',role='student')
    call('GET','/v1/game/roster')
    call('GET','/v1/game/roster/export')
    # Historical status is a read projection, not an implicit reset mutation.
    seed('student',current_points=250,points_period=old,game_qualified=True,qualified_at=timezone.now())
    call('GET','/v1/game/status',role='student')
    call('GET','/v1/points/{student}')
    call('GET','/v1/points/leaderboard',role=None)
    call('POST','/v1/points/{student}/adjust',dict(change=5,reason='Reset before increment'))
    archive_times=[db.execute(sql.SQL('SELECT "createdAt" FROM {}."MonthlyPointsArchive" WHERE "studentId"=%s AND year=%s AND month=%s').format(sql.Identifier(schemas[side])),(ids[side]['student'],previous.year,previous.month)).fetchone()[0] for side in (0,1)]
    call('GET',f'/v1/game/roster?year={previous.year}&month={previous.month}')
    call('GET',f'/v1/game/roster/export?year={previous.year}&month={previous.month}')
    # The source allows staff adjustment of inactive targets, but excludes them
    # from public leaderboard and roster. Do not invent a blocked-student rule.
    for side in (0,1):
        db.execute(sql.SQL('UPDATE {}."User" SET "isActive"=false WHERE id=%s').format(sql.Identifier(schemas[side])),(ids[side]['student'],))
    call('POST','/v1/points/{student}/adjust',dict(change=50,reason='Inactive target reference'))
    call('GET','/v1/points/leaderboard',role=None)
    call('GET','/v1/game/roster')
    for side in (0,1):
        db.execute(sql.SQL('UPDATE {}."User" SET "isActive"=true WHERE id=%s').format(sql.Identifier(schemas[side])),(ids[side]['student'],))
    seed('student',current_points=330,points_period=old,game_qualified=True)
    seed('other_student',current_points=17,points_period=None,game_qualified=False)
    # Explicit real-service lifecycle invocation, never an invented HTTP route.
    rolled=game.rollover_stale();reference=control('rollover')
    assert reference==dict(ok=True,result=rolled) and rolled==2
    assert state(0)==state(1)
    assert game.rollover_stale()==0 and control('rollover')==dict(ok=True,result=0)
    assert state(0)==state(1)
    checks.append('Game/points: rollover archives stale periods, preserves null-period points and is idempotent in both services')
    seed('student',current_points=420,points_period=old,game_qualified=True)
    game.startup_recovery();assert control('startup')['ok']
    assert state(0)==state(1)
    seed('student',current_points=430,points_period=old,game_qualified=False)
    game.monthly_reset();assert control('monthly')['ok']
    assert state(0)==state(1)
    checks.append('Game/points: real startup recovery and monthly reset match reference database effects')
    for side in (0,1):
        assert db.execute(sql.SQL('SELECT "createdAt" FROM {}."MonthlyPointsArchive" WHERE "studentId"=%s AND year=%s AND month=%s').format(sql.Identifier(schemas[side])),(ids[side]['student'],previous.year,previous.month)).fetchone()[0]==archive_times[side]
    checks.append('Game/points: repeated archive upsert preserves the exact original creation timestamp')
    call('GET',f'/v1/game/roster?year={previous.year}&month={previous.month}')
    # Rollback includes period archive/reset, points increment, history and audit.
    seed('student',current_points=270,points_period=old,game_qualified=True)
    before=state(0)
    with patch.object(points.PointsLog.objects,'create',side_effect=RuntimeError('injected points history failure')):
        try:points.adjust(SimpleNamespace(id=ids[0]['super_admin'],role='super_admin'),ids[0]['student'],dict(change=10,reason='Failure fixture'))
        except RuntimeError:pass
        else:raise AssertionError('fault injection did not execute')
    assert state(0)==before
    checks.append('Game/points: history-write failure rolls back archive/reset/increment and emits no audit or notifications')
    # Management worker executes against this same isolated Django schema only.
    from django.core.management import call_command
    call_command('run_game_scheduler',once=True)
    assert control('startup')['ok'] and state(0)==state(1)
    checks.append('Game/points: real Django scheduler --once startup matches Nest startup recovery')
    call('PATCH','/v1/settings',dict(teacherPointLimit=None,gameThreshold=None,initialPoints=None))
    call('POST','/v1/points/{student}/adjust',dict(change=1,reason='Null teacher limit'),role='teacher')
    seed('student',current_points=220,points_period=old,game_qualified=True)
    call('GET','/v1/game/status',role='student',label='null-initial-points-status-coercion')
    call('POST','/v1/points/{student}/adjust',dict(change=1,reason='Null reset rolls back'))
    seed('student',current_points=-1,points_period=current,game_qualified=False,qualified_at=None)
    call('POST','/v1/points/{student}/adjust',dict(change=1,reason='Null threshold coerces zero'))
    call('GET','/v1/game/status',role='student')
    call('PATCH','/v1/settings',dict(initialPoints=100,teacherPointLimit=20,gameThreshold=10000))
    assert control('notificationFailure',type='points')['ok']
    with patch('apps.core.notifications.notify_many',side_effect=RuntimeError('injected safe notification failure')):
        call('POST','/v1/points/{student}/adjust',dict(change=1,reason='Safe notification failure'),label='safe-notification-failure-preserves-201')
    assert control('notificationFailure')['ok']
    call('PATCH','/v1/settings',dict(gameThreshold=150))
    seed('student',current_points=149,points_period=current,game_qualified=False,qualified_at=None)
    assert control('notificationFailure',type='game')['ok']
    with patch('apps.core.game.notify_many',side_effect=RuntimeError('injected awaited notification failure')):
        call('POST','/v1/points/{student}/adjust',dict(change=1,reason='Awaited notification failure'),label='game-failure-preserves-committed-points-and-qualified-flag')
    assert control('notificationFailure')['ok']
    checks.append('Game/points: safe points-notification failures retain success; awaited game failures match reference post-commit 500 and persisted state')
    # Real scheduler callback is driven across a monthly boundary without sleeping.
    from apps.core import game_scheduler
    from datetime import datetime
    start=datetime(now.year,now.month,1,tzinfo=game_scheduler.ZONE)-timedelta(seconds=1)
    due=game_scheduler.next_due(start)
    seed('student',current_points=201,points_period=old,game_qualified=True)
    seed('other_student',current_points=17,points_period=old,game_qualified=False)
    class StopAfterTick:
        stopped=False
        def is_set(self):return self.stopped
        def wait(self,_):self.stopped=True
    ticks=iter([start,due,due])
    clock=[start]
    def advance_clock():
        clock[0]=next(ticks)
        return clock[0]
    with patch.object(game,'period_key',side_effect=lambda:f'{clock[0].year}-{clock[0].month:02d}'):
        game_scheduler.run(StopAfterTick(),now=advance_clock)
    assert control('monthly')['ok'] and state(0)==state(1)
    checks.append('Game/points: actual scheduled monthly callback matches Nest reset at 00:05 Asia/Tashkent')
    # Seed legacy history entries to verify unknown/system author names and 100 cap.
    for side in (0,1):
        for index in range(101):
            db.execute(sql.SQL('INSERT INTO {}."PointsLog" (id,"studentId",change,reason,"byUserId","createdAt") VALUES (%s,%s,1,%s,%s,\'2000-01-01\'::timestamp+%s*interval \'1 second\')').format(sql.Identifier(schemas[side])),
                (str(uuid4()),ids[side]['student'],'Legacy history '+str(index),None if index%2==0 else 'missing-staff',index))
    call('GET','/v1/points/{student}',label='history-100-cap-system-and-missing-author-names')
    # Cross-API request comparisons must finish before concurrent winner tests:
    # their legitimate notification winner may differ between isolated APIs.


def verify_concurrency(db,schemas,ids,tokens,port,checks,control,current,old):
    import json
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from urllib.request import Request,urlopen
    from urllib.error import HTTPError
    from django.db import connections
    from rest_framework.test import APIClient
    for side,period,base,final,game_messages in ((0,current,140,160,2),(1,current,140,160,2),
                                               (0,old,200,120,0),(1,old,200,120,0)):
        db.execute(sql.SQL('UPDATE {}."StudentProfile" SET "currentPoints"=%s,"pointsPeriod"=%s,"gameQualified"=false,"qualifiedAt"=null WHERE "userId"=%s').format(sql.Identifier(schemas[side])),(base,period,ids[side]['student']))
        before_log=db.execute(sql.SQL('SELECT count(*) FROM {}."PointsLog"').format(sql.Identifier(schemas[side]))).fetchone()[0]
        before_game=db.execute(sql.SQL('SELECT count(*) FROM {}."Notification" WHERE type=\'game\'').format(sql.Identifier(schemas[side]))).fetchone()[0]
        before_points=db.execute(sql.SQL('SELECT count(*) FROM {}."Notification" WHERE type=\'points\'').format(sql.Identifier(schemas[side]))).fetchone()[0]
        barrier=Barrier(2)
        def change(amount):
            body=dict(change=amount,reason='Concurrent increment');barrier.wait(timeout=10)
            if side==0:
                client=APIClient();client.credentials(HTTP_AUTHORIZATION='Bearer '+tokens[0]['super_admin'])
                try:
                    response=client.post('/v1/points/'+ids[0]['student']+'/adjust',body,format='json')
                    return response.status_code,json.loads(response.content)
                finally:connections.close_all()
            request=Request(f'http://127.0.0.1:{port}/v1/points/'+ids[1]['student']+'/adjust',data=json.dumps(body).encode(),
                headers={'Authorization':'Bearer '+tokens[1]['super_admin'],'Content-Type':'application/json'},method='POST')
            try:response=urlopen(request,timeout=20)
            except HTTPError as error:response=error
            return response.status,json.loads(response.read())
        with ThreadPoolExecutor(max_workers=2) as executor:outcomes=list(executor.map(change,[10,10]))
        assert sorted(outcomes,key=lambda v:v[1]['data']['current'])==[
            (201,dict(success=True,data=dict(current=final-10))),(201,dict(success=True,data=dict(current=final)))],outcomes
        assert control('drain')['ok']
        profile=db.execute(sql.SQL('SELECT "currentPoints","gameQualified" FROM {}."StudentProfile" WHERE "userId"=%s').format(sql.Identifier(schemas[side])),(ids[side]['student'],)).fetchone()
        assert profile==(final,bool(game_messages)),profile
        assert db.execute(sql.SQL('SELECT count(*) FROM {}."PointsLog"').format(sql.Identifier(schemas[side]))).fetchone()[0]==before_log+2
        assert db.execute(sql.SQL('SELECT count(*) FROM {}."Notification" WHERE type=\'game\'').format(sql.Identifier(schemas[side]))).fetchone()[0]==before_game+game_messages
        assert db.execute(sql.SQL('SELECT count(*) FROM {}."Notification" WHERE type=\'points\'').format(sql.Identifier(schemas[side]))).fetchone()[0]==before_points+4
        if period==old:
            year,month=map(int,old.split('-'))
            rows=db.execute(sql.SQL('SELECT points FROM {}."MonthlyPointsArchive" WHERE "studentId"=%s AND year=%s AND month=%s').format(sql.Identifier(schemas[side])),(ids[side]['student'],year,month)).fetchall()
            assert rows==[(200,)],rows
        checks.append('Game/points: '+('Django' if side==0 else 'NestJS')+' concurrent '+('rollover/increments' if period==old else 'qualification/increments')+f' persist {final}, two history rows, four points notices and {game_messages} game notices')
